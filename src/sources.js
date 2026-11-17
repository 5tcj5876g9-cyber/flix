import { readFileSync } from 'node:fs';
import { config } from './config.js';
import { cleanupProbes, getProbe, setProbe } from './db.js';
import { normalize, titleTokens } from './norm.js';

/*
 * المصادر:
 *   stream  — سيرفرات امبد من registry.json (مفحوصة على الشبكة)
 *   torrent — فهارس مفتوحة (apibay / yts) للتحميل
 *
 * نقرأ الـregistry مرة عند الإقلاع: أي مزوّد جديد ينضاف بلا تعديل كود.
 */

const REGISTRY = JSON.parse(readFileSync(new URL('./providers/registry.json', import.meta.url), 'utf8'));

function fillTemplate(template, { tmdbId, imdbId, season = 1, episode = 1 }) {
  if (!template) return null;
  const tmdb = tmdbId ? String(tmdbId) : '';
  const imdb = imdbId ? String(imdbId) : '';
  const id = tmdb || imdb;
  if (!id) return null;

  const url = template
    .replaceAll('{tmdb}', id)
    .replaceAll('{imdb}', imdb || tmdb)
    .replaceAll('{season}', String(season))
    .replaceAll('{episode}', String(episode));

  if (url.includes('undefined') || url.includes('null')) return null;
  return /^https:\/\//.test(url) ? url : null;
}

export const SERVERS = REGISTRY
  .filter((provider) => provider.status !== 'dead')
  .map((provider) => ({
    id: provider.id,
    label: provider.label,
    verified: provider.status === 'live',
    movieUrl: ({ tmdbId, imdbId }) => {
      const value = tmdbId || (provider.supportsImdb ? imdbId : null);
      if (!value) return null;
      return fillTemplate(provider.movieUrlTemplate, { tmdbId: tmdbId ?? null, imdbId: imdbId ?? null });
    },
    tvUrl: ({ tmdbId, imdbId, season, episode }) => {
      if (!tmdbId) return null;
      return fillTemplate(provider.tvUrlTemplate, { tmdbId, imdbId: imdbId ?? null, season, episode });
    },
  }));

export const frameHosts = [
  ...new Set(
    REGISTRY.filter((p) => p.status !== 'dead')
      .flatMap((p) => [p.movieUrlTemplate, p.tvUrlTemplate])
      .filter(Boolean)
      .map((template) => {
        try {
          return new URL(template.replaceAll('{tmdb}', '1').replaceAll('{imdb}', 'tt0000001').replaceAll('{season}', '1').replaceAll('{episode}', '1')).host;
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  ),
];

export function buildUrl(server, ctx) {
  const url = ctx.type === 'tv' ? server.tvUrl(ctx) : server.movieUrl(ctx);
  return url && /^https:\/\//.test(url) ? url : null;
}

/* ------------------------------- upstream -------------------------------- */

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1?\]?)$/i;

function safeUpstream(raw) {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== 'https:') return null;
    if (PRIVATE_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function readLimited(res, maxBytes = 2_000_000) {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) return null;

  const reader = res.body?.getReader();
  if (!reader) return null;

  let received = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function fetchJson(url, maxBytes = 2_000_000) {
  const target = safeUpstream(url);
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { accept: 'application/json', 'user-agent': config.userAgent },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const text = await readLimited(res, maxBytes);
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- probing -------------------------------- */

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  async run(task) {
    if (this.active >= this.limit) await new Promise((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}

const probeGate = new Semaphore(Number(process.env.PROBE_GLOBAL_LIMIT ?? 8));

async function probeOne(url) {
  const target = safeUpstream(url);
  if (!target) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.probeTimeoutMs);
  try {
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'user-agent': config.userAgent, accept: 'text/html,application/xhtml+xml' },
    });
    const alive = res.ok || res.status === 403 || res.status === 429 || (res.status >= 300 && res.status < 400);
    await res.body?.cancel().catch(() => {});
    return alive;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * probe=false للرندر الأول: كاش فقط + افتراض «حي» للمجهول.
 * الصفحة ما تنتظر ست بروبات، والعميل يحدّث الحالة عبر /api/servers.
 */
export async function resolveServers({
  type,
  uid,
  tmdbId = null,
  imdbId = null,
  season = 1,
  episode = 1,
  probe = true,
}) {
  const ctx = { type, tmdbId, imdbId, season, episode };
  const now = Date.now();

  const candidates = SERVERS.map((server) => {
    const cached = getProbe(uid, server.id, season, episode);
    const fresh = cached && now - Number(cached.checked_at) < config.probeTtlMs;
    return { server, fresh, ok: fresh ? Boolean(cached.ok) : probe ? null : true };
  }).filter((c) => buildUrl(c.server, ctx));

  const unknown = candidates.filter((c) => !c.fresh).map((c) => c.server);

  if (probe && unknown.length > 0) {
    const verdicts = await mapLimit(unknown, config.probeConcurrency, (server) =>
      probeGate.run(() => probeOne(buildUrl(server, ctx))),
    );
    unknown.forEach((server, index) => {
      const ok = Boolean(verdicts[index]);
      setProbe(uid, server.id, ok, season, episode);
      const entry = candidates.find((c) => c.server === server);
      if (entry) {
        entry.ok = ok;
        entry.fresh = true;
      }
    });
  }

  return candidates
    .map(({ server, ok }) => ({
      id: server.id,
      label: server.label,
      url: buildUrl(server, ctx),
      ok: Boolean(ok),
    }))
    .sort((a, b) => Number(b.ok) - Number(a.ok));
}

/* ------------------------------- downloads ------------------------------- */

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://9.rarbg.com:2810/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
];

const HASH = /^[a-f0-9]{40}$/i;

function magnet(infoHash, name) {
  if (!HASH.test(infoHash)) return null;
  const trackers = TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(name)}${trackers}`;
}

async function apibaySearch(title, year) {
  const query = `${title} ${year ?? ''}`.trim();
  const data = await fetchJson(`https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=0`);
  if (!Array.isArray(data)) return [];

  const tokens = titleTokens(title, year);

  return data
    .filter((item) => item && item.info_hash && item.name && item.id !== '0')
    .filter((item) => {
      const name = normalize(item.name);
      const hits = tokens.filter((token) => name.includes(token)).length;
      return hits >= Math.max(1, Math.ceil(tokens.length * 0.5));
    })
    .map((item) => {
      const name = String(item.name).slice(0, 200);
      return {
        source: 'apibay',
        name,
        size: Number(item.size) || 0,
        seeders: Number(item.seeders) || 0,
        leechers: Number(item.leechers) || 0,
        magnet: magnet(String(item.info_hash), name),
      };
    })
    .filter((item) => item.magnet)
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 15);
}

async function ytsDownloadSearch(imdbId) {
  if (!imdbId) return [];
  const data = await fetchJson(
    `https://yts.lt/api/v2/list_movies.json?query_term=${encodeURIComponent(imdbId)}&limit=5`,
  );
  const movies = data?.data?.movies ?? [];
  const out = [];
  for (const movie of movies) {
    for (const torrent of movie.torrents ?? []) {
      const name = `${movie.title_long ?? movie.title} [${torrent.quality} ${torrent.type}]`.slice(0, 200);
      const link = magnet(String(torrent.hash), name);
      if (!link) continue;
      out.push({
        source: 'yts',
        name,
        size: Number(torrent.size_bytes) || 0,
        seeders: Number(torrent.seeds) || 0,
        leechers: Number(torrent.peers) || 0,
        magnet: link,
      });
    }
  }
  return out.slice(0, 10);
}

export async function findDownloads({ title, year, imdbId }) {
  const [bay, yts] = await Promise.all([
    apibaySearch(title, year).catch(() => []),
    ytsDownloadSearch(imdbId).catch(() => []),
  ]);
  const seen = new Set();
  const all = [...yts, ...bay].filter((item) => {
    if (!item.magnet || seen.has(item.magnet)) return false;
    seen.add(item.magnet);
    return true;
  });
  all.sort((a, b) => b.seeders - a.seeders);
  return all.slice(0, 20);
}

setInterval(() => {
  try {
    cleanupProbes();
  } catch {
    /* التنظيف مو حرج */
  }
}, 6 * 60 * 60 * 1000).unref();

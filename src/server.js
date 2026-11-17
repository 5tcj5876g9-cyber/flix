import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute as isAbsolutePath, join, relative as pathRelative, resolve as pathResolve } from 'node:path';
import { config, hasTmdb } from './config.js';
import { countAll, cleanupProbes, db, getMedia, searchLocal, setImdb, upsertMany } from './db.js';
import { discover, details, findImdbId, searchMulti } from './tmdb.js';
import { findDownloads, frameHosts, resolveServers } from './sources.js';
import { adminAllowed, cached, clientIp, RateLimiter, securityHeaders, TtlCache } from './security.js';
import { burstGuard } from './burst.js';
import { errorHtml, homeHtml, watchHtml } from './views.js';
import { ingest } from './ingest.js';
import { subtitleSearch } from './subs.js';
import { ytsByImdb, ytsList, ytsScanLanguage, ytsSearch } from './yts.js';
import { intentFor } from './intent.js';

const PUBLIC_DIR = pathResolve(process.cwd(), 'public');
const RATE = new RateLimiter({ capacity: 90, refillPerSecond: 1.5 });
const API_CACHE = new TtlCache({ ttlMs: 300_000, max: 800 });
const KIND_CACHE = new Set(['trending', 'netflix', 'korean', 'asian', 'top_rated', 'tv_popular', 'popular', 'upcoming']);

let ingestRunning = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const json = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const html = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const int = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanType = (value) => (value === 'tv' ? 'tv' : 'movie');
const KEY = /^(\d{1,9}|tt\d{7,10})$/i;

function parseKey(raw) {
  const value = String(raw ?? '');
  if (/^tt\d{7,10}$/i.test(value)) return { imdbId: value.toLowerCase() };
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? { tmdbId: numeric } : null;
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = pathResolve(join(PUBLIC_DIR, relative));
  const rel = pathRelative(PUBLIC_DIR, target);
  if (rel.startsWith('..') || isAbsolutePath(rel)) return false;

  try {
    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    const etag = `"${createHash('sha1').update(data).digest('base64url').slice(0, 20)}"`;

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return true;
    }

    const immutable = /\.(png|jpe?g|webp|svg|ico|woff2?)$/i.test(target);
    res.writeHead(200, {
      'content-type': type,
      'content-length': data.byteLength,
      'cache-control': immutable ? 'public, max-age=2592000, immutable' : 'no-cache',
      etag,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
    return true;
  } catch {
    return false;
  }
}

/**
 * يجيب العنوان من الكاش المحلي، وإن ما كان موجود:
 * TMDB للأرقام، YTS لمعرّفات IMDb — بدون أي مفتاح.
 */
async function ensureMedia(type, key) {
  const raw = String(key ?? '');
  const local = getMedia(type, raw);
  if (local && Date.now() - Number(local.updated_at) < 7 * 86_400_000) return local;

  try {
    if (/^tt\d{7,10}$/i.test(raw)) {
      const row = await cached(API_CACHE, `title:${type}:${raw}`, () => ytsByImdb(raw.toLowerCase()));
      if (row) upsertMany([row]);
    } else if (hasTmdb) {
      const tmdbId = Number(raw);
      if (Number.isFinite(tmdbId) && tmdbId > 0) {
        const row = await cached(API_CACHE, `title:${type}:${tmdbId}`, () => details(type, tmdbId));
        if (row) upsertMany([row]);
      }
    }
  } catch {
    /* الكاش المحلي يكفي */
  }

  return getMedia(type, raw) ?? local;
}

/** بحث موحّد: محلي أولاً، بعدها TMDB أو YTS حسب المتاح. */
async function unifiedSearch({ query, type, page, netflix }) {
  // "كوري" و"رعب" طلبات قائمة، مو أسماء أفلام.
  const intent = intentFor(query);
  if (intent?.kind) {
    const browsed = await browseItems(intent.kind, page);
    return { items: browsed.items, total: browsed.items.length, source: 'intent' };
  }
  if (intent?.genre) {
    try {
      const items = await cached(API_CACHE, `yts:genre:${intent.genre}:${page}`, () =>
        ytsList({ page, genre: intent.genre, sortBy: 'rating', minimumRating: 5 }),
      );
      if (items.length) {
        upsertMany(items);
        return { items, total: items.length, source: 'intent' };
      }
    } catch {
      /* انزل للبحث النصي */
    }
  }

  const filters = {
    q: query,
    type,
    netflix,
    sort: 'popularity',
    limit: 30,
    offset: (page - 1) * 30,
  };

  const local = searchLocal(filters);
  if (!query || page > 10 || local.rows.length >= 12) {
    return { items: local.rows, total: local.total, source: 'local' };
  }

  const remote = [];
  if (hasTmdb) {
    try {
      remote.push(...(await cached(API_CACHE, `search:${query}:${page}:${type ?? 'multi'}`, () => searchMulti(query, page))));
    } catch {
      /* تجاهل */
    }
  }
  try {
    remote.push(...(await cached(API_CACHE, `yts:${query}:${page}`, () => ytsSearch(query, page))));
  } catch {
    /* تجاهل */
  }

  if (remote.length) {
    upsertMany(remote);
    const fresh = searchLocal(filters);
    if (fresh.rows.length) return { items: fresh.rows, total: Math.max(fresh.total, local.total), source: 'remote' };
  }

  return { items: local.rows, total: local.total, source: 'local' };
}

async function browseItems(kind, page) {
  if (hasTmdb) {
    try {
      const items = await cached(API_CACHE, `browse:${kind}:${page}`, () => discover(kind, page));
      if (items.length) {
        upsertMany(items);
        return { items, source: 'tmdb' };
      }
    } catch {
      /* انزل على YTS */
    }
  }

  const LANGUAGE_SETS = {
    korean: ['ko', 'kor'],
    asian: ['ko', 'kor', 'ja', 'jpn', 'zh', 'cn', 'chi', 'th', 'tha', 'hi', 'hin', 'id', 'ind', 'vi', 'vie', 'tl', 'fil'],
  };

  if (LANGUAGE_SETS[kind]) {
    const local = searchLocal({ language: LANGUAGE_SETS[kind][0], sort: 'rating', limit: 30, offset: (page - 1) * 30 });
    if (local.rows.length >= 12 || page > 1) return { items: local.rows, source: 'local' };

    const scanned = await cached(API_CACHE, `yts:lang:${kind}:${page}`, () =>
      ytsScanLanguage(LANGUAGE_SETS[kind], 10),
    );
    if (scanned.length) {
      upsertMany(scanned);
      const fresh = searchLocal({ language: LANGUAGE_SETS[kind][0], sort: 'rating', limit: 30, offset: (page - 1) * 30 });
      if (fresh.rows.length) return { items: fresh.rows, source: 'yts-scan' };
    }
  }

  try {
    const items =
      kind === 'top_rated'
        ? await cached(API_CACHE, `yts:top:${page}`, () => ytsList({ page, sortBy: 'rating', minimumRating: 6 }))
        : await cached(API_CACHE, `yts:popular:${page}`, () => ytsList({ page, sortBy: 'download_count' }));
    if (items.length) {
      upsertMany(items);
      return { items, source: 'yts' };
    }
  } catch {
    /* انزل على المحلي */
  }

  const local = searchLocal({ sort: 'popularity', limit: 30, offset: (page - 1) * 30 });
  return { items: local.rows, source: 'local' };
}

function healthPayload() {
  return {
    ok: true,
    uptime: Math.round(process.uptime()),
    catalog: countAll(),
    tmdb: hasTmdb,
    cache: API_CACHE.store.size,
  };
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  if (route === '/api/search') {
    const query = String(url.searchParams.get('q') ?? '').trim().slice(0, 120);
    const page = Math.min(Math.max(int(url.searchParams.get('page'), 1), 1), 200);
    const typeParam = url.searchParams.get('type');
    const type = typeParam === 'movie' || typeParam === 'tv' ? typeParam : undefined;
    const netflixParam = url.searchParams.get('netflix');
    const netflix = netflixParam === '1' ? true : netflixParam === '0' ? false : undefined;

    const result = await unifiedSearch({ query, type, page, netflix });
    return json(res, 200, { items: result.items, total: result.total, page, source: result.source });
  }

  if (route === '/api/browse') {
    const requested = String(url.searchParams.get('kind') ?? 'trending');
    const kind = KIND_CACHE.has(requested) ? requested : 'trending';
    const page = Math.min(Math.max(int(url.searchParams.get('page'), 1), 1), 200);
    const result = await browseItems(kind, page);
    return json(res, 200, { items: result.items, total: result.items.length, page, source: result.source });
  }

  const match = route.match(/^\/api\/(title|servers|downloads|subtitles)\/(movie|tv)\/([^/]{1,16})$/);
  if (match) {
    const [, action, rawType, rawKey] = match;
    if (!KEY.test(rawKey)) return json(res, 400, { error: 'bad id' });
    const type = cleanType(rawType);
    const media = await ensureMedia(type, rawKey);
    if (!media) return json(res, 404, { error: 'not found' });

    if (action === 'title') return json(res, 200, { item: media });

    if (action === 'servers') {
      const season = Math.min(Math.max(int(url.searchParams.get('season'), 1), 1), 100);
      const episode = Math.min(Math.max(int(url.searchParams.get('episode'), 1), 1), 1000);
      const servers = await resolveServers({
        type,
        uid: media.uid,
        tmdbId: media.tmdb_id,
        imdbId: media.imdb_id,
        season,
        episode,
      });
      return json(res, 200, { servers });
    }

    if (action === 'downloads') {
      let imdbId = media.imdb_id;
      if (!imdbId && media.tmdb_id && hasTmdb) {
        imdbId = await findImdbId(type, media.tmdb_id).catch(() => null);
        if (imdbId) setImdb(type, media.tmdb_id, imdbId);
      }
      const downloads = await cached(API_CACHE, `dl:${media.uid}`, () =>
        findDownloads({ title: media.original_title || media.title, year: media.year, imdbId }),
      );
      return json(res, 200, { downloads });
    }

    if (action === 'subtitles') {
      const lang = String(url.searchParams.get('lang') ?? config.osDefaultLang).slice(0, 8);
      const imdbId = media.imdb_id;
      const subtitles = await subtitleSearch({ imdbId, tmdbId: media.tmdb_id, lang }).catch(() => []);
      return json(res, 200, { subtitles });
    }
  }

  if (route === '/api/img') {
    const poster = String(url.searchParams.get('p') ?? '');
    if (!/^\/[A-Za-z0-9._\-/]{1,80}$/.test(poster) || poster.includes('..')) {
      return json(res, 400, { error: 'bad path' });
    }
    const size = String(url.searchParams.get('s') ?? 'w342');
    if (!['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'].includes(size)) {
      return json(res, 400, { error: 'bad size' });
    }
    res.writeHead(302, {
      location: `${config.tmdbImageBase}/${size}${poster}`,
      'cache-control': 'public, max-age=604800, immutable',
    });
    return res.end();
  }

  if (route === '/api/admin/ingest' && req.method === 'POST') {
    if (!adminAllowed(req)) return json(res, 403, { error: 'forbidden' });
    if (ingestRunning) return json(res, 409, { error: 'ingest already running' });

    const pages = Math.min(Math.max(int(url.searchParams.get('pages'), 4), 1), 40);
    const kind = KIND_CACHE.has(String(url.searchParams.get('kind'))) ? String(url.searchParams.get('kind')) : 'trending';
    ingestRunning = true;
    ingest({ kind, pages })
      .catch(() => {})
      .finally(() => {
        ingestRunning = false;
      });
    return json(res, 202, { accepted: true, kind, pages });
  }

  return json(res, 404, { error: 'not found' });
}

async function handlePage(req, res, url) {
  const route = url.pathname;

  if (route === '/') {
    const query = String(url.searchParams.get('q') ?? '').trim().slice(0, 120);
    const kindRaw = String(url.searchParams.get('kind') ?? (query ? '' : 'trending'));
    const kind = KIND_CACHE.has(kindRaw) ? kindRaw : 'trending';

    let items = [];
    if (query) {
      items = (await unifiedSearch({ query, page: 1 })).items;
    } else {
      items = (await browseItems(kind, 1)).items;
    }

    return html(res, 200, homeHtml({ items, kind, query, page: 1 }));
  }

  const watchMatch = route.match(/^\/watch\/(movie|tv)\/([^/]{1,16})$/);
  if (watchMatch) {
    const type = cleanType(watchMatch[1]);
    const rawKey = watchMatch[2];
    if (!KEY.test(rawKey)) return html(res, 400, errorHtml(400, 'معرّف غير صالح.'));

    const media = await ensureMedia(type, rawKey);
    if (!media) return html(res, 404, errorHtml(404, 'ما لقينا هذا العنوان.'));

    // بلا بروب على الرندر: الصفحة تجيب كاش السيرفرات فقط، والعميل يحدّث.
    const servers = await resolveServers({
      type,
      uid: media.uid,
      tmdbId: media.tmdb_id,
      imdbId: media.imdb_id,
      probe: false,
    }).catch(() => []);

    const downloads = await cached(API_CACHE, `dl:${media.uid}`, () =>
      findDownloads({
        title: media.original_title || media.title,
        year: media.year,
        imdbId: media.imdb_id,
      }),
    ).catch(() => []);

    return html(
      res,
      200,
      watchHtml({
        item: media,
        servers,
        downloads,
        subtitleNote: config.osApiKey
          ? 'الترجمة العربية داخل مشغّل كل سيرفر، وزر الترجمة في نفس المشغّل.'
          : 'الترجمة مدمجة أو من مشغّل السيرفر. لمفتاح OpenSubtitles ضبط إضافي في .env.',
      }),
    );
  }

  return html(res, 404, errorHtml(404, 'الصفحة غير موجودة.'));
}

const server = createServer(async (req, res) => {
  securityHeaders(res, { cspHosts: frameHosts });

  if (burstGuard.enter() === false) {
    res.writeHead(503, { 'retry-after': '2', 'content-type': 'text/plain; charset=utf-8' });
    res.end('busy');
    return;
  }

  const started = Date.now();
  try {
    const ip = clientIp(req);
    const isHealth = req.url === '/healthz';
    const verdict = isHealth ? { allowed: true, retryAfter: 0 } : RATE.check(ip, req.url?.startsWith('/api/') ? 2 : 1);
    if (!verdict.allowed) {
      res.writeHead(429, { 'retry-after': String(verdict.retryAfter), 'content-type': 'text/plain; charset=utf-8' });
      res.end('rate limited');
      return;
    }

    const url = new URL(req.url ?? '/', config.publicUrl);

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, HEAD, POST' });
      res.end();
      return;
    }

    // جسم POST ما يُقرأ في أي مسار — نستهلكه حتى لا يعلق المقبس.
    if (req.method === 'POST') req.resume();

    if (url.pathname === '/healthz') {
      json(res, 200, healthPayload());
    } else if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (url.pathname.startsWith('/watch/') || url.pathname === '/') {
      await handlePage(req, res, url);
    } else if (!(await serveStatic(req, res, url.pathname))) {
      html(res, 404, errorHtml(404, 'الصفحة غير موجودة.'));
    }
  } catch (error) {
    if (!res.headersSent) html(res, 500, errorHtml(500, 'صار خطأ غير متوقع.'));
    else res.end();
    console.error('[error]', req.method, String(req.url).split('?')[0], error?.message ?? error);
  } finally {
    burstGuard.leave();
    if (process.env.LOG_REQUESTS === '1') {
      console.log(`${req.method} ${String(req.url).split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`);
    }
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 65_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1000;

setInterval(() => RATE.sweep(), 60_000).unref();
setInterval(() => {
  try {
    cleanupProbes();
  } catch {
    /* التنظيف مو حرج */
  }
}, 6 * 60 * 60 * 1000).unref();

server.listen(config.port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`[flix] http://${process.env.HOST ?? '127.0.0.1'}:${config.port}`);
  console.log(`[flix] catalog=${countAll()} tmdb=${hasTmdb ? 'on' : 'off'} source=${hasTmdb ? 'tmdb+yts' : 'yts'}`);
});

function shutdown(signal) {
  console.log(`[flix] ${signal} — closing`);
  server.closeAllConnections?.();
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => console.error('[unhandled]', error));
process.on('uncaughtException', (error) => {
  console.error('[uncaught]', error?.message ?? error);
  shutdown('uncaught');
});

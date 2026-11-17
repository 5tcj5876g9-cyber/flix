import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/*
 * Re-checks every provider in src/providers/registry.json.
 *   node test/verify-embeds.mjs           table
 *   node test/verify-embeds.mjs --json    machine-readable rows
 *   node test/verify-embeds.mjs --update  rewrite status/verifiedAt and re-sort the registry
 */

const REGISTRY = new URL('../src/providers/registry.json', import.meta.url);

const TMDB_MOVIE = '550';
const IMDB_MOVIE = 'tt0137523';
const TMDB_TV = '1399';
const SEASON = '1';
const EPISODE = '1';

const TIMEOUT_MS = 8_000;
const MAX_BODY = 256 * 1024;
const MAX_HOPS = 3;
const CONCURRENCY = 6;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// vidsrc.buzz serves 403 to a bare client and the player only when a referer is present.
const REFERERS = { 'vidsrc.buzz': 'https://www.2embed.cc/' };

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1?\]?|.*\.local|.*\.internal)$/i;

const PARKED =
  /parked domain|domain is for sale|buy this domain|this domain (has been|is) (registered|parked)|instantfwding|sedo\.com|dan\.com|godaddy.*(parked|for sale)/i;

const ADS =
  /acscdn|aclib\.js|exoclick|juicyads|popads|popcash|adsterra|propellerads|onclickads|hilltopads|clickadu|zergnet/;

// Approximate registrable domain: last two labels. Used to refuse cross-site redirect hops.
function siteOf(host) {
  const labels = host.replace(/^www\./, '').split('.');
  return labels.slice(-2).join('.');
}

function fill(template, values) {
  return template.replace(/\{(tmdb|imdb|season|episode)\}/g, (_, key) => String(values[key] ?? ''));
}

function guard(raw, base) {
  let url;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return { ok: false, reason: 'BADURL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'NON-HTTPS' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host) || !host.includes('.')) return { ok: false, reason: 'SSRF' };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    const private4 =
      a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31);
    if (private4) return { ok: false, reason: 'SSRF' };
  }
  return { ok: true, url };
}

async function readLimited(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (received < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    chunks.push(value);
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function probe(raw) {
  const first = guard(raw);
  if (!first.ok) return { status: first.reason, bytes: 0, evidence: [], hops: [], verdict: 'DEAD' };

  const started = Date.now();
  let current = first.url;
  const hops = [];

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const headers = {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      };
      const referer = REFERERS[current.hostname];
      if (referer) headers.referer = referer;

      const res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers,
      });
      const type = res.headers.get('content-type') ?? '';

      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = guard(res.headers.get('location'), current);
        await res.body?.cancel().catch(() => {});
        hops.push({ status: res.status, from: current.href, to: next.ok ? next.url.href : 'blocked' });
        const crossSite = !next.ok || siteOf(next.url.hostname) !== siteOf(current.hostname);
        if (crossSite || hop === MAX_HOPS) {
          return { status: res.status, bytes: 0, evidence: [], hops, crossSite, verdict: 'MOVED', ms: Date.now() - started };
        }
        current = next.url;
        continue;
      }

      const body = /html|text|xml/i.test(type || 'text/html') ? await readLimited(res) : '';
      if (!body) await res.body?.cancel().catch(() => {});

      const low = body.toLowerCase();
      const evidence = [];
      if (/<iframe/.test(low)) evidence.push('iframe');
      if (/\.m3u8/.test(low)) evidence.push('m3u8');
      if (/jwplayer|videojs|hls\.js|plyr|videoplayer|videoserver/.test(low)) evidence.push('player');
      if (/<script[^>]+src=["'][^"']*(\/assets\/|_next\/|static\/)/.test(low) || /type=["']module["']/.test(low))
        evidence.push('spa');
      if (body.length > 3000) evidence.push(`${Math.round(body.length / 1024)}kb`);

      const cf = /just a moment|attention required|__cf_chl|cf_chl_opt|challenge-platform|turnstile|cf-browser-verification/.test(
        low,
      );
      const parked = PARKED.test(low);
      const adsOnly = ADS.test(low) && !/\.m3u8/.test(low) && body.length < 30_000;
      if (cf) evidence.push('cf');

      let verdict;
      if (parked || adsOnly) verdict = 'DEAD';
      else if (!res.ok && cf) verdict = 'CF';
      else if (!res.ok) verdict = 'DEAD';
      else if (cf && /just a moment|attention required|challenge-platform/.test(low)) verdict = 'LIVE-CF';
      else if (evidence.some((e) => /^(iframe|m3u8|player|spa)$/.test(e))) verdict = 'LIVE';
      else if (body.length > 20_000) verdict = 'LIVE';
      else verdict = 'DEAD';

      return { status: res.status, bytes: body.length, evidence, hops, parked, adsOnly, verdict, ms: Date.now() - started };
    }
    return { status: 'LOOP', bytes: 0, evidence: [], hops, verdict: 'REDIRECT' };
  } catch (error) {
    const reason = error.name === 'TimeoutError' ? 'TIMEOUT' : error.cause?.code ?? error.name;
    return { status: String(reason).slice(0, 32), bytes: 0, evidence: [], hops, verdict: 'DEAD', ms: Date.now() - started };
  }
}

function cell(result) {
  if (result.verdict === 'DEAD' && typeof result.status === 'string') return result.status;
  if (result.verdict === 'MOVED') {
    const target = result.hops.at(-1)?.to ?? '';
    try {
      return `${result.status}->${new URL(target).host}`.slice(0, 24);
    } catch {
      return `${result.status}->?`;
    }
  }
  const tags = result.evidence.filter((e) => /^(iframe|m3u8|player|spa)$/.test(e)).slice(0, 2);
  if (result.adsOnly) tags.push('ads');
  if (result.parked) tags.push('parked');
  return `${result.status} ${tags.join(',')}`.trim();
}

function rowVerdict(columns) {
  const verdicts = columns.map((c) => c.verdict);
  if (verdicts.includes('LIVE')) return 'LIVE';
  if (verdicts.includes('LIVE-CF')) return 'LIVE-CF';
  if (verdicts.includes('CF')) return 'CF';
  return 'DEAD';
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

const entries = JSON.parse(await readFile(REGISTRY, 'utf8'));
const verifyAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const rows = await mapLimit(entries, CONCURRENCY, async (entry) => {
  const ctx = { tmdb: TMDB_MOVIE, imdb: IMDB_MOVIE, season: SEASON, episode: EPISODE };
  const movieTmdb = fill(entry.movieUrlTemplate, ctx);
  const movieImdb = fill(entry.movieUrlTemplate, { ...ctx, tmdb: IMDB_MOVIE });
  const tv = fill(entry.tvUrlTemplate, { ...ctx, tmdb: TMDB_TV });

  const [a, b, c] = await Promise.all([
    probe(movieTmdb),
    entry.supportsImdb ? probe(movieImdb) : Promise.resolve({ status: 'n/a', verdict: 'SKIP', evidence: [], hops: [] }),
    probe(tv),
  ]);

  return { entry, movieTmdb, movieImdb, tv, columns: [a, b, c], verdict: rowVerdict([a, b, c]) };
});

if (process.argv.includes('--json')) {
  const dump = rows.map(({ entry, movieTmdb, movieImdb, tv, columns, verdict }) => ({
    id: entry.id,
    label: entry.label,
    verdict,
    movieTmdb: { url: movieTmdb, ...columns[0] },
    movieImdb: { url: columns[1].verdict === 'SKIP' ? null : movieImdb, ...columns[1] },
    tv: { url: tv, ...columns[2] },
  }));
  console.log(JSON.stringify(dump, null, 2));
} else {
  const width = Math.min(30, Math.max(...rows.map((r) => r.entry.label.length)) + 1);
  const header = [
    'provider'.padEnd(width),
    'movie-tmdb'.padEnd(20),
    'movie-imdb'.padEnd(20),
    'tv'.padEnd(20),
    'verdict',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const { entry, columns, verdict } of rows) {
    console.log(
      [
        entry.label.padEnd(width),
        cell(columns[0]).padEnd(20),
        (columns[1].verdict === 'SKIP' ? '-' : cell(columns[1])).padEnd(20),
        cell(columns[2]).padEnd(20),
        verdict,
      ].join(' '),
    );
  }

  const tally = rows.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log('-'.repeat(header.length));
  console.log(`checked ${rows.length} providers on ${verifyAt}`);
  console.log(
    Object.entries(tally)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}=${v}`)
      .join('  '),
  );
}

if (process.argv.includes('--update')) {
  const rank = { live: 0, 'live-cf': 1, dead: 2 };
  const statusFor = (verdict) =>
    verdict === 'LIVE' ? 'live' : verdict === 'LIVE-CF' || verdict === 'CF' ? 'live-cf' : 'dead';
  const updated = rows
    .map(({ entry, verdict }) => ({ ...entry, status: statusFor(verdict), verifiedAt: verifyAt }))
    .sort((a, b) => rank[a.status] - rank[b.status]);
  await writeFile(REGISTRY, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  console.log(`registry updated: ${updated.length} entries -> ${fileURLToPath(REGISTRY)}`);
}

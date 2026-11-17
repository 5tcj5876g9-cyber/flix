import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function loadDotEnv(file = resolve(process.cwd(), '.env')) {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const str = (key, fallback = '') => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};
const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`environment variable ${key} must be a number`);
  return parsed;
};

export const config = {
  port: num('PORT', 8095),
  publicUrl: str('PUBLIC_URL', `http://localhost:${num('PORT', 8095)}`).replace(/\/+$/, ''),

  dbPath: resolve(process.cwd(), str('DB_PATH', './data/flix.db')),
  subsDir: resolve(process.cwd(), str('SUBS_DIR', './data/subs')),

  // TMDB: مفتاح v3 أو توكن v4 (يبدأ بـ eyJ). بدونه الموقع يشتغل محلياً فقط.
  tmdbKey: str('TMDB_API_KEY'),
  tmdbLang: str('TMDB_LANG', 'ar-SA'),
  tmdbFallbackLang: str('TMDB_FALLBACK_LANG', 'en-US'),
  tmdbRegion: str('TMDB_REGION', 'SA'),
  tmdbImageBase: str('TMDB_IMAGE_BASE', 'https://image.tmdb.org/t/p'),

  // مزوّد نتفلكس في TMDB = 8
  netflixProviderId: num('NETFLIX_PROVIDER_ID', 8),

  osApiKey: str('OPENSUBTITLES_API_KEY'),
  osUserAgent: str('OPENSUBTITLES_USER_AGENT', 'flix v1.0'),
  osDefaultLang: str('SUBTITLE_LANG', 'ar'),

  probeTtlMs: num('PROBE_TTL_MS', 6 * 60 * 60 * 1000),
  probeTimeoutMs: num('PROBE_TIMEOUT_MS', 6000),
  probeConcurrency: num('PROBE_CONCURRENCY', 4),

  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 12000),
  userAgent: str('HTTP_USER_AGENT', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) flix/1.0'),
};

mkdirSync(dirname(config.dbPath), { recursive: true });
mkdirSync(config.subsDir, { recursive: true });

export const hasTmdb = Boolean(config.tmdbKey);

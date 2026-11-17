import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { normalize, toMatch } from './norm.js';

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 4000;
`);

/** ترحيل بسيط: النسخة الأولى كانت بمفتاح tmdb فقط. المفتاح الآن uid نصي. */
function ensureSchema() {
  const columns = db.prepare("PRAGMA table_info('media')").all();
  const hasUid = columns.some((column) => column.name === 'uid');
  if (columns.length > 0 && !hasUid) {
    db.exec('DROP TABLE IF EXISTS media_fts; DROP TABLE IF EXISTS media;');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id             INTEGER PRIMARY KEY,
      uid            TEXT    NOT NULL UNIQUE,
      tmdb_id        INTEGER,
      imdb_id        TEXT,
      type           TEXT    NOT NULL CHECK (type IN ('movie','tv')),
      title          TEXT    NOT NULL,
      original_title TEXT,
      norm           TEXT    NOT NULL,
      year           INTEGER,
      overview       TEXT,
      poster         TEXT,
      backdrop       TEXT,
      rating         REAL,
      popularity     REAL,
      language       TEXT,
      countries      TEXT,
      genres         TEXT,
      runtime        INTEGER,
      netflix        INTEGER NOT NULL DEFAULT 0,
      source         TEXT,
      updated_at     INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS media_pop  ON media (popularity DESC, id ASC);
    CREATE INDEX IF NOT EXISTS media_year ON media (year DESC);
    CREATE INDEX IF NOT EXISTS media_net  ON media (netflix, popularity DESC);
    CREATE INDEX IF NOT EXISTS media_lang ON media (language);
    CREATE INDEX IF NOT EXISTS media_imdb ON media (imdb_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
      norm,
      alt,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TABLE IF NOT EXISTS probes (
      tmdb_id    INTEGER NOT NULL,
      type       TEXT    NOT NULL,
      server     TEXT    NOT NULL,
      season     INTEGER NOT NULL DEFAULT 1,
      episode    INTEGER NOT NULL DEFAULT 1,
      ok         INTEGER NOT NULL,
      checked_at INTEGER NOT NULL,
      PRIMARY KEY (tmdb_id, type, server, season, episode)
    );
  `);
}

ensureSchema();

export function mediaKey(type, tmdbId, imdbId) {
  const suffix = imdbId || tmdbId;
  return `${type}:${suffix}`;
}

const upsertStmt = db.prepare(`
  INSERT INTO media (
    uid, tmdb_id, imdb_id, type, title, original_title, norm, year, overview, poster,
    backdrop, rating, popularity, language, countries, genres, runtime, netflix, source, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT (uid) DO UPDATE SET
    tmdb_id = COALESCE(excluded.tmdb_id, media.tmdb_id),
    imdb_id = COALESCE(excluded.imdb_id, media.imdb_id),
    title = excluded.title,
    original_title = excluded.original_title,
    norm = excluded.norm,
    year = COALESCE(excluded.year, media.year),
    overview = COALESCE(excluded.overview, media.overview),
    poster = COALESCE(excluded.poster, media.poster),
    backdrop = COALESCE(excluded.backdrop, media.backdrop),
    rating = COALESCE(excluded.rating, media.rating),
    popularity = COALESCE(excluded.popularity, media.popularity),
    language = COALESCE(excluded.language, media.language),
    countries = COALESCE(excluded.countries, media.countries),
    genres = COALESCE(excluded.genres, media.genres),
    runtime = COALESCE(excluded.runtime, media.runtime),
    netflix = excluded.netflix,
    source = COALESCE(excluded.source, media.source),
    updated_at = excluded.updated_at
`);

const idStmt = db.prepare('SELECT id FROM media WHERE uid = ?');
const ftsDelStmt = db.prepare('DELETE FROM media_fts WHERE rowid = ?');
const ftsInsStmt = db.prepare('INSERT INTO media_fts (rowid, norm, alt) VALUES (?, ?, ?)');

export function upsertMedia(row) {
  if (!row?.type || !row?.title) return null;
  if (!row.tmdb_id && !row.imdb_id) return null;

  const uid = mediaKey(row.type, row.tmdb_id, row.imdb_id);
  const norm = normalize(row.title);
  const alt = normalize([row.original_title, row.year].filter(Boolean).join(' '));

  upsertStmt.run(
    uid,
    row.tmdb_id ?? null,
    row.imdb_id ?? null,
    row.type,
    row.title,
    row.original_title ?? null,
    norm,
    row.year ?? null,
    row.overview ?? null,
    row.poster ?? null,
    row.backdrop ?? null,
    row.rating ?? null,
    row.popularity ?? null,
    row.language ?? null,
    row.countries ?? null,
    row.genres ?? null,
    row.runtime ?? null,
    row.netflix ? 1 : 0,
    row.source ?? null,
    Date.now(),
  );

  const found = idStmt.get(uid);
  if (!found) return null;
  ftsDelStmt.run(found.id);
  ftsInsStmt.run(found.id, norm, alt);
  return found.id;
}

export function upsertMany(rows) {
  let written = 0;
  let started = false;
  try {
    db.exec('BEGIN');
    started = true;
    for (const row of rows) {
      if (upsertMedia(row)) written += 1;
    }
    db.exec('COMMIT');
    started = false;
  } catch (error) {
    if (started) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* المعاملة انتهت أصلاً */
      }
    }
    throw error;
  }
  return written;
}

export function getMedia(type, key) {
  if (!type || !key) return null;
  const value = String(key);
  if (/^tt\d{7,10}$/i.test(value)) {
    return db.prepare('SELECT * FROM media WHERE type = ? AND imdb_id = ?').get(type, value) ?? null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return db.prepare('SELECT * FROM media WHERE type = ? AND tmdb_id = ?').get(type, numeric) ?? null;
}

export function setImdb(type, tmdbId, imdbId) {
  if (!imdbId || !tmdbId) return;
  db.prepare('UPDATE media SET imdb_id = ? WHERE type = ? AND tmdb_id = ?').run(imdbId, type, tmdbId);
}

const SORTS = {
  popularity: 'm.popularity DESC, m.id ASC',
  rating: 'm.rating DESC, m.popularity DESC, m.id ASC',
  newest: 'm.year DESC, m.popularity DESC, m.id ASC',
  oldest: 'm.year ASC, m.popularity ASC, m.id ASC',
  title: 'm.norm ASC, m.id ASC',
};

function pickSort(name) {
  return Object.hasOwn(SORTS, name) ? SORTS[name] : SORTS.popularity;
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function buildFilters(filters, params) {
  const where = [];
  if (filters.type === 'movie' || filters.type === 'tv') {
    where.push('m.type = ?');
    params.push(filters.type);
  }
  if (Number.isInteger(filters.year) && filters.year > 1800) {
    where.push('m.year = ?');
    params.push(filters.year);
  }
  if (filters.language) {
    where.push('m.language = ?');
    params.push(filters.language);
  }
  if (filters.country) {
    where.push("m.countries LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filters.country)}%`);
  }
  if (filters.netflix === true) where.push('m.netflix = 1');
  if (filters.netflix === false) where.push('m.netflix = 0');
  return where;
}

export function searchLocal(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 60);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const sort = pickSort(filters.sort);

  if (filters.q) {
    const match = toMatch(filters.q);
    if (!match) return { rows: [], total: 0 };

    const params = [match];
    const where = buildFilters(filters, params);
    const whereSql = where.length ? `AND ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT m.* FROM media_fts f
         JOIN media m ON m.id = f.rowid
         WHERE media_fts MATCH ? ${whereSql}
         ORDER BY CASE WHEN m.norm = ? THEN 0 ELSE 1 END,
                  bm25(media_fts, 8.0, 2.0),
                  m.popularity DESC, m.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(match, normalize(filters.q), ...params.slice(1), limit, offset);

    const total =
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM media_fts f
           JOIN media m ON m.id = f.rowid
           WHERE media_fts MATCH ? ${whereSql}`,
        )
        .get(...params)?.n ?? 0;

    return { rows, total: Number(total) };
  }

  const params = [];
  const where = buildFilters(filters, params);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db
    .prepare(`SELECT m.* FROM media m ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS n FROM media m ${whereSql}`).get(...params)?.n ?? 0,
  );

  return { rows, total };
}

export function countAll() {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM media').get()?.n ?? 0);
}

export function getProbe(uid, server, season = 1, episode = 1) {
  const row = db
    .prepare(
      'SELECT ok, checked_at FROM probes WHERE tmdb_id = ? AND type = ? AND server = ? AND season = ? AND episode = ?',
    )
    .get(hashUid(uid), 'any', server, season, episode);
  return row ?? null;
}

export function setProbe(uid, server, ok, season = 1, episode = 1) {
  db.prepare(
    `INSERT INTO probes (tmdb_id, type, server, season, episode, ok, checked_at) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (tmdb_id, type, server, season, episode) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at`,
  ).run(hashUid(uid), 'any', server, season, episode, ok ? 1 : 0, Date.now());
}

/** مفتاح ثابت 31-بت لأي uid نصي — البروب يبقى على نفس الصف عبر الشكلين. */
function hashUid(uid) {
  const text = String(uid ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

export function cleanupProbes(olderThanMs = 7 * 86_400_000) {
  const info = db.prepare('DELETE FROM probes WHERE checked_at < ?').run(Date.now() - olderThanMs);
  return Number(info.changes ?? 0);
}

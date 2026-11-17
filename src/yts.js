import { config } from './config.js';

/*
 * YTS: كتالوج أفلام مجاني بدون مفتاح.
 * يعطي poster + imdb_code + torrents + rating، وهذا يكفي للعرض والتشغيل
 * وللتحميل. النطاق الأساسي محجوب في بعض الشبكات، فنجرّب البدائل.
 */

const HOSTS = (process.env.YTS_HOSTS ?? 'yts.gg,yts.lt,yts.am,yts.mx').split(',').map((h) => h.trim()).filter(Boolean);
const MAX_BYTES = 3_000_000;
const PAGE_SIZE = 20;

let preferredHost = HOSTS[0];

function listUrl(host, params) {
  const url = new URL(`https://${host}/api/v2/list_movies.json`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const BLOCKED_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

/** يتبع 301/302 يدوياً، https ونطاق عام فقط، بحد ثلاث قفزات. */
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    let target = new URL(url);
    for (let hop = 0; hop < 3; hop += 1) {
      if (target.protocol !== 'https:' || BLOCKED_HOST.test(target.hostname)) return null;

      const res = await fetch(target, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { accept: 'application/json', 'user-agent': config.userAgent },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => {});
        if (!location) return null;
        target = new URL(location, target);
        continue;
      }

      if (!res.ok) return null;
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_BYTES) return null;

      const reader = res.body?.getReader();
      if (!reader) return null;

      let received = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
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
      return JSON.parse(new TextDecoder().decode(merged));
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function request(params) {
  const order = [preferredHost, ...HOSTS.filter((h) => h !== preferredHost)];
  for (const host of order) {
    const data = await fetchJson(listUrl(host, params));
    if (data?.status === 'ok') {
      preferredHost = host;
      return data.data ?? null;
    }
  }
  return null;
}

function toRow(movie) {
  if (!movie?.title) return null;
  const imdb = movie.imdb_code ? String(movie.imdb_code).trim() : null;
  const validImdb = imdb && /^tt\d{7,10}$/.test(imdb) ? imdb : null;
  if (!validImdb) return null;

  return {
    tmdb_id: null,
    imdb_id: validImdb,
    type: 'movie',
    title: movie.title,
    original_title: movie.title_english ?? movie.title,
    year: Number(movie.year) || null,
    overview: movie.summary || movie.description_full || null,
    poster: movie.large_cover_image ?? movie.medium_cover_image ?? null,
    backdrop: movie.background_image_original ?? null,
    rating: Number(movie.rating) || null,
    popularity: Number(movie.download_count) || 0,
    language: movie.language ?? null,
    countries: null,
    genres: Array.isArray(movie.genres) ? movie.genres.join(',') : null,
    runtime: Number(movie.runtime) || null,
    netflix: false,
    source: 'yts',
  };
}

export async function ytsList({ page = 1, sortBy = 'download_count', query = null, genre = null, minimumRating = 0 } = {}) {
  const data = await request({
    page,
    limit: PAGE_SIZE,
    sort_by: sortBy,
    order_by: 'desc',
    query_term: query,
    genre,
    minimum_rating: minimumRating > 0 ? minimumRating : undefined,
  });
  const movies = data?.movies ?? [];
  return movies.map(toRow).filter(Boolean);
}

export async function ytsSearch(query, page = 1) {
  if (!query) return [];
  const rows = await ytsList({ page, query, sortBy: 'seeds' });
  const needle = query.toLowerCase();
  // الصلة أولاً: عنوان يحتوي كل كلمات البحث، بعدها الأحدث، بعدها البذور.
  const scored = rows.map((row) => {
    const title = `${row.title} ${row.original_title ?? ''}`.toLowerCase();
    const words = needle.split(/\s+/).filter(Boolean);
    const hits = words.filter((word) => title.includes(word)).length;
    return { row, exact: title.includes(needle) ? 2 : 0, hits, year: row.year ?? 0 };
  });
  scored.sort((a, b) => b.exact - a.exact || b.hits - a.hits || b.year - a.year);
  return scored.map((entry) => entry.row);
}

export async function ytsRecent(page = 1) {
  return ytsList({ page, sortBy: 'date_added' });
}

/** الأكثر تحميلاً = الشعبية الحقيقية: أفلام يعرفها الناس. */
export async function ytsPopular(page = 1) {
  return ytsList({ page, sortBy: 'download_count' });
}

export async function ytsTop(page = 1) {
  return ytsList({ page, sortBy: 'rating', minimumRating: 6 });
}

export async function ytsByImdb(imdbId) {
  if (!imdbId) return null;
  const data = await request({ query_term: imdbId, limit: PAGE_SIZE });
  const movie = data?.movies?.[0];
  return movie ? toRow(movie) : null;
}

/**
 * مسح لغوي: YTS ما يفلتر باللغة، فنسحب صفحات مرتّبة بالتقييم ونفلتر محلياً.
 * يُستعمل لتعبئة "كوري" و"آسيوي" بدون أي مفتاح.
 */
export async function ytsScanLanguage(codes, pages = 8, { sortBy = 'rating', minimumRating = 4 } = {}) {
  const wanted = new Set(codes.map((code) => code.toLowerCase()));
  const out = [];
  const seen = new Set();

  for (let page = 1; page <= pages; page += 1) {
    let rows;
    try {
      rows = await ytsList({ page, sortBy, minimumRating });
    } catch {
      break;
    }
    if (!rows.length) break;

    for (const row of rows) {
      const code = String(row.language ?? '').toLowerCase().slice(0, 3);
      if (!wanted.has(code)) continue;
      if (seen.has(row.uid ?? row.imdb_id)) continue;
      seen.add(row.imdb_id);
      out.push(row);
    }
  }

  return out;
}

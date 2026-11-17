import { config, hasTmdb } from './config.js';

const BASE = 'https://api.themoviedb.org/3';
const MAX_RETRIES = 1;

/** مفتاح v3 أو توكن v4 — الشكل يحدد طريقة الإرسال. */
const isBearer = config.tmdbKey.startsWith('eyJ');

function buildUrl(path, params = {}) {
  const url = new URL(BASE + path);
  const merged = {
    language: config.tmdbLang,
    region: config.tmdbRegion,
    ...params,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  if (!isBearer) url.searchParams.set('api_key', config.tmdbKey);
  return url.toString();
}

class TmdbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

async function api(path, params = {}, { retries = MAX_RETRIES } = {}) {
  if (!hasTmdb) throw new TmdbError('TMDB_API_KEY غير مضبوط', 503);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const res = await fetch(buildUrl(path, params), {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(isBearer ? { authorization: `Bearer ${config.tmdbKey}` } : {}),
          'user-agent': config.userAgent,
          'accept-language': config.tmdbLang,
        },
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        lastError = new TmdbError('TMDB rate limited', 429);
        await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, 4000)));
        continue;
      }
      if (!res.ok) {
        throw new TmdbError(`TMDB ${res.status}`, res.status);
      }
      return await res.json();
    } catch (error) {
      lastError = error;
      if (error.name === 'AbortError') lastError = new TmdbError('TMDB timeout', 504);
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new TmdbError('TMDB request failed', 502);
}

function yearOf(date) {
  const year = Number(String(date ?? '').slice(0, 4));
  return Number.isFinite(year) && year > 1800 ? year : null;
}

/** نتيجة بحث/اكتشاف → صف داخلي. */
export function toRow(item, { type, netflix = false } = {}) {
  const mediaType = type ?? (item.media_type === 'tv' ? 'tv' : 'movie');
  const title = mediaType === 'tv' ? item.name : item.title;
  if (!item?.id || !title) return null;

  return {
    tmdb_id: item.id,
    type: mediaType,
    title,
    original_title: mediaType === 'tv' ? item.original_name : item.original_title,
    year: yearOf(mediaType === 'tv' ? item.first_air_date : item.release_date),
    overview: item.overview || null,
    poster: item.poster_path ?? null,
    backdrop: item.backdrop_path ?? null,
    rating: item.vote_average ? Number(item.vote_average) : null,
    popularity: item.popularity ? Number(item.popularity) : null,
    language: item.original_language ?? null,
    countries: Array.isArray(item.origin_country) ? item.origin_country.join(',') : null,
    genres: Array.isArray(item.genres) ? item.genres.map((g) => g.name).join(',') : null,
    runtime: item.runtime ?? (Array.isArray(item.episode_run_time) ? item.episode_run_time[0] : null) ?? null,
    imdb_id: item.imdb_id ?? item.external_ids?.imdb_id ?? null,
    netflix,
  };
}

export async function searchMulti(query, page = 1) {
  const data = await api('/search/multi', { query, page, include_adult: false });
  return (data.results ?? [])
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => toRow(r))
    .filter(Boolean);
}

export async function searchMovies(query, page = 1) {
  const data = await api('/search/movie', { query, page, include_adult: false });
  return (data.results ?? []).map((r) => toRow(r, { type: 'movie' })).filter(Boolean);
}

export async function searchTv(query, page = 1) {
  const data = await api('/search/tv', { query, page, include_adult: false });
  return (data.results ?? []).map((r) => toRow(r, { type: 'tv' })).filter(Boolean);
}

const KINDS = {
  trending: { path: '/trending/all/week', netflix: false },
  popular: { path: '/movie/popular', type: 'movie' },
  top_rated: { path: '/movie/top_rated', type: 'movie' },
  upcoming: { path: '/movie/upcoming', type: 'movie' },
  tv_popular: { path: '/tv/popular', type: 'tv' },
};

const ASIAN_COUNTRIES = ['KR', 'JP', 'CN', 'TW', 'HK', 'TH', 'VN', 'IN', 'PH', 'ID', 'SG', 'MY'];

export async function discover(kind, page = 1) {
  const paging = { page, sort_by: 'popularity.desc', include_adult: false };

  switch (kind) {
    case 'netflix': {
      const [movies, shows] = await Promise.all([
        api('/discover/movie', {
          ...paging,
          with_watch_providers: config.netflixProviderId,
          watch_region: config.tmdbRegion,
          'vote_count.gte': 20,
        }).catch(() => ({ results: [] })),
        api('/discover/tv', {
          ...paging,
          with_watch_providers: config.netflixProviderId,
          watch_region: config.tmdbRegion,
          'vote_count.gte': 10,
        }).catch(() => ({ results: [] })),
      ]);
      return [
        ...(movies.results ?? []).map((r) => toRow(r, { type: 'movie', netflix: true })),
        ...(shows.results ?? []).map((r) => toRow(r, { type: 'tv', netflix: true })),
      ].filter(Boolean);
    }

    case 'korean': {
      const [movies, shows] = await Promise.all([
        api('/discover/movie', { ...paging, with_original_language: 'ko', 'vote_count.gte': 10 }),
        api('/discover/tv', { ...paging, with_original_language: 'ko', 'vote_count.gte': 5 }),
      ]);
      return [
        ...(movies.results ?? []).map((r) => toRow(r, { type: 'movie' })),
        ...(shows.results ?? []).map((r) => toRow(r, { type: 'tv' })),
      ].filter(Boolean);
    }

    case 'asian': {
      const [movies, shows] = await Promise.all([
        api('/discover/movie', {
          ...paging,
          with_origin_country: ASIAN_COUNTRIES.join('|'),
          'vote_count.gte': 10,
        }),
        api('/discover/tv', {
          ...paging,
          with_origin_country: ASIAN_COUNTRIES.join('|'),
          'vote_count.gte': 5,
        }),
      ]);
      return [
        ...(movies.results ?? []).map((r) => toRow(r, { type: 'movie' })),
        ...(shows.results ?? []).map((r) => toRow(r, { type: 'tv' })),
      ].filter(Boolean);
    }

    default: {
      const spec = KINDS[kind] ?? KINDS.trending;
      const data = await api(spec.path, { page });
      return (data.results ?? [])
        .map((r) => toRow(r, { type: spec.type, netflix: Boolean(spec.netflix) }))
        .filter(Boolean);
    }
  }
}

export async function details(type, tmdbId) {
  const data = await api(`/${type}/${tmdbId}`, {
    append_to_response: 'external_ids',
  });
  return toRow(data, { type });
}

export async function findImdbId(type, tmdbId) {
  const data = await api(`/${type}/${tmdbId}/external_ids`);
  return data?.imdb_id ?? null;
}

export { TmdbError };

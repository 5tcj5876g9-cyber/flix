import { config } from './config.js';

/*
 * OpenSubtitles REST v1. يحتاج مفتاح API (مجاني) — بدونه نرجع مصفوفة فاضية
 * والموقع يظل شغال على ترجمة المشغّل.
 */

const BASE = 'https://api.opensubtitles.com/api/v1';

function headers() {
  return {
    'Api-Key': config.osApiKey,
    'User-Agent': config.osUserAgent,
    accept: 'application/json',
  };
}

async function request(path) {
  if (!config.osApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(BASE + path, { headers: headers(), signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function subtitleSearch({ imdbId, tmdbId, lang = 'ar' }) {
  if (!config.osApiKey) return [];

  const params = new URLSearchParams({ languages: lang });
  if (imdbId) params.set('imdb_id', String(imdbId).replace(/^tt/, ''));
  else if (tmdbId) params.set('tmdb_id', String(tmdbId));
  else return [];

  const data = await request(`/subtitles?${params.toString()}`);
  const rows = data?.data ?? [];

  return rows.slice(0, 12).map((row) => {
    const attrs = row.attributes ?? {};
    const file = attrs.files?.[0] ?? {};
    return {
      id: file.file_id ?? null,
      language: attrs.language ?? lang,
      label: attrs.release || attrs.feature_details?.title || 'ترجمة',
      downloads: attrs.download_count ?? 0,
      rating: attrs.ratings ?? 0,
      hearingImpaired: Boolean(attrs.hearing_impaired),
      fileId: file.file_id ?? null,
    };
  }).filter((row) => row.fileId);
}

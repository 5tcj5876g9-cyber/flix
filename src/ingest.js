import { pathToFileURL } from 'node:url';
import { hasTmdb } from './config.js';
import { countAll, upsertMany } from './db.js';
import { discover } from './tmdb.js';
import { ytsList, ytsPopular, ytsScanLanguage, ytsTop } from './yts.js';

const KINDS = ['trending', 'netflix', 'korean', 'asian', 'top_rated', 'tv_popular'];

/**
 * يملأ الكتالوج المحلي:
 *   tmdb  — عندما يوجد مفتاح (تصنيفات، عربي، مسلسلات، نتفلكس)
 *   yts   — بدون مفتاح، آلاف الأفلام مع بوستر وimdb
 * النتائج تدخل فهرس البحث العربي مباشرة.
 */
export async function ingest({ kind = 'trending', pages = 4, source = 'auto', kinds = null } = {}) {
  const report = [];
  const useTmdb = hasTmdb && source !== 'yts';
  const useYts = source !== 'tmdb';

  if (useTmdb) {
    const list = kinds ?? (kind === 'all' ? KINDS : [kind]);
    for (const current of list) {
      let written = 0;
      for (let page = 1; page <= pages; page += 1) {
        try {
          const rows = await discover(current, page);
          if (rows.length === 0) break;
          written += upsertMany(rows);
          if (rows.length < 10) break;
        } catch (error) {
          report.push({ source: 'tmdb', kind: current, page, error: error.message });
          break;
        }
      }
      report.push({ source: 'tmdb', kind: current, written });
    }
  }

  if (useYts) {
    const loaders = kind === 'top_rated' ? [ytsTop] : [ytsPopular, ytsTop];
    for (const load of loaders) {
      let written = 0;
      for (let page = 1; page <= pages; page += 1) {
        try {
          const rows = await load(page);
          if (rows.length === 0) break;
          written += upsertMany(rows);
        } catch (error) {
          report.push({ source: 'yts', loader: load.name, page, error: error.message });
          break;
        }
      }
      report.push({ source: 'yts', loader: load.name, written });
    }
  }

  // تصنيفات إضافية تغطي الكوري والآسيوي حتى بدون مفتاح.
  if (useYts && (kind === 'korean' || kind === 'asian' || kind === 'all')) {
    const sets = {
      korean: ['ko', 'kor'],
      asian: ['ko', 'kor', 'ja', 'jpn', 'zh', 'cn', 'chi', 'th', 'tha', 'hi', 'hin', 'id', 'ind', 'vi', 'vie', 'tl', 'fil'],
    };
    for (const [label, codes] of Object.entries(sets)) {
      if (kind !== 'all' && kind !== label) continue;
      const rows = await ytsScanLanguage(codes, pages * 2).catch(() => []);
      const written = rows.length ? upsertMany(rows) : 0;
      report.push({ source: 'yts', kind: label, written });
    }
  }

  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  const read = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };

  const kind = read('--kind', 'all');
  const pages = Math.min(Math.max(Number(read('--pages', '6')) || 6, 1), 60);
  const source = read('--source', 'auto');

  const started = Date.now();
  const before = countAll();
  ingest({ kind, pages, source })
    .then((report) => {
      const written = report.reduce((sum, row) => sum + (row.written ?? 0), 0);
      console.log(
        `[ingest] +${written} صف في ${((Date.now() - started) / 1000).toFixed(1)}s · الكتالوج ${before} → ${countAll()}`,
      );
      for (const row of report) console.log('  ', JSON.stringify(row));
    })
    .catch((error) => {
      console.error('[ingest] failed:', error.message);
      process.exit(1);
    });
}

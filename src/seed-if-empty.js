import { countAll } from './db.js';
import { ingest } from './ingest.js';

/*
 * الاستضافات المجانية (Render/Koyeb) تعطي قرصاً مؤقتاً: القرص يرجع فاضي
 * بعد كل نشر. هذا الملف يبني الكتالوج عند أول إقلاع فقط.
 * لو الكتالوج موجود، يخرج فوراً بدون أي طلب شبكة.
 */

const THRESHOLD = Number(process.env.SEED_MIN_ROWS ?? 50);

if (countAll() < THRESHOLD) {
  const started = Date.now();
  try {
    await ingest({ source: 'yts', pages: Number(process.env.SEED_PAGES ?? 20) });
    console.log(`[seed] built catalog in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (error) {
    console.error('[seed] failed, server still starts:', error.message);
  }
}

console.log(`[seed] catalog=${countAll()}`);

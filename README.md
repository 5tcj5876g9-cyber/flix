---
title: flix
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
app_port: 8095
pinned: false
---

# سينمانا — flix

موقع أفلام ومسلسلات: بحث عربي فوري، كتالوج من TMDB + YTS، بث عبر سيرفرات امبد خارجية، وروابط تحميل magnet. Node 22+، بدون أي npm dependency.

## تشغيل سريع

```bash
cd flix
cp .env.example .env          # اختياري: مفتاح TMDB + ADMIN_KEY
node src/ingest.js --source yts --pages 30   # يبني الكتالوج (≈1200 عنوان)
node src/server.js
# http://127.0.0.1:8095
```

## من وين تجي الأفلام

| الطبقة | المصدر | مفتاح؟ | يعطي |
|---|---|---|---|
| كتالوج | **YTS** (`yts.gg`) | لا | عنوان، سنة، بوستر، IMDb id، تقييم، لغات، تورنت |
| كتالوج | **TMDB** | نعم (مجاني) | عربي، مسلسلات، نتفلكس، كوري/آسيوي، IMDb id |
| بث | 6 سيرفرات امبد | لا | مشغّل داخل iframe على TMDB أو IMDb id |
| تحميل | apibay + YTS | لا | روابط magnet مع عدد البذور |
| ترجمة | OpenSubtitles | اختياري | ملفات VTT |

الموقع **ما يستضيف أي ملف فيديو**. كل البث من سيرفرات خارجية، والتحميل عبر magnet.

## المتغيرات

انظر `.env.example`. الأهم:

- `TMDB_API_KEY` — يفتح القوائم العربية ونتفلكس وكوري. بدونه الموقع شغّال على YTS.
- `ADMIN_KEY` — مطلوب لـ `POST /api/admin/ingest?kind=&pages=` (هيدر `x-admin-key`).
- `TRUST_PROXY=1` — خلف Cloudflare Tunnel فقط، وإلا يقرأ IP الحقيقي غلط.

## الأوامر

```bash
node src/ingest.js --source yts --pages 30       # تعبئة سريعة
node src/ingest.js --kind korean --pages 10      # مسح لغوي للكوري
node src/ingest.js --kind all --pages 20         # كل التصنيفات
node src/probe.js 550 movie                      # فحص السيرفرات لعنوان
node test/verify-embeds.mjs                      # فحص كل المزوّدين
```

## المسارات

```
GET  /                          الصفحة الرئيسية (SSR)
GET  /watch/:type/:id           صفحة المشاهدة (tmdb رقم أو imdb tt...)
GET  /api/search?q=&page=       بحث محلي/بعيد
GET  /api/browse?kind=          trending|netflix|korean|asian|top_rated
GET  /api/title/:type/:id       تفاصيل
GET  /api/servers/:type/:id     سيرفرات + حالة الفحص
GET  /api/downloads/:type/:id   magnet
GET  /api/subtitles/:type/:id   OpenSubtitles
GET  /healthz                   فحص حياة
POST /api/admin/ingest          فهرسة (x-admin-key)
```

## الحماية

- CSP بلا `unsafe-inline`، `frame-src` محصور بنطاقات السيرفرات، `referrer-policy: no-referrer`.
- Token bucket لكل IP + حد تزامن عام + سقف مهلة 15s + سقف جسم 2MB للطلبات الخارجية.
- ممنوع طلب أي عنوان داخلي (SSRF): https عام فقط، و`redirect: manual` على كل upstream.
- `ETag` من محتوى الملف (لا من الحجم) و`no-cache` للأصول — ما يعلق الزائر على JS قديم.
- كل الأرقام في SQL مُعاملة، و`ORDER BY` من خريطة ثابتة.

## النشر

`DEPLOY.md` — Oracle Always Free (24/7 بلا نوم) + Cloudflare Tunnel + Docker/systemd.

## ملاحظة

بدون `TMDB_API_KEY` القوائم العربية والمسلسلات ونتفلكس وكوري ضعيفة — YTS أفلام إنجليزية غالباً. المفتاح مجاني من <https://www.themoviedb.org/settings/api>.

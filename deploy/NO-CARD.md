# استضافة مجانية بدون بطاقة — Render / Koyeb

Oracle Always Free ممتاز لكنه يطلب بطاقة للتحقق. الحلول التالية **بلا بطاقة**، وكلها تشغّل نفس صورة Docker.

## Render (الأسهل — نشر تلقائي من GitHub)

1. سجّل عند <https://dashboard.render.com/register> (GitHub login، بلا بطاقة).
2. **New + → Blueprint** → اختر ريبو `flix`. يقرأ `render.yaml` ويجهّز الخدمة.
   - بدون Blueprint: **New + → Web Service** → الريبو → **Runtime: Docker** → Plan: **Free** → Health Check Path: `/healthz`.
3. أضف المتغيرات:
   - `TMDB_API_KEY` — اختياري لكن يفتح المسلسلات ونتفلكس وكوري.
   - `ADMIN_KEY` — من `.env` عندك (٤٨ حرف).
4. Deploy. أول إقلاع يبني الكتالوج تلقائياً (`src/seed-if-empty.js`) — انتظر ~٩٠ ثانية.
5. الرابط: `https://flix-xxxx.onrender.com`.

**حدود الخطة المجانية:** ٥١٢MB رام، نوم بعد ١٥ دقيقة خمول، قرص مؤقت (الكتالوج يُبنى عند كل إقلاع).

### منع النوم
سجّل في <https://cron-job.org> (مجاني، بلا بطاقة) وأضف مهمة:

```
URL:      https://flix-xxxx.onrender.com/healthz
Schedule: every 10 minutes
```

يصير الموقع مستيقظ ٢٤/٧. `/healthz` لا يلمس قاعدة البيانات ولا يستهلك حصة TMDB.

## Koyeb (بلا نوم فعلي)

1. <https://app.koyeb.com/auth/signup> — GitHub، بلا بطاقة.
2. **Create Service → Web Service → GitHub** → الريبو.
3. Builder: **Dockerfile** · Instance: **Free** · Port: `8095` · Health check: `/healthz`.
4. Env: `HOST=0.0.0.0`, `NODE_ENV=production`, `TRUST_PROXY=1`.
5. الرابط: `https://<app>.koyeb.app`.

Koyeb المجاني يعمل scale-to-zero عند الخمول — أول طلب بعد الخمول ياخذ ٢–٥ ثوانٍ. نفس حل cron-job.org يمنعها.

## الحماية على المجاني

- **Cloudflare** (بلا بطاقة): أضف الدومين، Proxy ON، WAF Managed Rules، Rate limiting rule: `/api/*` → 60 req/min per IP، Bot Fight Mode.
- رابط `onrender.com` أو `koyeb.app` ما يقدر يتخفى وراه Cloudflare إلا بدومين. بدونه، حماية التطبيق نفسها شغالة: token bucket، حد تزامن، مهلة ١٥ث، سقف جسم، SSRF مقفول.
- لا تضع `ADMIN_KEY` في مكان عام. `/api/admin/ingest` مقفول بدونه.

## الفرق عن Oracle

| | Render Free | Koyeb Free | Oracle A1 |
|---|---|---|---|
| بطاقة | لا | لا | نعم (تحقق) |
| نوم | ١٥ دقيقة | scale-to-zero | لا |
| رام | 512MB | 512MB | 24GB |
| قرص ثابت | لا | لا | 200GB |
| ٤/٢٤ | بـcron ping | بـcron ping | أصلاً |

للجدّية: Oracle. للتجربة الآن بلا بطاقة: Render + cron ping.

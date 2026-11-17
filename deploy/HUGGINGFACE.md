# Hugging Face Spaces — استضافة بلا بطاقة

Space من نوع Docker يبني نفس `Dockerfile` تلقائياً. لا بطاقة، ولا خطوة بناء يدوية.

## ما يحتاجه المشروع

`README.md` فيه front matter في أوله:

```yaml
---
title: flix
sdk: docker
app_port: 8095
---
```

`app_port` يطابق `EXPOSE 8095` في `Dockerfile` — لو غيّرت البورت، غيّر الاثنين.

## خطوات النشر

1. حساب على <https://huggingface.co/join> (بريد فقط، بلا بطاقة).
2. Token: **Settings → Access Tokens → New token → Write**.
3. أنشئ Space: <https://huggingface.co/new-space> — SDK: **Docker**، Template: **Blank**، Hardware: **CPU basic (free)**.
4. ادفع الكود:

```bash
git remote add hf https://huggingface.co/spaces/<user>/<space>
git push hf main
```

عند السؤال عن كلمة السر: اسم المستخدم + الـtoken.

5. HF يبني الصورة (~٣ دقايق). الرابط:

```
https://<user>-<space>.hf.space
```

6. أول إقلاع يبني الكتالوج تلقائياً (~٩٠ ثانية) — `src/seed-if-empty.js`.

## الحدود

- **مجاني**: 2 vCPU · 16 GB RAM · 50 GB disk.
- **نوم**: Space مجاني ينام بعد ~٤٨ ساعة بدون زيارة. علاجه: cron ping كل ٣٠ دقيقة على `/healthz` (cron-job.org، بلا بطاقة) — يصير مستيقظ دائماً.
- **القرص**: مؤقت بين إعادة البناء، فالكتالوج يُبنى في كل إقلاع.
- **عام**: Space مجاني يكون عاماً. الريبو نفسه يبقى خاصاً لو حبيت.

## متغيرات

في Space: **Settings → Variables and secrets**:

```
HOST=0.0.0.0
TRUST_PROXY=1
NODE_ENV=production
TMDB_API_KEY=...   (secret، اختياري)
ADMIN_KEY=...      (secret)
```

بدونها يشتغل، لكن `HOST` الافتراضي `127.0.0.1` يمنع الوصول من برّا — **لازم** `HOST=0.0.0.0`.

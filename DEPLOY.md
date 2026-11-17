# DEPLOY — نشر flix مجاناً 24/7 مع حماية DDoS

الموقع: Node.js 26+ (يعمل على 22.5+)، بلا أي npm dependency، SQLite عبر `node:sqlite`، منفذ `8095`، فحص صحة على `/healthz`. الملفات الحساسة: `.env` (يُنشأ محلياً، لا يُرفع أبداً)، `data/flix.db`.

الفكرة الأساسية: **النفق يخرج من السيرفر، ما يدخل منه شيء** — لا بورت مفتوح على الإنترنت أصلاً، فيتعذر الوصول للأصل (origin) للضرب مباشرة، وكل هجوم يمر من شبكة كلاودفلير أول.

---

## 1. الجدول السريع — استضافة مجانية 24/7

| المزوّد | ينام؟ | الرام | صلاحية المجاني | الأنسب لـ |
|---|---|---|---|---|
| **Oracle Always Free** ⭐ | **لا ينام أبداً** | حتى **24 GB** (Ampere A1: 4 OCPU × 6 GB، أو مزيج حتى 24 GB) | دائم ضمن Always Free، بلا بطاقة رمز* | الإنتاج الحقيقي — الأفضل بلا منازع |
| Koyeb Free | **ينام** عند الخمول (scale-to-zero)، إيقاظ 5–30 ث | 512 MB | خدمة مجانية واحدة دائمة | تجربة سريعة |
| Render Free | **ينام بعد 15 دقيقة** خمول (سبين-داون) | 512 MB | دائم لكن بقرص غير ثابت | ديمو، مو موقع كتالوج |
| Fly.io | لا ينام، لكن **البدل المجاني للمستخدمين الجدد محدود/ملغي** منذ 2024 — الآلات القديمة فقط | 256 MB للآلة المجانية | حسب العهد القديم | من عنده حساب قديم |
| Zeabur Free | ينام/يوقف بعد الحصة | 512 MB | حصة شهرية محدودة | تجربة |
| Northflank Free | لا ينام لكن الحصة ضيقة جداً | 256 MB | حصص محدودة | مكوّن واحد صغير |

\* Oracle يسأل عن بطاقة للتحقق فقط، ما يسحب منها ضمن Always Free. التفاصيل تتغير — **راجع صفحة الأسعار عند كل مزوّد قبل التسجيل**، فهذا الجدول مكتوب بتاريخ نشره.

**الخلاصة:** Oracle Always Free هو الخيار الوحيد «بدون نوم + رام حقيقية». الباقي ينام أو حصصه رمزية — وموقع أفلام مع SQLite محلي يحتاج قرصاً ثابتاً، وهو متاح فقط عند Oracle (وFly.io بقرص مدفوع).

---

## 2. Oracle Always Free — الخطوات كاملة (المسار الموصى به)

1. **إنشاء الحساب:** cloud.oracle.com → Start for free → Home Region قريب (مثلاً UAE East / UAE Central).
2. **إنشاء الآلة:** Compute → Create Instance → Shape: **Ampere A1** (Flex) → عدّل إلى **4 OCPU + 24 GB RAM** (داخل حصة Always Free) → Image: **Ubuntu 24.04** (Minimal كافٍ) → أضف مفتاح SSH.
3. **الشبكة:** أثناء الإنشاء، لا تضف أي Ingress Rule غير SSH (المنفذ 22). **لا تفتح 8095 ولا 80/443** — النفق يكفي.
4. اتصال: `ssh ubuntu@<IP-العام>`
5. انقل الكود: `rsync -av --exclude data --exclude .env flix/ ubuntu@<IP>:~/flix`
6. شغّل التركيب:
   ```bash
   sudo -E APP_DIR=/opt/flix bash ~/flix/deploy/install.sh
   ```
   (لو ما عندك توكن نفق بعد، اتركه — السكربت يطبع الخطوات اليدوية)
7. **التوكـن:** كلاودفلير Zero Trust → Networks → Tunnels → Create tunnel → اسم `flix-tunnel` → انسخ التوكـن ثم:
   ```bash
   CLOUDFLARED_TUNNEL_TOKEN=eyJ... sudo -E cloudflared service install eyJ...
   ```
8. Public hostname في لوحة النفق: subdomain `flix` → domain `example.com` → service `http://localhost:8095`. (بوضع التوكن تضبطه من اللوحة مباشرة، ما تحتاج config.yml).

**النتيجة:** آلة 4 OCPU/24GB، لا نوم، لا منفذ مفتوح، خدمة systemd بتصلّب كامل + نسخ احتياطي يومي.

---

## 3. الباقي باختصار (لما Oracle ما ينفع)

### Koyeb Free (ينام — للتجربة)
1. ارفع الصورة إلى Docker Hub/GHCR: `docker build -t USER/flix . && docker push USER/flix`.
2. Koyeb → Create Web Service → Docker image → اربط مستودعك → Port: `8095` → Env: `NODE_ENV=production`, `HOST=0.0.0.0`.
3. **قرص ثابت غير متاح بالمجاني** → `data/flix.db` يُمسح عند كل إعادة نشر — خذ snapshot أو خزّن قاعدة البيانات عند مزوّد S3 مجاني وحمّلها عند الإقلاع (يحتاج تعديل كود — خارج هذه الحزمة).
4. النفق: بما أن ما تقدر تشغّل حاوية ثانية مجاناً، اربط الدومين مباشرة في Koyeb وفعّل **Proxy ON** في كلاودفلير (انظر §5) — الأصل بيكون مكشوفاً باسم Koyeb، أضعف من النفق.

### Render Free (ينام 15 دقيقة)
1. New → Web Service → اربط مستودع Git → Environment: Docker → Render يقرأ `Dockerfile` تلقائياً.
2. Env: `HOST=0.0.0.0`, `NODE_ENV=production`, `PORT=8095` (Render يحقن PORT — تجاهله، التطبيق يقرأه أصلاً).
3. Free لا يسمح بقرص ثابت → SQLite يُمسح. **ينام بعد 15 دقيقة خمول → الموقع بارد لكل زائر جديد.** مو مناسب لموقع كتالوج.

### Fly.io (بدل محدود)
1. `fly launch --no-deploy` (يقرأ Dockerfile) → `fly volumes create flixdata --size 3` (القرص مدفوع بعد بدل صغير).
2. في `fly.toml`: `[mounts] source="flixdata", destination="/app/data"`، داخلي `internal_port = 8095`.
3. `fly deploy` ثم `fly certs add flix.example.com` أو نفق بآلة ثانية: `fly machines run cloudflare/cloudflared:latest --env TUNNEL_TOKEN=...` — لا تنسَ `--network` المشترك مع التطبيق.

### Zeabur / Northflank
كلاهما: deploy من GitHub بقالب Docker، بيئة `HOST=0.0.0.0`، والحصص المجانية تنام/توقف الخدمة. لربط نفق: مدفوع أو اربط الدومين مباشرة مع Proxy ON.

---

## 4. Docker Compose (سيرفر أي كان)

```bash
cd flix
cp -n .env .env 2>/dev/null || true   # أو أنشئ .env يدوياً:
cat > .env <<'EOF'
CLOUDFLARED_TUNNEL_TOKEN=eyJ...   # من Zero Trust → Tunnels
# TMDB_API_KEY=
# ADMIN_KEY=
EOF
docker compose up -d --build
docker compose ps            # الحالتين healthy
docker stats                 # مراقبة حيّة
```

ترقية بلا توقف طويل:
```bash
sudo bash deploy/update.sh
```

**ملاحظة rate-limit لكل IP (مهم):** `src/security.js` يثق بـ `CF-Connecting-IP` فقط إذا جاء الطلب من `127.0.0.1`. بالوضع الافتراضي في compose، cloudflared يتصل عبر شبكة bridge فيرى التطبيق IP حاوية — الحد يصير إجمالياً مو لكل زائر. الحل: فعّل `network_mode: "service:flix"` في compose (التعليقات جاهزة داخله)، وغير ingress إلى `http://localhost:8095`. على مسار systemd المسألة محسومة تلقائياً لأن النفق يوصل من loopback.

---

## 5. حماية DDoS عملية (Cloudflare)

راجع كل بند من لوحة كلاودفلير بعد إضافة الدومين:

1. **Proxy ON:** سجل DNS (A/CNAME) → أيقونة السحابة برتقالية «Proxied». مع النفق DNS يكون CNAME تلقائي `UUID.cfargotunnel.com` ومُمرَّر أصلاً.
2. **SSL/TLS → Overview:** Full (strict). ما في شهادة أصلة مسألة — النفق يتكفل.
3. **WAF → Managed Rules:** فعّل «Cloudflare Managed Ruleset» (يسدّ SQLi/XSS/RFI المعروفة). خطة المجاني فيها المجموعة الأساسية فقط — تكفي كبداية.
4. **Rate limiting rule (المجاني يسمح بقاعدة واحدة):**
   - Security → WAF → Rate limiting rules → Create:
     - Expression: `(http.request.uri.path contains "/api/")`
     - Rate: **60 requests / 60 seconds** per IP (characteristic: IP address)
     - Action: **Block** for 60 seconds.
   - نسخة JSON للمفكّرة:
     ```json
     {
       "match": { "expression": "(http.request.uri.path contains \"/api/\")" },
       "characteristics": ["ip.src"],
       "period": 60,
       "threshold": 60,
       "action": { "response": { "status": 429 } }
     }
     ```
   - التطبيق نفسه عنده token-bucket داخلي في `security.js` — كلاودفلير يصدّ الحجم فوقه.
5. **Bot Fight Mode:** Security → Bots → فعّله (يحدّ طلبات السكرابرز الشائعة).
6. **Under Attack Mode:** عند هجوم فعلي — Security → Settings → Security Level: **I'm Under Attack** (interstitial تحدي 5 ثوانٍ لكل زائر). شغّله وقت الضرب فقط، ثم أرجّعه.
7. **إخفاء الأصل:** لا تفتح أي بورت inbound في جدار السيرفر/مجموعة أمان Oracle. تحقّق: `ufw status` يعرض OpenSSH فقط، و`ss -tlnp | grep 8095` يظهر `127.0.0.1:8095` أو داخل حاوية فقط.
8. **`TRUST_PROXY=1`:** مضبوط في compose وsystemd — للتطبيق يقرأ IP الزائر الحقيقي من `CF-Connecting-IP` بدل عنوان النفق.
9. **Backups لـ `data/flix.db`:** cron يومي يُثبَّت تلقائياً بـ install.sh (`/etc/cron.d/flix-backup` — نسخة `.backup` آمنة مع WAL + تنظيف أقدم من 14 يوم). يدوياً:
   ```bash
   sqlite3 /opt/flix/data/flix.db ".backup '/var/backups/flix-$(date +%F).db'"
   ```
10. **مراقبة:**
    ```bash
    docker stats            # رام/CPU لحظي للحاويتين
    docker compose logs -f  # سجلات
    journalctl -u flix -f   # مسار systemd
    curl -s http://127.0.0.1:8095/healthz && echo  # نبضة يدوية
    ```

---

## 6. الملفات

```
flix/
├── Dockerfile                      # node:22-alpine، مستخدم غير root، healthcheck على /healthz
├── docker-compose.yml              # flix + cloudflared، read_only، cap_drop ALL، mem_limit
├── .dockerignore
├── DEPLOY.md                       # هذا الملف
└── deploy/
    ├── cloudflared/config.yml      # وضع config-file (بديل التوكن) — protocol: http2
    ├── systemd/flix.service        # وحدة مصلّبة: ProtectSystem=strict، MemoryMax=512M
    ├── install.sh                  # تركيب Ubuntu 24.04: مستخدم+node+systemd+cloudflared+ufw+cron
    └── update.sh                   # تحديث: نسخة احتياطية → rsync → restart → healthcheck → تراجع
```

المتغيرات البيئية المقروءة من `src/config.js`: `PORT` (8095)، `HOST`، `TRUST_PROXY`، `TMDB_API_KEY`، `TMDB_LANG`، `OPENSUBTITLES_API_KEY`، `SUBTITLE_LANG`، `ADMIN_KEY`، `EMBED_HOSTS`، `PROBE_*`، `DB_PATH`، `SUBS_DIR` — الأسرار تُدار في `.env` على السيرفر فقط.

#!/usr/bin/env bash
# flix — تركيب كامل على Ubuntu 24.04: مستخدم، كود، systemd، cloudflared، جدار ناري.
#
# الاستخدام (كـ root على السيرفر):
#   sudo bash install.sh
#
# القيم الافتراضية تُغيّر من البيئة:
#   APP_DIR=/opt/flix RUN_USER=flix PORT=8095 TUNNEL_TOKEN=eyJ... sudo -E bash install.sh
#
# لا أسرار داخل هذا الملف — التوكـن والعناصر السرية تُمرّر من البيئة أو تكتب في .env يدوياً.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flix}"
RUN_USER="${RUN_USER:-flix}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PORT="${PORT:-8095}"
TUNNEL_TOKEN="${CLOUDFLARED_TUNNEL_TOKEN:-}"
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERR: شغّل السكربت كـ root (sudo bash install.sh)" >&2
  exit 1
fi

echo "==> 1/8 مستخدم النظام ${RUN_USER}"
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --no-create-home \
    --shell /usr/sbin/nologin "$RUN_USER"
fi

echo "==> 2/8 حزم الأساس"
apt-get update -qq
apt-get install -y -qq ca-certificates curl ufw rsync sqlite3 tar >/dev/null

echo "==> 3/8 Node ${NODE_MAJOR} من NodeSource"
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

echo "==> 4/8 نسخ الكود إلى ${APP_DIR}"
mkdir -p "$APP_DIR/data"
rsync -a --delete \
  --exclude "data" --exclude ".env" --exclude "*.log" --exclude "*.png" \
  "$SRC_DIR/src" "$SRC_DIR/public" "$SRC_DIR/package.json" "$SRC_DIR/deploy" "$APP_DIR/"
cp "$SRC_DIR/deploy/systemd/flix.service" /etc/systemd/system/flix.service
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR"

echo "==> 5/8 ملف .env (لا يُكتب فوق ملف موجود)"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=${PORT}
TRUST_PROXY=1
# TMDB_API_KEY=            # مفتاح v3 أو توكن v4 (eyJ...) — اختياري
# OPENSUBTITLES_API_KEY=   # اختياري
# ADMIN_KEY=               # يفعّل نقاط الأدمن — اتركه فارغاً لتعطيلها
EOF
  chown "$RUN_USER:$RUN_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    أنشأنا ${APP_DIR}/.env — عدّل القيم الاختيارية إن رغبت"
else
  echo "    .env موجود — لم نلمسه"
fi

echo "==> 6/8 تشغيل الخدمة"
systemctl daemon-reload
systemctl enable --now flix.service
sleep 2
systemctl is-active flix.service >/dev/null \
  || { journalctl -u flix.service -n 30 --no-pager >&2; exit 1; }

echo "==> 7/8 جدار ناري — لا منفذ للتطبيق على الإنترنت (النفق يخرج فقط)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

echo "==> 8/8 cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
  dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi
if [[ -n "$TUNNEL_TOKEN" ]]; then
  cloudflared service install "$TUNNEL_TOKEN"
  systemctl enable --now cloudflared.service
  echo "    النفق شغال (وضع التوكن)"
else
  echo "    ما في توكن — وضع config-file يدوي:"
  echo "      cloudflared tunnel login"
  echo "      cloudflared tunnel create flix-tunnel"
  echo "      cloudflared tunnel route dns flix-tunnel flix.example.com"
  echo "      # عدّل deploy/cloudflared/config.yml ثم:"
  echo "      cloudflared --config ${APP_DIR}/deploy/cloudflared/config.yml tunnel run flix-tunnel"
fi

echo "==> نسخ احتياطي يومي 03:20"
cat > /etc/cron.d/flix-backup <<EOF
20 3 * * * root sqlite3 ${APP_DIR}/data/flix.db ".backup '/var/backups/flix-\$(date +\%F).db'" && find /var/backups -name 'flix-*.db' -mtime +14 -delete
EOF
chmod 644 /etc/cron.d/flix-backup

echo "==> فحص صحة"
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "OK: flix حي على 127.0.0.1:${PORT} — الموقع يوصل عبر Cloudflare فقط"
    exit 0
  fi
  sleep 2
done
echo "ERR: /healthz ما جاوبت — شوف: journalctl -u flix.service -n 50" >&2
exit 1

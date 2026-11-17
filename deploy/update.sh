#!/usr/bin/env bash
# flix — تحديث بلا توقف طويل: نسخة احتياطية من الكود، rsync، إعادة تشغيل، فحص صحة، تراجع عند الفشل.
#
# الاستخدام على السيرفر:
#   sudo bash update.sh                          # SOURCE_DIR الافتراضي: المجلد اللي جنبه السكربت
#   sudo SOURCE_DIR=/root/flix-new bash update.sh
#
# يعتمد تلقائياً: systemd (flix.service) أو docker compose (docker-compose.yml في APP_DIR).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/flix}"
SOURCE_DIR="${SOURCE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="${PORT:-8095}"
HEALTH_URL="http://127.0.0.1:${PORT}/healthz"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERR: شغّل السكربت كـ root" >&2
  exit 1
fi

wait_health() {
  local i
  for i in $(seq 1 15); do
    curl -fsS "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
   && [[ -f "$APP_DIR/docker-compose.yml" ]]; then
  echo "==> مسار docker compose"
  docker tag flix:prod flix:backup 2>/dev/null || true
  cd "$APP_DIR"
  docker compose build flix
  docker compose up -d flix
  if wait_health; then
    echo "OK: التحديث شغال"
    exit 0
  fi
  echo "ERR: فحص الصحة فشل بعد التحديث — تراجع إلى flix:backup" >&2
  docker tag flix:backup flix:prod
  docker compose up -d flix
  exit 1
fi

if [[ ! -f /etc/systemd/system/flix.service ]]; then
  echo "ERR: لا systemd ولا docker compose في ${APP_DIR}" >&2
  exit 1
fi

echo "==> مسار systemd — نسخة احتياطية من الكود"
tar -czf /var/backups/flix-code-$(date +%F-%H%M).tar.gz \
  -C "$APP_DIR" src public package.json

echo "==> نسخ الكود الجديد"
rsync -a --delete \
  --exclude "data" --exclude ".env" --exclude "*.log" --exclude "*.png" \
  "$SOURCE_DIR/src" "$SOURCE_DIR/public" "$SOURCE_DIR/package.json" "$APP_DIR/"
chown -R flix:flix "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/package.json"

echo "==> إعادة تشغيل"
systemctl restart flix.service
if wait_health; then
  echo "OK: التحديث شغال — خدمة متوقفة ثوانٍ فقط"
  exit 0
fi

echo "ERR: /healthz فشل — تراجع" >&2
latest=$(ls -1t /var/backups/flix-code-*.tar.gz | head -1)
tar -xzf "$latest" -C "$APP_DIR"
chown -R flix:flix "$APP_DIR/src" "$APP_DIR/public"
systemctl restart flix.service
wait_health || { journalctl -u flix.service -n 50 --no-pager >&2; exit 1; }
echo "OK: رجعنا للنسخة السابقة"

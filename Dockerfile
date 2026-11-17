# flix — صورة إنتاج. لا npm dependencies إطلاقاً (node:sqlite مدمج)،
# فلا خطوة npm install ولا قفل إصدارات — فقط node:24 مع الكود.
FROM node:24-alpine

# الإعدادات الثابتة للصورة (المتغيرات الحساسة تجي من env_file في compose)
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8095

WORKDIR /app

# الكود ينسخ فقط — data ييجي من volume، لا يُحمل داخل الصورة
COPY package.json ./
COPY src ./src
COPY public ./public

# مجلد البيانات بملكية مستخدم node (uid 1000) حتى يشتغل volume باسمه
RUN install -d -o node -g node -m 0755 /app/data

USER node

# /healthz موجود في src/server.js — فحص حقيقي لا يلمس الأرضية
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
    CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1

EXPOSE 8095

VOLUME ["/app/data"]

CMD ["sh", "-c", "node src/seed-if-empty.js; exec node src/server.js"]

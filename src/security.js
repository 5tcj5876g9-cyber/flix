import { timingSafeEqual } from 'node:crypto';

/* ------------------------------ client ip -------------------------------- */

/**
 * خلف Cloudflare Tunnel كل الطلبات تجي من 127.0.0.1، والعنوان الحقيقي في
 * CF-Connecting-IP. نثق به فقط لو TRUST_PROXY=1، ونرفض أي شكل غلط.
 */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export function clientIp(req) {
  // الهيدر موثوق فقط لو الطلب فعلاً جاي من النفق المحلي.
  // منفذ مكشوف على الإنترنت يقدر يزوّر CF-Connecting-IP، فلا نقرأه منه.
  const peer = req.socket.remoteAddress ?? '';
  if (TRUST_PROXY && LOOPBACK.has(peer)) {
    const cf = req.headers['cf-connecting-ip'];
    const candidate = Array.isArray(cf) ? cf[0] : cf;
    if (candidate && (IPV4.test(candidate) || IPV6.test(candidate))) return candidate;
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim();
    if (forwarded && (IPV4.test(forwarded) || IPV6.test(forwarded))) return forwarded;
  }
  return peer || 'unknown';
}

/* ------------------------------ rate limits ------------------------------ */

/**
 * Token bucket لكل IP. الحجم محدود: لو تجاوزنا السقف نطرد أقدم مفتاح،
 * ما نترك خريطة تكبر لين تبلع الرام.
 */
export class RateLimiter {
  constructor({ capacity = 90, refillPerSecond = 1.5, maxKeys = 20000, banMs = 60_000, banThreshold = 120 } = {}) {
    this.capacity = capacity;
    this.refill = refillPerSecond;
    this.maxKeys = maxKeys;
    this.banMs = banMs;
    this.banThreshold = banThreshold;
    this.buckets = new Map();
  }

  check(key, cost = 1) {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      bucket = { tokens: this.capacity, updated: now, strikes: 0, bannedUntil: 0 };
      this.buckets.set(key, bucket);
    }

    if (bucket.bannedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((bucket.bannedUntil - now) / 1000) };
    }

    const elapsed = (now - bucket.updated) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refill);
    bucket.updated = now;

    if (bucket.tokens < cost) {
      bucket.strikes += 1;
      if (bucket.strikes >= this.banThreshold) {
        bucket.bannedUntil = now + this.banMs;
        bucket.strikes = 0;
      }
      return { allowed: false, retryAfter: 1 };
    }

    bucket.tokens -= cost;
    if (bucket.strikes > 0) bucket.strikes -= 1;
    return { allowed: true, retryAfter: 0 };
  }

  sweep() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.bannedUntil < now && now - bucket.updated > 600_000) this.buckets.delete(key);
    }
  }
}

/* -------------------------------- cache ---------------------------------- */

/**
 * كاش صغير في الذاكرة مع stale-on-error: لو TMDB سقط أو حدّك بالحصة،
 * الزوار يشوفون آخر نتيجة ناجحة بدل صفحة خطأ.
 */
export class TtlCache {
  constructor({ ttlMs = 300_000, max = 600 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.at;
    return { value: entry.value, fresh: age < this.ttlMs, age };
  }

  set(key, value) {
    if (this.store.size >= this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, at: Date.now() });
  }
}

export async function cached(cache, key, producer) {
  const hit = cache.get(key);
  if (hit?.fresh) return hit.value;
  try {
    const value = await producer();
    cache.set(key, value);
    return value;
  } catch (error) {
    if (hit) return hit.value;
    throw error;
  }
}

/* ------------------------------- headers --------------------------------- */

const EMBED_HOSTS = process.env.EMBED_HOSTS ?? '';

export function securityHeaders(res, { cspHosts = [] } = {}) {
  const validHost = /^[a-z0-9.-]{1,120}$/i;
  const frameHosts = [
    ...new Set([...cspHosts, ...EMBED_HOSTS.split(',')].map((h) => h.trim()).filter((h) => validHost.test(h))),
  ];
  const csp = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: https:",
    "script-src 'self'",
    "style-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    `frame-src 'self' ${frameHosts.map((h) => `https://${h}`).join(' ')}`.trim(),
    'upgrade-insecure-requests',
  ].join('; ');

  res.setHeader('content-security-policy', csp);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  if (process.env.NODE_ENV !== 'production') res.setHeader('cache-control', 'no-store');
}

/* -------------------------------- admin ---------------------------------- */

export function adminAllowed(req) {
  const expected = process.env.ADMIN_KEY ?? '';
  if (!expected) return false;
  const supplied = String(req.headers['x-admin-key'] ?? '');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function tokenEq(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

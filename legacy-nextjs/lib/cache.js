/**
 * Tiny cache + rate limiter shared by the API routes.
 *
 * Two backends:
 *   - Vercel KV, when KV_REST_API_URL and KV_REST_API_TOKEN are set. Shared
 *     across function instances, so this is the one that actually protects
 *     sw.docking.org once the site is public.
 *   - An in-process Map otherwise. Fine for local dev and a private deploy,
 *     but every cold lambda starts empty, so it is NOT enough on its own for a
 *     public site.
 */

const MEM = new Map();
const MEM_MAX = 400;

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const hasSharedCache = Boolean(KV_URL && KV_TOKEN);

function memGet(key) {
  const entry = MEM.get(key);
  if (!entry) return null;
  if (entry.expires && entry.expires < Date.now()) {
    MEM.delete(key);
    return null;
  }
  // refresh LRU position
  MEM.delete(key);
  MEM.set(key, entry);
  return entry.value;
}

function memSet(key, value, ttlSeconds) {
  if (MEM.size >= MEM_MAX) MEM.delete(MEM.keys().next().value);
  MEM.set(key, {
    value,
    expires: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

export async function cacheGet(key) {
  if (hasSharedCache) {
    try {
      const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        cache: "no-store",
      });
      if (res.ok) {
        const body = await res.json();
        if (body?.result) return JSON.parse(body.result);
      }
    } catch {
      /* fall through to memory */
    }
  }
  return memGet(key);
}

export async function cacheSet(key, value, ttlSeconds = 60 * 60 * 24 * 30) {
  memSet(key, value, ttlSeconds);
  if (hasSharedCache) {
    try {
      await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?ex=${ttlSeconds}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(value),
      });
    } catch {
      /* cache writes are best effort */
    }
  }
}

/**
 * Per-IP request budget. In-process only, so it is a speed bump rather than a
 * wall — treat it as the minimum, not the solution.
 *
 * Buckets are keyed by IP *and* scope. Without the scope, pulling ADMET for a
 * shortlist (several chunked calls) would quietly spend the user's search
 * allowance and they would be locked out of the thing they actually came for.
 */
const HITS = new Map();

export function rateLimit(ip, { scope = "default", limit = 12, windowSeconds = 600 } = {}) {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const hits = (HITS.get(key) || []).filter((t) => now - t < windowMs);

  if (hits.length >= limit) {
    HITS.set(key, hits);
    return {
      ok: false,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)),
    };
  }

  hits.push(now);
  HITS.set(key, hits);

  // keep the map from growing without bound on a long-lived instance
  if (HITS.size > 5000) {
    for (const [k, v] of HITS) {
      if (!v.length || now - v[v.length - 1] > windowMs) HITS.delete(k);
      if (HITS.size <= 2500) break;
    }
  }

  return { ok: true, remaining: limit - hits.length };
}

export function clientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Sleep helper for throttled loops. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

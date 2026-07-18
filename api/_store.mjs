/* Tiny KV adapter backed by an Upstash-compatible Redis REST API.
   Vercel's Upstash/KV integrations inject either KV_REST_API_* or
   UPSTASH_REDIS_REST_* env vars — both are accepted here.
   Replaces the Netlify Blobs store used on the previous host. */

const BASE =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const storeReady = () => Boolean(BASE && TOKEN);

export async function kvGet(key) {
  if (!storeReady()) return null;
  try {
    const res = await fetch(`${BASE}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.result == null) return null;
    return typeof body.result === 'string' ? JSON.parse(body.result) : body.result;
  } catch {
    return null;
  }
}

export async function kvSet(key, value) {
  if (!storeReady()) return false;
  try {
    const res = await fetch(`${BASE}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}

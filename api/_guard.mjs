/* Shared request guards: admin authentication and per-IP rate limiting.

   Every endpoint here is unauthenticated or guarded by a single shared key,
   with no lockout of any kind, so a script could previously reserve every open
   window in the calendar, fill the store with signed contracts, or grind
   through ADMIN_KEY guesses for as long as it liked. These helpers put a
   budget on all three.

   Counters live in the same Upstash KV the rest of the site uses. If the store
   is unreachable the limiter fails OPEN — a storage outage should not take the
   booking form down with it. */

import { kvIncr } from './_store.mjs';

// works with both the edge handlers (Headers) and the node ones (plain object)
const header = (req, name) => {
  const h = req.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(name) || '';
  return h[name] || h[name.toLowerCase()] || '';
};

export const clientIp = (req) =>
  (header(req, 'x-vercel-forwarded-for') || header(req, 'x-forwarded-for') || '')
    .split(',')[0]
    .trim() || 'unknown';

// length-safe, branch-free string compare, so a wrong key leaks no timing
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const isAdmin = (req) => {
  const expected = process.env.ADMIN_KEY || '';
  return Boolean(expected) && safeEqual(header(req, 'x-admin-key'), expected);
};

/* Fixed-window counter. Returns true while the caller is within budget. */
export async function withinLimit(req, bucket, limit, windowSec) {
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const n = await kvIncr(`rl:${bucket}:${clientIp(req)}:${slot}`, windowSec + 5);
  return n === null || n <= limit;
}

const tooMany = () =>
  Response.json(
    { error: 'too many requests' },
    { status: 429, headers: { 'Retry-After': '3600' } }
  );

/* Guard for public endpoints. Returns a 429 Response to send back, or null. */
export async function limitPublic(req, bucket, limit, windowSec = 3600) {
  return (await withinLimit(req, bucket, limit, windowSec)) ? null : tooMany();
}

/* Guard for admin endpoints. Returns a Response to send back, or null when the
   caller is a verified admin. Wrong keys are counted and cut off well before a
   guessing run gets anywhere; correct keys are never rate limited. */
export async function requireAdmin(req) {
  if (isAdmin(req)) return null;
  if (!(await withinLimit(req, 'adminfail', 10, 900))) return tooMany();
  return Response.json({ error: 'unauthorized' }, { status: 401 });
}

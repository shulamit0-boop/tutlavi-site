/* מתאם KV מול Upstash Redis REST — אותה תשתית שמריצה את אתר תות.
   Vercel מזריק או KV_REST_API_* או UPSTASH_REDIS_REST_*; שניהם נתמכים. */

const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const storeReady = () => Boolean(BASE && TOKEN);

const auth = { Authorization: `Bearer ${TOKEN}` };
const parse = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

export async function kvGet(key) {
  if (!storeReady()) return null;
  try {
    const res = await fetch(`${BASE}/get/${encodeURIComponent(key)}`, {
      headers: auth,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return parse((await res.json())?.result);
  } catch {
    return null;
  }
}

/* קריאת הרבה פריטים בבת אחת. בלי זה טעינת דף הבית הייתה מאות קריאות
   נפרדות ל-KV, וזה מה שהופך דף מהיר לדף שנטען שתי שניות. */
export async function kvMGet(keys) {
  if (!storeReady() || !keys.length) return [];
  const out = [];
  for (let i = 0; i < keys.length; i += 60) {
    const chunk = keys.slice(i, i + 60);
    try {
      const path = chunk.map((k) => encodeURIComponent(k)).join('/');
      const res = await fetch(`${BASE}/mget/${path}`, { headers: auth, cache: 'no-store' });
      if (!res.ok) {
        out.push(...chunk.map(() => null));
        continue;
      }
      const arr = (await res.json())?.result;
      out.push(...(Array.isArray(arr) ? arr.map(parse) : chunk.map(() => null)));
    } catch {
      out.push(...chunk.map(() => null));
    }
  }
  return out;
}

export async function kvSet(key, value) {
  if (!storeReady()) return false;
  try {
    const res = await fetch(`${BASE}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function kvDel(key) {
  if (!storeReady()) return false;
  try {
    const res = await fetch(`${BASE}/del/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: auth,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* מונה אטומי להגבלת קצב. הפגיעה הראשונה בחלון מדליקה TTL, כך שהמפתח
   נמחק לבד ואין מה לטאטא. */
export async function kvIncr(key, ttlSec) {
  if (!storeReady()) return null;
  try {
    const res = await fetch(`${BASE}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: auth,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const n = Number((await res.json())?.result);
    if (!Number.isFinite(n)) return null;
    if (n === 1 && ttlSec) {
      await fetch(`${BASE}/expire/${encodeURIComponent(key)}/${ttlSec}`, {
        method: 'POST',
        headers: auth,
      });
    }
    return n;
  } catch {
    return null;
  }
}

/* יומן פעילות — מי נכנסה, מי העלתה, מי מחקה, מי הורידה.
   נשמר כרשימה קצרה ולא כמפתח לכל שורה: זה נקרא רק בפאנל, ותמיד בשלמותו. */
export async function logAction(entry) {
  const list = (await kvGet('audit')) || [];
  list.push({ at: new Date().toISOString(), ...entry });
  await kvSet('audit', list.slice(-1000));
}

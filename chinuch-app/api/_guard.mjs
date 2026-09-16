/* זיהוי, הרשאות והגבלת קצב.

   בשלב הזה של המערכת אין עוד חשבונות אישיות למורות (הן מגיעות בשלב הבא).
   מה שיש הוא **מפתח לכל בית ספר** ומפתח ניהול אחד:

   · מפתח ניהול (ADMIN_KEY)  → רואה ועורכת הכל, מנהלת קטגוריות ובתי ספר
   · מפתח בית ספר            → רואה את הכל שמשותף + את מה שבית הספר שלה העלה

   הבחירה במפתח לכל בית ספר ולא במפתח אחד לכולן היא מה שהופך את הסימון
   "בית הספר שלי בלבד" לגבול אמיתי שהשרת אוכף, ולא רק לסינון בתצוגה.
   כשיתווספו חשבונות אישיות — מתחלף רק המקור של הזהות, לא מודל הנתונים. */

import { kvIncr, kvGet } from './_store.mjs';

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

// השוואה באורך קבוע, כדי שמפתח שגוי לא ידליף מידע דרך זמן התגובה
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const COOKIE = 'ck';

function cookieValue(req, name) {
  const raw = header(req, 'cookie');
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export const sessionCookie = (key) =>
  `${COOKIE}=${encodeURIComponent(key)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/* המפתח מגיע מהעוגייה (כך גם תמונות תצוגה והורדות עובדות כקישור רגיל),
   ובכותרת כגיבוי לקריאות fetch מהפאנל. */
export const requestKey = (req) => cookieValue(req, COOKIE) || header(req, 'x-key') || '';

export async function identify(req, key = requestKey(req)) {
  if (!key) return null;
  if (process.env.ADMIN_KEY && safeEqual(key, process.env.ADMIN_KEY)) {
    return { role: 'admin', schoolId: null, schoolName: 'ניהול המערכת' };
  }
  const cfg = (await kvGet('config')) || {};
  const schools = Array.isArray(cfg.schools) ? cfg.schools : [];
  for (const s of schools) {
    if (s && s.key && s.active !== false && safeEqual(key, s.key)) {
      return { role: 'member', schoolId: s.id, schoolName: s.name };
    }
  }
  return null;
}

/* חלון קצב קבוע. מחזיר true כל עוד הפונה בתוך התקציב.
   אם ה-KV לא נגיש המגבלה נפתחת — תקלת אחסון לא צריכה להפיל את האתר. */
export async function withinLimit(req, bucket, limit, windowSec) {
  const slot = Math.floor(Date.now() / (windowSec * 1000));
  const n = await kvIncr(`rl:${bucket}:${clientIp(req)}:${slot}`, windowSec + 5);
  return n === null || n <= limit;
}

const tooMany = () =>
  Response.json({ error: 'יותר מדי בקשות. נסי שוב בעוד שעה.' }, {
    status: 429,
    headers: { 'Retry-After': '3600' },
  });

export async function limitPublic(req, bucket, limit, windowSec = 3600) {
  return (await withinLimit(req, bucket, limit, windowSec)) ? null : tooMany();
}

/* שומר לכל נקודת קצה שדורשת זיהוי. מחזיר { me } או { denied } */
export async function requireUser(req, minRole = 'member') {
  const me = await identify(req);
  if (!me) {
    if (!(await withinLimit(req, 'keyfail', 20, 900))) return { denied: tooMany() };
    return { denied: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  if (minRole === 'admin' && me.role !== 'admin') {
    return { denied: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { me };
}

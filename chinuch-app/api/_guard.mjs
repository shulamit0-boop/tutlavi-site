/* זהות, הרשאות והגבלת קצב.

   הזהות מגיעה מגוגל (ראה _google.mjs). אחרי האימות הראשון אנחנו מנפיקים
   **עוגיית סשן משלנו**, חתומה ב-HMAC, ולא שומרים את הטוקן של גוגל: הוא פג
   אחרי שעה, והמורה לא אמורה להתחבר מחדש כל שעה.

   העוגייה נושאת רק כתובת מייל וזמן הנפקה. התפקיד, בית הספר והמצב נקראים
   **מחדש בכל בקשה** מתוך רשימת המשתמשות — כדי שהסרה של מורה תיכנס לתוקף
   באותו רגע ולא בעוד שלושים יום. */

import { kvIncr, kvGet, kvSet } from './_store.mjs';

const MAX_AGE = 60 * 60 * 24 * 30; // שלושים יום
export const COOKIE = 'bcs';
const USERS = 'users';

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

// השוואה באורך קבוע, כדי שחתימה שגויה לא תדליף מידע דרך זמן התגובה
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/* ---------- עוגיית הסשן ---------- */

export const sessionReady = () => Boolean(process.env.SESSION_SECRET);

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmac(data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.SESSION_SECRET || ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

export async function signSession(email) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ e: email, t: Date.now() })));
  return `${payload}.${await hmac(payload)}`;
}

async function readSession(req) {
  if (!sessionReady()) return '';
  const raw = header(req, 'cookie');
  if (!raw) return '';
  let token = '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE) token = decodeURIComponent(rest.join('='));
  }
  if (!token) return '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return '';
  if (!safeEqual(sig, await hmac(payload))) return '';
  try {
    const { e, t } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!e || !t || Date.now() - t > MAX_AGE * 1000) return '';
    return String(e).toLowerCase();
  } catch {
    return '';
  }
}

const cookieFlags = `Path=/; HttpOnly; Secure; SameSite=Lax`;
export const sessionCookie = (token) => `${COOKIE}=${encodeURIComponent(token)}; ${cookieFlags}; Max-Age=${MAX_AGE}`;
export const clearCookie = () => `${COOKIE}=; ${cookieFlags}; Max-Age=0`;

/* ---------- המשתמשות ---------- */

export const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 160);

export const loadUsers = async () => (await kvGet(USERS)) || [];
export const saveUsers = (list) => kvSet(USERS, list.slice(0, 5000));

/* מנהלות־על מוגדרות במשתנה סביבה ולא בפאנל, כי אחרת אין דרך להיכנס
   למערכת ריקה בפעם הראשונה — וגם כדי שלא תהיה דרך להעניק לעצמך את
   התפקיד הזה מתוך המערכת. */
export const superAdmins = () =>
  String(process.env.SUPER_ADMINS || '')
    .split(/[,\s]+/)
    .map(normEmail)
    .filter(Boolean);

export const isSuper = (email) => superAdmins().includes(normEmail(email));

/* מי הפונה: קוראת את העוגייה, ומרכיבה את הזהות מהרשומה העדכנית ב-KV. */
export async function identify(req) {
  const email = await readSession(req);
  if (!email) return null;

  const users = await loadUsers();
  const rec = users.find((u) => u && normEmail(u.email) === email) || null;

  if (isSuper(email)) {
    return {
      email,
      name: rec?.name || email,
      role: 'super',
      schoolId: rec?.schoolId || null,
      status: 'active',
    };
  }
  if (!rec) return { email, name: '', role: 'pending', schoolId: null, status: 'unknown' };
  if (rec.status !== 'active') {
    return {
      email,
      name: rec.name || '',
      role: 'pending',
      schoolId: rec.schoolId || null,
      status: rec.status || 'pending',
    };
  }
  return {
    email,
    name: rec.name || '',
    role: rec.role === 'principal' ? 'principal' : 'teacher',
    schoolId: rec.schoolId || null,
    status: 'active',
  };
}

/* ---------- הגבלת קצב ---------- */

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

/* שומר לכל נקודת קצה שדורשת זיהוי.
   'member' = כל מורה מאושרת · 'staff' = מנהלת בית ספר ומעלה · 'super' = ניהול */
export async function requireUser(req, minRole = 'member') {
  const me = await identify(req);
  if (!me) return { denied: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  if (me.role === 'pending') {
    return {
      denied: Response.json(
        { error: 'הבקשה שלך ממתינה לאישור מנהלת בית הספר', pending: true },
        { status: 403 }
      ),
    };
  }
  if (minRole === 'super' && me.role !== 'super') {
    return { denied: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  if (minRole === 'staff' && me.role !== 'super' && me.role !== 'principal') {
    return { denied: Response.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { me };
}

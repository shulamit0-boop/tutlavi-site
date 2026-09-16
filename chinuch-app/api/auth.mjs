/* כניסה עם גוגל.

   הזרימה: הדפדפן מציג את כפתור Google Sign-In, מקבל ID token, ושולח אותו
   לכאן. אנחנו מאמתים אותו מול המפתחות של גוגל, מוצאים או יוצרים רשומת
   משתמשת, ומנפיקים עוגיית סשן משלנו.

   מורה שאין לה עוד רשומה **לא נחסמת** — נפתחת לה בקשת הרשאה במצב "ממתינה",
   והיא רואה מסך שמסביר מי אמורה לאשר אותה. חסימה שקטה של מי שלא במערכת
   הייתה שולחת אותה להתקשר למישהי במקום להשאיר עקבות בפאנל של המנהלת. */

import { kvGet, storeReady, logAction } from './_store.mjs';
import {
  identify, signSession, sessionCookie, clearCookie, limitPublic,
  loadUsers, saveUsers, normEmail, isSuper, sessionReady,
} from './_guard.mjs';
import { verifyGoogleToken, googleReady } from './_google.mjs';

export const config = { runtime: 'edge' };

const noStore = { 'Cache-Control': 'no-store' };
const slug = (v) => (/^[a-z0-9-]{2,40}$/.test(String(v || '')) ? String(v) : '');

const publicSchools = async () => {
  const cfg = (await kvGet('config')) || {};
  return (Array.isArray(cfg.schools) ? cfg.schools : [])
    .filter((s) => s && s.active !== false)
    .map((s) => ({ id: s.id, name: s.name, domain: s.domain || '' }));
};

export default async function handler(req) {
  if (req.method === 'GET') {
    const me = await identify(req);
    const schools = await publicSchools();
    return Response.json(
      {
        me,
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        schools: schools.map((s) => ({ id: s.id, name: s.name })),
        ready: { google: googleReady(), session: sessionReady(), store: storeReady() },
      },
      { headers: noStore }
    );
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (body.action === 'logout') {
    return Response.json({ ok: true }, { headers: { ...noStore, 'Set-Cookie': clearCookie() } });
  }

  /* מורה שממתינה לאישור בוחרת את בית הספר שלה — כך הבקשה מגיעה למנהלת הנכונה */
  if (body.action === 'school') {
    const me = await identify(req);
    if (!me) return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
    if (me.role !== 'pending') {
      return Response.json({ error: 'forbidden' }, { status: 403, headers: noStore });
    }
    const schools = await publicSchools();
    const wanted = slug(body.schoolId);
    if (!schools.some((s) => s.id === wanted)) {
      return Response.json({ error: 'בית הספר לא נמצא' }, { status: 400, headers: noStore });
    }
    const users = await loadUsers();
    const rec = users.find((u) => normEmail(u.email) === me.email);
    if (!rec) return Response.json({ error: 'not found' }, { status: 404, headers: noStore });
    rec.schoolId = wanted;
    rec.requestedAt = new Date().toISOString();
    if (!(await saveUsers(users))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    await logAction({ what: 'request', email: me.email, school: wanted });
    return Response.json({ ok: true, me: await identify(req) }, { headers: noStore });
  }

  /* ---------- הכניסה עצמה ---------- */

  if (!googleReady() || !sessionReady()) {
    return Response.json(
      { error: 'הכניסה עם גוגל עוד לא הוגדרה במערכת' },
      { status: 503, headers: noStore }
    );
  }
  if (!storeReady()) {
    return Response.json({ error: 'האחסון עוד לא הוגדר' }, { status: 503, headers: noStore });
  }

  const limited = await limitPublic(req, 'login', 60);
  if (limited) return limited;

  let g;
  try {
    g = await verifyGoogleToken(body.credential);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 401, headers: noStore });
  }

  const users = await loadUsers();
  let rec = users.find((u) => u && normEmail(u.email) === g.email);
  const now = new Date().toISOString();

  if (rec && rec.status === 'removed') {
    // חסימה מפורשת: לא מחזירים אותה אוטומטית למצב "ממתינה", אחרת כל הסרה
    // הייתה מתבטלת בכניסה הבאה
    return Response.json(
      { error: 'ההרשאה שלך למערכת הוסרה. אפשר לפנות למנהלת בית הספר.' },
      { status: 403, headers: noStore }
    );
  }

  if (!rec) {
    const schools = await publicSchools();
    // חשבון Google Workspace של בית ספר מזוהה לפי הדומיין, כדי שהמורה
    // לא תצטרך לבחור מרשימה ושהבקשה תגיע ישר למנהלת הנכונה
    const byDomain = g.hd ? schools.find((s) => s.domain && s.domain === g.hd) : null;
    rec = {
      email: g.email,
      name: g.name,
      picture: g.picture,
      role: 'teacher',
      schoolId: byDomain ? byDomain.id : slug(body.schoolId) || null,
      status: isSuper(g.email) ? 'active' : 'pending',
      createdAt: now,
      requestedAt: now,
    };
    users.push(rec);
    await logAction({ what: 'signup', email: g.email, school: rec.schoolId });
  } else {
    // השם והתמונה מגוגל הם מקור האמת — הם מתעדכנים בכל כניסה
    rec.name = g.name || rec.name;
    rec.picture = g.picture || rec.picture;
    if (isSuper(g.email)) rec.status = 'active';
  }
  rec.lastLoginAt = now;

  if (!(await saveUsers(users))) {
    return Response.json({ error: 'store write failed' }, { status: 500 });
  }

  const token = await signSession(g.email);
  const me = {
    email: g.email,
    name: rec.name,
    role: isSuper(g.email)
      ? 'super'
      : rec.status !== 'active'
        ? 'pending'
        : rec.role === 'principal'
          ? 'principal'
          : 'teacher',
    schoolId: rec.schoolId || null,
    status: isSuper(g.email) ? 'active' : rec.status,
  };
  return Response.json(
    { me, schools: (await publicSchools()).map((s) => ({ id: s.id, name: s.name })) },
    { headers: { ...noStore, 'Set-Cookie': sessionCookie(token) } }
  );
}

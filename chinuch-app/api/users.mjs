/* ניהול המורות: אישור, דחייה, הסרה, הזמנה ושינוי תפקיד.

   ההיררכיה נאכפת כאן ולא בתצוגה: מנהלת בית ספר יכולה לגעת **רק** במורות
   של בית הספר שלה, ורק מנהלת מערכת ממנה מנהלות ומעבירה מורה בין בתי ספר.
   בלי הכלל הזה, כל מנהלת הייתה יכולה לאשר לעצמה מורות בבית ספר אחר. */

import { storeReady, logAction, kvGet } from './_store.mjs';
import { requireUser, loadUsers, saveUsers, normEmail, isSuper } from './_guard.mjs';

export const config = { runtime: 'edge' };

const clean = (v, n) => String(v == null ? '' : v).slice(0, n);
const slug = (v) => (/^[a-z0-9-]{2,40}$/.test(String(v || '')) ? String(v) : '');

const publicUser = (u) => ({
  email: u.email,
  name: u.name || '',
  role: isSuper(u.email) ? 'super' : u.role === 'principal' ? 'principal' : 'teacher',
  schoolId: u.schoolId || null,
  status: isSuper(u.email) ? 'active' : u.status || 'pending',
  createdAt: u.createdAt || '',
  requestedAt: u.requestedAt || '',
  lastLoginAt: u.lastLoginAt || '',
  approvedBy: u.approvedBy || '',
});

/* מי רשאית לגעת במי */
function mayManage(me, target) {
  if (me.role === 'super') return true;
  if (me.role !== 'principal') return false;
  if (isSuper(target.email)) return false; // מנהלת בית ספר לא נוגעת במנהלת מערכת
  if (target.role === 'principal') return false; // ולא במנהלת אחרת
  return Boolean(me.schoolId) && target.schoolId === me.schoolId;
}

export default async function handler(req) {
  const { me, denied } = await requireUser(req, 'staff');
  if (denied) return denied;

  if (req.method === 'GET') {
    const all = await loadUsers();
    const cfg = (await kvGet('config')) || {};
    const schools = (Array.isArray(cfg.schools) ? cfg.schools : []).map((s) => ({
      id: s.id,
      name: s.name,
    }));
    const list =
      me.role === 'super' ? all : all.filter((u) => u && u.schoolId === me.schoolId);
    return Response.json(
      {
        me,
        schools,
        users: list.map(publicUser),
        pending: list.filter((u) => (u.status || 'pending') === 'pending').length,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  const action = clean(body.action, 20);
  const email = normEmail(body.email);
  const users = await loadUsers();
  const now = new Date().toISOString();

  /* הזמנת מורה שעוד לא נכנסה: הרשומה נוצרת מאושרת מראש, כך שהכניסה
     הראשונה שלה עם גוגל עוברת ישר פנימה */
  if (action === 'invite') {
    if (!email || !email.includes('@')) {
      return Response.json({ error: 'כתובת מייל לא תקינה' }, { status: 400 });
    }
    if (users.some((u) => normEmail(u.email) === email)) {
      return Response.json({ error: 'המורה הזו כבר במערכת' }, { status: 409 });
    }
    const schoolId = me.role === 'super' ? slug(body.schoolId) || null : me.schoolId;
    if (!schoolId) return Response.json({ error: 'צריך לבחור בית ספר' }, { status: 400 });
    users.push({
      email,
      name: clean(body.name, 80),
      role: 'teacher',
      schoolId,
      status: 'active',
      createdAt: now,
      approvedBy: me.email,
      invited: true,
    });
    if (!(await saveUsers(users))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    await logAction({ what: 'invite', email, school: schoolId, by: me.email });
    return Response.json({ ok: true });
  }

  const rec = users.find((u) => u && normEmail(u.email) === email);
  if (!rec) return Response.json({ error: 'לא נמצאה' }, { status: 404 });
  // הבדיקה על עצמך קודמת, כדי שההודעה תהיה מובנת ולא "אין הרשאה" סתם.
  // בלעדיה מנהלת יכולה להסיר את עצמה ולהישאר בלי דרך חזרה למערכת.
  if (normEmail(me.email) === email && action !== 'approve') {
    return Response.json({ error: 'אי אפשר לשנות את ההרשאה של עצמך' }, { status: 400 });
  }
  if (!mayManage(me, rec)) return Response.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'approve') {
    rec.status = 'active';
    rec.approvedBy = me.email;
    rec.approvedAt = now;
    if (!rec.schoolId) rec.schoolId = me.role === 'principal' ? me.schoolId : rec.schoolId;
  } else if (action === 'decline') {
    rec.status = 'declined';
    rec.approvedBy = me.email;
  } else if (action === 'remove') {
    rec.status = 'removed';
    rec.approvedBy = me.email;
  } else if (action === 'setRole') {
    if (me.role !== 'super') return Response.json({ error: 'forbidden' }, { status: 403 });
    rec.role = body.role === 'principal' ? 'principal' : 'teacher';
    if (rec.role === 'principal' && !rec.schoolId) {
      return Response.json({ error: 'מנהלת חייבת להיות משויכת לבית ספר' }, { status: 400 });
    }
  } else if (action === 'setSchool') {
    if (me.role !== 'super') return Response.json({ error: 'forbidden' }, { status: 403 });
    rec.schoolId = slug(body.schoolId) || null;
  } else {
    return Response.json({ error: 'unknown action' }, { status: 400 });
  }

  if (!(await saveUsers(users))) {
    return Response.json({ error: 'store write failed' }, { status: 500 });
  }
  await logAction({ what: action, email, school: rec.schoolId, by: me.email });
  return Response.json({ ok: true, user: publicUser(rec) });
}

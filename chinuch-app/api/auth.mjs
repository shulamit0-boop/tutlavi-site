/* כניסה למערכת: המורה מקלידה את מפתח בית הספר, ומקבלת עוגייה.

   העוגייה היא HttpOnly ולא localStorage, וזה לא פרט טכני: בלעדיה כל תמונת
   תצוגה וכל הורדת קובץ היו חייבות לצרף כותרת בעצמן — ותג <img> לא יכול
   לשלוח כותרות. עם עוגייה, קובץ מוגן מתנהג כמו קישור רגיל. */

import { identify, sessionCookie, clearCookie, limitPublic } from './_guard.mjs';

export const config = { runtime: 'edge' };

const noStore = { 'Cache-Control': 'no-store' };

export default async function handler(req) {
  // מי אני — נקרא בכל טעינת דף כדי להחליט אם להציג את מסך המפתח
  if (req.method === 'GET') {
    const me = await identify(req);
    if (!me) return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
    return Response.json({ me }, { headers: noStore });
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

  // מפתח שגוי נספר ונחסם הרבה לפני שניחוש שיטתי מגיע לאנשהו
  const limited = await limitPublic(req, 'login', 30);
  if (limited) return limited;

  const key = String(body.key || '').trim();
  const me = await identify(req, key);
  if (!me) {
    return Response.json({ error: 'המפתח אינו מזוהה' }, { status: 401, headers: noStore });
  }

  return Response.json({ me }, { headers: { ...noStore, 'Set-Cookie': sessionCookie(key) } });
}

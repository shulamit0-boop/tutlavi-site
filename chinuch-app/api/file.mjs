/* הורדת קובץ ותמונת תצוגה — שכבת ההרשאה מול Vercel Blob.

   הנקודה כולה: כתובת Blob היא ציבורית לכל מי שמחזיק אותה. לכן הכתובת
   נשארת בשרת, והדפדפן מבקש /api/file?id=... . כאן נבדקת העוגייה ונבדק אם
   הפריט בכלל נראה לבית הספר הזה, ורק אז הקובץ מוזרם.

   חשוב שזו הזרמה ולא הפניה (302): הפניה הייתה מוסרת את כל ההגנה, כי
   הדפדפן היה מקבל בדיוק את הכתובת שניסינו לא לחשוף. */

import { kvGet, kvSet } from './_store.mjs';
import { requireUser } from './_guard.mjs';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'GET') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const { me, denied } = await requireUser(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const id = String(url.searchParams.get('id') || '').slice(0, 40);
  const wantThumb = url.searchParams.get('thumb') === '1';

  const it = await kvGet(`item:${id}`);
  if (!it || it.deletedAt) return new Response('לא נמצא', { status: 404 });
  if (me.role !== 'super' && it.visibility !== 'all' && it.schoolId !== me.schoolId) {
    return new Response('אין הרשאה', { status: 403 });
  }

  const target = wantThumb ? it.thumbUrl : it.blobUrl;
  if (!target) return new Response('לא נמצא', { status: 404 });

  let upstream;
  try {
    upstream = await fetch(target, { cache: 'no-store' });
  } catch {
    return new Response('הקובץ אינו נגיש', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response('הקובץ אינו נגיש', { status: 502 });
  }

  if (!wantThumb) {
    // מונה הורדות. נשמר ולא נמתין עליו — כשל בספירה לא אמור לבטל הורדה.
    it.downloads = (it.downloads || 0) + 1;
    kvSet(`item:${id}`, it).catch(() => {});
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || it.mime || 'application/octet-stream');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (!wantThumb) {
    // שם הקובץ בעברית עובר ב-RFC 5987, אחרת הוא יוצא ג'יבריש בכרום
    const name = it.fileName || 'design';
    headers.set(
      'Content-Disposition',
      `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
  }
  return new Response(upstream.body, { status: 200, headers });
}

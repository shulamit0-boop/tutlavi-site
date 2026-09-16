/* חתימת העלאה ישירה ל-Vercel Blob.

   הדפדפן מעלה ישר ל-Blob ולא דרך הפונקציה — אחרת היינו נעצרים בתקרת
   4.5MB של גוף בקשה, וזה בדיוק הגודל שכל PDF של שילוט עובר.
   דורש BLOB_READ_WRITE_TOKEN, שנוצר אוטומטית ברגע שמחברים Blob Store
   לפרויקט ב-Vercel. עד אז התשובה היא 503 והפאנל אומר את זה בעברית. */

import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { identify } from './_guard.mjs';

const ALLOWED = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'video/mp4', 'video/quicktime',
  'application/zip', 'application/x-zip-compressed',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'אחסון הקבצים עוד לא הוקם' });
  }

  const me = await identify(req);
  if (!me) return res.status(401).json({ error: 'unauthorized' });
  if (me.role === 'pending') return res.status(403).json({ error: 'הבקשה שלך ממתינה לאישור' });

  const body = req.body || {};

  // מחיקת קובץ שהוחלף — כדי שלא יישארו קבצים יתומים ב-Blob
  if (body.type === 'delete') {
    if (typeof body.url !== 'string' || !/\.blob\.vercel-storage\.com\//.test(body.url)) {
      return res.status(400).json({ error: 'bad url' });
    }
    try {
      await del(body.url);
    } catch {
      /* כבר לא קיים — בסדר */
    }
    return res.json({ ok: true });
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^(files|thumbs)\/[\w.-]{1,120}$/.test(pathname)) throw new Error('bad path');
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: 50 * 1024 * 1024,
          // סיומת אקראית: הכתובת ב-Blob לא תהיה ניחושה גם אם תדלוף מהשרת
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        /* הפריט נשמר ב-/api/items אחרי שההעלאה מסתיימת */
      },
    });
    return res.json(result);
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
}

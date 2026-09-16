/* אימות הזהות מגוגל.

   הדפדפן מקבל מגוגל ID token (JWT חתום) ושולח אותו לכאן. **אסור** להסתפק
   בפענוח שלו — JWT הוא טקסט שכל אחד יכול להרכיב. מה שהופך אותו לזהות הוא
   החתימה של גוגל, ולכן כאן נבדקת החתימה עצמה מול המפתחות הציבוריים של גוגל,
   ואחריה מי הנפיק (iss), למי הוא נועד (aud) ומתי הוא פג (exp).

   האימות נעשה מקומית ולא מול tokeninfo של גוגל: קריאת רשת בכל כניסה היא
   עוד נקודת כשל, והיא גם מוגבלת בקצב. WebCrypto נמצא ב-edge runtime, אז
   אין כאן שום תלות חיצונית. */

const CERTS_URL = process.env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const SKEW = 120; // שתי דקות פער שעונים

export const googleReady = () => Boolean(process.env.GOOGLE_CLIENT_ID);

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/* המפתחות של גוגל מתחלפים מדי פעם. שומרים אותם בזיכרון לשעה — מספיק כדי
   לא לקרוא לגוגל בכל כניסה, וקצר מספיק כדי להתעדכן בהחלפה. */
let cache = { at: 0, keys: null };

async function googleKeys() {
  if (cache.keys && Date.now() - cache.at < 3600_000) return cache.keys;
  const res = await fetch(CERTS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('לא הצלחתי לאמת מול גוגל');
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw new Error('לא הצלחתי לאמת מול גוגל');
  cache = { at: Date.now(), keys };
  return keys;
}

/* מחזיר את פרטי המשתמשת אם הטוקן תקין, וזורק שגיאה בעברית אם לא. */
export async function verifyGoogleToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientId) throw new Error('הכניסה עם גוגל עוד לא הוגדרה');

  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('הזיהוי מגוגל אינו תקין');
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = b64urlToJson(h);
    payload = b64urlToJson(p);
  } catch {
    throw new Error('הזיהוי מגוגל אינו תקין');
  }
  if (header.alg !== 'RS256') throw new Error('הזיהוי מגוגל אינו תקין');

  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('הזיהוי מגוגל אינו תקין');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error('הזיהוי מגוגל אינו תקין');

  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(payload.iss)) throw new Error('הזיהוי מגוגל אינו תקין');
  // aud: בלי הבדיקה הזו, טוקן שנחתם עבור אפליקציה אחרת לגמרי היה נכנס לכאן
  if (payload.aud !== clientId) throw new Error('הזיהוי מגוגל אינו תקין');
  if (!payload.exp || payload.exp + SKEW < now) throw new Error('הזיהוי מגוגל פג — נסי להיכנס שוב');
  if (payload.iat && payload.iat - SKEW > now) throw new Error('הזיהוי מגוגל אינו תקין');

  const email = String(payload.email || '').trim().toLowerCase();
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  if (!email || !verified) throw new Error('חשבון הגוגל הזה בלי כתובת מייל מאומתת');

  return {
    email,
    name: String(payload.name || '').slice(0, 80),
    picture: String(payload.picture || '').slice(0, 400),
    sub: String(payload.sub || ''),
    hd: String(payload.hd || '').toLowerCase(),
  };
}

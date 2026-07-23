/* WhatsApp → schedule event webhook (Meta WhatsApp Business Cloud API).
   A message sent to the studio's WhatsApp Business number is parsed into a
   schedule event and appended to the site content (same KV `content` key the
   admin panel and public site use).

   Env vars (set in Vercel):
   - WA_VERIFY_TOKEN  — any secret string; must match the token entered in the
     Meta webhook config (used only for the GET verification handshake).
   - WA_ALLOWED       — comma-separated phone numbers allowed to add events
     (digits only or with +, e.g. "972542451297"). Others are ignored.
   - WA_APP_SECRET    — (required) the Meta app secret, used to verify the
     X-Hub-Signature-256 on every call. Until it is set the webhook refuses
     every POST: an unverified caller could otherwise post events to the site.
   - WA_ACCESS_TOKEN + WA_PHONE_NUMBER_ID — (optional) enable a WhatsApp reply
     confirming the event was added / explaining the format on a parse miss.

   Message format (Hebrew labels, one per line; name + date required):
     אירוע: ערב ג'אז בבר
     תאריך: 15.08.2026
     קטגוריה: מוזיקה        (אופציונלי)
     סטטוס: פתוח להרשמה      (אופציונלי — ברירת מחדל "בקרוב")
     תיאור: ערב מוזיקה חיה   (אופציונלי)
*/

import crypto from 'node:crypto';
import { kvGet, kvSet, storeReady } from './_store.mjs';

export const config = { api: { bodyParser: false } };

const KEY = 'content';

const digits = (n) => String(n || '').replace(/\D/g, '');
const allowedNumbers = () =>
  (process.env.WA_ALLOWED || '').split(',').map(digits).filter(Boolean);

function readRawBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let got = false;
    req.on('data', (c) => { got = true; data += c; });
    req.on('end', () => resolve({ raw: data, fromStream: got }));
    req.on('error', () => resolve({ raw: '', fromStream: false }));
  });
}

function normalizeDate(s) {
  const m = /(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/.exec(s || '');
  if (!m) return String(s || '').trim();
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${String(d).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${y}`;
}

const LABELS = [
  [/^(?:אירוע|שם)\s*[:\-]\s*(.+)$/, 'name'],
  [/^(?:תאריך|מתי)\s*[:\-]\s*(.+)$/, 'date'],
  [/^(?:קטגוריה|סוג)\s*[:\-]\s*(.+)$/, 'cat'],
  [/^(?:סטטוס|מצב)\s*[:\-]\s*(.+)$/, 'status'],
  [/^(?:תיאור|פרטים)\s*[:\-]\s*(.+)$/, 'desc'],
];

// returns a sanitized event, or null if it lacks the required name + date
export function parseEvent(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ev = { date: '', name: '', desc: '', cat: '', status: '', hot: false, hidden: false };
  for (const line of lines) {
    for (const [re, key] of LABELS) {
      const m = re.exec(line);
      if (m) { ev[key] = m[1].trim(); break; }
    }
  }
  ev.date = normalizeDate(ev.date);
  if (!ev.name || !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(ev.date)) return null;
  ev.status = ev.status || 'בקרוב';
  return {
    date: ev.date.slice(0, 40),
    name: ev.name.slice(0, 200),
    desc: ev.desc.slice(0, 400),
    cat: ev.cat.slice(0, 60),
    status: ev.status.slice(0, 60),
    hot: false,
    hidden: false,
  };
}

// pull the first text message + sender out of a Cloud API webhook payload
export function extractMessage(body) {
  try {
    const value = body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || msg.type !== 'text') return null;
    return { from: msg.from, text: msg.text?.body || '' };
  } catch {
    return null;
  }
}

async function sendReply(to, text) {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneId = process.env.WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) return;
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
  } catch { /* reply is best-effort */ }
}

async function addEvent(ev) {
  if (!storeReady()) return false;
  const content = (await kvGet(KEY)) || { texts: {}, events: null };
  const events = Array.isArray(content.events) ? content.events : [];
  events.push(ev);
  content.events = events.slice(0, 100);
  return kvSet(KEY, content);
}

export default async function handler(req, res) {
  // GET — Meta webhook verification handshake
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' &&
        q['hub.verify_token'] &&
        q['hub.verify_token'] === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(q['hub.challenge']);
    }
    return res.status(403).send('forbidden');
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  /* Signature verification. This endpoint writes to the live site, and the
     sender allow-list is no protection on its own because `from` is just a
     field in the payload the caller sends. So every branch that cannot prove
     the request came from Meta refuses it: no app secret configured, or no
     raw bytes to hash, means no write. */
  const secret = process.env.WA_APP_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'webhook not configured' });
  }

  const { raw, fromStream } = await readRawBody(req);
  if (!fromStream || !raw) {
    return res.status(400).json({ error: 'no raw body' });
  }

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const sig = String(req.headers['x-hub-signature-256'] || '');
  const ok = sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'bad signature' });

  let body;
  try { body = JSON.parse(raw); } catch { body = {}; }

  // always answer 200 fast so Meta does not retry-storm; process best-effort
  try {
    const msg = extractMessage(body);
    if (msg && allowedNumbers().includes(digits(msg.from))) {
      const ev = parseEvent(msg.text);
      if (ev) {
        const saved = await addEvent(ev);
        await sendReply(msg.from, saved
          ? `✓ נוסף אירוע: ${ev.name} (${ev.date}). מופיע באתר — אפשר לערוך/להסתיר ב-tutlavi.com/admin`
          : 'האירוע לא נשמר (האחסון לא זמין כרגע). נסי שוב מאוחר יותר.');
      } else {
        await sendReply(msg.from,
          'לא הצלחתי לקרוא אירוע. שלחי בפורמט:\nאירוע: <שם>\nתאריך: dd.mm.yyyy\nקטגוריה: <אופציונלי>\nסטטוס: <אופציונלי>\nתיאור: <אופציונלי>');
      }
    }
  } catch { /* swallow */ }

  return res.status(200).json({ ok: true });
}

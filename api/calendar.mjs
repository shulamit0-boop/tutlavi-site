import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin } from './_guard.mjs';
import { safeEqual } from './_guard.mjs';

export const config = { runtime: 'edge' };

/* iCalendar feed of the studio's confirmed rentals, for subscribing to from
   Google Calendar ("Other calendars → From URL").

   Google fetches this server-to-server with no headers of its own, so the only
   thing that can authenticate the request is the URL itself. The feed carries
   renter names and phone numbers, so it is gated on a random token kept in KV
   and minted from /admin — never on ADMIN_KEY, which would then be sitting in
   Google's stored subscription URL and in every proxy log along the way.

   Note on refresh: Google re-reads subscribed URLs on its own schedule, which
   can be many hours. That is Google's behaviour and cannot be forced from
   here; the studio panel stays the live view. */

const TOKEN_KEY = 'icsToken';
const INDEX_KEY = 'bookings:index';

const rnd = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

// RFC 5545: escape, then fold lines at 75 octets
const esc = (s) =>
  String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let buf = '';
  for (const ch of line) {
    const next = buf + ch;
    if (new TextEncoder().encode(next).length > (out.length ? 74 : 75)) {
      out.push(buf);
      buf = ch;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out.join('\r\n ');
}

const stamp = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

/* Local wall-clock time in Asia/Jerusalem, emitted with a TZID rather than as
   UTC: the studio's hours are local hours and must not shift with DST. */
const localDT = (date, time) => `${date.replace(/-/g, '')}T${(time || '00:00').replace(':', '')}00`;

/* Pure formatter, kept separate from the KV reads so it can be tested: a
   malformed calendar is rejected by Google silently, with no error anywhere. */
export function buildIcs(bookings) {
  const events = [];
  for (const b of bookings) {
    if (!b || !b.date) continue;
    const status = b.status || (b.studioSigned ? 'confirmed' : b.signature ? 'signed' : 'requested');
    if (status === 'declined') continue;
    // confirmed rentals are real events; anything still in flight goes in as
    // TENTATIVE so the studio can see the slot is spoken for without it
    // looking like a done deal
    const tentative = status !== 'confirmed';

    const title = (tentative ? '(טרם אושר) ' : '') + 'השכרת חלל — ' + (b.name || 'ללא שם');
    const desc = [
      b.purpose ? 'מטרה: ' + b.purpose : '',
      b.participants ? 'משתתפים: ' + b.participants : '',
      b.price ? 'עלות: ' + b.price : '',
      b.phone ? 'טלפון: ' + b.phone : '',
      b.email ? 'מייל: ' + b.email : '',
      'סטטוס: ' + status,
      'https://tutlavi.com/contract?bid=' + b.id,
    ].filter(Boolean).join('\n');

    const timed = Boolean(b.start && b.end);
    events.push(
      'BEGIN:VEVENT',
      'UID:booking-' + b.id + '@tutlavi.com',
      'DTSTAMP:' + stamp(b.studioSignedAt || b.signedAt || b.requestedAt),
      timed
        ? 'DTSTART;TZID=Asia/Jerusalem:' + localDT(b.date, b.start)
        : 'DTSTART;VALUE=DATE:' + b.date.replace(/-/g, ''),
      timed
        ? 'DTEND;TZID=Asia/Jerusalem:' + localDT(b.date, b.end)
        : 'DTEND;VALUE=DATE:' + b.date.replace(/-/g, ''),
      'SUMMARY:' + esc(title),
      'DESCRIPTION:' + esc(desc),
      'LOCATION:' + esc('סטודיו תות, מגן אברהם 6, תל אביב'),
      'STATUS:' + (tentative ? 'TENTATIVE' : 'CONFIRMED'),
      'END:VEVENT'
    );
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Studio Tutlavi//Rentals//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc('סטודיו תות — השכרות'),
    'X-WR-TIMEZONE:Asia/Jerusalem',
    ...events,
    'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

export default async function handler(req) {
  const url = new URL(req.url);

  /* Admin: mint (or fetch) the token, so /admin can show the subscribe URL. */
  if (req.method === 'POST') {
    const denied = await requireAdmin(req);
    if (denied) return denied;
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });
    let token = await kvGet(TOKEN_KEY);
    if (typeof token !== 'string' || token.length < 32 || url.searchParams.get('rotate')) {
      token = rnd();
      if (!(await kvSet(TOKEN_KEY, token))) {
        return Response.json({ error: 'store write failed' }, { status: 500 });
      }
    }
    return Response.json({ ok: true, token }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method !== 'GET') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const token = await kvGet(TOKEN_KEY);
  const given = url.searchParams.get('k') || '';
  if (typeof token !== 'string' || !token || !safeEqual(given, token)) {
    // deliberately terse: this endpoint should say nothing to a prober
    return new Response('not found', { status: 404 });
  }

  const idx = (await kvGet(INDEX_KEY)) || [];
  const bookings = [];
  for (const id of idx.slice(0, 300)) {
    const b = await kvGet('booking:' + id);
    if (b) bookings.push({ ...b, id });
  }
  const body = buildIcs(bookings);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="tutlavi.ics"',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

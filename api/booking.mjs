import { kvGet, kvSet, storeReady } from './_store.mjs';
import { isAdmin, limitPublic, requireAdmin } from './_guard.mjs';
import {
  HOLD_DAYS, holdExpiry, placeHold, releaseHold, commitHold,
  withExpiredHoldsCleared,
} from './_avail.mjs';

export const config = { runtime: 'edge' };

/* Booking lifecycle
   ─────────────────
   requested  visitor sent a principle request — no ID number, no signature.
              The chosen window is held for HOLD_DAYS days.
   sent       the studio approved the request and handed over the signing link.
   signed     the visitor filled in their ID number and signed.
   confirmed  the studio countersigned. Only now is the window actually booked
              and only now does it reach the calendar feed.
   declined   the studio turned it down, or the hold lapsed. Window released.

   Records written before this flow existed have no `status`; deriveStatus()
   maps them onto it so old contract links keep rendering. */

const AVAIL_KEY = 'availability';
const INDEX_KEY = 'bookings:index';      // newest-first list of ids, for /admin

/* The signing link is the only thing guarding a contract, so the id has to be
   unguessable: Math.random() is not a CSPRNG. 128 random bits, hex. */
const rid = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

// whoever holds the link sees only the last 4 digits; the studio sees it all
const maskId = (s) => {
  const v = String(s || '');
  return v.length > 4 ? '•'.repeat(Math.min(v.length - 4, 8)) + v.slice(-4) : v;
};

const deriveStatus = (b) => {
  if (b.status) return b.status;
  if (b.studioSigned) return 'confirmed';
  if (b.signature) return 'signed';
  return 'requested';
};

const str = (v, n) => String(v || '').slice(0, n);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isTime = (v) => /^\d{2}:\d{2}$/.test(v || '');

/* Everything the public may see about a booking. The signature image and the
   full ID number are deliberately not in here. */
const publicView = (b, id) => ({
  id,
  status: deriveStatus(b),
  name: b.name, email: b.email, phone: b.phone,
  date: b.date, start: b.start, end: b.end,
  purpose: b.purpose, participants: b.participants, price: b.price,
  message: b.message,
  idnum: maskId(b.idnum),
  signature: b.signature || null,
  requestedAt: b.requestedAt || null,
  signedAt: b.signedAt || null,
  studioSigned: Boolean(b.studioSigned),
  studioSignedAt: b.studioSignedAt || null,
  holdUntil: b.holdUntil || null,
});

async function readAvail() {
  const data = (await kvGet(AVAIL_KEY)) || { locked: [], windows: [] };
  data.windows = withExpiredHoldsCleared(data.windows);
  return data;
}

async function pushIndex(id) {
  const idx = (await kvGet(INDEX_KEY)) || [];
  if (!idx.includes(id)) idx.unshift(id);
  await kvSet(INDEX_KEY, idx.slice(0, 500));
}

export default async function handler(req) {
  if (req.method === 'GET') {
    const url = new URL(req.url);

    // admin: the whole list, for the bookings tab in /admin
    if (url.searchParams.get('list')) {
      const denied = await requireAdmin(req);
      if (denied) return denied;
      const idx = (await kvGet(INDEX_KEY)) || [];
      const rows = [];
      for (const id of idx.slice(0, 200)) {
        const b = await kvGet('booking:' + id);
        // the list view never needs the signature image — it is the bulk of
        // the record and would make this response enormous
        if (b) rows.push({ ...publicView(b, id), idnum: b.idnum || '', signature: null });
      }
      return Response.json({ ok: true, bookings: rows }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    // generous for a person opening their contract, useless for a scanner
    if (!isAdmin(req)) {
      const limited = await limitPublic(req, 'contractview', 60);
      if (limited) return limited;
    }
    const id = url.searchParams.get('id') || '';
    if (!/^[a-z0-9]{6,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
    const b = await kvGet('booking:' + id);
    if (!b) return Response.json({ error: 'not found' }, { status: 404 });
    const out = isAdmin(req)
      ? { ...b, id, status: deriveStatus(b) }
      : publicView(b, id);
    return Response.json(out, {
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  /* ---- 1. visitor sends a principle request (no ID number, no signature) ---- */
  if (body.action === 'request') {
    const limited = await limitPublic(req, 'bookreq', 8);
    if (limited) return limited;
    const d = body.data || {};
    const clean = {
      status: 'requested',
      name: str(d.name, 120),
      email: str(d.email, 160),
      phone: str(d.phone, 30),
      date: isDate(d.date) ? d.date : '',
      start: isTime(d.start) ? d.start : '',
      end: isTime(d.end) ? d.end : '',
      purpose: str(d.purpose, 160),
      participants: str(d.participants, 30),
      price: str(d.price, 30),
      message: str(d.message, 1500),
      windowId: str(d.windowId, 60),
      idnum: '',
      signature: null,
      requestedAt: new Date().toISOString(),
      sentAt: null,
      signedAt: null,
      studioSigned: false,
      studioSignedAt: null,
      holdUntil: null,
    };
    if (!clean.name || !clean.date) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }

    const id = rid();

    // hold the slot before writing the booking, so a slot that is already
    // spoken for is reported as such instead of creating a dead request
    if (clean.windowId) {
      const avail = await readAvail();
      const until = holdExpiry();
      const res = placeHold(avail, clean.windowId, clean.date, id, until);
      if (!res.ok) {
        return Response.json({ error: res.reason }, { status: 409 });
      }
      if (!(await kvSet(AVAIL_KEY, avail))) {
        return Response.json({ error: 'store write failed' }, { status: 500 });
      }
      clean.holdUntil = until;
    }

    if (!(await kvSet('booking:' + id, clean))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    await pushIndex(id);
    return Response.json({ ok: true, id, holdUntil: clean.holdUntil, holdDays: HOLD_DAYS });
  }

  /* ---- 2. visitor signs: ID number + signature, on the link they were sent ---- */
  if (body.action === 'sign') {
    const limited = await limitPublic(req, 'contractsign', 10);
    if (limited) return limited;
    const id = str(body.id, 40);
    if (!/^[a-z0-9]{6,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
    const b = await kvGet('booking:' + id);
    if (!b) return Response.json({ error: 'not found' }, { status: 404 });

    const status = deriveStatus(b);
    // only a request the studio has actually released for signing may be signed,
    // and signing twice must not overwrite a signature already on file
    if (status !== 'sent') {
      return Response.json({ error: 'not open for signing', status }, { status: 409 });
    }

    const sig = String(body.signature || '');
    if (!sig.startsWith('data:image/png;base64,') || sig.length > 300000) {
      return Response.json({ error: 'bad signature' }, { status: 400 });
    }
    const idnum = str(body.idnum, 30);
    if (!idnum) return Response.json({ error: 'missing id number' }, { status: 400 });

    b.idnum = idnum;
    b.signature = sig;
    b.status = 'signed';
    b.signedAt = new Date().toISOString();
    if (!(await kvSet('booking:' + id, b))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  /* ---- everything below is the studio ---- */
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const id = str(body.id, 40);
  if (!/^[a-z0-9]{6,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const b = await kvGet('booking:' + id);
  if (!b) return Response.json({ error: 'not found' }, { status: 404 });

  /* ---- 3. studio approves the request and releases the signing link ---- */
  if (body.action === 'approve') {
    b.status = 'sent';
    b.sentAt = new Date().toISOString();
    // approving restarts the clock: the visitor gets the full window to sign
    if (b.windowId && b.date) {
      const avail = await readAvail();
      const until = holdExpiry();
      const res = placeHold(avail, b.windowId, b.date, id, until);
      if (res.ok) {
        await kvSet(AVAIL_KEY, avail);
        b.holdUntil = until;
      }
    }
    if (!(await kvSet('booking:' + id, b))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    return Response.json({ ok: true, status: b.status, holdUntil: b.holdUntil });
  }

  /* ---- 4. studio countersigns: the day is now taken ---- */
  if (body.action === 'studio-sign') {
    if (!b.signature) {
      return Response.json({ error: 'not signed by renter yet' }, { status: 409 });
    }
    b.status = 'confirmed';
    b.studioSigned = true;
    b.studioSignedAt = new Date().toISOString();
    const avail = await readAvail();
    if (commitHold(avail, id)) {
      if (!(await kvSet(AVAIL_KEY, avail))) {
        return Response.json({ error: 'store write failed' }, { status: 500 });
      }
    }
    if (!(await kvSet('booking:' + id, b))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    return Response.json({ ok: true, status: b.status });
  }

  /* ---- 5. studio declines / cancels: the slot goes back on the market ---- */
  if (body.action === 'decline') {
    b.status = 'declined';
    b.declinedAt = new Date().toISOString();
    b.holdUntil = null;
    const avail = await readAvail();
    if (releaseHold(avail, id)) await kvSet(AVAIL_KEY, avail);
    if (!(await kvSet('booking:' + id, b))) {
      return Response.json({ error: 'store write failed' }, { status: 500 });
    }
    return Response.json({ ok: true, status: b.status });
  }

  return Response.json({ error: 'bad request' }, { status: 400 });
}

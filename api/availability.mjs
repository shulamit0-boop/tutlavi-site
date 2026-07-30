import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin } from './_guard.mjs';
import { withExpiredHoldsCleared, holdLive } from './_avail.mjs';

export const config = { runtime: 'edge' };

const KEY = 'availability';
const EMPTY = { locked: [], windows: [] };

const sanitize = (body) => ({
  locked: Array.isArray(body.locked)
    ? body.locked.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 2000)
    : [],
  windows: Array.isArray(body.windows)
    ? body.windows
        .filter(
          (w) =>
            w &&
            /^\d{4}-\d{2}-\d{2}$/.test(w.date) &&
            /^\d{2}:\d{2}$/.test(w.start) &&
            /^\d{2}:\d{2}$/.test(w.end)
        )
        .map((w) => ({
          id: String(w.id || Date.now() + Math.random().toString(36).slice(2, 7)),
          date: w.date,
          start: w.start,
          end: w.end,
          note: String(w.note || '').slice(0, 120),
          booked: w.booked === true,
          price: Number.isFinite(+w.price) && +w.price > 0 ? Math.min(Math.round(+w.price), 1000000) : 0,
          /* A hold belongs to the booking flow, not to the calendar editor. It
             is carried through untouched so that saving the calendar in /admin
             cannot silently drop a slot someone is mid-way through signing for. */
          hold:
            w.hold && typeof w.hold.id === 'string' && typeof w.hold.until === 'string'
              ? { id: w.hold.id.slice(0, 40), until: w.hold.until.slice(0, 40) }
              : null,
        }))
        .slice(0, 2000)
    : [],
});

export default async function handler(req) {
  if (req.method === 'GET') {
    const data = (await kvGet(KEY)) || EMPTY;
    /* Expired holds are dropped on the way out rather than swept on a timer,
       so a request that was never signed stops blocking the slot by itself. */
    const windows = withExpiredHoldsCleared(data.windows).map((w) => ({
      ...w,
      // the public calendar must not leak which booking holds a slot
      hold: undefined,
      pending: holdLive(w),
    }));
    return Response.json({ ...data, windows }, { headers: { 'Cache-Control': 'no-store' } });
  }

  /* The old anonymous POST /reserve is gone. It let any caller mark a window
     as permanently booked with no booking behind it; holds are now placed by
     api/booking.mjs as part of a real request, and only the studio's
     countersignature turns a hold into a booking. */

  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (req.method === 'PUT') {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });
    const clean = sanitize(body);
    const saved = await kvSet(KEY, clean);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, counts: { locked: clean.locked.length, windows: clean.windows.length } });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

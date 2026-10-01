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
          // filled in from the stored record by the PUT handler below
          hold: null,
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
    /* The panel never sees holds (GET strips them), so whatever it sends back
       has none. Holds are owned by api/booking.mjs: take them from what is
       stored, never from the request, so saving the calendar cannot drop a
       slot someone is mid-way through signing for. */
    const stored = (await kvGet(KEY)) || EMPTY;
    const holds = new Map(
      withExpiredHoldsCleared(stored.windows)
        .filter((w) => w.hold)
        .map((w) => [w.id + '|' + w.date, w.hold])
    );
    clean.windows.forEach((w) => { w.hold = holds.get(w.id + '|' + w.date) || null; });
    const saved = await kvSet(KEY, clean);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, counts: { locked: clean.locked.length, windows: clean.windows.length } });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

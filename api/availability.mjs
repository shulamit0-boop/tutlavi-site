import { kvGet, kvSet, storeReady } from './_store.mjs';
import { limitPublic, requireAdmin } from './_guard.mjs';

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
        }))
        .slice(0, 2000)
    : [],
});

export default async function handler(req) {
  if (req.method === 'GET') {
    const data = (await kvGet(KEY)) || EMPTY;
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Public reservation: a visitor books a specific open window. Anonymous and
  // irreversible from the visitor's side, so without a budget one script can
  // mark the whole calendar as taken.
  if (req.method === 'POST') {
    const limited = await limitPublic(req, 'reserve', 5);
    if (limited) return limited;
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
    if (body.action !== 'reserve' || !body.id || !body.date) {
      return Response.json({ error: 'bad request' }, { status: 400 });
    }
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

    const data = (await kvGet(KEY)) || EMPTY;
    const win = (data.windows || []).find((w) => w.id === String(body.id) && w.date === String(body.date));
    if (!win) return Response.json({ error: 'not found' }, { status: 404 });
    if (win.booked) return Response.json({ error: 'already booked' }, { status: 409 });
    if ((data.locked || []).includes(win.date)) return Response.json({ error: 'day locked' }, { status: 409 });
    win.booked = true;
    const saved = await kvSet(KEY, data);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true });
  }

  // admin mutations require the key
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

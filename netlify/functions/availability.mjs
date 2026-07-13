import { getStore } from '@netlify/blobs';

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

export default async (req) => {
  const store = getStore('tutlavi-booking');

  if (req.method === 'GET') {
    const data = (await store.get('availability', { type: 'json' })) || EMPTY;
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

  // public reservation: a visitor books a specific open window
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
    if (body.action !== 'reserve' || !body.id || !body.date) {
      return Response.json({ error: 'bad request' }, { status: 400 });
    }
    const data = (await store.get('availability', { type: 'json' })) || EMPTY;
    const win = (data.windows || []).find((w) => w.id === String(body.id) && w.date === String(body.date));
    if (!win) return Response.json({ error: 'not found' }, { status: 404 });
    if (win.booked) return Response.json({ error: 'already booked' }, { status: 409 });
    if ((data.locked || []).includes(win.date)) return Response.json({ error: 'day locked' }, { status: 409 });
    win.booked = true;
    await store.setJSON('availability', data);
    return Response.json({ ok: true });
  }

  // admin mutations require the key
  const key = req.headers.get('x-admin-key') || '';
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
    const clean = sanitize(body);
    await store.setJSON('availability', clean);
    return Response.json({ ok: true, counts: { locked: clean.locked.length, windows: clean.windows.length } });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
};

export const config = { path: '/api/availability' };

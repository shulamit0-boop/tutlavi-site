import { getStore } from '@netlify/blobs';

const EMPTY = { locked: [], windows: [] };

export default async (req) => {
  const store = getStore('tutlavi-booking');

  if (req.method === 'GET') {
    const data = (await store.get('availability', { type: 'json' })) || EMPTY;
    return Response.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // mutations require the admin key
  const key = req.headers.get('x-admin-key') || '';
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (req.method === 'PUT') {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'bad json' }), { status: 400 });
    }
    const clean = {
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
            }))
            .slice(0, 2000)
        : [],
    };
    await store.setJSON('availability', clean);
    return Response.json({ ok: true, counts: { locked: clean.locked.length, windows: clean.windows.length } });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
};

export const config = { path: '/api/availability' };

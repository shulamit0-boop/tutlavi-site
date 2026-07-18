import { kvGet, kvSet, storeReady } from './_store.mjs';

export const config = { runtime: 'edge' };

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export default async function handler(req) {
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[a-z0-9]{6,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
    const b = await kvGet('booking:' + id);
    if (!b) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(b, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }

    // client creates a signed booking/contract
    if (body.action === 'create') {
      const d = body.data || {};
      const sig = String(body.signature || '');
      if (!sig.startsWith('data:image/png;base64,') || sig.length > 300000) {
        return Response.json({ error: 'bad signature' }, { status: 400 });
      }
      const clean = {
        name: String(d.name || '').slice(0, 120),
        idnum: String(d.idnum || '').slice(0, 30),
        email: String(d.email || '').slice(0, 160),
        phone: String(d.phone || '').slice(0, 30),
        date: /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '',
        start: /^\d{2}:\d{2}$/.test(d.start) ? d.start : '',
        end: /^\d{2}:\d{2}$/.test(d.end) ? d.end : '',
        purpose: String(d.purpose || '').slice(0, 160),
        participants: String(d.participants || '').slice(0, 30),
        price: String(d.price || '').slice(0, 30),
        message: String(d.message || '').slice(0, 1500),
        signedAt: new Date().toISOString(),
        studioSigned: false,
        studioSignedAt: null,
      };
      if (!clean.name || !clean.date) return Response.json({ error: 'missing fields' }, { status: 400 });
      if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });
      const id = rid();
      const saved = await kvSet('booking:' + id, { ...clean, signature: sig });
      if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
      return Response.json({ ok: true, id });
    }

    // studio counter-signs (requires the admin key)
    if (body.action === 'studio-sign') {
      const key = req.headers.get('x-admin-key') || '';
      if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const id = String(body.id || '');
      const b = await kvGet('booking:' + id);
      if (!b) return Response.json({ error: 'not found' }, { status: 404 });
      b.studioSigned = true;
      b.studioSignedAt = new Date().toISOString();
      const saved = await kvSet('booking:' + id, b);
      if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { isAdmin, limitPublic, requireAdmin } from './_guard.mjs';

export const config = { runtime: 'edge' };

/* The contract link is the only thing guarding a signed contract, so the id
   has to be unguessable: Math.random() is not a CSPRNG and Date.now() made
   half of the old id predictable. 128 random bits, hex, still matches the
   [a-z0-9]{6,40} shape of the ids already stored. */
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

export default async function handler(req) {
  if (req.method === 'GET') {
    // generous for a person opening their contract, useless for a scanner
    if (!isAdmin(req)) {
      const limited = await limitPublic(req, 'contractview', 60);
      if (limited) return limited;
    }
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[a-z0-9]{6,40}$/.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
    const b = await kvGet('booking:' + id);
    if (!b) return Response.json({ error: 'not found' }, { status: 404 });
    const out = isAdmin(req) ? b : { ...b, idnum: maskId(b.idnum) };
    return Response.json(out, {
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
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
      // each contract stores a signature image, so this is the most expensive
      // thing an anonymous caller can write
      const limited = await limitPublic(req, 'contract', 5);
      if (limited) return limited;
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
      const denied = await requireAdmin(req);
      if (denied) return denied;
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

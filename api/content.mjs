import { kvGet, kvSet, storeReady } from './_store.mjs';

export const config = { runtime: 'edge' };

const KEY = 'content';
// events: null = never configured (site keeps its built-in defaults);
//         []   = explicitly cleared by the admin (site hides the schedule)
const EMPTY = { texts: {}, events: null };

const sanitize = (body) => {
  const texts = {};
  if (body && body.texts && typeof body.texts === 'object') {
    for (const [k, v] of Object.entries(body.texts).slice(0, 100)) {
      if (typeof v === 'string' && /^[\w.-]{1,60}$/.test(k)) texts[k] = v.slice(0, 4000);
    }
  }
  const events = Array.isArray(body?.events)
    ? body.events
        .filter((e) => e && typeof e === 'object')
        .map((e) => {
          // registration mode: 'none' (info only), 'external' (link out),
          // 'internal' (register on-site); internal sub-mode 'free' | 'paid'
          const reg = ['external', 'internal'].includes(e.reg) ? e.reg : 'none';
          const regMode = e.regMode === 'paid' ? 'paid' : 'free';
          const price = Math.max(0, Math.min(100000, parseInt(e.price, 10) || 0));
          return {
            id: /^[a-z0-9]{4,40}$/.test(String(e.id || '')) ? String(e.id) : '',
            date: String(e.date || '').slice(0, 40),
            name: String(e.name || '').slice(0, 200),
            desc: String(e.desc || '').slice(0, 400),
            cat: String(e.cat || '').slice(0, 60),
            status: String(e.status || '').slice(0, 60),
            hot: e.hot === true,
            hidden: e.hidden === true,
            reg,
            regUrl: reg === 'external' ? String(e.regUrl || '').slice(0, 500) : '',
            regMode: reg === 'internal' ? regMode : 'free',
            price: reg === 'internal' && regMode === 'paid' ? price : 0,
          };
        })
        .slice(0, 100)
    : null;
  return { texts, events };
};

export default async function handler(req) {
  if (req.method === 'GET') {
    const data = (await kvGet(KEY)) || EMPTY;
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  }

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
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });
    const clean = sanitize(body);
    const saved = await kvSet(KEY, clean);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

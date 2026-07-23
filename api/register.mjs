import { kvGet, kvSet, storeReady } from './_store.mjs';

export const config = { runtime: 'edge' };

const KEY = 'registrations';
const SITE = 'https://tutlavi.com';
const GI_BASE = 'https://api.greeninvoice.co.il/api/v1';

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Green Invoice / Morning payment (paid tickets) ----------
   Activates only once GI_API_ID + GI_API_SECRET are set as env vars in
   Vercel. Until then paid registrations return 503 ("payments not
   configured") and the site shows a "בהקמה" message, exactly like the
   Blob upload flow. Field mapping follows the v1 /payments/form endpoint
   (developers.morning.co) — verify against a live sandbox once credentials
   exist. */
const giConfigured = () =>
  Boolean(process.env.GI_API_ID && process.env.GI_API_SECRET);

async function giToken() {
  try {
    const res = await fetch(GI_BASE + '/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: process.env.GI_API_ID,
        secret: process.env.GI_API_SECRET,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.token || null;
  } catch {
    return null;
  }
}

async function giPaymentUrl(token, reg) {
  try {
    const body = {
      description: 'כרטיס לאירוע: ' + reg.eventName,
      type: 400, // חשבונית מס/קבלה שתופק אוטומטית לאחר התשלום
      lang: 'he',
      currency: 'ILS',
      client: {
        name: reg.name,
        emails: reg.email ? [reg.email] : [],
        phone: reg.phone || '',
        add: true,
      },
      income: [
        {
          description:
            'כרטיס — ' + reg.eventName + (reg.eventDate ? ' (' + reg.eventDate + ')' : ''),
          quantity: reg.qty,
          price: reg.price, // מחיר ליחידה כולל מע"מ
          currency: 'ILS',
          vatType: 0,
        },
      ],
      remarks: 'הרשמה לאירוע דרך אתר סטודיו תות',
      successUrl: SITE + '/?paid=' + reg.id,
      failureUrl: SITE + '/?payfail=' + reg.id,
      notifyUrl: SITE + '/api/register?action=ipn',
      custom: reg.id, // מוחזר אלינו ב-IPN כדי לסמן "שולם"
    };
    const res = await fetch(GI_BASE + '/payments/form', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.url || null;
  } catch {
    return null;
  }
}

async function markPaid(regId) {
  const list = (await kvGet(KEY)) || [];
  const r = list.find((x) => x && x.id === regId);
  if (r && r.status !== 'שולם') {
    r.status = 'שולם';
    r.paidAt = new Date().toISOString();
    await kvSet(KEY, list);
  }
}

export default async function handler(req) {
  const url = new URL(req.url);

  // Green Invoice server-to-server notification (IPN) → mark the reg paid.
  if (url.searchParams.get('action') === 'ipn') {
    let payload = {};
    try {
      payload = await req.json();
    } catch {
      payload = Object.fromEntries(url.searchParams.entries());
    }
    const regId =
      payload.custom || payload.id || url.searchParams.get('id') || '';
    if (regId) await markPaid(String(regId));
    return Response.json({ ok: true });
  }

  // Admin: list all registrations (contains personal data → key required).
  if (req.method === 'GET') {
    const key = req.headers.get('x-admin-key') || '';
    if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const list = (await kvGet(KEY)) || [];
    return Response.json({ registrations: list }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }

    // admin: delete a registration (test entries / spam)
    if (body && body.action === 'delete') {
      const key = req.headers.get('x-admin-key') || '';
      if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      const id = String(body.id || '');
      const list = (await kvGet(KEY)) || [];
      const next = list.filter((x) => x && x.id !== id);
      const saved = await kvSet(KEY, next);
      if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
      return Response.json({ ok: true, removed: list.length - next.length });
    }

    const d = body || {};
    const paid = d.mode === 'paid';
    const price = Math.max(0, Math.min(100000, parseInt(d.price, 10) || 0));
    const qty = Math.max(1, Math.min(20, parseInt(d.qty, 10) || 1));
    const reg = {
      id: rid(),
      at: new Date().toISOString(),
      eventId: String(d.eventId || '').slice(0, 40),
      eventName: String(d.eventName || '').slice(0, 200),
      eventDate: String(d.eventDate || '').slice(0, 40),
      name: String(d.name || '').slice(0, 120),
      email: String(d.email || '').slice(0, 160),
      phone: String(d.phone || '').slice(0, 30),
      qty,
      mode: paid ? 'paid' : 'free',
      price: paid ? price : 0,
      amount: paid ? price * qty : 0,
      status: paid ? 'ממתין לתשלום' : 'רשום',
    };
    if (!reg.name || !reg.email) {
      return Response.json({ error: 'missing fields' }, { status: 400 });
    }
    if (paid && price <= 0) {
      return Response.json({ error: 'bad price' }, { status: 400 });
    }
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

    // For paid tickets, create the payment page BEFORE saving so a payment
    // outage doesn't leave orphan pendings.
    let paymentUrl = null;
    if (paid) {
      if (!giConfigured()) {
        return Response.json({ error: 'payments not configured' }, { status: 503 });
      }
      const token = await giToken();
      paymentUrl = token ? await giPaymentUrl(token, reg) : null;
      if (!paymentUrl) {
        return Response.json({ error: 'payment init failed' }, { status: 502 });
      }
    }

    const list = (await kvGet(KEY)) || [];
    list.push(reg);
    const saved = await kvSet(KEY, list.slice(-5000));
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });

    return Response.json({ ok: true, id: reg.id, paymentUrl });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

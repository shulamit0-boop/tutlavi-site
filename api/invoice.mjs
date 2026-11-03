import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin } from './_guard.mjs';
import { text } from './_input.mjs';

export const config = { runtime: 'edge' };

/* Invoices through Green Invoice (חשבונית ירוקה / morning).

   After a rental, the studio issues one "חשבונית מס קבלה" (type 320) for it:
   the renter paid by bank transfer before the event, so the invoice and the
   receipt are one document. Green Invoice emails it to the renter itself.

   Two steps, always, and both admin-only:
     preview  what would be issued: client details, price before VAT, VAT,
              total. Nothing leaves the site. The panel (or Claude) shows this
              to the studio and waits for an explicit yes.
     issue    the same, with the price the studio just confirmed. Creates the
              document and stores its number on the booking, so a second
              click cannot issue a duplicate (unless `again` is sent on
              purpose).

   The contract says the price is "בתוספת מע"מ", so the booking's price is the
   amount before VAT and Green Invoice adds VAT on top (vatType 0).

   Env (set by the studio in Vercel, never by Claude):
     GREENINVOICE_API_ID, GREENINVOICE_API_SECRET  — an API key from Green
       Invoice: הגדרות ← כלים למפתחים ← מפתחות API
     GREENINVOICE_SANDBOX=1  — talk to the sandbox instead (for testing) */

const VAT = 0.18;   // display only; Green Invoice computes the real figure
const DOC_TYPE = 320;
const PAY_BANK_TRANSFER = 4;

const base = () =>
  process.env.GREENINVOICE_SANDBOX === '1'
    ? 'https://sandbox.d.greeninvoice.co.il/api/v1'
    : 'https://api.greeninvoice.co.il/api/v1';

export const invoiceReady = () =>
  Boolean(process.env.GREENINVOICE_API_ID && process.env.GREENINVOICE_API_SECRET);

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const round2 = (n) => Math.round(n * 100) / 100;

// "₪2,500" / "2500 ש״ח" / "2,500.50" → 2500 / 2500 / 2500.5; nothing usable → 0
export function parsePrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? round2(v) : 0;
  const m = String(v || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? round2(+m[0]) : 0;
}

const heDate = (iso) => (isDate(iso) ? iso.split('-').reverse().join('.') : '');

const describe = (b) =>
  // "08:30 עד 13:30": a dash between two times is flipped by the PDF's RTL layout
  ['השכרת חלל סטודיו תות', heDate(b.date), b.start && b.end ? b.start + ' עד ' + b.end : b.start, b.purpose]
    .filter(Boolean).join(' · ').slice(0, 250);

/* `incl`: the amount already includes VAT (what the renter actually paid).
   Otherwise it is the price before VAT, as the contract states it. */
function draft(b, amount, incl) {
  const net = incl ? round2(amount / (1 + VAT)) : amount;
  const total = incl ? amount : round2(amount * (1 + VAT));
  return {
    client: { name: b.name || '', taxId: b.idnum || '', email: b.email || '', phone: b.phone || '' },
    description: describe(b),
    eventDate: b.date || '',
    vatIncluded: Boolean(incl),
    price: net, vat: round2(total - net), total,
  };
}

/* Since 2026 the token comes from morning's identity service (OAuth client
   credentials), not from /account/token: that path now just answers 404.
   Documents are still created on the greeninvoice.co.il API with the token. */
const idp = () =>
  process.env.GREENINVOICE_SANDBOX === '1' ? 'https://api.sandbox.morning.dev' : 'https://api.morning.co';

async function token() {
  const r = await fetch(idp() + '/idp/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.GREENINVOICE_API_ID,
      client_secret: process.env.GREENINVOICE_API_SECRET,
    }),
  });
  const j = await r.json().catch(() => ({}));
  const t = j.accessToken || j.access_token || j.token;
  if (!r.ok || !t) throw new Error('auth ' + r.status + ' ' + (j.errorMessage || j.error_description || j.error || ''));
  return t;
}

export default async function handler(req) {
  if (req.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));

  // connection test: signs in to Green Invoice and nothing else — no document
  if (body.action === 'check') {
    if (!invoiceReady()) return Response.json({ ok: false, ready: false });
    try { await token(); return Response.json({ ok: true, ready: true, sandbox: process.env.GREENINVOICE_SANDBOX === '1' }); }
    catch (e) { return Response.json({ ok: false, ready: true, error: String(e && e.message).slice(0, 120) }); }
  }

  const id = text(body.id, 64);
  if (!/^[a-z0-9]+$/i.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const b = await kvGet('booking:' + id);
  if (!b) return Response.json({ error: 'not found' }, { status: 404 });

  if (body.action === 'preview') {
    return Response.json({
      ok: true,
      ready: invoiceReady(),
      sandbox: process.env.GREENINVOICE_SANDBOX === '1',
      status: b.status || '',
      invoice: b.invoice || null,
      ...draft(b, parsePrice(b.price), body.vatIncluded === true),
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (body.action !== 'issue') return Response.json({ error: 'unknown action' }, { status: 400 });
  if (!invoiceReady()) return Response.json({ error: 'green invoice not configured' }, { status: 503 });
  if (b.invoice && body.again !== true) {
    return Response.json({ error: 'already issued', invoice: b.invoice }, { status: 409 });
  }
  /* The price is the one the studio confirmed on screen, sent back explicitly:
     issuing never falls back to whatever is stored on the booking. */
  const price = parsePrice(body.price);
  if (!price) return Response.json({ error: 'missing price' }, { status: 400 });
  if (!b.name) return Response.json({ error: 'missing client name' }, { status: 400 });
  // no email is fine: the document link is then handed over on WhatsApp instead
  const payDate = isDate(body.paymentDate) ? body.paymentDate : new Date().toISOString().slice(0, 10);

  const incl = body.vatIncluded === true;
  const d = draft(b, price, incl);
  const doc = {
    type: DOC_TYPE,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    description: 'השכרת חלל סטודיו תות',   // document title; the full line is in the income row
    remarks: text(body.remarks, 300),
    client: {
      name: d.client.name,
      ...(d.client.email ? { emails: [d.client.email] } : {}),
      ...(d.client.taxId ? { taxId: d.client.taxId } : {}),
      ...(d.client.phone ? { phone: d.client.phone } : {}),
      country: 'IL',
      add: true,
    },
    // income vatType: 0 = VAT added on top, 1 = VAT included in the price
    income: [{ description: d.description, quantity: 1, price, currency: 'ILS', vatType: incl ? 1 : 0 }],
    payment: [{ type: PAY_BANK_TRANSFER, date: payDate, price: d.total, currency: 'ILS' }],
  };

  let j;
  try {
    const t = await token();
    const r = await fetch(base() + '/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
      body: JSON.stringify(doc),
    });
    j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) {
      console.warn('green invoice: rejected', { status: r.status, code: j.errorCode, msg: j.errorMessage });
      return Response.json({ error: 'green invoice: ' + (j.errorMessage || r.status) }, { status: 502 });
    }
  } catch (e) {
    console.warn('green invoice: failed', String(e && e.message));
    return Response.json({ error: 'green invoice unreachable' }, { status: 502 });
  }

  b.invoice = {
    id: j.id,
    number: j.number || '',
    url: (j.url && (j.url.he || j.url.origin)) || '',
    price: d.price, total: d.total,
    at: new Date().toISOString(),
    sandbox: process.env.GREENINVOICE_SANDBOX === '1',
  };
  // the document exists either way; a failed write only loses the duplicate guard
  if (!(await kvSet('booking:' + id, b))) console.warn('invoice issued but not stored', { id, number: b.invoice.number });
  return Response.json({ ok: true, invoice: b.invoice, emailedTo: d.client.email || '' });
}

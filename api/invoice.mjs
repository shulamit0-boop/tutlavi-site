import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin, limitPublic } from './_guard.mjs';
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
/* Who the invoice is made out to. The renter who signed is not always who
   pays: a company rents, a person signs. The studio confirms this on every
   invoice; what she confirmed is remembered on the booking for next time. */
const billTo = (b) => ({ name: b.billName || b.name || '', taxId: b.billTaxId || b.idnum || '' });
// Israeli company numbers (ח.פ.) start with 51; 52/54/55/56/57/58/59 are other corporations
export const looksCorporate = (taxId) => /^5[1-9]\d{7}$/.test(String(taxId || '').replace(/\D/g, ''));

/* The registered name of an Israeli company, from the public companies
   registry on data.gov.il (רשם החברות). Only used to *suggest* the name on
   the confirmation screen; the studio still confirms it. */
const REGISTRY = 'https://data.gov.il/api/3/action/datastore_search?resource_id=f004176c-b85f-4542-8901-7b3176f9a054&q=';
export async function companyName(taxId) {
  const n = String(taxId || '').replace(/\D/g, '');
  if (!looksCorporate(n)) return '';
  try {
    const r = await fetch(REGISTRY + n, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const rec = ((j.result && j.result.records) || []).find((x) => String(x['מספר חברה']) === n);
    // the registry writes the gershayim of בע"מ as "~"
    return rec ? String(rec['שם חברה'] || '').replace(/~/g, '"').trim() : '';
  } catch { return ''; }
}

function draft(b, amount, incl) {
  const net = incl ? round2(amount / (1 + VAT)) : amount;
  const total = incl ? amount : round2(amount * (1 + VAT));
  return {
    client: { ...billTo(b), email: b.email || '', phone: b.phone || '' },
    corporate: looksCorporate(billTo(b).taxId),
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

const rid = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
};

async function gi(t, method, path, payload) {
  const r = await fetch(base() + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

/* What the Tut-branded copy (/invoice?v=…) shows. Read back from Green Invoice
   right after issuing, so it carries the business details exactly as they are
   on the signed original (name, עוסק number, address). */
function snapshot(doc, fallback) {
  const biz = doc.business || {};
  const cl = doc.client || {};
  return {
    type: doc.type || fallback.type,
    number: doc.number || fallback.number,
    date: doc.documentDate || fallback.date,
    business: {
      name: biz.name || '', title: biz.title || '', taxId: biz.taxId || '', type: biz.type ?? null,
      address: [biz.address, biz.city].filter(Boolean).join(', '), phone: biz.phone || biz.mobile || '', email: biz.email || '',
    },
    client: { name: cl.name || fallback.client.name, taxId: cl.taxId || fallback.client.taxId || '', phone: cl.phone || fallback.client.phone || '' },
    income: (doc.income || fallback.income).map((x) => ({ description: x.description, quantity: x.quantity, price: x.price, amount: x.amount ?? x.price * x.quantity })),
    payment: (doc.payment || fallback.payment).map((x) => ({ type: x.type, date: x.date, price: x.price })),
    net: doc.amountDueVat ?? fallback.net,
    vat: doc.vat ?? fallback.vat,
    vatRate: doc.vatRate ?? VAT,
    total: doc.amount ?? fallback.total,
    original: (doc.url && (doc.url.he || doc.url.origin)) || fallback.original,
    links: (doc.linkedDocuments || []).map((x) => ({ type: x.documentType ?? x.type, number: x.number })),
  };
}

async function saveView(t, j, fallback) {
  let full = {};
  try { const g = await gi(t, 'GET', '/documents/' + j.id); if (g.r.ok) full = g.j; } catch {}
  const view = rid();
  await kvSet('invoiceview:' + view, snapshot(full, fallback));
  return view;
}

export default async function handler(req) {
  /* public: the branded copy, by its unguessable token */
  if (req.method === 'GET') {
    const limited = await limitPublic(req, 'invoiceview', 60);
    if (limited) return limited;
    const v = new URL(req.url).searchParams.get('v') || '';
    if (!/^[a-f0-9]{32}$/.test(v)) return Response.json({ error: 'not found' }, { status: 404 });
    const snap = await kvGet('invoiceview:' + v);
    if (!snap) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ ok: true, doc: snap }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  if (req.method !== 'POST') return Response.json({ error: 'method' }, { status: 405 });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const sandbox = process.env.GREENINVOICE_SANDBOX === '1';

  // connection test: signs in to Green Invoice and nothing else — no document
  if (body.action === 'check') {
    if (!invoiceReady()) return Response.json({ ok: false, ready: false });
    try { await token(); return Response.json({ ok: true, ready: true, sandbox }); }
    catch (e) { return Response.json({ ok: false, ready: true, error: String(e && e.message).slice(0, 120) }); }
  }

  const id = text(body.id, 64);
  if (!/^[a-z0-9]+$/i.test(id)) return Response.json({ error: 'bad id' }, { status: 400 });
  const b = await kvGet('booking:' + id);
  if (!b) return Response.json({ error: 'not found' }, { status: 404 });

  if (body.action === 'preview') {
    const d = draft(b, parsePrice(b.price), body.vatIncluded === true);
    // a company number with the signer's private name on it: suggest the registered name
    let nameFrom = b.billName ? 'confirmed' : 'signer';
    if (!b.billName && d.corporate) {
      const reg = await companyName(d.client.taxId);
      if (reg) { d.client.name = reg; nameFrom = 'registry'; }
    }
    return Response.json({
      ok: true, ready: invoiceReady(), sandbox,
      status: b.status || '',
      invoice: b.invoice || null,
      signer: { name: b.name || '', idnum: b.idnum || '' },
      nameFrom,
      ...d,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (!invoiceReady()) return Response.json({ error: 'green invoice not configured' }, { status: 503 });

  /* ---- cancel an issued invoice with a credit note (חשבונית זיכוי, 330).
     A tax document cannot be edited or deleted; this is the only way to
     correct one. The booking is then free for a new invoice. ---- */
  if (body.action === 'credit') {
    /* Normally the booking's current invoice. A top-up credit for an invoice
       already cancelled (only partly) names it from the history instead, and
       carries the exact amount, VAT included. */
    const fromHistory = (b.invoiceHistory || []).find((x) => x.number === body.number);
    const inv = body.number === (b.invoice && b.invoice.number) ? b.invoice : fromHistory;
    if (!inv || !inv.id) return Response.json({ error: 'no such invoice on this booking' }, { status: 409 });
    const partial = parsePrice(body.amount);
    if (inv === fromHistory && !partial) return Response.json({ error: 'amount required for an already-credited invoice' }, { status: 400 });
    let t, src, j;
    try {
      t = await token();
      src = (await gi(t, 'GET', '/documents/' + inv.id)).j;
      const credit = {
        type: 330, lang: 'he', currency: 'ILS', vatType: src.vatType ?? 0,
        description: 'ביטול חשבונית ' + inv.number,
        remarks: text(body.reason, 200),
        client: { ...(src.client && src.client.id ? { id: src.client.id } : {}), name: (src.client && src.client.name) || b.name, ...(src.client && src.client.taxId ? { taxId: src.client.taxId } : {}), country: 'IL' },
        /* Green Invoice stores a row's price before VAT, whatever vatType it was
           sent with, so the credit always adds VAT on top (vatType 0). Copying
           the source's vatType 1 ("included") credited 1,059.32 instead of
           1,250 on credit note 70005. */
        income: partial
          ? [{ description: 'השלמת ביטול חשבונית ' + inv.number, quantity: 1, price: partial, currency: 'ILS', vatType: 1 }]
          : (src.income || []).map((x) => ({ description: x.description, quantity: x.quantity, price: x.price, currency: 'ILS', vatType: 0 })),
        linkedDocumentIds: [inv.id],
        linkType: 'cancel',
      };
      ({ j } = await gi(t, 'POST', '/documents', credit));
      if (!j.id) {
        console.warn('green invoice: credit rejected', { code: j.errorCode, msg: j.errorMessage });
        return Response.json({ error: 'green invoice: ' + (j.errorMessage || 'rejected') }, { status: 502 });
      }
    } catch (e) {
      return Response.json({ error: 'green invoice unreachable' }, { status: 502 });
    }
    const cr = { id: j.id, number: j.number || '', url: (j.url && (j.url.he || j.url.origin)) || '', at: new Date().toISOString() };
    if (inv === fromHistory) {
      inv.credits = [...(inv.credits || []), { ...cr, amount: partial }];
    } else {
      b.invoiceHistory = [...(b.invoiceHistory || []), { ...inv, cancelledBy: cr }];
      b.invoice = null;
    }
    await kvSet('booking:' + id, b);
    return Response.json({ ok: true, credit: cr });
  }

  if (body.action !== 'issue') return Response.json({ error: 'unknown action' }, { status: 400 });
  if (b.invoice && body.again !== true) {
    return Response.json({ error: 'already issued', invoice: b.invoice }, { status: 409 });
  }
  /* Price and recipient are the ones the studio confirmed on screen, sent
     back explicitly: issuing never falls back to what is on the booking. */
  const price = parsePrice(body.price);
  if (!price) return Response.json({ error: 'missing price' }, { status: 400 });
  const clientName = text(body.clientName, 120);
  const clientTaxId = text(body.clientTaxId, 20).replace(/[^\d]/g, '');
  if (!clientName) return Response.json({ error: 'missing client name' }, { status: 400 });
  // no email is fine: the document link is then handed over on WhatsApp instead
  const payDate = isDate(body.paymentDate) ? body.paymentDate : new Date().toISOString().slice(0, 10);

  const incl = body.vatIncluded === true;
  const d = draft(b, price, incl);
  d.client.name = clientName;
  d.client.taxId = clientTaxId;
  const doc = {
    type: DOC_TYPE,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    description: 'השכרת חלל סטודיו תות',   // document title; the full line is in the income row
    remarks: text(body.remarks, 300),
    client: {
      name: clientName,
      ...(d.client.email ? { emails: [d.client.email] } : {}),
      ...(clientTaxId ? { taxId: clientTaxId } : {}),
      ...(d.client.phone ? { phone: d.client.phone } : {}),
      country: 'IL',
      add: true,
    },
    // income vatType: 0 = VAT added on top, 1 = VAT included in the price
    income: [{ description: d.description, quantity: 1, price, currency: 'ILS', vatType: incl ? 1 : 0 }],
    payment: [{ type: PAY_BANK_TRANSFER, date: payDate, price: d.total, currency: 'ILS' }],
  };

  let j, t;
  try {
    t = await token();
    ({ j } = await gi(t, 'POST', '/documents', doc));
    if (!j.id) {
      console.warn('green invoice: rejected', { code: j.errorCode, msg: j.errorMessage });
      return Response.json({ error: 'green invoice: ' + (j.errorMessage || 'rejected') }, { status: 502 });
    }
  } catch (e) {
    console.warn('green invoice: failed', String(e && e.message));
    return Response.json({ error: 'green invoice unreachable' }, { status: 502 });
  }

  const original = (j.url && (j.url.he || j.url.origin)) || '';
  const view = await saveView(t, j, {
    type: DOC_TYPE, number: j.number, date: payDate, client: d.client, original,
    income: [{ description: d.description, quantity: 1, price: d.price, amount: d.price }],
    payment: [{ type: PAY_BANK_TRANSFER, date: payDate, price: d.total }],
    net: d.price, vat: d.vat, total: d.total,
  }).catch(() => '');

  b.billName = clientName;
  b.billTaxId = clientTaxId;
  b.invoice = {
    id: j.id,
    number: j.number || '',
    url: original,
    view,
    price: d.price, total: d.total,
    at: new Date().toISOString(),
    sandbox,
  };
  // the document exists either way; a failed write only loses the duplicate guard
  if (!(await kvSet('booking:' + id, b))) console.warn('invoice issued but not stored', { id, number: b.invoice.number });
  return Response.json({ ok: true, invoice: b.invoice, emailedTo: d.client.email || '' });
}

/* Studio money: the monthly fixed costs and the income / expenses entered by
   hand in the "כספים" tab of the admin panel. Rental income is not stored
   here — the panel reads it from the bookings themselves (confirmed ones).

   Everything needs the admin key: this is the studio's books.

   Storage: KV key `finance` → {
     fixed:   [{ id, name, amount }]                     — per month, every month
     entries: [{ id, kind: 'in'|'out', date, desc, amount }]
   }
   Before anything was saved, GET returns the studio's known monthly costs. */

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin } from './_guard.mjs';
import { text } from './_input.mjs';

export const config = { runtime: 'edge' };

const KEY = 'finance';
const MAX_FIXED = 40;
const MAX_ENTRIES = 3000;

export const DEFAULT_FIXED = [
  { id: 'rent', name: 'שכירות', amount: 4600 },
  { id: 'arnona', name: 'ארנונה', amount: 650 },
  { id: 'power', name: 'חשמל', amount: 500 },
  { id: 'cleaner', name: 'מנקה', amount: 600 },
  { id: 'upkeep', name: 'תחזוקה', amount: 300 },
];

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const okId = (v) => (/^[a-z0-9]{2,40}$/.test(String(v || '')) ? String(v) : rid());
const money = (v) => {
  const n = Math.round((+v || 0) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : 0;
};
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

export function clean(body) {
  const fixed = (Array.isArray(body?.fixed) ? body.fixed : [])
    .filter((f) => f && typeof f === 'object')
    .slice(0, MAX_FIXED)
    .map((f) => ({ id: okId(f.id), name: text(f.name, 80), amount: money(f.amount) }));
  const entries = (Array.isArray(body?.entries) ? body.entries : [])
    .filter((e) => e && typeof e === 'object' && isDate(e.date) && money(e.amount))
    .slice(-MAX_ENTRIES)
    .map((e) => ({
      id: okId(e.id),
      kind: e.kind === 'out' ? 'out' : 'in',
      date: e.date,
      desc: text(e.desc, 160),
      amount: money(e.amount),
    }));
  return { fixed, entries };
}

export default async function handler(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  if (req.method === 'GET') {
    const saved = await kvGet(KEY);
    const out = saved && Array.isArray(saved.fixed) ? clean(saved) : { fixed: DEFAULT_FIXED, entries: [] };
    return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method !== 'PUT') return Response.json({ error: 'method not allowed' }, { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const next = clean(body);
  if (!(await kvSet(KEY, next))) return Response.json({ error: 'store write failed' }, { status: 500 });
  return Response.json({ ok: true, ...next });
}

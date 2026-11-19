/* Vivian's sign-up list (CRM): everyone who asked for updates — from the
   /vivian page, the /syrups page (QR at the cocktail workshop), or added by
   hand in the admin panel. One row per phone number: signing up again merges
   the interests instead of creating a duplicate.

   Public:  POST {name, phone, interests[], source}         → adds / merges
   Admin:   GET                                              → the list
            POST {action:'save', lead}                       → add / edit
            POST {action:'delete', id}                       → remove        */

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { limitPublic, requireAdmin } from './_guard.mjs';
import { text, multiline } from './_input.mjs';

export const config = { runtime: 'edge' };

const KEY = 'vivian_leads';
const MAX = 10000;
const SOURCES = { vivian: 'עמוד ויויאן', syrups: 'סדנת קוקטיילים (QR)', manual: 'ידני' };

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^972/, '0');

export function cleanInterests(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const x of arr) {
    const t = text(x, 40);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export default async function handler(req) {
  if (req.method === 'GET') {
    const denied = await requireAdmin(req);
    if (denied) return denied;
    const list = (await kvGet(KEY)) || [];
    return json({ leads: list });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const d = body || {};

  /* ---------- admin ---------- */
  if (d.action === 'delete' || d.action === 'save') {
    const denied = await requireAdmin(req);
    if (denied) return denied;
    const list = (await kvGet(KEY)) || [];
    if (d.action === 'delete') {
      const id = text(d.id, 40);
      const next = list.filter((x) => x && x.id !== id);
      if (!(await kvSet(KEY, next))) return json({ error: 'store write failed' }, 500);
      return json({ ok: true, removed: list.length - next.length });
    }
    const l = d.lead || {};
    const row = {
      name: text(l.name, 120),
      phone: text(l.phone, 30),
      interests: cleanInterests(l.interests),
      notes: multiline(l.notes, 1000),
    };
    if (!row.name && !row.phone) return json({ error: 'missing fields' }, 400);
    const id = text(l.id, 40);
    const cur = id ? list.find((x) => x && x.id === id) : null;
    let saved;
    if (cur) { Object.assign(cur, row, { updatedAt: new Date().toISOString() }); saved = cur; }
    else { saved = { id: rid(), at: new Date().toISOString(), source: SOURCES.manual, ...row }; list.push(saved); }
    if (!(await kvSet(KEY, list.slice(-MAX)))) return json({ error: 'store write failed' }, 500);
    return json({ ok: true, lead: saved });
  }

  /* ---------- public sign-up ---------- */
  if (text(d._honey, 50)) return json({ ok: true }); // bot: pretend it worked
  const limited = await limitPublic(req, 'vivian', 8);
  if (limited) return limited;
  if (!storeReady()) return json({ error: 'store not configured' }, 503);

  const name = text(d.name, 120);
  const phone = text(d.phone, 30);
  const pd = digits(phone);
  if (!name || pd.length < 9 || pd.length > 13) return json({ error: 'missing fields' }, 400);
  const source = SOURCES[text(d.source, 20)] || SOURCES.vivian;
  const interests = cleanInterests(d.interests);
  const now = new Date().toISOString();

  const list = (await kvGet(KEY)) || [];
  const dup = list.find((x) => x && digits(x.phone) === pd);
  if (dup) {
    dup.name = dup.name || name;
    dup.interests = cleanInterests([...(dup.interests || []), ...interests]);
    if (!String(dup.source || '').includes(source)) dup.source = (dup.source ? dup.source + ' + ' : '') + source;
    dup.lastAt = now;
  } else {
    list.push({ id: rid(), at: now, name, phone, interests, source });
  }
  if (!(await kvSet(KEY, list.slice(-MAX)))) return json({ error: 'store write failed' }, 500);
  return json({ ok: true });
}

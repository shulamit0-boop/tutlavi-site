/* Artists directory ("קהילת האמנים").

   Names, phone numbers and a few words about each artist arrive in the
   WhatsApp group "קהילת האמנים" (inside the "מקשקשות" community). A collector
   on the Hefziba server (~/hefziba/tut_artists.py) reads that group, turns
   each message into a card and pushes it here. The admin panel shows the
   cards under the "אמנים" tab, where they can be corrected, added by hand or
   removed.

   Everything needs the admin key: the list is personal data.

   Storage: KV key `artists` → [{ id, name, phone, field, instagram, notes,
   source, msgIds, addedBy, at, updatedAt, edited }]. `edited` is set once a
   card was changed in the panel, and from then on the collector never
   overwrites it.
   KV key `artists_meta` → { fields: [...] }: the תחום list the panel offers.
   Managed in the panel; the collector reads it so the model picks one of
   them when it fits. */

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireAdmin } from './_guard.mjs';
import { text, multiline } from './_input.mjs';

export const config = { runtime: 'edge' };

const KEY = 'artists';
const META = 'artists_meta';
const MAX = 500;

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const digits = (s) => String(s || '').replace(/\D/g, '');

/* 05x-xxxxxxx → 9725xxxxxxx so two spellings of one number match */
const canon = (s) => {
  let d = digits(s);
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
};

/* "@name", "name", "instagram.com/name/..." → https://instagram.com/name */
const igUrl = (v) => {
  const s = text(v, 200).trim();
  if (!s) return '';
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i) || s.match(/^@?([A-Za-z0-9._]{1,30})$/);
  return m ? 'https://instagram.com/' + m[1].replace(/\.$/, '') : '';
};

const cleanList = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, 80)).filter(Boolean))].slice(0, 60);

/* the stored lists, or (before anything was saved) whatever the cards use */
async function readMeta(list) {
  const m = (await kvGet(META)) || {};
  const used = (k) => [...new Set(list.map((a) => (a[k] || '').trim()).filter(Boolean))];
  return {
    fields: Array.isArray(m.fields) ? m.fields : used('field'),
  };
}

const clean = (a, prev) => ({
  id: /^[a-z0-9]{4,40}$/.test(String(a.id || '')) ? String(a.id) : (prev?.id || rid()),
  name: text(a.name, 120),
  phone: text(a.phone, 40),
  field: text(a.field, 80),
  instagram: igUrl(a.instagram),
  notes: multiline(a.notes, 1000),
  source: a.source === 'whatsapp' ? 'whatsapp' : 'manual',
  msgIds: Array.isArray(a.msgIds) ? a.msgIds.map((x) => text(x, 80)).filter(Boolean).slice(0, 20) : (prev?.msgIds || []),
  addedBy: text(a.addedBy, 80) || prev?.addedBy || '',
  at: prev?.at || (typeof a.at === 'string' && a.at.length < 40 ? a.at : new Date().toISOString()),
  updatedAt: new Date().toISOString(),
  edited: Boolean(prev?.edited || a.edited === true),
});

export default async function handler(req) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  if (req.method === 'GET') {
    const list = (await kvGet(KEY)) || [];
    const meta = await readMeta(list);
    return Response.json({ artists: list, ...meta }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (req.method !== 'POST') return Response.json({ error: 'method not allowed' }, { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }

  const list = (await kvGet(KEY)) || [];

  /* collector: a batch of cards from the group. A card whose message was
     already imported, or whose phone already exists, updates that card
     (unless it was edited by hand) instead of creating a twin. */
  if (body.action === 'upsert') {
    const incoming = Array.isArray(body.artists) ? body.artists.slice(0, 100) : [];
    let added = 0, updated = 0, skipped = 0;
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') continue;
      const ids = Array.isArray(raw.msgIds) ? raw.msgIds.map(String) : [];
      const ph = canon(raw.phone);
      const idx = list.findIndex((x) =>
        (ids.length && x.msgIds?.some((m) => ids.includes(m))) || (ph && canon(x.phone) === ph));
      if (idx === -1) {
        const c = clean({ ...raw, source: 'whatsapp' }, null);
        if (!c.name && !c.phone) continue;
        list.push(c); added++;
      } else if (list[idx].edited) {
        skipped++;
      } else {
        const prev = list[idx];
        const merged = clean({
          ...prev,
          name: raw.name || prev.name,
          phone: raw.phone || prev.phone,
          field: raw.field || prev.field,
          instagram: raw.instagram || prev.instagram,
          notes: [prev.notes, raw.notes].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('\n'),
          msgIds: [...new Set([...(prev.msgIds || []), ...ids])],
          addedBy: prev.addedBy || raw.addedBy,
          source: 'whatsapp',
        }, prev);
        list[idx] = merged; updated++;
      }
    }
    if (list.length > MAX) list.splice(0, list.length - MAX);
    if (!(await kvSet(KEY, list))) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, added, updated, skipped, total: list.length });
  }

  /* panel: one card, new or changed */
  if (body.action === 'save') {
    const a = body.artist && typeof body.artist === 'object' ? body.artist : {};
    const idx = list.findIndex((x) => x.id === a.id);
    const prev = idx === -1 ? null : list[idx];
    const c = clean({ ...a, source: prev?.source || 'manual', edited: true }, prev);
    if (!c.name && !c.phone) return Response.json({ error: 'name or phone required' }, { status: 400 });
    if (idx === -1) list.push(c); else list[idx] = c;
    if (list.length > MAX) return Response.json({ error: 'too many' }, { status: 400 });
    if (!(await kvSet(KEY, list))) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, artist: c });
  }

  /* panel: the תחום list */
  if (body.action === 'meta') {
    const meta = { fields: cleanList(body.fields) };
    if (!(await kvSet(META, meta))) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, ...meta });
  }

  if (body.action === 'delete') {
    const id = String(body.id || '');
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return Response.json({ error: 'not found' }, { status: 404 });
    if (!(await kvSet(KEY, next))) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'unknown action' }, { status: 400 });
}

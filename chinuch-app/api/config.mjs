/* בתי הספר והקטגוריות. נקודת הקצה הזו כולה לניהול בלבד — היא מחזירה גם את
   מפתחות בתי הספר. */

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireUser } from './_guard.mjs';
import { seedConfig, DEFAULT_CATS } from './_seed.mjs';

export const config = { runtime: 'edge' };

const KEY = 'config';
const randKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 14);

const slugOk = (s) => /^[a-z0-9-]{2,40}$/.test(s);
const clean = (v, n) => String(v == null ? '' : v).slice(0, n);

function sanitize(body, prev) {
  const prevSchools = Array.isArray(prev?.schools) ? prev.schools : [];
  const schools = (Array.isArray(body?.schools) ? body.schools : [])
    .filter((s) => s && clean(s.name, 120).trim())
    .slice(0, 200)
    .map((s) => {
      const id = slugOk(String(s.id || '')) ? String(s.id) : randKey().slice(0, 8);
      const was = prevSchools.find((p) => p && p.id === id);
      return {
        id,
        name: clean(s.name, 120),
        city: clean(s.city, 60),
        // מפתח קיים נשמר כמו שהוא; "החלפת מפתח" מהפאנל מגיעה כ-key ריק
        key: s.newKey === true || !was?.key ? randKey() : was.key,
        active: s.active !== false,
      };
    });

  const cats = (Array.isArray(body?.cats) ? body.cats : [])
    .filter((c) => c && slugOk(String(c.slug || '')) && clean(c.name, 80).trim())
    .slice(0, 200)
    .map((c, i) => {
      const out = {
        slug: String(c.slug),
        name: clean(c.name, 80),
        group: c.group === 'month' ? 'month' : 'event',
        order: Number.isFinite(+c.order) ? +c.order : i,
        hidden: c.hidden === true,
        desc: clean(c.desc, 300),
      };
      if (c.event && /^[a-z-]{2,40}$/.test(String(c.event))) out.event = String(c.event);
      const m = +(c.hebDate?.m ?? 0);
      const d = +(c.hebDate?.d ?? 0);
      const days = Math.max(1, Math.min(120, +(c.hebDate?.days ?? 1) || 1));
      if (m >= 1 && m <= 13 && d >= 1 && d <= 30) out.hebDate = { m, d, days };
      return out;
    })
    .sort((a, b) => a.order - b.order);

  return { schools, cats: cats.length ? cats : prev?.cats || [] };
}

/* קריאה ראשונה מקימה את המערכת: קטגוריות ברירת מחדל ובית ספר אחד לדוגמה. */
export async function loadConfig() {
  const cfg = await kvGet(KEY);
  if (cfg && Array.isArray(cfg.cats) && cfg.cats.length) return cfg;
  const fresh = seedConfig(randKey());
  if (storeReady()) await kvSet(KEY, fresh);
  return fresh;
}

export default async function handler(req) {
  const { me, denied } = await requireUser(req, 'admin');
  if (denied) return denied;

  if (req.method === 'GET') {
    const cfg = await loadConfig();
    return Response.json(
      { ...cfg, defaults: DEFAULT_CATS.map((c) => c.slug) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (req.method === 'PUT') {
    if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
    const prev = await loadConfig();
    const next = sanitize(body, prev);
    if (!next.schools.length) {
      return Response.json({ error: 'צריך להשאיר לפחות בית ספר אחד' }, { status: 400 });
    }
    const saved = await kvSet(KEY, next);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, ...next, by: me.role });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

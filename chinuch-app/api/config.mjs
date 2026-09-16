/* בתי הספר והקטגוריות — נקודת קצה לניהול המערכת בלבד.

   לבית ספר יש domain אופציונלי: הדומיין של חשבון ה-Google Workspace שלו.
   מורה שנכנסת עם חשבון כזה משויכת אליו אוטומטית, ולכן הבקשה שלה מגיעה
   ישר למנהלת הנכונה בלי שהיא תבחר מרשימה. */

import { kvGet, kvSet, storeReady } from './_store.mjs';
import { requireUser } from './_guard.mjs';
import { seedConfig, DEFAULT_CATS } from './_seed.mjs';

export const config = { runtime: 'edge' };

const KEY = 'config';
const randId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(36))
    .join('')
    .slice(0, 8);

const slugOk = (s) => /^[a-z0-9-]{2,40}$/.test(s);
const clean = (v, n) => String(v == null ? '' : v).slice(0, n);

function sanitize(body, prev) {
  const schools = (Array.isArray(body?.schools) ? body.schools : [])
    .filter((s) => s && clean(s.name, 120).trim())
    .slice(0, 200)
    .map((s) => ({
      id: slugOk(String(s.id || '')) ? String(s.id) : randId(),
      name: clean(s.name, 120),
      city: clean(s.city, 60),
      domain: clean(s.domain, 80).trim().toLowerCase().replace(/^@/, ''),
      active: s.active !== false,
    }));

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
  const fresh = seedConfig();
  if (storeReady()) await kvSet(KEY, fresh);
  return fresh;
}

export default async function handler(req) {
  const { me, denied } = await requireUser(req, 'super');
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
    const saved = await kvSet(KEY, next);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    return Response.json({ ok: true, ...next, by: me.role });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

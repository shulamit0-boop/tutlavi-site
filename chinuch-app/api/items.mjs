/* הפריטים עצמם: קישורי Canva וקבצים, והרצועה "רלוונטי עכשיו".

   שתי החלטות ששוות הסבר:

   1. כתובת ה-Blob של קובץ **לא יוצאת מכאן לעולם**. הדפדפן מקבל מזהה, וההורדה
      עוברת דרך /api/file שבודק הרשאה ומזרים. כתובת Blob היא ציבורית מעצם
      טבעה — מי שיש לו אותה, יש לו את הקובץ, גם בלי מפתח.

   2. הרלוונטיות מחושבת בשרת ולא בדפדפן, כי היא נסמכת על הלוח העברי
      (_hebrew.mjs) ועל התאריכים שהמנהלת הגדירה לקטגוריות. */

import { kvGet, kvSet, kvMGet, storeReady, logAction } from './_store.mjs';
import { requireUser } from './_guard.mjs';
import { loadConfig } from './config.mjs';
import { relevanceNow, absToday, absFromGreg } from './_hebrew.mjs';

export const config = { runtime: 'edge' };

const INDEX = 'items:index';
const MAX_RELEVANT = 24;
const BLOB_HOST = /^https:\/\/[\w-]+\.public\.blob\.vercel-storage\.com\//;

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clean = (v, n) => String(v == null ? '' : v).slice(0, n);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

const safeLink = (v) => {
  const s = clean(v, 600).trim();
  return /^https?:\/\//i.test(s) ? s : '';
};

/* מה שהדפדפן מקבל לראות. blobUrl ו-thumbUrl נשארים בשרת, וגם כתובת המייל
   של מי שהעלתה לא נחשפת למורות אחרות — רק השם. */
const publicItem = (it, me) => ({
  id: it.id,
  kind: it.kind,
  title: it.title,
  desc: it.desc,
  tags: it.tags || [],
  cats: it.cats || [],
  url: it.kind === 'link' ? it.url : '',
  canvaEdit: it.canvaEdit === true,
  fileName: it.fileName || '',
  mime: it.mime || '',
  size: it.size || 0,
  hasThumb: Boolean(it.thumbUrl),
  relFrom: it.relFrom || '',
  relTo: it.relTo || '',
  pinned: it.pinned === true,
  visibility: it.visibility,
  schoolId: it.schoolId || null,
  uploader: it.uploader || '',
  createdAt: it.createdAt,
  views: it.views || 0,
  downloads: it.downloads || 0,
  canEdit: me ? canEdit(it, me) : false,
});

const canSee = (it, me) =>
  me.role === 'super' || it.visibility === 'all' || it.schoolId === me.schoolId;

/* מורה עורכת ומוחקת את מה שהיא העלתה. מנהלת בית ספר — כל מה שבבית הספר
   שלה. מנהלת המערכת — הכל. */
const canEdit = (it, me) => {
  if (me.role === 'super') return true;
  if (me.role === 'principal') return Boolean(me.schoolId) && it.schoolId === me.schoolId;
  return Boolean(it.uploaderEmail) && it.uploaderEmail === me.email;
};

export async function loadItems() {
  const ids = (await kvGet(INDEX)) || [];
  if (!ids.length) return { ids, items: [] };
  const rows = await kvMGet(ids.map((id) => `item:${id}`));
  return { ids, items: rows.filter(Boolean) };
}

/* סדר הרצועה: מוצמד ידנית → החודש העברי הנוכחי → אירוע שמגיע → חלון תאריכים
   שהוגדר לפריט. פריט שמתאים לשתי סיבות מופיע פעם אחת, במקום הגבוה. */
function buildRelevant(items, cats, rel, today) {
  const order = [];
  const seen = new Set();
  const take = (list, reason) => {
    for (const it of list) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      order.push({ id: it.id, reason });
      if (order.length >= MAX_RELEVANT) return;
    }
  };

  const byNew = [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  take(byNew.filter((it) => it.pinned), 'נבחר');
  if (rel.monthSlug) {
    const cat = cats.find((c) => c.slug === rel.monthSlug);
    if (cat && !cat.hidden) {
      take(byNew.filter((it) => (it.cats || []).includes(rel.monthSlug)), cat.name);
    }
  }
  for (const up of rel.upcoming) {
    const cat = cats.find((c) => c.slug === up.slug || c.event === up.slug);
    if (!cat || cat.hidden) continue;
    const label = up.active
      ? up.daysUntil === 0
        ? cat.name + ' — היום'
        : cat.name + ' — עכשיו'
      : `${cat.name} · בעוד ${up.daysUntil} ימים`;
    take(byNew.filter((it) => (it.cats || []).includes(cat.slug)), label);
  }
  take(
    byNew.filter((it) => {
      if (!it.relFrom && !it.relTo) return false;
      const from = it.relFrom ? absFromGreg(...it.relFrom.split('-').map(Number)) : -Infinity;
      const to = it.relTo ? absFromGreg(...it.relTo.split('-').map(Number)) : Infinity;
      return today >= from && today <= to;
    }),
    'לתקופה הזו'
  );
  return order;
}

export default async function handler(req) {
  const { me, denied } = await requireUser(req);
  if (denied) return denied;

  /* ---------- קריאה ---------- */
  if (req.method === 'GET') {
    const cfg = await loadConfig();
    const { items } = await loadItems();
    const live = items.filter((it) => !it.deletedAt);
    const visible = live.filter((it) => canSee(it, me));

    const today = absToday();
    const extra = {};
    for (const c of cfg.cats) if (c.hebDate) extra[c.slug] = c.hebDate;
    const rel = relevanceNow(today, 30, extra);
    // שם הקטגוריה מצטרף לאירועים שמגיעים, כדי שהדפדפן לא יצטרך למצוא אותו
    rel.upcoming = rel.upcoming
      .map((u) => {
        const cat = cfg.cats.find((c) => c.slug === u.slug || c.event === u.slug);
        return cat ? { ...u, slug: cat.slug, name: cat.name } : null;
      })
      .filter(Boolean);

    const counts = {};
    for (const it of visible) for (const c of it.cats || []) counts[c] = (counts[c] || 0) + 1;

    return Response.json(
      {
        me,
        rel,
        relevant: buildRelevant(visible, cfg.cats, rel, today),
        cats: cfg.cats.map((c) => ({ ...c, count: counts[c.slug] || 0 })),
        schools: cfg.schools.map((s) => ({ id: s.id, name: s.name })),
        items: visible.map((it) => publicItem(it, me)),
        trash:
          me.role === 'super'
            ? items.filter((it) => it.deletedAt).map((it) => publicItem(it, me))
            : [],
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!storeReady()) return Response.json({ error: 'store not configured' }, { status: 503 });

  let body = {};
  if (req.method !== 'DELETE') {
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'bad json' }, { status: 400 });
    }
  }

  /* ---------- פעולות קטנות ---------- */
  if (req.method === 'POST' && body.action) {
    const id = clean(body.id, 40);
    const it = await kvGet(`item:${id}`);
    if (!it) return Response.json({ error: 'not found' }, { status: 404 });

    if (body.action === 'view') {
      if (!canSee(it, me)) return Response.json({ error: 'forbidden' }, { status: 403 });
      it.views = (it.views || 0) + 1;
      await kvSet(`item:${id}`, it);
      return Response.json({ ok: true });
    }

    if (body.action === 'pin') {
      if (me.role !== 'super') return Response.json({ error: 'forbidden' }, { status: 403 });
      it.pinned = !it.pinned;
      await kvSet(`item:${id}`, it);
      return Response.json({ ok: true, pinned: it.pinned });
    }

    if (body.action === 'restore') {
      if (me.role !== 'super') return Response.json({ error: 'forbidden' }, { status: 403 });
      delete it.deletedAt;
      await kvSet(`item:${id}`, it);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  }

  /* ---------- יצירה ---------- */
  if (req.method === 'POST') {
    const cfg = await loadConfig();
    const catSlugs = new Set(cfg.cats.map((c) => c.slug));
    const cats = (Array.isArray(body.cats) ? body.cats : [])
      .map((c) => clean(c, 40))
      .filter((c) => catSlugs.has(c))
      .slice(0, 6);
    if (!cats.length) return Response.json({ error: 'צריך לבחור קטגוריה' }, { status: 400 });

    const title = clean(body.title, 160).trim();
    if (!title) return Response.json({ error: 'צריך שם לעיצוב' }, { status: 400 });

    const kind = body.kind === 'file' ? 'file' : 'link';
    const it = {
      id: rid(),
      kind,
      title,
      desc: clean(body.desc, 1200),
      tags: (Array.isArray(body.tags) ? body.tags : []).map((t) => clean(t, 40)).slice(0, 12),
      cats,
      relFrom: isoDate(body.relFrom),
      relTo: isoDate(body.relTo),
      visibility: body.visibility === 'all' ? 'all' : 'school',
      schoolId: me.role === 'super' ? clean(body.schoolId, 40) || null : me.schoolId,
      uploader: me.name || clean(body.uploader, 60),
      uploaderEmail: me.email,
      createdAt: new Date().toISOString(),
      views: 0,
      downloads: 0,
      pinned: false,
    };
    // פריט של מנהלת המערכת שאין לו בית ספר חייב להיות משותף, אחרת אף אחת
    // לא תראה אותו: הוא שייך ל"בית ספר" שאין לו מפתח
    if (!it.schoolId) it.visibility = 'all';

    if (kind === 'link') {
      it.url = safeLink(body.url);
      if (!it.url) return Response.json({ error: 'הקישור אינו תקין' }, { status: 400 });
      // קישור עריכה של Canva מסומן כאן ולא רק בדפדפן, כדי שגם פריט שנשמר
      // דרך ה-API יישא את הסימון
      it.canvaEdit = /canva\.com\/design\/[^/]+\/[^/]*\/edit/i.test(it.url);
    } else {
      const url = clean(body.blob?.url, 600);
      if (!BLOB_HOST.test(url)) {
        return Response.json({ error: 'העלאת הקובץ לא הושלמה' }, { status: 400 });
      }
      it.blobUrl = url;
      it.fileName = clean(body.blob?.fileName, 200);
      it.mime = clean(body.blob?.mime, 100);
      it.size = Math.max(0, Math.min(200 * 1024 * 1024, parseInt(body.blob?.size, 10) || 0));
    }

    const thumb = clean(body.thumbUrl, 600);
    if (thumb && BLOB_HOST.test(thumb)) it.thumbUrl = thumb;

    const ids = (await kvGet(INDEX)) || [];
    const okItem = await kvSet(`item:${it.id}`, it);
    if (!okItem) return Response.json({ error: 'store write failed' }, { status: 500 });
    ids.push(it.id);
    await kvSet(INDEX, ids.slice(-20000));
    await logAction({ what: 'create', id: it.id, title: it.title, school: it.schoolId, by: me.email });
    return Response.json({ ok: true, item: publicItem(it, me) });
  }

  /* ---------- עריכה ---------- */
  if (req.method === 'PUT') {
    const id = clean(body.id, 40);
    const it = await kvGet(`item:${id}`);
    if (!it) return Response.json({ error: 'not found' }, { status: 404 });
    if (!canEdit(it, me)) return Response.json({ error: 'forbidden' }, { status: 403 });

    const cfg = await loadConfig();
    const catSlugs = new Set(cfg.cats.map((c) => c.slug));

    if (body.title != null) it.title = clean(body.title, 160).trim() || it.title;
    if (body.desc != null) it.desc = clean(body.desc, 1200);
    if (Array.isArray(body.tags)) it.tags = body.tags.map((t) => clean(t, 40)).slice(0, 12);
    if (Array.isArray(body.cats)) {
      const cats = body.cats.map((c) => clean(c, 40)).filter((c) => catSlugs.has(c)).slice(0, 6);
      if (cats.length) it.cats = cats;
    }
    if (body.relFrom != null) it.relFrom = isoDate(body.relFrom);
    if (body.relTo != null) it.relTo = isoDate(body.relTo);
    if (body.visibility) it.visibility = body.visibility === 'all' ? 'all' : 'school';
    if (!it.schoolId) it.visibility = 'all';
    if (body.kind === 'link' && body.url != null) {
      const url = safeLink(body.url);
      if (url) {
        it.url = url;
        it.canvaEdit = /canva\.com\/design\/[^/]+\/[^/]*\/edit/i.test(url);
      }
    }
    if (body.thumbUrl != null) {
      const thumb = clean(body.thumbUrl, 600);
      if (!thumb) delete it.thumbUrl;
      else if (BLOB_HOST.test(thumb)) it.thumbUrl = thumb;
    }
    it.updatedAt = new Date().toISOString();

    const saved = await kvSet(`item:${id}`, it);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    await logAction({ what: 'edit', id, title: it.title, by: me.email });
    return Response.json({ ok: true, item: publicItem(it, me) });
  }

  /* ---------- מחיקה רכה ---------- */
  if (req.method === 'DELETE') {
    const id = clean(new URL(req.url).searchParams.get('id'), 40);
    const it = await kvGet(`item:${id}`);
    if (!it) return Response.json({ error: 'not found' }, { status: 404 });
    if (!canEdit(it, me)) return Response.json({ error: 'forbidden' }, { status: 403 });
    // מחיקה רכה: פריט שנמחק בטעות חוזר בלחיצה מפאנל הניהול
    it.deletedAt = new Date().toISOString();
    it.pinned = false;
    const saved = await kvSet(`item:${id}`, it);
    if (!saved) return Response.json({ error: 'store write failed' }, { status: 500 });
    await logAction({ what: 'delete', id, title: it.title, by: me.email });
    return Response.json({ ok: true });
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 });
}

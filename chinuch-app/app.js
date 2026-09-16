/* עיצובי בית חינוך — הלוגיקה של הדף.
   בלי framework ובלי build: הדף הזה נטען גם ברשת של בית ספר בשעת שיא.

   הערה על התצוגות: כל מה שמוצג מגיע מקריאה אחת ל-/api/items. הסינון,
   החיפוש והמיון קורים בדפדפן, כי בהיקף של מאות עיצובים זה מיידי — ורק
   הרלוונטיות מחושבת בשרת, כי היא צריכה את הלוח העברי. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const NAME_KEY = 'bc-teacher-name';
let D = null; // כל הנתונים מהשרת
let editing = null; // הפריט שנמצא בעריכה, אם יש

/* ---------- עזרי רשת ---------- */

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new Error((body && body.error) || `שגיאה ${res.status}`);
  return body;
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

const sizeLabel = (n) =>
  !n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

const dateLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};

const schoolLabel = (id) => (D.schools.find((s) => s.id === id) || {}).name || '';

/* ---------- כניסה ---------- */

$('#gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#gateBtn');
  const err = $('#gateErr');
  err.hidden = true;
  btn.disabled = true;
  btn.textContent = 'בודקת…';
  try {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ key: $('#gateKey').value }) });
    const name = $('#gateName').value.trim();
    if (name) localStorage.setItem(NAME_KEY, name.slice(0, 60));
    $('#gateKey').value = '';
    await start();
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'כניסה';
  }
});

$('#outBtn').addEventListener('click', async () => {
  await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }).catch(() => {});
  location.reload();
});

/* ---------- טעינה ---------- */

async function load() {
  D = await api('/api/items');
  $('#schoolName').textContent = D.me.schoolName || '';
  $('#adminBtn').hidden = D.me.role !== 'admin';
  $('#footStat').textContent =
    `${D.items.length} עיצובים · ${D.cats.filter((c) => !c.hidden).length} קטגוריות` +
    (D.me.role === 'admin' ? ' · מחוברת כניהול' : '');
}

async function start() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  await load();
  route();
}

(async function boot() {
  try {
    await api('/api/auth');
    await start();
  } catch {
    $('#gate').hidden = false;
  }
})();

/* ---------- ניווט ---------- */

window.addEventListener('hashchange', route);

function route() {
  if (!D) return;
  const h = location.hash || '#/';
  const views = { home: $('#viewHome'), list: $('#viewList'), admin: $('#viewAdmin') };
  for (const v of Object.values(views)) v.hidden = true;

  if (h.startsWith('#/c/')) {
    views.list.hidden = false;
    renderList(decodeURIComponent(h.slice(4)));
  } else if (h === '#/admin' && D.me.role === 'admin') {
    views.admin.hidden = false;
    renderAdmin();
  } else if (h === '#/q') {
    views.list.hidden = false;
    renderList(null);
  } else {
    views.home.hidden = false;
    renderHome();
  }
  window.scrollTo({ top: 0 });
}

$('#adminBtn').addEventListener('click', () => {
  location.hash = '#/admin';
});

/* ---------- דף הבית ---------- */

function cardHtml(it, why) {
  const thumb = it.hasThumb
    ? `<img src="/api/file?id=${encodeURIComponent(it.id)}&thumb=1" alt="" loading="lazy">`
    : `<div class="ph">${esc(catNames(it.cats)[0] || (it.kind === 'file' ? 'קובץ' : 'Canva'))}</div>`;
  return `
    <button class="card" data-id="${esc(it.id)}" type="button">
      <span class="thumb">${thumb}</span>
      <span class="body">
        ${why ? `<span class="why">${esc(why)}</span>` : ''}
        <span class="t">${esc(it.title)}</span>
        <span class="m">
          <span class="kind">${it.kind === 'file' ? 'קובץ' : 'Canva'}</span>
          ${it.uploader ? `<span>${esc(it.uploader)}</span>` : ''}
          ${it.visibility === 'school' ? '<span>בית הספר שלי</span>' : ''}
        </span>
      </span>
    </button>`;
}

const catNames = (slugs) =>
  (slugs || []).map((s) => (D.cats.find((c) => c.slug === s) || {}).name).filter(Boolean);

function renderHome() {
  const rel = D.rel;
  $('#relDate').textContent = `היום ${rel.today}`;
  const up = rel.upcoming[0];
  $('#relHint').textContent = up
    ? up.active
      ? up.daysUntil === 0
        ? `${up.name} — היום`
        : `${up.name} — עכשיו`
      : `${up.name} בעוד ${up.daysUntil} ימים`
    : '';

  const byId = new Map(D.items.map((it) => [it.id, it]));
  $('#relStrip').innerHTML = D.relevant
    .map((r) => (byId.has(r.id) ? cardHtml(byId.get(r.id), r.reason) : ''))
    .join('');

  const tile = (c) => {
    const now = c.slug === D.rel.monthSlug || D.rel.upcoming.some((u) => u.slug === c.slug);
    return `<a class="tile${now ? ' now' : ''}" href="#/c/${encodeURIComponent(c.slug)}">
      <b>${esc(c.name)}</b>
      <span>${c.count ? `${c.count} עיצובים` : 'ריק'}${now ? ' · עכשיו' : ''}</span>
    </a>`;
  };
  const shown = D.cats.filter((c) => !c.hidden);
  $('#monthTiles').innerHTML = shown.filter((c) => c.group === 'month').map(tile).join('');
  $('#eventTiles').innerHTML = shown.filter((c) => c.group !== 'month').map(tile).join('');
}

/* ---------- דף קטגוריה וחיפוש ---------- */

function renderList(slug) {
  const q = $('#search').value.trim().toLowerCase();
  const cat = slug ? D.cats.find((c) => c.slug === slug) : null;
  $('#listTitle').textContent = cat ? cat.name : q ? `חיפוש: ${q}` : 'כל העיצובים';
  $('#listDesc').textContent = cat ? cat.desc || '' : '';

  let list = D.items.filter((it) => (slug ? (it.cats || []).includes(slug) : true));
  if (q) {
    list = list.filter((it) =>
      [it.title, it.desc, (it.tags || []).join(' '), catNames(it.cats).join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }
  const kind = $('#fKind').value;
  if (kind) list = list.filter((it) => it.kind === kind);

  const sort = $('#fSort').value;
  list.sort((a, b) =>
    sort === 'title'
      ? a.title.localeCompare(b.title, 'he')
      : sort === 'views'
        ? (b.views || 0) - (a.views || 0)
        : String(b.createdAt).localeCompare(String(a.createdAt))
  );

  $('#listCount').textContent = `${list.length} עיצובים`;
  $('#listGrid').innerHTML = list.length
    ? list.map((it) => cardHtml(it)).join('')
    : '<p class="empty">אין כאן עיצובים עדיין. אפשר להוסיף את הראשון.</p>';
}

$('#fKind').addEventListener('change', route);
$('#fSort').addEventListener('change', route);

let searchTimer = null;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = $('#search').value.trim();
    if (q && !location.hash.startsWith('#/c/')) location.hash = '#/q';
    else route();
  }, 180);
});

/* ---------- כרטיס פריט ---------- */

document.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (card) openItem(card.dataset.id);
  if (e.target.matches('[data-close]')) e.target.closest('dialog').close();
});

function openItem(id) {
  const it = D.items.find((x) => x.id === id);
  if (!it) return;
  const mine = D.me.role === 'admin' || it.schoolId === D.me.schoolId;
  const fileHref = `/api/file?id=${encodeURIComponent(it.id)}`;

  $('#itemBody').innerHTML = `
    <div class="dlg-head">
      <h2>${esc(it.title)}</h2>
      <button type="button" class="x" data-close aria-label="סגירה">×</button>
    </div>
    ${it.hasThumb ? `<img class="view-thumb" src="${fileHref}&thumb=1" alt="">` : ''}
    ${it.canvaEdit ? '<p class="warn">זהו קישור <b>עריכה</b>: שינוי שתעשי בו משנה את העיצוב המקורי אצל מי שהעלתה אותו.</p>' : ''}
    ${it.desc ? `<p class="view-desc">${esc(it.desc)}</p>` : ''}
    <div class="view-cats">
      ${catNames(it.cats).map((n, i) => `<a href="#/c/${encodeURIComponent(it.cats[i])}">${esc(n)}</a>`).join('')}
      ${(it.tags || []).map((t) => `<a href="#/q" data-tag="${esc(t)}">#${esc(t)}</a>`).join('')}
    </div>
    <div class="view-meta">
      <span>${it.kind === 'file' ? `קובץ ${esc(it.fileName || '')} ${sizeLabel(it.size)}` : 'קישור Canva'}</span>
      ${it.uploader ? `<span>הועלה על ידי ${esc(it.uploader)}</span>` : ''}
      ${it.schoolId ? `<span>${esc(schoolLabel(it.schoolId))}</span>` : ''}
      <span>${dateLabel(it.createdAt)}</span>
      <span>${it.visibility === 'all' ? 'משותף לכל בתי הספר' : 'בית הספר שלי בלבד'}</span>
      ${it.downloads ? `<span>${it.downloads} הורדות</span>` : ''}
    </div>
    <div class="view-acts">
      ${
        it.kind === 'link'
          ? `<a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener">פתיחה ב-Canva</a>
             <button class="btn" type="button" data-copy="${esc(it.url)}">העתקת הקישור</button>`
          : `<a class="btn primary" href="${fileHref}" download>הורדת הקובץ</a>`
      }
      ${mine ? `<button class="btn" type="button" data-edit="${esc(it.id)}">עריכה</button>` : ''}
      ${D.me.role === 'admin' ? `<button class="btn" type="button" data-pin="${esc(it.id)}">${it.pinned ? 'ביטול ההצמדה' : 'הצמדה ל״רלוונטי עכשיו״'}</button>` : ''}
      ${mine ? `<button class="btn danger" type="button" data-del="${esc(it.id)}">מחיקה</button>` : ''}
    </div>`;
  $('#itemDlg').showModal();
  api('/api/items', { method: 'POST', body: JSON.stringify({ action: 'view', id: it.id }) }).catch(() => {});
}

$('#itemBody').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.copy) {
    try {
      await navigator.clipboard.writeText(t.dataset.copy);
      toast('הקישור הועתק');
    } catch {
      toast('לא הצלחתי להעתיק — אפשר לפתוח ולהעתיק מהדפדפן');
    }
  }
  if (t.dataset.tag) {
    $('#search').value = t.dataset.tag;
    $('#itemDlg').close();
    location.hash = '#/q';
    route();
  }
  if (t.dataset.edit) {
    const it = D.items.find((x) => x.id === t.dataset.edit);
    $('#itemDlg').close();
    openForm(it);
  }
  if (t.dataset.pin) {
    await api('/api/items', { method: 'POST', body: JSON.stringify({ action: 'pin', id: t.dataset.pin }) });
    $('#itemDlg').close();
    await load();
    route();
    toast('עודכן');
  }
  if (t.dataset.del) {
    if (!confirm('למחוק את העיצוב? אפשר לשחזר אותו מפאנל הניהול.')) return;
    await api(`/api/items?id=${encodeURIComponent(t.dataset.del)}`, { method: 'DELETE' });
    $('#itemDlg').close();
    await load();
    route();
    toast('נמחק');
  }
});

/* ---------- טופס הוספה ועריכה ---------- */

let formKind = 'link';
let chosenCats = new Set();

$('#addBtn').addEventListener('click', () => openForm(null));

function openForm(it) {
  editing = it || null;
  formKind = it ? it.kind : 'link';
  chosenCats = new Set(it ? it.cats : []);

  $('#formTitle').textContent = it ? 'עריכת עיצוב' : 'הוספת עיצוב';
  $('#fTitle').value = it ? it.title : '';
  $('#fDesc').value = it ? it.desc || '' : '';
  $('#fTags').value = it ? (it.tags || []).join(', ') : '';
  $('#fUrl').value = it && it.kind === 'link' ? it.url : '';
  $('#fVis').value = it ? it.visibility : 'school';
  $('#fFrom').value = it ? it.relFrom || '' : '';
  $('#fTo').value = it ? it.relTo || '' : '';
  $('#fFile').value = '';
  $('#fThumb').value = '';
  $('#formErr').hidden = true;
  $('#formProg').textContent = '';
  $('#editWarn').hidden = true;

  // בעריכה אין החלפת קובץ: קובץ חדש הוא פריט חדש, אחרת קישור שכבר חולק
  // בוואטסאפ היה מתחיל להוריד משהו אחר
  $('#kindSwitch').hidden = Boolean(it);
  $('#kindFile').hidden = formKind !== 'file' || Boolean(it);
  $('#kindLink').hidden = formKind !== 'link';
  $$('#kindSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.kind === formKind));

  const groups = [
    ['חודשים', D.cats.filter((c) => c.group === 'month' && !c.hidden), 'month'],
    ['אירועים ונושאים', D.cats.filter((c) => c.group !== 'month' && !c.hidden), 'event'],
  ];
  $('#fCats').innerHTML = groups
    .map(([, list, cls]) =>
      list
        .map(
          (c) =>
            `<button type="button" class="chip ${cls}${chosenCats.has(c.slug) ? ' on' : ''}" data-cat="${esc(c.slug)}">${esc(c.name)}</button>`
        )
        .join('')
    )
    .join('');

  $('#formDlg').showModal();
}

$('#kindSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  formKind = b.dataset.kind;
  $$('#kindSwitch button').forEach((x) => x.classList.toggle('on', x === b));
  $('#kindFile').hidden = formKind !== 'file';
  $('#kindLink').hidden = formKind !== 'link';
});

$('#fCats').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const slug = b.dataset.cat;
  if (chosenCats.has(slug)) chosenCats.delete(slug);
  else chosenCats.add(slug);
  b.classList.toggle('on', chosenCats.has(slug));
});

// אזהרת קישור עריכה, בזמן ההקלדה ולא אחרי השמירה
$('#fUrl').addEventListener('input', () => {
  $('#editWarn').hidden = !/canva\.com\/design\/[^/]+\/[^/]*\/edit/i.test($('#fUrl').value);
});

/* העלאה ישירה ל-Blob. הספריה נטענת רק כשצריך אותה באמת. */
async function uploadFile(file, folder) {
  const { upload } = await import('https://esm.sh/@vercel/blob@0.27.3/client');
  const ext = (String(file.name).match(/\.[a-z0-9]{1,6}$/i) || [''])[0].toLowerCase();
  const path = `${folder}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${ext}`;
  const res = await upload(path, file, {
    access: 'public',
    handleUploadUrl: '/api/upload',
    contentType: file.type || undefined,
  });
  return res.url;
}

$('#itemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#formErr');
  const prog = $('#formProg');
  const save = $('#formSave');
  err.hidden = true;

  const title = $('#fTitle').value.trim();
  if (!title) return fail('צריך שם לעיצוב');
  if (!chosenCats.size) return fail('צריך לבחור לפחות קטגוריה אחת');
  const file = $('#fFile').files[0];
  if (formKind === 'link' && !/^https?:\/\//i.test($('#fUrl').value.trim())) {
    return fail('הקישור צריך להתחיל ב-https://');
  }
  if (formKind === 'file' && !editing && !file) return fail('צריך לבחור קובץ');
  if (file && file.size > 50 * 1024 * 1024) return fail('הקובץ גדול מ-50MB');

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
    save.disabled = false;
    prog.textContent = '';
  }

  save.disabled = true;
  try {
    const body = {
      title,
      desc: $('#fDesc').value.trim(),
      tags: $('#fTags').value.split(',').map((t) => t.trim()).filter(Boolean),
      cats: [...chosenCats],
      visibility: $('#fVis').value,
      relFrom: $('#fFrom').value,
      relTo: $('#fTo').value,
      uploader: localStorage.getItem(NAME_KEY) || '',
      kind: formKind,
    };

    if (formKind === 'link') body.url = $('#fUrl').value.trim();

    if (file) {
      prog.textContent = 'מעלה את הקובץ…';
      const url = await uploadFile(file, 'files');
      body.blob = { url, fileName: file.name, mime: file.type, size: file.size };
      body.kind = 'file';
    }

    const thumb = $('#fThumb').files[0];
    if (thumb) {
      prog.textContent = 'מעלה את תמונת התצוגה…';
      body.thumbUrl = await uploadFile(thumb, 'thumbs');
    }

    prog.textContent = 'שומרת…';
    if (editing) {
      await api('/api/items', { method: 'PUT', body: JSON.stringify({ id: editing.id, ...body }) });
    } else {
      await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
    }
    $('#formDlg').close();
    await load();
    route();
    toast(editing ? 'העיצוב עודכן' : 'העיצוב נוסף');
  } catch (e2) {
    fail(
      /503/.test(e2.message) || /אחסון/.test(e2.message)
        ? 'אחסון הקבצים עוד לא הוקם ב-Vercel. בינתיים אפשר להוסיף קישור Canva.'
        : e2.message
    );
  } finally {
    save.disabled = false;
    prog.textContent = '';
  }
});

/* ---------- פאנל ניהול ---------- */

let cfg = null;

async function renderAdmin() {
  if (!cfg) cfg = await api('/api/config');

  $('#schoolRows').innerHTML = cfg.schools
    .map(
      (s, i) => `
      <div class="adm-row" data-i="${i}">
        <input type="text" value="${esc(s.name)}" data-f="name" placeholder="שם בית הספר">
        <input type="text" value="${esc(s.city)}" data-f="city" placeholder="עיר">
        <code>${esc(s.key)}</code>
        <button class="btn tiny" type="button" data-copykey="${esc(s.key)}">העתקה</button>
        <button class="btn tiny" type="button" data-newkey="${i}">החלפת מפתח</button>
        <label><input type="checkbox" data-f="active" ${s.active === false ? '' : 'checked'}> פעיל</label>
      </div>`
    )
    .join('');

  $('#catRows').innerHTML = cfg.cats
    .map(
      (c, i) => `
      <div class="adm-row" data-i="${i}">
        <input type="text" value="${esc(c.name)}" data-f="name" placeholder="שם הקטגוריה">
        <code>${esc(c.slug)}</code>
        <select data-f="group">
          <option value="month"${c.group === 'month' ? ' selected' : ''}>חודש</option>
          <option value="event"${c.group !== 'month' ? ' selected' : ''}>אירוע / נושא</option>
        </select>
        <label><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> מוסתרת</label>
        <button class="btn tiny" type="button" data-up="${i}">↑</button>
        <button class="btn tiny" type="button" data-down="${i}">↓</button>
      </div>`
    )
    .join('');

  $('#trashRows').innerHTML = D.trash.length
    ? D.trash
        .map(
          (it) => `
        <div class="adm-row">
          <span>${esc(it.title)}</span>
          <button class="btn tiny" type="button" data-restore="${esc(it.id)}">שחזור</button>
        </div>`
        )
        .join('')
    : '<p class="panel-note">אין פריטים מחוקים.</p>';
}

$('#viewAdmin').addEventListener('click', async (e) => {
  const t = e.target;

  if (t.dataset.copykey) {
    try {
      await navigator.clipboard.writeText(t.dataset.copykey);
      toast('המפתח הועתק — אפשר לשלוח אותו למורות של בית הספר');
    } catch {
      toast('לא הצלחתי להעתיק. המפתח מוצג על המסך.');
    }
  }
  if (t.dataset.newkey != null) {
    if (!confirm('להחליף את המפתח? המפתח הקודם יפסיק לעבוד לכל המורות של בית הספר.')) return;
    collectCfg();
    cfg.schools[+t.dataset.newkey].newKey = true;
    await saveCfg();
  }
  if (t.dataset.up != null || t.dataset.down != null) {
    collectCfg();
    const i = +(t.dataset.up ?? t.dataset.down);
    const j = t.dataset.up != null ? i - 1 : i + 1;
    if (j < 0 || j >= cfg.cats.length) return;
    [cfg.cats[i], cfg.cats[j]] = [cfg.cats[j], cfg.cats[i]];
    cfg.cats.forEach((c, k) => {
      c.order = k;
    });
    renderAdmin();
  }
  if (t.dataset.restore) {
    await api('/api/items', { method: 'POST', body: JSON.stringify({ action: 'restore', id: t.dataset.restore }) });
    await load();
    renderAdmin();
    toast('שוחזר');
  }
});

/* קריאת מה שהוקלד בפאנל חזרה לתוך cfg, לפני כל פעולה ששומרת או מסדרת */
function collectCfg() {
  $$('#schoolRows .adm-row').forEach((row) => {
    const s = cfg.schools[+row.dataset.i];
    if (!s) return;
    s.name = $('[data-f="name"]', row).value;
    s.city = $('[data-f="city"]', row).value;
    s.active = $('[data-f="active"]', row).checked;
  });
  $$('#catRows .adm-row').forEach((row) => {
    const c = cfg.cats[+row.dataset.i];
    if (!c) return;
    c.name = $('[data-f="name"]', row).value;
    c.group = $('[data-f="group"]', row).value;
    c.hidden = $('[data-f="hidden"]', row).checked;
  });
  cfg.cats.forEach((c, i) => {
    c.order = i;
  });
}

async function saveCfg() {
  const state = $('#cfgState');
  state.textContent = 'שומרת…';
  try {
    const saved = await api('/api/config', { method: 'PUT', body: JSON.stringify(cfg) });
    cfg = { schools: saved.schools, cats: saved.cats };
    await load();
    renderAdmin();
    state.textContent = 'נשמר';
  } catch (e) {
    state.textContent = e.message;
  }
}

$('#saveCfg').addEventListener('click', () => {
  collectCfg();
  saveCfg();
});

$('#addSchool').addEventListener('click', () => {
  collectCfg();
  cfg.schools.push({ id: '', name: 'בית ספר חדש', city: '', active: true });
  renderAdmin();
});

$('#addCat').addEventListener('click', () => {
  collectCfg();
  const name = prompt('שם הקטגוריה החדשה:');
  if (!name) return;
  const slug = 'c' + Date.now().toString(36);
  cfg.cats.push({ slug, name, group: 'event', order: cfg.cats.length, hidden: false, desc: '' });
  renderAdmin();
});

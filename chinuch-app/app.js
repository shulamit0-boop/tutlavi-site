/* עיצובי בית חינוך — הלוגיקה של הדף.
   בלי framework ובלי build: הדף הזה נטען גם ברשת של בית ספר בשעת שיא.

   הזהות: כניסה עם גוגל. הדפדפן מקבל מגוגל ID token ושולח אותו ל-/api/auth,
   והשרת מנפיק עוגיית סשן משלו. הטוקן של גוגל לא נשמר כאן ולא ב-localStorage.

   התצוגות: כל מה שמוצג מגיע מקריאה אחת ל-/api/items. הסינון, החיפוש והמיון
   קורים בדפדפן — בהיקף של מאות עיצובים זה מיידי. רק הרלוונטיות מחושבת
   בשרת, כי היא צריכה את הלוח העברי. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

let D = null; // הנתונים מ-/api/items
let INFO = null; // התשובה מ-/api/auth
let STAFF = null; // הנתונים מ-/api/users
let editing = null;

const ROLE_LABEL = { super: 'ניהול המערכת', principal: 'מנהלת בית ספר', teacher: 'מורה' };

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
  if (!res.ok) {
    const err = new Error((body && body.error) || `שגיאה ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
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
  return Number.isNaN(+d) ? '' : `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};

const schoolName = (id, list) =>
  ((list || (D && D.schools) || (INFO && INFO.schools) || []).find((s) => s.id === id) || {}).name || '';

/* ---------- כניסה עם גוגל ---------- */

let gisLoaded = null;

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error('לא הצלחתי לטעון את הכניסה של גוגל'));
    document.head.appendChild(el);
  });
  return gisLoaded;
}

async function showGate(err) {
  $('#app').hidden = true;
  $('#wait').hidden = true;
  $('#gate').hidden = false;
  $('#gateErr').hidden = !err;
  if (err) $('#gateErr').textContent = err;

  // כשחסרה הגדרה בשרת, עדיף להגיד מה חסר מלהציג כפתור שלא יעבוד
  if (!INFO.clientId || !INFO.ready.session) {
    const missing = [
      !INFO.clientId ? 'GOOGLE_CLIENT_ID' : '',
      !INFO.ready.session ? 'SESSION_SECRET' : '',
      !INFO.ready.store ? 'אחסון הנתונים' : '',
    ].filter(Boolean);
    $('#gateSetup').textContent = 'המערכת עוד לא הוגדרה עד הסוף. חסר: ' + missing.join(', ') + '.';
    $('#gateSetup').hidden = false;
    return;
  }

  try {
    await loadGis();
    /* global google */
    google.accounts.id.initialize({
      client_id: INFO.clientId,
      callback: onGoogle,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    google.accounts.id.renderButton($('#gBtn'), {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      locale: 'he',
      width: 280,
    });
  } catch (e) {
    // הודעה שמורה יכולה לעשות איתה משהו. הנוסח המקורי ("google is not
    // defined") נכון אבל חסר תועלת למי שרק רוצה להיכנס.
    console.error(e);
    $('#gateSetup').textContent =
      'לא הצלחתי לטעון את הכניסה של גוגל. כדאי לרענן את הדף — ואם זה חוזר, לבדוק אם תוסף בדפדפן חוסם את accounts.google.com.';
    $('#gateSetup').hidden = false;
  }
}

async function onGoogle(response) {
  try {
    const out = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ credential: response.credential }),
    });
    INFO = { ...INFO, me: out.me, schools: out.schools || INFO.schools };
    if (out.me.role === 'pending') showWait();
    else await start();
  } catch (e) {
    showGate(e.message);
  }
}

/* ---------- ממתינה לאישור ---------- */

function showWait() {
  $('#app').hidden = true;
  $('#gate').hidden = true;
  $('#wait').hidden = false;
  const me = INFO.me;
  $('#waitWho').textContent = `${me.name || ''} · ${me.email}`;
  $('#waitErr').hidden = true;

  if (me.status === 'declined') {
    $('#waitTitle').textContent = 'הבקשה לא אושרה';
    $('#waitPick').hidden = true;
    $('#waitState').textContent =
      'מנהלת בית הספר לא אישרה את הבקשה. אם זו טעות, כדאי לפנות אליה ישירות.';
    return;
  }

  const schools = INFO.schools || [];
  if (!me.schoolId) {
    $('#waitTitle').textContent = 'עוד צעד אחד';
    $('#waitPick').hidden = false;
    $('#waitSchool').innerHTML =
      '<option value="">— בחירת בית ספר —</option>' +
      schools.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
    $('#waitState').textContent = schools.length
      ? ''
      : 'עדיין לא הוגדרו בתי ספר במערכת. כדאי לפנות למי שמנהלת אותה.';
  } else {
    $('#waitTitle').textContent = 'הבקשה ממתינה לאישור';
    $('#waitPick').hidden = true;
    $('#waitState').textContent = `הבקשה נשלחה למנהלת של ${schoolName(me.schoolId, schools)}. אחרי האישור פשוט להיכנס שוב.`;
  }
}

$('#waitSend').addEventListener('click', async () => {
  const schoolId = $('#waitSchool').value;
  if (!schoolId) {
    $('#waitErr').textContent = 'צריך לבחור בית ספר';
    $('#waitErr').hidden = false;
    return;
  }
  try {
    const out = await api('/api/auth', {
      method: 'POST',
      body: JSON.stringify({ action: 'school', schoolId }),
    });
    INFO = { ...INFO, me: out.me };
    showWait();
    toast('הבקשה נשלחה');
  } catch (e) {
    $('#waitErr').textContent = e.message;
    $('#waitErr').hidden = false;
  }
});

$('#waitRefresh').addEventListener('click', () => boot());
$('#waitOut').addEventListener('click', () => logout());

async function logout() {
  await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }).catch(() => {});
  location.reload();
}
$('#outBtn').addEventListener('click', logout);

/* ---------- טעינה ---------- */

async function load() {
  D = await api('/api/items');
  const me = D.me;
  $('#schoolName').textContent =
    me.role === 'super' ? ROLE_LABEL.super : schoolName(me.schoolId) || ROLE_LABEL[me.role];
  $('#adminBtn').hidden = me.role !== 'super';
  $('#staffBtn').hidden = !(me.role === 'super' || me.role === 'principal');
  $('#footStat').textContent =
    `${D.items.length} עיצובים · ${D.cats.filter((c) => !c.hidden).length} קטגוריות · ` +
    `${me.name || me.email} (${ROLE_LABEL[me.role]})`;
  if (!$('#staffBtn').hidden) refreshPending();
}

/* מונה הבקשות הממתינות מופיע על הכפתור, כדי שמנהלת תראה אותן בלי להיכנס */
async function refreshPending() {
  try {
    STAFF = await api('/api/users');
    const b = $('#pendBadge');
    b.textContent = STAFF.pending || '';
    b.hidden = !STAFF.pending;
  } catch {
    /* לא קריטי */
  }
}

async function start() {
  $('#gate').hidden = true;
  $('#wait').hidden = true;
  $('#app').hidden = false;
  await load();
  route();
}

async function boot() {
  try {
    INFO = await api('/api/auth');
  } catch {
    INFO = { me: null, clientId: '', schools: [], ready: {} };
  }
  if (!INFO.me) return showGate();
  if (INFO.me.role === 'pending') return showWait();
  try {
    await start();
  } catch (e) {
    if (e.status === 403 && e.body && e.body.pending) showWait();
    else showGate(e.message);
  }
}
boot();

/* ---------- ניווט ---------- */

window.addEventListener('hashchange', route);

function route() {
  if (!D) return;
  const h = location.hash || '#/';
  const views = {
    home: $('#viewHome'),
    list: $('#viewList'),
    staff: $('#viewStaff'),
    admin: $('#viewAdmin'),
  };
  for (const v of Object.values(views)) v.hidden = true;
  const staffOk = D.me.role === 'super' || D.me.role === 'principal';

  if (h.startsWith('#/c/')) {
    views.list.hidden = false;
    renderList(decodeURIComponent(h.slice(4)));
  } else if (h === '#/staff' && staffOk) {
    views.staff.hidden = false;
    renderStaff();
  } else if (h === '#/admin' && D.me.role === 'super') {
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
$('#staffBtn').addEventListener('click', () => {
  location.hash = '#/staff';
});

/* ---------- דף הבית ---------- */

const catNames = (slugs) =>
  (slugs || []).map((s) => (D.cats.find((c) => c.slug === s) || {}).name).filter(Boolean);

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
      ${it.schoolId ? `<span>${esc(schoolName(it.schoolId))}</span>` : ''}
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
      ${it.canEdit ? `<button class="btn" type="button" data-edit="${esc(it.id)}">עריכה</button>` : ''}
      ${D.me.role === 'super' ? `<button class="btn" type="button" data-pin="${esc(it.id)}">${it.pinned ? 'ביטול ההצמדה' : 'הצמדה ל״רלוונטי עכשיו״'}</button>` : ''}
      ${it.canEdit ? `<button class="btn danger" type="button" data-del="${esc(it.id)}">מחיקה</button>` : ''}
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
    if (!confirm('למחוק את העיצוב? מנהלת המערכת יכולה לשחזר אותו.')) return;
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
    [D.cats.filter((c) => c.group === 'month' && !c.hidden), 'month'],
    [D.cats.filter((c) => c.group !== 'month' && !c.hidden), 'event'],
  ];
  $('#fCats').innerHTML = groups
    .map(([list, cls]) =>
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

  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
    save.disabled = false;
    prog.textContent = '';
  }

  const title = $('#fTitle').value.trim();
  if (!title) return fail('צריך שם לעיצוב');
  if (!chosenCats.size) return fail('צריך לבחור לפחות קטגוריה אחת');
  const file = $('#fFile').files[0];
  if (formKind === 'link' && !/^https?:\/\//i.test($('#fUrl').value.trim())) {
    return fail('הקישור צריך להתחיל ב-https://');
  }
  if (formKind === 'file' && !editing && !file) return fail('צריך לבחור קובץ');
  if (file && file.size > 50 * 1024 * 1024) return fail('הקובץ גדול מ-50MB');

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
      /אחסון הקבצים/.test(e2.message)
        ? 'אחסון הקבצים עוד לא הוקם ב-Vercel. בינתיים אפשר להוסיף קישור Canva.'
        : e2.message
    );
  } finally {
    save.disabled = false;
    prog.textContent = '';
  }
});

/* ---------- המורות ---------- */

const STATUS_LABEL = { active: 'מאושרת', pending: 'ממתינה', declined: 'נדחתה', removed: 'הוסרה' };

async function renderStaff() {
  STAFF = await api('/api/users');
  const isSuper = STAFF.me.role === 'super';
  const users = STAFF.users;
  const pend = users.filter((u) => u.status === 'pending');

  $('#pendCount').textContent = pend.length || '';
  $('#pendCount').hidden = !pend.length;
  $('#pendRows').innerHTML = pend.length
    ? pend
        .map(
          (u) => `
      <div class="adm-row">
        <span class="who"><b>${esc(u.name || u.email)}</b><em>${esc(u.email)}</em></span>
        <span class="muted">${esc(schoolName(u.schoolId, STAFF.schools) || 'לא בחרה בית ספר')}</span>
        <span class="muted">${esc(dateLabel(u.requestedAt))}</span>
        <button class="btn tiny primary" type="button" data-act="approve" data-email="${esc(u.email)}">אישור</button>
        <button class="btn tiny danger" type="button" data-act="decline" data-email="${esc(u.email)}">דחייה</button>
      </div>`
        )
        .join('')
    : '<p class="panel-note">אין בקשות ממתינות.</p>';

  const active = users.filter((u) => u.status === 'active');
  $('#userRows').innerHTML = active.length
    ? active
        .map(
          (u) => `
      <div class="adm-row">
        <span class="who"><b>${esc(u.name || u.email)}</b><em>${esc(u.email)}</em></span>
        <span class="muted">${esc(schoolName(u.schoolId, STAFF.schools))}</span>
        <span class="muted">${u.lastLoginAt ? 'כניסה אחרונה ' + esc(dateLabel(u.lastLoginAt)) : 'עוד לא נכנסה'}</span>
        ${
          isSuper && u.role !== 'super'
            ? `<select data-role="${esc(u.email)}">
                 <option value="teacher"${u.role === 'teacher' ? ' selected' : ''}>מורה</option>
                 <option value="principal"${u.role === 'principal' ? ' selected' : ''}>מנהלת בית ספר</option>
               </select>
               <select data-school="${esc(u.email)}">
                 <option value="">— בית ספר —</option>
                 ${STAFF.schools.map((s) => `<option value="${esc(s.id)}"${u.schoolId === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
               </select>`
            : `<span class="role-pill">${esc(ROLE_LABEL[u.role] || '')}</span>`
        }
        ${
          u.role === 'super' || u.email === STAFF.me.email
            ? ''
            : `<button class="btn tiny danger" type="button" data-act="remove" data-email="${esc(u.email)}">הסרה</button>`
        }
      </div>`
        )
        .join('')
    : '<p class="panel-note">אין עוד מורות מאושרות.</p>';

  const inv = $('#invSchool');
  inv.hidden = !isSuper;
  if (isSuper) {
    inv.innerHTML =
      '<option value="">— בית ספר —</option>' +
      STAFF.schools.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  }
}

$('#viewStaff').addEventListener('click', async (e) => {
  const t = e.target;
  if (!t.dataset.act) return;
  if (t.dataset.act === 'remove' && !confirm('להסיר את ההרשאה? היא לא תוכל להיכנס יותר.')) return;
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({ action: t.dataset.act, email: t.dataset.email }),
    });
    await renderStaff();
    await load();
    toast('עודכן');
  } catch (err) {
    toast(err.message);
  }
});

$('#viewStaff').addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.dataset.role) {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'setRole', email: t.dataset.role, role: t.value }),
      });
      toast('התפקיד עודכן');
    } else if (t.dataset.school) {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'setSchool', email: t.dataset.school, schoolId: t.value }),
      });
      toast('בית הספר עודכן');
    } else return;
    await renderStaff();
  } catch (err) {
    toast(err.message);
    renderStaff();
  }
});

$('#invBtn').addEventListener('click', async () => {
  const err = $('#invErr');
  err.hidden = true;
  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        action: 'invite',
        email: $('#invEmail').value.trim(),
        name: $('#invName').value.trim(),
        schoolId: $('#invSchool').value,
      }),
    });
    $('#invEmail').value = '';
    $('#invName').value = '';
    await renderStaff();
    toast('המורה הוזמנה — הכניסה הראשונה שלה עם גוגל תעבוד ישר');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
});

/* ---------- ניהול המערכת ---------- */

let cfg = null;

async function renderAdmin() {
  if (!cfg) cfg = await api('/api/config');

  $('#schoolRows').innerHTML = cfg.schools.length
    ? cfg.schools
        .map(
          (s, i) => `
      <div class="adm-row" data-i="${i}">
        <input type="text" value="${esc(s.name)}" data-f="name" placeholder="שם בית הספר">
        <input type="text" value="${esc(s.city)}" data-f="city" placeholder="עיר">
        <input type="text" value="${esc(s.domain || '')}" data-f="domain" placeholder="דומיין גוגל (לא חובה)">
        <label><input type="checkbox" data-f="active" ${s.active === false ? '' : 'checked'}> פעיל</label>
      </div>`
        )
        .join('')
    : '<p class="panel-note">עוד לא הוגדרו בתי ספר. מוסיפים כאן את הראשון.</p>';

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
    s.domain = $('[data-f="domain"]', row).value;
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
  cfg.schools.push({ id: '', name: 'בית ספר חדש', city: '', domain: '', active: true });
  renderAdmin();
});

$('#addCat').addEventListener('click', () => {
  collectCfg();
  const name = prompt('שם הקטגוריה החדשה:');
  if (!name) return;
  cfg.cats.push({
    slug: 'c' + Date.now().toString(36),
    name,
    group: 'event',
    order: cfg.cats.length,
    hidden: false,
    desc: '',
  });
  renderAdmin();
});

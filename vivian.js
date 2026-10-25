/* ============================================================
   ויויאן — the bar page. Deliberately its own small script: the
   home page's script.js is built around the rental modal and the
   availability calendar, none of which exists here.
   ============================================================ */
document.documentElement.classList.add('js');

/* ---------- scroll reveal ---------- */
const revealEls = [...document.querySelectorAll('.reveal')];
const showReveal = (el) => el.classList.add('in-view');

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { showReveal(e.target); io.unobserve(e.target); } });
  }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
  revealEls.forEach(el => io.observe(el));
  revealEls.forEach(el => { if (el.getBoundingClientRect().top < window.innerHeight) showReveal(el); });
} else {
  revealEls.forEach(showReveal);
}

/* ---------- menu drawer ---------- */
const menuOverlay = document.getElementById('menuOverlay');
const menuBtn = document.getElementById('menuBtn');
const menuClose = document.getElementById('menuClose');
const menuScrim = document.getElementById('menuScrim');

function openMenu() {
  menuOverlay.classList.add('open');
  menuOverlay.setAttribute('aria-hidden', 'false');
  menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open', 'modal-open');
}
function closeMenu() {
  menuOverlay.classList.remove('open');
  menuOverlay.setAttribute('aria-hidden', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open', 'modal-open');
}
menuBtn.addEventListener('click', () => menuOverlay.classList.contains('open') ? closeMenu() : openMenu());
menuClose.addEventListener('click', closeMenu);
menuScrim?.addEventListener('click', closeMenu);
menuOverlay.querySelectorAll('.menu-item[href]').forEach(a => a.addEventListener('click', closeMenu));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOverlay.classList.contains('open')) closeMenu(); });

/* ---------- editable texts (managed at /admin → "תוכן האתר") ----------
   Same store as the home page, its own keys. An empty or missing value leaves
   the text that is written in the HTML — so the page never renders blank. */
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

fetch('/api/content')
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null)
  .then(c => {
    const t = (c && c.texts) || {};
    document.querySelectorAll('[data-edit]').forEach(el => {
      const v = t[el.dataset.edit];
      if (typeof v !== 'string' || !v.trim()) return;
      el.innerHTML = escHtml(v.trim()).replace(/\n/g, '<br>') +
        (el.hasAttribute('data-dot') ? '<span class="dot">.</span>' : '');
    });
    renderVivianEvents(c && c.events);
  });

/* ---------- events from the studio schedule ----------
   An event in /admin → "אירועים" with "להציג גם בעמוד ויויאן" switched on shows
   up here too. None flagged → the pop-up written in the texts stays as it is. */
const VIV_WA = 'https://wa.me/972547316782?text=';

function parseDate(d) {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(d || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// day of month in Hebrew letters: 21 → כ״א, 15 → ט״ו
function hebDay(n) {
  if (n === 15) return 'ט״ו';
  if (n === 16) return 'ט״ז';
  const s = (n >= 10 ? 'יכל'[Math.floor(n / 10) - 1] : '') + (n % 10 ? 'אבגדהוזחט'[n % 10 - 1] : '');
  return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
}

function hebDate(dt) {
  try {
    const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).formatToParts(dt);
    const day = +parts.find(p => p.type === 'day').value;
    const month = parts.find(p => p.type === 'month').value;
    return hebDay(day) + ' ב' + month.replace(/^ב/, '');
  } catch { return ''; }
}

function renderVivianEvents(events) {
  const wrap = document.getElementById('vivEvents');
  if (!wrap || !Array.isArray(events)) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const list = events.filter(ev => {
    if (!ev || ev.vivian !== true || ev.hidden === true) return false;
    const dt = parseDate(ev.date);
    return !dt || dt >= today;
  });
  if (!list.length) return;
  wrap.innerHTML = list.map(ev => {
    const dt = parseDate(ev.date);
    const shortDate = dt
      ? String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0')
      : (ev.date || '');
    const msg = 'היי ויויאן! אני רוצה לשמור מקום ל' + (ev.name || 'פופ-אפ הקרוב') + (shortDate ? ' (' + shortDate + ')' : '');
    return '<div class="popup-row reveal in-view">' +
      '<div class="popup-when">' +
        '<span class="popup-date" dir="ltr">' + escHtml(shortDate) + '</span>' +
        (dt ? '<span class="popup-heb">' + escHtml(hebDate(dt)) + '</span>' : '') +
      '</div>' +
      '<div class="popup-what">' +
        '<span class="popup-name">' + escHtml(ev.name || '') + '</span>' +
        (ev.desc ? '<span class="popup-note">' + escHtml(ev.desc) + '</span>' : '') +
      '</div>' +
      '<a class="popup-cta" href="' + VIV_WA + encodeURIComponent(msg) + '" target="_blank" rel="noopener">שמרו לי מקום&nbsp;<span dir="ltr" aria-hidden="true">←</span></a>' +
    '</div>';
  }).join('');
}

/* ---------- updates sign-up ---------- */
const VIV_ENDPOINT = 'https://formsubmit.co/ajax/vivian.office.info@gmail.com';
const vivForm = document.getElementById('vivForm');
const vivName = document.getElementById('viv-name');
const vivPhone = document.getElementById('viv-phone');
const vivSubmit = document.getElementById('vivSubmit');
const vivStatus = document.getElementById('vivStatus');

function syncVivSubmit() {
  vivSubmit.disabled = !(vivName.value.trim() && vivPhone.value.trim());
}
[vivName, vivPhone].forEach(el => el.addEventListener('input', syncVivSubmit));
syncVivSubmit();

vivForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (vivSubmit.disabled) return;
  vivStatus.className = 'form-status';
  vivStatus.textContent = 'שולח…';
  vivSubmit.disabled = true;

  const p = Object.fromEntries(new FormData(vivForm).entries());
  fetch(VIV_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      _subject: 'הרשמה לעדכוני ויויאן · ' + (p.name || ''),
      _template: 'box',
      _captcha: 'false',
      _honey: p._honey || '',
      'שם': p.name || '',
      'טלפון': p.phone || '',
      'מאיפה': 'עמוד ויויאן',
    }),
  })
    .then(r => r.json())
    .then(d => {
      if (String(d.success) !== 'true') throw new Error(d.message || 'failed');
      vivStatus.className = 'form-status ok';
      vivStatus.textContent = 'נרשמתם. נעדכן אתכם בוואטסאפ לפני כולם.';
      vivForm.reset();
      syncVivSubmit();
    })
    .catch(() => {
      vivStatus.className = 'form-status err';
      vivStatus.textContent = 'לא הצלחנו לשלוח. אפשר פשוט לכתוב לוואטסאפ 054-731-6782.';
      vivSubmit.disabled = false;
    });
});

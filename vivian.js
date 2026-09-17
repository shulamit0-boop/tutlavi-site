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
  });

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

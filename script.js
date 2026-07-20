/* ============================================================
   STUDIO TUTLAVI — front-end reproduction of the Base44 "HomeAlt"
   page (normal vertical scroll) + the original rental / signing
   / calendar system preserved intact.
   ============================================================ */

document.documentElement.classList.add('js');

const STUDIO_VIDEO = '/media/studio.mp4';

/* ---------- videos: inject source + autoplay ----------
   Initialized after /api/content resolves (or after a short timeout) so a
   custom uploaded video doesn't cause the default one to download too. */
let videosInited = false;
function initVideos(overrideSrc) {
  videosInited = true;
  document.querySelectorAll('video').forEach(video => {
    const src = overrideSrc || video.dataset.videoSrc || STUDIO_VIDEO;
    const source = video.querySelector('source');
    if (source) {
      if (source.getAttribute('src') === src) return;
      source.setAttribute('src', src); source.setAttribute('type', 'video/mp4');
    } else {
      if (video.getAttribute('src') === src) return;
      video.setAttribute('src', src);
    }
    video.muted = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('loop', 'true');
    video.setAttribute('autoplay', 'true');
    video.load();
    const tryPlay = () => video.play().catch(() => {});
    tryPlay();
    video.addEventListener('canplay', tryPlay, { once: true });
  });
}
setTimeout(() => { if (!videosInited) initVideos(null); }, 2500);

/* deferred init can leave autoplay stuck in some browsers — kick paused
   autoplay videos on the first interaction / tab focus */
function kickVideos() {
  document.querySelectorAll('video[autoplay]').forEach(v => { if (v.paused) v.play().catch(() => {}); });
}
window.addEventListener('scroll', kickVideos, { once: true, passive: true });
window.addEventListener('pointerdown', kickVideos, { once: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickVideos(); });

/* ---------- editable site content (managed at /admin → "תוכן האתר") ----------
   Overrides stored in KV under the `content` key. Empty/missing value = the
   built-in text in this HTML stays as-is. events: null = defaults, [] = hide. */
const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

fetch('/api/content')
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null)
  .then(c => {
    try { applySiteContent(c); } catch { /* never break the page */ }
    const t = (c && c.texts) || {};
    const vid = typeof t.splitVideo === 'string' && t.splitVideo.trim() ? t.splitVideo.trim() : null;
    if (!videosInited || vid) initVideos(vid);
  });

function applySiteContent(c) {
  if (!c) return;
  const t = c.texts || {};
  const has = (k) => typeof t[k] === 'string' && t[k].trim() !== '';

  document.querySelectorAll('[data-edit]').forEach(el => {
    const k = el.dataset.edit;
    if (!has(k)) return;
    el.innerHTML = escHtml(t[k].trim()).replace(/\n/g, '<br>') +
      (el.hasAttribute('data-dot') ? '<span class="dot">.</span>' : '');
  });

  if (has('contactEmail')) {
    const email = t.contactEmail.trim();
    document.querySelectorAll('a[data-email]').forEach(a => {
      a.href = 'mailto:' + email;
      (a.querySelector('span[dir]') || a).textContent = email;
    });
  }
  if (has('contactPhone')) {
    const phone = t.contactPhone.trim();
    const digits = phone.replace(/[^\d+]/g, '');
    document.querySelectorAll('a[data-phone]').forEach(a => {
      a.href = 'tel:' + (digits.startsWith('0') ? '+972' + digits.slice(1) : digits);
      (a.querySelector('span[dir]') || a).textContent = phone;
    });
  }
  if (has('contactInstagram')) {
    const handle = t.contactInstagram.trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
      .replace(/^@/, '')
      .replace(/\/+$/, '');
    document.querySelectorAll('a[data-insta]').forEach(a => {
      a.href = 'https://www.instagram.com/' + handle;
      (a.querySelector('span[dir]') || a).textContent = '@' + handle;
    });
  }
  if (has('heroImage')) {
    const bg = document.querySelector('.hero-bg');
    if (bg) {
      bg.style.backgroundImage =
        'linear-gradient(rgba(255,255,255,.12), rgba(255,255,255,.28)), url("' + t.heroImage.trim() + '")';
    }
  }
  if (has('footerStudio')) {
    const col = document.getElementById('footerStudioCol');
    if (col) {
      col.querySelectorAll('.footer-static').forEach(s => s.remove());
      t.footerStudio.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
        const s = document.createElement('span');
        s.className = 'footer-static';
        s.textContent = line;
        col.appendChild(s);
      });
    }
  }

  if (Array.isArray(c.events)) {
    const section = document.getElementById('schedule');
    const list = document.getElementById('schedList');
    if (!c.events.length) {
      if (section) section.style.display = 'none';
    } else if (list) {
      list.innerHTML = c.events.map(ev => {
        const hot = ev.hot ? ' on' : '';
        return '<li class="sched-row reveal in-view">' +
          '<span class="sched-flag' + hot + '"></span>' +
          '<span class="sched-date" dir="ltr">' + escHtml(ev.date || '') + '</span>' +
          '<span class="sched-main">' +
            '<span class="sched-name">' + escHtml(ev.name || '') + '</span>' +
            (ev.desc ? '<span class="sched-desc">' + escHtml(ev.desc) + '</span>' : '') +
          '</span>' +
          '<span class="sched-cat">' + escHtml(ev.cat || '') + '</span>' +
          '<span class="sched-status' + hot + '">' + escHtml(ev.status || '') + '</span>' +
        '</li>';
      }).join('');
      const count = document.getElementById('schedCount');
      if (count) count.textContent = c.events.length === 1 ? 'אירוע קרוב אחד' : c.events.length + ' אירועים קרובים';
    }
  }
}

/* ---------- scroll reveal ---------- */
const revealEls = [...document.querySelectorAll('.reveal')];
const showReveal = (el) => el.classList.add('in-view');

if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { showReveal(e.target); revealObserver.unobserve(e.target); }
    });
  }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
  revealEls.forEach(el => revealObserver.observe(el));
  // reveal anything already within the first viewport immediately
  revealEls.forEach(el => { if (el.getBoundingClientRect().top < window.innerHeight) showReveal(el); });
} else {
  // no IO support → just show everything
  revealEls.forEach(showReveal);
}

/* ---------- header state (scrolled + on-dark over the black section) ---------- */
const header = document.getElementById('siteHeader');
const aboutSection = document.getElementById('about');
const playBtn = document.getElementById('playBtn');
const introSection = document.getElementById('intro');

function onScroll() {
  const y = window.scrollY;
  header.classList.toggle('scrolled', y > 40);

  // header turns light while the black "about" band sits under it
  if (aboutSection) {
    const r = aboutSection.getBoundingClientRect();
    header.classList.toggle('on-dark', r.top <= 80 && r.bottom >= 80);
  }

  // floating play button hides once we scroll past the split section
  if (playBtn && introSection) {
    const pastSplit = introSection.getBoundingClientRect().bottom < window.innerHeight * 0.4;
    playBtn.classList.toggle('hide', pastSplit || document.body.classList.contains('menu-open'));
  }
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- full-screen menu overlay ---------- */
const menuOverlay = document.getElementById('menuOverlay');
const menuBtn = document.getElementById('menuBtn');
const menuClose = document.getElementById('menuClose');

function openMenu() {
  menuOverlay.classList.add('open');
  menuOverlay.setAttribute('aria-hidden', 'false');
  menuBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('menu-open', 'modal-open');
  if (playBtn) playBtn.classList.add('hide');
}
function closeMenu() {
  menuOverlay.classList.remove('open');
  menuOverlay.setAttribute('aria-hidden', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('menu-open');
  if (!document.getElementById('inquiryModal').classList.contains('open')) {
    document.body.classList.remove('modal-open');
  }
  onScroll();
}
menuBtn.addEventListener('click', () => menuOverlay.classList.contains('open') ? closeMenu() : openMenu());
if (playBtn) playBtn.addEventListener('click', openMenu);
menuClose.addEventListener('click', closeMenu);
menuOverlay.querySelectorAll('.menu-item[href]').forEach(a => a.addEventListener('click', closeMenu));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOverlay.classList.contains('open')) closeMenu(); });

/* ============================================================
   RENTAL / COLLABORATION SYSTEM  (calendar · signing · contract)
   Preserved from the original site.
   ============================================================ */

const inquiryModal = document.getElementById('inquiryModal');
const inquiryForm = document.getElementById('inquiryForm');
const rentalFields = document.getElementById('rentalFields');
const rentalInputs = rentalFields.querySelectorAll('input');
const formStatus = document.getElementById('formStatus');
const typeRadios = inquiryForm.querySelectorAll('input[name="type"]');

function setRentalVisible(show) {
  rentalFields.hidden = !show;
  rentalInputs.forEach(inp => { inp.required = false; });
  const agree = document.getElementById('f-agree');
  if (agree) agree.required = show;
  if (show) loadAvailability();
}

/* ---------- availability calendar (managed at /admin) ---------- */
let availability = null;
let fcalView = null;
let selectedDate = null;
const availChips = document.getElementById('availChips');
const availStatus = document.getElementById('availStatus');
const dateInput = document.getElementById('f-date');
const startSel = document.getElementById('f-start');
const endSel = document.getElementById('f-end');
const windowIdInput = document.getElementById('f-window-id');
const fcalGrid = document.getElementById('fcalGrid');
const fcalLabel = document.getElementById('fcalLabel');

(function fillTimeSelects() {
  if (!startSel) return;
  const opts = ['<option value="">--:--</option>'];
  for (let h = 8; h < 24; h++) {
    for (const m of ['00', '30']) {
      const t = String(h).padStart(2, '0') + ':' + m;
      opts.push('<option>' + t + '</option>');
    }
  }
  startSel.innerHTML = opts.join('');
  endSel.innerHTML = opts.join('');
})();

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DOW = ['א','ב','ג','ד','ה','ו','ש'];
const isoOf = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

async function loadAvailability(force) {
  if (availability && !force) { renderFcal(); return; }
  try {
    const res = await fetch('/api/availability');
    availability = await res.json();
  } catch {
    availability = { locked: [], windows: [] };
  }
  if (!fcalView) { fcalView = new Date(); fcalView.setDate(1); }
  renderFcal();
}

function dayWindows(dIso) {
  return (availability.windows || []).filter(w => w.date === dIso);
}

function renderFcal() {
  if (!fcalGrid || !availability || !fcalView) return;
  fcalLabel.textContent = HE_MONTHS[fcalView.getMonth()] + ' ' + fcalView.getFullYear();
  fcalGrid.innerHTML = '';
  HE_DOW.forEach(d => {
    const el = document.createElement('span');
    el.className = 'fcal-dow';
    el.textContent = d;
    fcalGrid.appendChild(el);
  });
  const gridStart = new Date(fcalView);
  gridStart.setDate(1 - fcalView.getDay());
  const todayIso = isoOf(new Date());

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dIso = isoOf(d);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fcal-day';
    btn.textContent = d.getDate();
    if (d.getMonth() !== fcalView.getMonth()) btn.classList.add('out');
    if (dIso < todayIso) btn.classList.add('past');
    const wins = dayWindows(dIso);
    const openWins = wins.filter(w => !w.booked);
    const isLocked = (availability.locked || []).includes(dIso);
    if (isLocked) btn.classList.add('locked');
    else if (openWins.length) btn.classList.add('open');
    else if (wins.length) btn.classList.add('booked');
    if (dIso === selectedDate) btn.classList.add('sel');
    const disabled = isLocked || dIso < todayIso;
    btn.disabled = disabled;
    if (!disabled) btn.addEventListener('click', () => selectDay(dIso));
    fcalGrid.appendChild(btn);
  }
}

function selectDay(dIso) {
  selectedDate = dIso;
  dateInput.value = dIso;
  windowIdInput.value = '';
  renderFcal();
  const wins = dayWindows(dIso);
  const open = wins.filter(w => !w.booked).sort((a, b) => a.start.localeCompare(b.start));
  availChips.innerHTML = '';
  if (open.length) {
    open.forEach(w => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'avail-chip';
      chip.innerHTML = '<span dir="ltr">' + w.start + '–' + w.end + '</span>' +
        (w.price ? ' · ₪' + w.price.toLocaleString() : '') +
        (w.note ? ' · ' + w.note : '');
      chip.addEventListener('click', () => {
        startSel.value = w.start;
        endSel.value = w.end;
        windowIdInput.value = w.id;
        availChips.querySelectorAll('.avail-chip').forEach(c => c.classList.remove('picked'));
        chip.classList.add('picked');
        const costLine = document.getElementById('costLine');
        const costField = document.getElementById('f-cost');
        if (w.price) {
          costField.value = '₪' + w.price.toLocaleString();
          document.getElementById('costVal').textContent = '₪' + w.price.toLocaleString();
          costLine.hidden = false;
        } else {
          costField.value = '';
          costLine.hidden = true;
        }
        availStatus.textContent = 'נבחר: ' + fmtHe(dIso) + ' · ' + w.start + '–' + w.end +
          (w.price ? ' · ₪' + w.price.toLocaleString() : '') + ' — החלון יישמר עבורכם עם השליחה.';
        availStatus.className = 'avail-status ok';
        refreshContractLink();
      });
      availChips.appendChild(chip);
    });
    availStatus.textContent = 'בחרו חלון שעות פנוי:';
    availStatus.className = 'avail-status';
  } else if (wins.length) {
    availStatus.textContent = 'כל החלונות בתאריך זה תפוסים — בחרו יום אחר.';
    availStatus.className = 'avail-status err';
  } else {
    availStatus.textContent = fmtHe(dIso) + ' — אין חלון מוגדר; בחרו שעות מבוקשות ושלחו, ונחזור אליכם.';
    availStatus.className = 'avail-status';
  }
  refreshContractLink();
}

function fmtHe(isoDate) {
  return new Date(isoDate + 'T00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

document.getElementById('fcalPrev')?.addEventListener('click', () => { fcalView.setMonth(fcalView.getMonth() - 1); renderFcal(); });
document.getElementById('fcalNext')?.addEventListener('click', () => { fcalView.setMonth(fcalView.getMonth() + 1); renderFcal(); });

async function reserveWindow() {
  if (!windowIdInput.value || !dateInput.value) return true;
  try {
    const res = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reserve', id: windowIdInput.value, date: dateInput.value }),
    });
    if (res.status === 409) return 'taken';
    return res.ok;
  } catch {
    return true;
  }
}

/* ---------- contract preview link mirrors the form live ---------- */
function contractParams() {
  const p = new URLSearchParams();
  const set = (k, v) => { if (v) p.set(k, v); };
  set('name', document.getElementById('f-name').value.trim());
  set('idnum', document.getElementById('f-idnum').value.trim());
  set('date', dateInput.value);
  set('start', startSel.value);
  set('end', endSel.value);
  set('purpose', document.getElementById('f-purpose').value);
  set('participants', document.getElementById('f-participants').value);
  set('price', document.getElementById('f-cost').value);
  return p;
}

function refreshContractLink() {
  const link = document.getElementById('contractLink');
  if (!link) return;
  const p = contractParams();
  link.href = '/contract' + (p.toString() ? '?' + p.toString() : '');
}

['f-name', 'f-idnum', 'f-purpose', 'f-participants'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', refreshContractLink);
  document.getElementById(id)?.addEventListener('change', refreshContractLink);
});
startSel?.addEventListener('change', refreshContractLink);
endSel?.addEventListener('change', refreshContractLink);

/* ---------- signature pad ---------- */
const sigPad = document.getElementById('sigPad');
const sigCtx = sigPad.getContext('2d');
let sigDrawn = false;
let drawing = false;

function sigInit() {
  sigCtx.fillStyle = '#ffffff';
  sigCtx.fillRect(0, 0, sigPad.width, sigPad.height);
  sigCtx.strokeStyle = '#000000';
  sigCtx.lineWidth = 2;
  sigCtx.lineCap = 'round';
  sigCtx.lineJoin = 'round';
  sigDrawn = false;
}
sigInit();

function sigPos(e) {
  const r = sigPad.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return [
    (t.clientX - r.left) * (sigPad.width / r.width),
    (t.clientY - r.top) * (sigPad.height / r.height),
  ];
}

function sigStart(e) { e.preventDefault(); drawing = true; const [x, y] = sigPos(e); sigCtx.beginPath(); sigCtx.moveTo(x, y); }
function sigMove(e) { if (!drawing) return; e.preventDefault(); const [x, y] = sigPos(e); sigCtx.lineTo(x, y); sigCtx.stroke(); sigDrawn = true; }
function sigEnd() { drawing = false; }

sigPad.addEventListener('mousedown', sigStart);
sigPad.addEventListener('mousemove', sigMove);
window.addEventListener('mouseup', sigEnd);
sigPad.addEventListener('touchstart', sigStart, { passive: false });
sigPad.addEventListener('touchmove', sigMove, { passive: false });
sigPad.addEventListener('touchend', sigEnd);
document.getElementById('sigClear').addEventListener('click', sigInit);

async function createBooking(payload) {
  try {
    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        signature: sigPad.toDataURL('image/png'),
        data: {
          name: payload.name,
          idnum: payload['id-number'],
          email: payload.email,
          phone: payload.phone,
          date: payload['event-date'],
          start: payload['event-start'],
          end: payload['event-end'],
          purpose: payload['event-purpose'],
          participants: payload.participants,
          price: payload['estimated-cost'],
          message: payload.message,
        },
      }),
    });
    const data = await res.json();
    return data.ok ? data.id : null;
  } catch {
    return null;
  }
}

/* ---------- modal open/close ---------- */
function openInquiry(mode) {
  if (menuOverlay.classList.contains('open')) closeMenu();
  if (mode === 'rental') {
    inquiryForm.querySelector('input[value="השכרת חלל"]').checked = true;
    setRentalVisible(true);
  }
  inquiryModal.classList.add('open');
  inquiryModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => inquiryForm.querySelector('#f-name').focus(), 300);
}
function closeInquiry() {
  inquiryModal.classList.remove('open');
  inquiryModal.setAttribute('aria-hidden', 'true');
  if (!document.body.classList.contains('menu-open')) document.body.classList.remove('modal-open');
}
document.querySelectorAll('[data-open-inquiry]').forEach(btn => {
  btn.addEventListener('click', () => openInquiry(btn.getAttribute('data-open-inquiry')));
});
document.querySelectorAll('[data-close-inquiry]').forEach(el => el.addEventListener('click', closeInquiry));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && inquiryModal.classList.contains('open')) closeInquiry(); });

typeRadios.forEach(r => {
  r.addEventListener('change', () => setRentalVisible(r.value === 'השכרת חלל' && r.checked));
});

/* ---------- inquiry submit → FormSubmit + booking + reservation ---------- */
const FORM_ENDPOINT = 'https://formsubmit.co/ajax/vivian.office.info@gmail.com';

inquiryForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!rentalFields.hidden && availability && dateInput.value && availability.locked.includes(dateInput.value)) {
    formStatus.className = 'form-status err';
    formStatus.textContent = 'התאריך שנבחר נעול — בחרו תאריך אחר.';
    return;
  }
  const submitBtn = inquiryForm.querySelector('.modal-submit');
  formStatus.className = 'form-status';
  formStatus.textContent = 'שולח…';
  submitBtn.disabled = true;

  const payload = Object.fromEntries(new FormData(inquiryForm).entries());
  const isRental = !rentalFields.hidden;

  if (isRental && !sigDrawn) {
    document.getElementById('sigStatus').textContent = 'נדרשת חתימה — ציירו את חתימתכם במסגרת.';
    document.getElementById('sigStatus').className = 'avail-status err';
    formStatus.textContent = '';
    submitBtn.disabled = false;
    sigPad.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  (async () => {
    let contractUrl = 'https://tutlavi.com/contract';
    if (isRental) {
      const bid = await createBooking(payload);
      if (bid) {
        contractUrl = 'https://tutlavi.com/contract?bid=' + bid;
        payload['signed-contract'] = contractUrl;
      }
      payload['event-hours'] = (payload['event-start'] || '') +
        (payload['event-end'] ? '-' + payload['event-end'] : '');
      payload._autoresponse =
        'תודה על פנייתך לסטודיו תות!\n\n' +
        'סיכום הבקשה:\n' +
        'תאריך: ' + (payload['event-date'] || '') + '\n' +
        (payload['event-hours'] ? 'שעות: ' + payload['event-hours'] + '\n' : '') +
        (payload['event-purpose'] ? 'מטרה: ' + payload['event-purpose'] + '\n' : '') +
        (payload.participants ? 'משתתפים: ' + payload.participants + '\n' : '') +
        (payload['estimated-cost'] ? 'עלות: ' + payload['estimated-cost'] + '\n' : '') +
        '\nהחוזה החתום שלכם: ' + contractUrl + '\n' +
        'החוזה הועבר לחתימת סטודיו תות; עותק נגיש בקישור בכל עת.\n\n' +
        'התשלום מתבצע בהעברה בנקאית — פרטי החשבון יישלחו עם אישור ההזמנה.\n' +
        (payload['window-id'] ? 'החלון שבחרתם נשמר עבורכם וממתין לאישורנו.\n' : '') +
        '\nסטודיו תות · מגן אברהם 6, תל אביב · 054-312-9933';
    }

    const res = await fetch(FORM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (String(data.success) !== 'true') throw new Error(data.message || 'failed');

    const reserved = await reserveWindow();
    formStatus.className = 'form-status ok';
    formStatus.textContent = reserved === 'taken'
      ? 'הפנייה נשלחה! שימו לב: החלון בדיוק נתפס על ידי מישהו אחר — נחזור אליכם לתיאום.'
      : (isRental
          ? 'תודה! החוזה נחתם והועבר לחתימת סטודיו תות. עותק נשלח למייל שלכם.'
          : 'תודה! הפנייה נשלחה, נחזור אליכם בהקדם.');
    inquiryForm.reset();
    sigInit();
    selectedDate = null;
    availChips.innerHTML = '';
    document.getElementById('costLine').hidden = true;
    setRentalVisible(false);
    loadAvailability(true);
  })()
    .catch(() => {
      formStatus.className = 'form-status err';
      formStatus.textContent = 'משהו השתבש. נסו שוב או כתבו ל-vivian.office.info@gmail.com';
    })
    .finally(() => { submitBtn.disabled = false; });
});

/* ---------- on-page contact form → FormSubmit ---------- */
const contactForm = document.getElementById('contactForm');
const cfStatus = document.getElementById('cfStatus');
contactForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = contactForm.querySelector('.btn-send');
  cfStatus.className = 'cf-status';
  cfStatus.textContent = 'שולח…';
  btn.disabled = true;
  const payload = Object.fromEntries(new FormData(contactForm).entries());
  fetch(FORM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(r => r.json())
    .then(data => {
      if (String(data.success) !== 'true') throw new Error();
      cfStatus.className = 'cf-status ok';
      cfStatus.textContent = 'תודה! ההודעה נשלחה, נחזור אליכם בהקדם.';
      contactForm.reset();
    })
    .catch(() => {
      cfStatus.className = 'cf-status err';
      cfStatus.textContent = 'משהו השתבש. נסו שוב או כתבו ל-vivian.office.info@gmail.com';
    })
    .finally(() => { btn.disabled = false; });
});

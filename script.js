/* ============================================================
   Slide engine — a faithful port of the reference site's
   home-page scroll: fixed full-screen sections, one step per
   wheel gesture, clip-path curtain wipes (.6s power2.inOut).
   Falls back to native scrolling on mobile / reduced motion.
   ============================================================ */

const WIPE_MS = 600;
const WIPE_EASE = 'cubic-bezier(.45, 0, .55, 1)';

const slides = [...document.querySelectorAll('.slide')];
const navLinks = [...document.querySelectorAll('.main-nav a')];
const slideNow = document.getElementById('slideNow');
const slideTotal = document.getElementById('slideTotal');

const isSlideshow = () =>
  window.matchMedia('(min-width: 981px)').matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let current = 0;
let animating = false;
let wheelAccum = 0;
let engineOn = false;

if (slideTotal) slideTotal.textContent = String(slides.length).padStart(2, '0');

/* ---------- per-slide content ---------- */

function playSlideVideos(slide, play) {
  slide.querySelectorAll('video').forEach(v => {
    if (play) v.play().catch(() => {});
    else v.pause();
  });
}

function revealSlide(slide) {
  slide.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.transitionDelay = (0.25 + i * 0.09).toFixed(2) + 's';
    el.classList.add('in-view');
  });
}

function unrevealSlide(slide) {
  slide.querySelectorAll('.reveal').forEach(el => {
    el.style.transitionDelay = '0s';
    el.classList.remove('in-view');
  });
}

function markActive(index) {
  navLinks.forEach(l => l.classList.toggle('active', +l.dataset.slide === index));
  if (slideNow) slideNow.textContent = String(index + 1).padStart(2, '0');
  document.body.classList.toggle('slide-footer-active', slides[index].classList.contains('slide-footer'));
  const id = slides[index].id;
  if (id) history.replaceState(null, '', '#' + id);
}

/* ---------- the curtain wipe (ported from the reference) ---------- */

function setStyles(el, styles) {
  Object.assign(el.style, styles);
}

function goTo(target, dir) {
  if (animating || target === current || target < 0 || target >= slides.length) return;
  animating = true;

  const from = slides[current];
  const to = slides[target];
  const down = dir === 'down';

  unrevealSlide(from);
  playSlideVideos(to, true);

  // incoming slide sits fully visible beneath the outgoing one
  setStyles(to, { transition: 'none', clipPath: 'none', zIndex: 9, visibility: 'visible' });
  setStyles(from, { zIndex: 10 });

  // force reflow so the transition below actually runs
  void from.offsetHeight;

  from.style.transition = `clip-path ${WIPE_MS}ms ${WIPE_EASE}`;
  // down: the current slide is wiped away upward (bottom edge rises)
  // up:   the current slide descends away (top edge falls) — the special drop
  from.style.clipPath = down ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)';

  window.setTimeout(() => {
    setStyles(from, { transition: 'none', zIndex: 0, clipPath: 'none', visibility: 'hidden' });
    setStyles(to, { zIndex: 10 });
    playSlideVideos(from, false);
    current = target;
    markActive(current);
    revealSlide(to);
    animating = false;
  }, WIPE_MS + 30);
}

const next = () => goTo(current + 1, 'down');
const prev = () => goTo(current - 1, 'up');

/* ---------- engine setup / teardown ---------- */

function engineStart() {
  engineOn = true;
  slides.forEach((slide, i) => {
    slide.classList.add('is-ready');
    setStyles(slide, {
      visibility: i === current ? 'visible' : 'hidden',
      zIndex: i === current ? 10 : 0,
      clipPath: 'none',
      transition: 'none',
    });
    playSlideVideos(slide, i === current);
  });
  markActive(current);
  revealSlide(slides[current]);
}

function engineStop() {
  engineOn = false;
  slides.forEach(slide => {
    slide.classList.add('is-ready');
    setStyles(slide, { visibility: 'visible', zIndex: 0, clipPath: 'none', transition: 'none' });
    slide.querySelectorAll('.reveal').forEach(el => {
      el.style.transitionDelay = '0s';
      el.classList.add('in-view');
    });
    playSlideVideos(slide, true);
  });
}

/* ---------- input: wheel, keys, touch ---------- */

window.addEventListener('wheel', (e) => {
  if (!engineOn || document.body.classList.contains('modal-open')) return;
  e.preventDefault();
  if (animating) return;
  wheelAccum += e.deltaY;
  if (Math.abs(wheelAccum) < 24) return;
  (wheelAccum > 0) ? next() : prev();
  wheelAccum = 0;
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!engineOn || document.body.classList.contains('modal-open')) return;
  if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
  if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
  if (e.key === 'Home') { e.preventDefault(); goTo(0, 'up'); }
  if (e.key === 'End') { e.preventDefault(); goTo(slides.length - 1, 'down'); }
});

let touchY = null;
window.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
window.addEventListener('touchend', (e) => {
  if (!engineOn || touchY === null) return;
  const dy = touchY - e.changedTouches[0].clientY;
  if (Math.abs(dy) > 48) (dy > 0) ? next() : prev();
  touchY = null;
}, { passive: true });

/* ---------- nav links jump straight to their slide ---------- */

document.querySelectorAll('.slide-link').forEach(link => {
  link.addEventListener('click', (e) => {
    if (!engineOn) return; // mobile: let the anchor scroll natively
    e.preventDefault();
    const target = +link.dataset.slide;
    goTo(target, target > current ? 'down' : 'up');
  });
});

/* ---------- mode switching on resize ---------- */

function applyMode() {
  if (isSlideshow()) {
    if (!engineOn) engineStart();
  } else {
    if (engineOn || !slides[0].classList.contains('is-ready')) engineStop();
  }
}

window.addEventListener('resize', () => { applyMode(); });

/* honor a #hash deep-link on load */
(function initFromHash() {
  const id = location.hash.slice(1);
  const idx = slides.findIndex(s => s.id === id);
  if (idx > 0) current = idx;
})();

applyMode();

/* ---------- mobile overlay nav ---------- */

const menuToggle = document.getElementById('menuToggle');
const overlayNav = document.getElementById('overlayNav');

menuToggle.addEventListener('click', () => {
  const isOpen = overlayNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', isOpen);
});

overlayNav.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    overlayNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ---------- floating newsletter chip ---------- */

const newsChip = document.getElementById('newsChip');
const newsChipClose = document.getElementById('newsChipClose');

if (sessionStorage.getItem('tutlavi-chip-closed')) {
  newsChip.classList.add('hidden');
}
newsChipClose.addEventListener('click', () => {
  newsChip.classList.add('hidden');
  sessionStorage.setItem('tutlavi-chip-closed', '1');
});

/* ---------- inquiry modal (collaboration / space rental) ---------- */

const inquiryModal = document.getElementById('inquiryModal');
const inquiryForm = document.getElementById('inquiryForm');
const rentalFields = document.getElementById('rentalFields');
const rentalInputs = rentalFields.querySelectorAll('input');
const formStatus = document.getElementById('formStatus');
const typeRadios = inquiryForm.querySelectorAll('input[name="type"]');

function setRentalVisible(show) {
  rentalFields.hidden = !show;
  // date stays optional — a hidden-or-skipped required field silently blocks
  // submission in some flows; the venue can follow up on missing dates
  rentalInputs.forEach(inp => { inp.required = false; });
  // contract approval is required for rental requests (visible, so the
  // browser can point at it if left unchecked)
  const agree = document.getElementById('f-agree');
  if (agree) agree.required = show;
  if (show) loadAvailability();
}

/* ---------- availability calendar (managed at /admin) ---------- */

let availability = null;
let fcalView = null;   // first-of-month Date being displayed
let selectedDate = null;
const availChips = document.getElementById('availChips');
const availStatus = document.getElementById('availStatus');
const dateInput = document.getElementById('f-date');
const startSel = document.getElementById('f-start');
const endSel = document.getElementById('f-end');
const windowIdInput = document.getElementById('f-window-id');
const fcalGrid = document.getElementById('fcalGrid');
const fcalLabel = document.getElementById('fcalLabel');

// hours are chosen, never typed: 08:00–23:30 in half-hour steps
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
    return true; // the email is what matters; reservation is best-effort
  }
}

/* ---------- the contract preview link mirrors the form live ---------- */

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
  sigCtx.strokeStyle = '#17140f';
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

function sigStart(e) {
  e.preventDefault();
  drawing = true;
  const [x, y] = sigPos(e);
  sigCtx.beginPath();
  sigCtx.moveTo(x, y);
}
function sigMove(e) {
  if (!drawing) return;
  e.preventDefault();
  const [x, y] = sigPos(e);
  sigCtx.lineTo(x, y);
  sigCtx.stroke();
  sigDrawn = true;
}
function sigEnd() { drawing = false; }

sigPad.addEventListener('mousedown', sigStart);
sigPad.addEventListener('mousemove', sigMove);
window.addEventListener('mouseup', sigEnd);
sigPad.addEventListener('touchstart', sigStart, { passive: false });
sigPad.addEventListener('touchmove', sigMove, { passive: false });
sigPad.addEventListener('touchend', sigEnd);

document.getElementById('sigClear').addEventListener('click', sigInit);

/* create the signed booking record; returns its id (or null) */
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

function openInquiry(mode) {
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
  document.body.classList.remove('modal-open');
}

document.querySelectorAll('[data-open-inquiry]').forEach(btn => {
  btn.addEventListener('click', () => openInquiry(btn.getAttribute('data-open-inquiry')));
});
document.querySelectorAll('[data-close-inquiry]').forEach(el => {
  el.addEventListener('click', closeInquiry);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inquiryModal.classList.contains('open')) closeInquiry();
});

typeRadios.forEach(r => {
  r.addEventListener('change', () => setRentalVisible(r.value === 'השכרת חלל' && r.checked));
});

// AJAX submit to FormSubmit — free email delivery, keeps the visitor on the page
const FORM_ENDPOINT = 'https://formsubmit.co/ajax/vivian.office.info@gmail.com';

inquiryForm.addEventListener('submit', (e) => {
  e.preventDefault();
  // a locked day cannot be requested
  if (!rentalFields.hidden && availability && dateInput.value && availability.locked.includes(dateInput.value)) {
    formStatus.className = 'form-status mono err';
    formStatus.textContent = 'התאריך שנבחר נעול — בחרו תאריך אחר.';
    return;
  }
  const submitBtn = inquiryForm.querySelector('.modal-submit');
  formStatus.className = 'form-status mono';
  formStatus.textContent = 'שולח…';
  submitBtn.disabled = true;

  const payload = Object.fromEntries(new FormData(inquiryForm).entries());
  const isRental = !rentalFields.hidden;

  // rental requests must be signed
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
      // store the signed contract; both emails link to it
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
    formStatus.className = 'form-status mono ok';
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
    loadAvailability(true); // refresh so the taken slot shows as booked
  })()
    .catch(() => {
      formStatus.className = 'form-status mono err';
      formStatus.textContent = 'משהו השתבש. נסו שוב או כתבו ל-vivian.office.info@gmail.com';
    })
    .finally(() => { submitBtn.disabled = false; });
});

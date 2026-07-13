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
  if (show) loadAvailability();
}

/* ---------- availability (managed at /admin) ---------- */

let availability = null;
const availBox = document.getElementById('availBox');
const availChips = document.getElementById('availChips');
const availStatus = document.getElementById('availStatus');
const dateInput = document.getElementById('f-date');
const hoursInput = document.getElementById('f-hours');

async function loadAvailability() {
  if (availability) return;
  try {
    const res = await fetch('/api/availability');
    availability = await res.json();
  } catch {
    availability = { locked: [], windows: [] };
  }
  renderUpcomingWindows();
}

function fmtDate(isoDate) {
  const d = new Date(isoDate + 'T00:00');
  return d.toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

function renderUpcomingWindows() {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (availability.windows || [])
    .filter(w => w.date >= today && !availability.locked.includes(w.date))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 6);
  if (!upcoming.length) { availBox.hidden = true; return; }
  availBox.hidden = false;
  availChips.innerHTML = '';
  upcoming.forEach(w => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'avail-chip';
    chip.innerHTML = fmtDate(w.date) + ' · <span dir="ltr">' + w.start + '–' + w.end + '</span>';
    chip.addEventListener('click', () => {
      dateInput.value = w.date;
      hoursInput.value = w.start + '-' + w.end;
      updateDateStatus();
    });
    availChips.appendChild(chip);
  });
}

function updateDateStatus() {
  if (!availability || !dateInput.value) { availStatus.textContent = ''; availStatus.className = 'avail-status'; return; }
  const d = dateInput.value;
  if (availability.locked.includes(d)) {
    availStatus.textContent = 'התאריך הזה נעול ולא זמין להשכרה — בחרו תאריך אחר.';
    availStatus.className = 'avail-status err';
    return;
  }
  const wins = (availability.windows || []).filter(w => w.date === d);
  if (wins.length) {
    availStatus.textContent = 'פתוח בתאריך זה: ' + wins.map(w => w.start + '–' + w.end).join(' · ');
    availStatus.className = 'avail-status ok';
  } else {
    availStatus.textContent = 'אין חלון מוגדר בתאריך זה — אפשר לשלוח בקשה ונחזור אליכם.';
    availStatus.className = 'avail-status';
  }
}

dateInput.addEventListener('change', updateDateStatus);

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
  fetch(FORM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((data) => {
      if (String(data.success) !== 'true') throw new Error(data.message || 'failed');
      formStatus.className = 'form-status mono ok';
      formStatus.textContent = 'תודה! הפנייה נשלחה, נחזור אליכם בהקדם.';
      inquiryForm.reset();
      setRentalVisible(false);
    })
    .catch(() => {
      formStatus.className = 'form-status mono err';
      formStatus.textContent = 'משהו השתבש. נסו שוב או כתבו ל-vivian.office.info@gmail.com';
    })
    .finally(() => { submitBtn.disabled = false; });
});

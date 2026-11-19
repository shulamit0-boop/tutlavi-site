/* syrups.html — sign-up for syrup / bar updates (QR from the cocktail workshop).
   Same FormSubmit target as the updates form on /vivian. */
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

  const fd = new FormData(vivForm);
  const interests = fd.getAll('interest').join(', ');
  fetch(VIV_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      _subject: 'הרשמה לעדכוני סירופים · ' + (fd.get('name') || ''),
      _template: 'box',
      _captcha: 'false',
      _honey: fd.get('_honey') || '',
      'שם': fd.get('name') || '',
      'טלפון': fd.get('phone') || '',
      'מה מעניין': interests || '—',
      'מאיפה': 'סדנת קוקטיילים (QR)',
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

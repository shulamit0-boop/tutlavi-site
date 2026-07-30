/* Transactional mail for the rental flow, sent from the studio's own domain
   through Resend.

   Everything here is a no-op when RESEND_API_KEY is missing: the callers ask
   mailReady() first and tell the browser whether the server already sent the
   mail, so until the domain is verified the site keeps falling back to the old
   FormSubmit path and to the mailto: button in /admin. Nothing breaks
   half-configured, and nothing is sent twice.

   The template is deliberately plain HTML tables with inline styles — that is
   what survives Gmail, Outlook and iOS Mail. No external images either: the
   wordmark is type, so the mail looks right with images blocked. */

const ENDPOINT = 'https://api.resend.com/emails';
const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.MAIL_FROM || 'סטודיו תות <hello@tutlavi.com>';
const STUDIO = process.env.STUDIO_EMAIL || 'vivian.office.info@gmail.com';
const SITE = 'https://tutlavi.com';

export const mailReady = () => Boolean(KEY);

const INK = '#000000';
const RED = '#ef4444';
const MUTED = '#545454';
const LINE = '#e6e6e6';
const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

const MONTHS = ['בינואר', 'בפברואר', 'במרץ', 'באפריל', 'במאי', 'ביוני',
  'ביולי', 'באוגוסט', 'בספטמבר', 'באוקטובר', 'בנובמבר', 'בדצמבר'];
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/* Intl with a he-IL locale is not something to bet an email on inside an edge
   runtime, so the Hebrew date is assembled by hand from the ISO parts. */
export function heDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const dow = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `יום ${dow}, ${d} ${MONTHS[m - 1]} ${y}`;
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* label/value pairs; empty values are dropped rather than printed blank */
const rows = (pairs) => pairs
  .filter(([, v]) => v !== '' && v != null)
  .map(([k, v]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:14px;white-space:nowrap;vertical-align:top;width:120px">${esc(k)}</td>
        <td style="padding:10px 0 10px 16px;border-bottom:1px solid ${LINE};color:${INK};font-size:15px;font-weight:600;vertical-align:top">${esc(v)}</td>
      </tr>`).join('');

const button = (href, label) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
      <tr><td style="background:${RED};border-radius:2px">
        <a href="${esc(href)}" style="display:inline-block;padding:14px 30px;color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;text-decoration:none">${esc(label)}</a>
      </td></tr>
    </table>`;

function layout({ eyebrow, title, lead, body, cta }) {
  return `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" dir="rtl"
           style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${LINE};font-family:${FONT};text-align:right">

      <tr><td style="background:${INK};padding:26px 32px">
        <div style="color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-.02em">תות<span style="color:${RED}">.</span></div>
        <div style="color:rgba(255,255,255,.55);font-size:10px;letter-spacing:.28em;padding-top:6px" dir="ltr">STUDIO TUTLAVI · TOUTE LA VIE</div>
      </td></tr>

      <tr><td style="padding:32px">
        <div style="color:${RED};font-size:11px;font-weight:700;letter-spacing:.18em">${esc(eyebrow)}</div>
        <h1 style="margin:10px 0 0;color:${INK};font-size:23px;line-height:1.3;font-weight:800">${esc(title)}</h1>
        ${lead ? `<p style="margin:14px 0 0;color:${MUTED};font-size:15px;line-height:1.7">${lead}</p>` : ''}
        ${body || ''}
        ${cta ? button(cta.href, cta.label) : ''}
      </td></tr>

      <tr><td style="padding:22px 32px;background:#fafafa;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.9">
        סטודיו תות · מגן אברהם 6, תל אביב<br>
        054-312-9933 · <a href="${SITE}" style="color:${MUTED}">tutlavi.com</a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!mailReady() || !to) return false;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    return res.ok;
  } catch {
    // a booking must never be lost because the mail provider blinked
    return false;
  }
}

const when = (b) => [heDate(b.date), [b.start, b.end].filter(Boolean).join('–')]
  .filter(Boolean).join(' · ');

const detailRows = (b) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px">
      ${rows([
        ['תאריך', heDate(b.date)],
        ['שעות', [b.start, b.end].filter(Boolean).join('–')],
        ['מטרה', b.purpose],
        ['משתתפים', b.participants],
        ['עלות', b.price],
      ])}
    </table>`;

/* ---- 1. a new request landed: to the studio ---- */
export function newRequestToStudio(b, id) {
  const html = layout({
    eyebrow: 'בקשה חדשה',
    title: `${b.name || 'פנייה'} מבקש/ת את החלל`,
    lead: 'התאריך מוחזק עבורם עד לתשובתך. אישור הבקשה שולח להם את החוזה לחתימה.',
    body: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px">
      ${rows([
        ['שם', b.name],
        ['טלפון', b.phone],
        ['מייל', b.email],
        ['תאריך', heDate(b.date)],
        ['שעות', [b.start, b.end].filter(Boolean).join('–')],
        ['מטרה', b.purpose],
        ['משתתפים', b.participants],
        ['עלות', b.price],
        ['מוחזק עד', heDate(String(b.holdUntil || '').slice(0, 10))],
      ])}
    </table>
    ${b.message ? `<p style="margin:22px 0 0;padding:16px;background:#fafafa;border-right:3px solid ${RED};color:${INK};font-size:15px;line-height:1.7">${esc(b.message)}</p>` : ''}`,
    cta: { href: `${SITE}/admin`, label: 'לאישור הבקשה' },
  });
  return send({
    to: STUDIO,
    subject: `בקשת השכרה · ${b.name || ''}${b.date ? ' · ' + heDate(b.date) : ''}`,
    html,
    replyTo: b.email || undefined,
    text: `בקשת השכרה חדשה\n${b.name || ''} · ${b.phone || ''} · ${b.email || ''}\n${when(b)}\n${b.message || ''}\n\nלאישור: ${SITE}/admin`,
  });
}

/* ---- 2. the same request, acknowledged to the visitor ---- */
export function receiptToClient(b) {
  const html = layout({
    eyebrow: 'הבקשה התקבלה',
    title: 'תודה, קיבלנו את הבקשה שלכם',
    lead: 'התאריך שמור עבורכם בינתיים. נחזור אליכם בהקדם, ואם הכול מסתדר נשלח חוזה לחתימה במייל נפרד.<br>זו בקשה עקרונית — עדיין לא נדרשתם לחתום על כלום.',
    body: detailRows(b) + `
    <p style="margin:22px 0 0;color:${MUTED};font-size:14px;line-height:1.8">התשלום מתבצע בהעברה בנקאית — פרטי החשבון יישלחו עם אישור ההזמנה.</p>`,
  });
  return send({
    to: b.email,
    subject: 'קיבלנו את בקשתכם · סטודיו תות',
    html,
    replyTo: STUDIO,
    text: `תודה, קיבלנו את הבקשה שלכם.\n${when(b)}\nהתאריך שמור עבורכם בינתיים; נחזור אליכם בהקדם.\n\nסטודיו תות · מגן אברהם 6, תל אביב`,
  });
}

/* ---- 3. the studio approved: the signing link goes out by itself ---- */
export function contractToClient(b, id) {
  const link = `${SITE}/contract?bid=${id}`;
  const html = layout({
    eyebrow: 'החוזה מוכן',
    title: 'אישרנו את הבקשה — נשאר רק לחתום',
    lead: 'שמחים לארח אתכם. בקישור למטה תמצאו את ההסכם המלא, ממולא בפרטים שלכם; שם תתבקשו למלא ת.ז / ח.פ ולחתום.',
    body: detailRows(b) + `
    <p style="margin:22px 0 0;color:${MUTED};font-size:14px;line-height:1.8">לאחר החתימה שלכם נחתום גם אנחנו, והתאריך ייסגר סופית.<br>התשלום מתבצע בהעברה בנקאית — פרטי החשבון יישלחו עם אישור ההזמנה.</p>`,
    cta: { href: link, label: 'למעבר לחוזה ולחתימה' },
  });
  return send({
    to: b.email,
    subject: 'ההסכם שלכם לחתימה · סטודיו תות',
    html,
    replyTo: STUDIO,
    text: `אישרנו את הבקשה שלכם.\n${when(b)}\n\nלחתימה על ההסכם: ${link}\n\nסטודיו תות · מגן אברהם 6, תל אביב`,
  });
}

/* ---- 4. the visitor signed: nudge the studio to countersign ---- */
export function signedToStudio(b, id) {
  const html = layout({
    eyebrow: 'נחתם על ידי השוכר',
    title: `${b.name || 'השוכר'} חתם/ה על ההסכם`,
    lead: 'נשארה חתימת הסטודיו. עד שתחתמי התאריך עדיין מוחזק ולא סגור.',
    body: detailRows(b),
    cta: { href: `${SITE}/contract?bid=${id}`, label: 'לצפייה ולחתימה' },
  });
  return send({
    to: STUDIO,
    subject: `נחתם · ${b.name || ''}${b.date ? ' · ' + heDate(b.date) : ''}`,
    html,
    replyTo: b.email || undefined,
    text: `${b.name || ''} חתם/ה על ההסכם.\n${when(b)}\nנשארה חתימת הסטודיו: ${SITE}/contract?bid=${id}`,
  });
}

/* ---- 5. countersigned: the date is theirs ---- */
export function confirmedToClient(b, id) {
  const html = layout({
    eyebrow: 'ההזמנה סגורה',
    title: 'חתמנו — התאריך שלכם',
    lead: 'ההסכם חתום משני הצדדים והתאריך נשמר עבורכם. מחכים לכם.',
    body: detailRows(b) + `
    <p style="margin:22px 0 0;color:${MUTED};font-size:14px;line-height:1.8">התשלום מתבצע בהעברה בנקאית — פרטי החשבון מצורפים בהודעה נפרדת.<br>כל שאלה, אנחנו כאן.</p>`,
    cta: { href: `${SITE}/contract?bid=${id}`, label: 'לצפייה בהסכם החתום' },
  });
  return send({
    to: b.email,
    subject: 'ההזמנה שלכם אושרה · סטודיו תות',
    html,
    replyTo: STUDIO,
    text: `חתמנו — ההסכם סגור משני הצדדים.\n${when(b)}\n\nההסכם: ${SITE}/contract?bid=${id}\n\nסטודיו תות · מגן אברהם 6, תל אביב`,
  });
}

/* ---- 6. a collaboration enquiry — no booking behind it ---- */
export function enquiryToStudio(d) {
  const html = layout({
    eyebrow: 'פנייה חדשה',
    title: `${d.name || 'מישהו'} כתב/ה לכם מהאתר`,
    body: `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px">
      ${rows([['סוג הפנייה', d.type], ['שם', d.name], ['טלפון', d.phone], ['מייל', d.email]])}
    </table>
    ${d.message ? `<p style="margin:22px 0 0;padding:16px;background:#fafafa;border-right:3px solid ${RED};color:${INK};font-size:15px;line-height:1.7">${esc(d.message)}</p>` : ''}`,
  });
  return send({
    to: STUDIO,
    subject: `פנייה מהאתר · ${d.name || ''}`,
    html,
    replyTo: d.email || undefined,
    text: `${d.type || 'פנייה'}\n${d.name || ''} · ${d.phone || ''} · ${d.email || ''}\n\n${d.message || ''}`,
  });
}

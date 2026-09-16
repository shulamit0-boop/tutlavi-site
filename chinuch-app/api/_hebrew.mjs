/* המרת תאריכים עברית↔לועזית, ללא תלות חיצונית.

   למה לא ספריה: הרצועה "רלוונטי עכשיו" חייבת לדעת מה החודש העברי היום ואיזה
   חג מגיע — וזה חישוב דטרמיניסטי של כמה עשרות שורות. חבילת npm כאן הייתה
   מוסיפה תלות שצריך לתחזק, ועוד סיכון שהיא לא תרוץ ב-edge runtime.

   האלגוריתם הוא הנוסח המקובל (Dershowitz & Reingold, אותו קוד שבלוח של Emacs):
   חישוב המולד, דחיות ראש השנה, ומשם ספירת ימים. מספור החודשים מתחיל בניסן=1,
   כמו במקור — תשרי הוא 7. זה נראה הפוך אבל זה מה שמשאיר את החישוב פשוט.

   כל ה-API כאן עובד ב"תאריך אבסולוטי": מספר הימים מ-1 בינואר שנת 1. */

const HEB_EPOCH = -1373429;

const GREG_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isGregLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function absFromGreg(y, m, d) {
  let days = d;
  for (let i = 0; i < m - 1; i++) days += GREG_MONTH_DAYS[i];
  if (m > 2 && isGregLeap(y)) days += 1;
  const py = y - 1;
  return days + 365 * py + Math.floor(py / 4) - Math.floor(py / 100) + Math.floor(py / 400);
}

export function gregFromAbs(abs) {
  let y = Math.floor(abs / 366) || 1;
  while (absFromGreg(y + 1, 1, 1) <= abs) y++;
  let m = 1;
  while (abs >= absFromGreg(y, m + 1, 1) && m < 12) m++;
  const d = abs - absFromGreg(y, m, 1) + 1;
  return { y, m, d };
}

export const absToday = () => {
  const n = new Date();
  return absFromGreg(n.getFullYear(), n.getMonth() + 1, n.getDate());
};

/* ---------- הלוח העברי ---------- */

export const isHebLeap = (y) => ((7 * y + 1) % 19) < 7;
const lastMonthOfYear = (y) => (isHebLeap(y) ? 13 : 12);

/* ימים שחלפו מבריאת העולם עד ראש השנה של השנה הזו, כולל שלוש הדחיות */
function elapsedDays(year) {
  const monthsElapsed =
    235 * Math.floor((year - 1) / 19) +
    12 * ((year - 1) % 19) +
    Math.floor((((year - 1) % 19) * 7 + 1) / 19);
  const partsElapsed = 204 + 793 * (monthsElapsed % 1080);
  const hoursElapsed =
    11 +
    12 * monthsElapsed +
    793 * Math.floor(monthsElapsed / 1080) +
    Math.floor(partsElapsed / 1080);
  /* ה-1 הזה הוא לא קוסמטי: הדחיות למטה נבדקות לפי day % 7, ובלעדיו
     היום יוצא בפרשה הלא נכונה של השבוע ופעם בכמה שנים ראש השנה נדחה
     ליום שגוי. זה בדיוק מה שהזיז את יום כיפור תשפ"ו ואת פסח תשפ"ז ביום. */
  let day = 1 + 29 * monthsElapsed + Math.floor(hoursElapsed / 24);
  const parts = 1080 * (hoursElapsed % 24) + (partsElapsed % 1080);

  if (
    parts >= 19440 ||
    (day % 7 === 2 && parts >= 9924 && !isHebLeap(year)) ||
    (day % 7 === 1 && parts >= 16789 && isHebLeap(year - 1))
  ) {
    day += 1;
  }
  // לא בראשון, ברביעי או בשישי
  return [0, 3, 5].includes(day % 7) ? day + 1 : day;
}

const daysInHebYear = (y) => elapsedDays(y + 1) - elapsedDays(y);
const longCheshvan = (y) => daysInHebYear(y) % 10 === 5;
const shortKislev = (y) => daysInHebYear(y) % 10 === 3;

export function lastDayOfHebMonth(month, year) {
  if (
    [2, 4, 6, 10, 13].includes(month) ||
    (month === 12 && !isHebLeap(year)) ||
    (month === 8 && !longCheshvan(year)) ||
    (month === 9 && shortKislev(year))
  ) {
    return 29;
  }
  return 30;
}

function hebDayNumber(month, day, year) {
  let n = day;
  if (month < 7) {
    const last = lastMonthOfYear(year);
    for (let m = 7; m <= last; m++) n += lastDayOfHebMonth(m, year);
    for (let m = 1; m < month; m++) n += lastDayOfHebMonth(m, year);
  } else {
    for (let m = 7; m < month; m++) n += lastDayOfHebMonth(m, year);
  }
  return n;
}

export const absFromHeb = (year, month, day) =>
  hebDayNumber(month, day, year) + elapsedDays(year) + HEB_EPOCH;

export function hebFromAbs(abs) {
  const g = gregFromAbs(abs);
  let year = g.y + 3760;
  let month = [9, 10, 11, 12, 1, 2, 3, 4, 7, 7, 7, 8][g.m - 1];
  while (abs >= absFromHeb(year + 1, 7, 1)) year++;
  const len = lastMonthOfYear(year);
  while (abs > absFromHeb(year, month, lastDayOfHebMonth(month, year))) {
    month = (month % len) + 1;
  }
  const day = abs - absFromHeb(year, month, 1) + 1;
  return { year, month, day };
}

/* ---------- שמות בעברית ---------- */

const MONTH_NAMES = {
  1: 'ניסן', 2: 'אייר', 3: 'סיוון', 4: 'תמוז', 5: 'אב', 6: 'אלול',
  7: 'תשרי', 8: 'חשוון', 9: 'כסלו', 10: 'טבת', 11: 'שבט', 12: 'אדר', 13: 'אדר ב׳',
};

// slug הקטגוריה של החודש. בשנה מעוברת אדר א׳ ואדר ב׳ מצביעים לאותה קטגוריה.
const MONTH_SLUGS = {
  1: 'nisan', 2: 'iyar', 3: 'sivan', 4: 'tamuz', 5: 'av', 6: 'elul',
  7: 'tishrei', 8: 'cheshvan', 9: 'kislev', 10: 'tevet', 11: 'shevat',
  12: 'adar', 13: 'adar',
};

export const hebMonthName = (month, year) =>
  month === 12 && isHebLeap(year) ? 'אדר א׳' : MONTH_NAMES[month];

export const hebMonthSlug = (month) => MONTH_SLUGS[month] || '';

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/* גימטריה. ט"ו וט"ז מקבלים טיפול נפרד כדי לא לכתוב שם של הקב"ה. */
export function gematria(n) {
  let s = '';
  let rest = n;
  while (rest >= 400) {
    s += 'ת';
    rest -= 400;
  }
  s += HUNDREDS[Math.floor(rest / 100)];
  rest %= 100;
  if (rest === 15) s += 'טו';
  else if (rest === 16) s += 'טז';
  else {
    s += TENS[Math.floor(rest / 10)];
    s += ONES[rest % 10];
  }
  if (s.length === 1) return s + '׳';
  return s.slice(0, -1) + '״' + s.slice(-1);
}

export function hebDateLabel(abs) {
  const h = hebFromAbs(abs);
  return `${gematria(h.day)} ב${hebMonthName(h.month, h.year)} ${gematria(h.year % 1000)}`;
}

/* ---------- אירועים בתאריך עברי קבוע ---------- */

/* month לפי המספור הפנימי (ניסן=1). purim מקבל 'adarLast' כי בשנה מעוברת
   הוא באדר ב׳ ולא באדר א׳ — וזו בדיוק סוג הטעות שמסיטה עיצובים בחודש שלם.

   days הוא משך האירוע. הוא לא קוסמטי: בלי משך, ביום השני של חנוכה קטגוריית
   חנוכה כבר נופלת מהרצועה — בדיוק ביום שבו מורה מחפשת אותה. */
export const EVENT_DATES = {
  'rosh-hashana': { m: 7, d: 1, days: 2 },
  'yom-kippur': { m: 7, d: 10, days: 1 },
  sukkot: { m: 7, d: 15, days: 9 },
  'yud-tes-kislev': { m: 9, d: 19, days: 1 },
  chanuka: { m: 9, d: 25, days: 8 },
  'yud-shevat': { m: 11, d: 10, days: 1 },
  'tu-bishvat': { m: 11, d: 15, days: 1 },
  purim: { m: 'adarLast', d: 14, days: 2 },
  'yud-alef-nisan': { m: 1, d: 11, days: 1 },
  pesach: { m: 1, d: 15, days: 8 },
  'lag-baomer': { m: 2, d: 18, days: 1 },
  shavuot: { m: 3, d: 6, days: 2 },
  'gimmel-tamuz': { m: 4, d: 3, days: 1 },
  'chai-elul': { m: 6, d: 18, days: 1 },
};

/* חלון האירוע ביחס להיום: האם הוא בעיצומו, ואם לא — בעוד כמה ימים הוא מתחיל.
   GRACE נותן לאירוע להישאר על המסך עוד יומיים אחרי שנגמר, כי מורה שמחפשת
   את שילוט סוכות ביום שאחרי סוכות עדיין מחפשת אותו. */
const GRACE = 2;

export function eventWindow(def, fromAbs) {
  if (!def || !def.d) return null;
  const days = Math.max(1, def.days || 1);
  const start = nextDate(def, fromAbs - (days - 1 + GRACE));
  if (start == null) return null;
  const end = start + days - 1;
  return {
    start,
    end,
    daysUntil: start - fromAbs,
    active: fromAbs >= start && fromAbs <= end + GRACE,
  };
}

const resolveMonth = (m, year) => (m === 'adarLast' ? (isHebLeap(year) ? 13 : 12) : m);

/* התאריך הלועזי הבא של תאריך עברי — בשנה הזו אם עוד לא עבר, אחרת בשנה הבאה */
export function nextDate(def, fromAbs) {
  if (!def || !def.d) return null;
  const { year } = hebFromAbs(fromAbs);
  for (const y of [year, year + 1]) {
    const m = resolveMonth(def.m, y);
    if (def.d > lastDayOfHebMonth(m, y)) continue; // ל' בחודש שיש בו כ"ט
    const abs = absFromHeb(y, m, def.d);
    if (abs >= fromAbs) return abs;
  }
  return null;
}

export const nextOccurrence = (slug, fromAbs) => nextDate(EVENT_DATES[slug], fromAbs);

/* מה שמזין את הרצועה: החודש הנוכחי + האירועים שמגיעים בחלון הקרוב */
export function relevanceNow(fromAbs = absToday(), windowDays = 30, extra = {}) {
  const h = hebFromAbs(fromAbs);
  const upcoming = [];
  const dates = { ...EVENT_DATES, ...extra };
  for (const slug of Object.keys(dates)) {
    const w = eventWindow(dates[slug], fromAbs);
    if (!w) continue;
    if (!w.active && (w.daysUntil <= 0 || w.daysUntil > windowDays)) continue;
    upcoming.push({
      slug,
      daysUntil: w.daysUntil,
      active: w.active,
      dateLabel: hebDateLabel(w.start),
    });
  }
  // מה שקורה עכשיו קודם (והמאוחר שהתחיל — ראשון), ואחריו מה שמגיע
  upcoming.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.active ? b.daysUntil - a.daysUntil : a.daysUntil - b.daysUntil;
  });
  return {
    today: hebDateLabel(fromAbs),
    monthSlug: hebMonthSlug(h.month),
    monthName: hebMonthName(h.month, h.year),
    yearLabel: gematria(h.year % 1000),
    upcoming,
  };
}

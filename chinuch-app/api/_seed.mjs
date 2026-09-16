/* ברירות המחדל של המערכת: הקטגוריות שמופיעות ביום הראשון.
   הן נערכות בפאנל הניהול — הרשימה כאן היא רק נקודת הפתיחה, וגם אחרי
   שינוי בפאנל הקוד לא נוגע בה יותר. */

export const DEFAULT_CATS = [
  // חודשי השנה, בסדר השנה העברית
  { slug: 'tishrei', name: 'תשרי', group: 'month' },
  { slug: 'cheshvan', name: 'חשוון', group: 'month' },
  { slug: 'kislev', name: 'כסלו', group: 'month' },
  { slug: 'tevet', name: 'טבת', group: 'month' },
  { slug: 'shevat', name: 'שבט', group: 'month' },
  { slug: 'adar', name: 'אדר', group: 'month' },
  { slug: 'nisan', name: 'ניסן', group: 'month' },
  { slug: 'iyar', name: 'אייר', group: 'month' },
  { slug: 'sivan', name: 'סיוון', group: 'month' },
  { slug: 'tamuz', name: 'תמוז', group: 'month' },
  { slug: 'av', name: 'אב', group: 'month' },
  { slug: 'elul', name: 'אלול', group: 'month' },

  // אירועים בתאריך עברי קבוע — event מצביע ללוח ב-_hebrew.mjs
  { slug: 'rosh-hashana', name: 'ראש השנה', group: 'event', event: 'rosh-hashana' },
  { slug: 'yom-kippur', name: 'יום כיפור', group: 'event', event: 'yom-kippur' },
  { slug: 'sukkot', name: 'סוכות ושמחת תורה', group: 'event', event: 'sukkot' },
  { slug: 'yud-tes-kislev', name: 'י״ט כסלו', group: 'event', event: 'yud-tes-kislev' },
  { slug: 'chanuka', name: 'חנוכה', group: 'event', event: 'chanuka' },
  { slug: 'yud-shevat', name: 'י׳ שבט', group: 'event', event: 'yud-shevat' },
  { slug: 'tu-bishvat', name: 'ט״ו בשבט', group: 'event', event: 'tu-bishvat' },
  { slug: 'purim', name: 'פורים', group: 'event', event: 'purim' },
  { slug: 'yud-alef-nisan', name: 'י״א ניסן', group: 'event', event: 'yud-alef-nisan' },
  { slug: 'pesach', name: 'פסח', group: 'event', event: 'pesach' },
  { slug: 'lag-baomer', name: 'ל״ג בעומר', group: 'event', event: 'lag-baomer' },
  { slug: 'shavuot', name: 'שבועות', group: 'event', event: 'shavuot' },
  { slug: 'gimmel-tamuz', name: 'ג׳ תמוז', group: 'event', event: 'gimmel-tamuz' },
  { slug: 'chai-elul', name: 'ח״י אלול', group: 'event', event: 'chai-elul' },

  // נושאי השנה. hebDate הוא תאריך עברי שהמנהלת יכולה לשנות בפאנל
  { slug: 'ptichat-shana', name: 'פתיחת שנה', group: 'event', hebDate: { m: 6, d: 1, days: 45 } },
  { slug: 'siyum-shana', name: 'סיום שנה וטקסים', group: 'event', hebDate: { m: 3, d: 1, days: 45 } },
  { slug: 'asifot-horim', name: 'אסיפות הורים', group: 'event' },
  { slug: 'shotef', name: 'שוטף — מערכות, שילוט, תעודות', group: 'event' },
];

/* בית ספר לדוגמה, כדי שהמערכת לא תעלה ריקה. המפתח נוצר אקראי בהקמה
   ומוחלף בפאנל. */
export const seedConfig = (key) => ({
  schools: [{ id: 'demo', name: 'בית ספר לדוגמה', city: '', key, active: true }],
  cats: DEFAULT_CATS.map((c, i) => ({ ...c, order: i, hidden: false, desc: '' })),
});

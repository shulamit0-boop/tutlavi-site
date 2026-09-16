/* בדיקת קצה-לקצה: Upstash מדומה בזיכרון + מפתח RSA שמדמה את גוגל.

   הטוקנים כאן נחתמים באמת, והמערכת מאמתת אותם באמת מול "המפתחות של
   גוגל" שמוגשים משרת מקומי. ככה נבדק גם מה שקורה כשהחתימה לא נכונה,
   כשהקהל (aud) לא שלנו, או כשהטוקן פג — שלושת המקרים שבהם "אימות" רשלני
   היה מכניס כל אחד למערכת. */

import http from 'node:http';

/* ---------- Upstash מדומה ---------- */
const mem = new Map();
let certsJson = '{"keys":[]}';

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [cmd, ...args] = parts;
  const send = (result) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result }));
  };
  if (cmd === 'certs') {
    res.setHeader('content-type', 'application/json');
    return res.end(certsJson);
  }
  if (cmd === 'get') return send(mem.has(args[0]) ? mem.get(args[0]) : null);
  if (cmd === 'mget') return send(args.map((k) => (mem.has(k) ? mem.get(k) : null)));
  if (cmd === 'del') { mem.delete(args[0]); return send(1); }
  if (cmd === 'incr') { const n = +(mem.get(args[0]) || 0) + 1; mem.set(args[0], String(n)); return send(n); }
  if (cmd === 'expire') return send(1);
  if (cmd === 'set') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { mem.set(args[0], b); send('OK'); });
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

/* ---------- זהות מדומה של גוגל ---------- */
const CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const real = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
const other = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', real.publicKey);
certsJson = JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', use: 'sig', alg: 'RS256' }] });

const b64u = (x) => Buffer.from(x).toString('base64url');
async function idToken(claims = {}, key = real.privateKey, kid = 'test-kid') {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '10' + Math.random().toString().slice(2, 12),
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...claims,
  };
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const p = b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
}

process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'test';
process.env.GOOGLE_CERTS_URL = `http://127.0.0.1:${port}/certs`;
process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
process.env.SESSION_SECRET = 'a-very-long-random-test-secret-0123456789';
process.env.SUPER_ADMINS = 'boss@chinuch.org';

const auth = (await import('../api/auth.mjs')).default;
const cfgH = (await import('../api/config.mjs')).default;
const usersH = (await import('../api/users.mjs')).default;
const items = (await import('../api/items.mjs')).default;
const H = await import('../api/_hebrew.mjs');

/* ---------- עזרים ---------- */
let pass = 0, fail = 0;
const t = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra); }
};
const req = (method, path, { body, cookie } = {}) =>
  new Request('https://x.test' + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie: `bcs=${encodeURIComponent(cookie)}` } : {}),
      'x-forwarded-for': '1.2.3.4',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const cookieOf = (r) => {
  const raw = r.headers.get('set-cookie') || '';
  const v = raw.split(';')[0].split('=').slice(1).join('=');
  return decodeURIComponent(v);
};
const login = async (email, name, extra = {}) => {
  const r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email, name, ...extra }) } }));
  return { res: r, body: await j(r), cookie: cookieOf(r) };
};

console.log('\n— אימות הזהות מגוגל —');
t('בלי עוגייה: 401 ב-/api/items', (await items(req('GET', '/api/items'))).status === 401);
let r = await auth(req('POST', '/api/auth', { body: { credential: 'לא-טוקן' } }));
t('טקסט שאינו טוקן נדחה', r.status === 401);
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'x@y.co' }, other.privateKey) } }));
t('טוקן שנחתם במפתח אחר נדחה', r.status === 401, JSON.stringify(await j(r)));
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'x@y.co', aud: 'app-אחרת' }) } }));
t('טוקן שנועד לאפליקציה אחרת נדחה', r.status === 401);
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'x@y.co', exp: Math.floor(Date.now() / 1000) - 600 }) } }));
t('טוקן שפג נדחה', r.status === 401);
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'x@y.co', email_verified: false }) } }));
t('מייל לא מאומת נדחה', r.status === 401);
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'x@y.co', iss: 'https://evil.example' }) } }));
t('מנפיק שאינו גוגל נדחה', r.status === 401);

console.log('\n— הסשן שלנו —');
const boss = await login('boss@chinuch.org', 'שולמית');
t('מנהלת מערכת נכנסת', boss.res.status === 200 && boss.body.me.role === 'super');
t('העוגייה HttpOnly + Secure', /HttpOnly/.test(boss.res.headers.get('set-cookie')) && /Secure/.test(boss.res.headers.get('set-cookie')));
const tampered = boss.cookie.slice(0, -3) + 'AAA';
t('עוגייה שנגעו בה נדחית', (await items(req('GET', '/api/items', { cookie: tampered }))).status === 401);
t('עוגייה עם מייל אחר וחתימה של הראשון נדחית',
  (await items(req('GET', '/api/items', { cookie: boss.cookie.replace(/^[^.]+/, Buffer.from(JSON.stringify({ e: 'evil@x.co', t: Date.now() })).toString('base64url')) }))).status === 401);

console.log('\n— בתי ספר וקטגוריות —');
let cfg = await j(await cfgH(req('GET', '/api/config', { cookie: boss.cookie })));
t('נזרעו קטגוריות ברירת מחדל', cfg.cats.length > 25, String(cfg.cats?.length));
t('עולה בלי בתי ספר', cfg.schools.length === 0);
cfg.schools = [
  { id: '', name: 'בית חינוך תל אביב', city: 'תל אביב', domain: 'chinuch-ta.org' },
  { id: '', name: 'בית חינוך ירושלים', city: 'ירושלים' },
];
cfg = await j(await cfgH(req('PUT', '/api/config', { cookie: boss.cookie, body: cfg })));
const [SA, SB] = cfg.schools;
t('שני בתי ספר נשמרו עם מזהים', Boolean(SA.id && SB.id && SA.id !== SB.id));
t('אין יותר מפתח לבית ספר', !('key' in SA));
t('הדומיין נשמר', SA.domain === 'chinuch-ta.org');

console.log('\n— בקשת הרשאה ואישור —');
const mich = await login('michal@gmail.com', 'מיכל כהן');
t('מורה חדשה נכנסת כ"ממתינה"', mich.body.me.role === 'pending' && mich.body.me.status === 'pending');
r = await items(req('GET', '/api/items', { cookie: mich.cookie }));
t('ממתינה לא רואה שום תוכן', r.status === 403 && (await j(r)).pending === true);
r = await auth(req('POST', '/api/auth', { body: { action: 'school', schoolId: SA.id }, cookie: mich.cookie }));
t('היא בוחרת בית ספר', r.status === 200 && (await j(r)).me.schoolId === SA.id);

// מנהלת בית ספר: קודם משויכת, אחר כך ממונה
const rivka = await login('rivka@gmail.com', 'רבקה לוי');
await auth(req('POST', '/api/auth', { body: { action: 'school', schoolId: SA.id }, cookie: rivka.cookie }));
await usersH(req('POST', '/api/users', { cookie: boss.cookie, body: { action: 'approve', email: 'rivka@gmail.com' } }));
r = await usersH(req('POST', '/api/users', { cookie: boss.cookie, body: { action: 'setRole', email: 'rivka@gmail.com', role: 'principal' } }));
t('מנהלת בית ספר מונתה', r.status === 200 && (await j(r)).user.role === 'principal');

let staff = await j(await usersH(req('GET', '/api/users', { cookie: rivka.cookie })));
t('המנהלת רואה את הבקשה הממתינה', staff.pending === 1 && staff.users.some((u) => u.email === 'michal@gmail.com'));
t('היא לא רואה מורות של בית ספר אחר', staff.users.every((u) => u.schoolId === SA.id));

// מורה של בית ספר אחר, כדי לבדוק את הגבול
const dina = await login('dina@gmail.com', 'דינה');
await auth(req('POST', '/api/auth', { body: { action: 'school', schoolId: SB.id }, cookie: dina.cookie }));
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'approve', email: 'dina@gmail.com' } }));
t('מנהלת לא מאשרת מורה של בית ספר אחר', r.status === 403);
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'setRole', email: 'michal@gmail.com', role: 'principal' } }));
t('מנהלת בית ספר לא ממנה מנהלות', r.status === 403);
r = await usersH(req('GET', '/api/users', { cookie: mich.cookie }));
t('מורה ממתינה לא נכנסת לפאנל המורות', r.status === 403);

r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'approve', email: 'michal@gmail.com' } }));
t('המנהלת מאשרת את המורה שלה', r.status === 200);
r = await items(req('GET', '/api/items', { cookie: mich.cookie }));
t('אחרי האישור נפתח התוכן', r.status === 200);
await usersH(req('POST', '/api/users', { cookie: boss.cookie, body: { action: 'approve', email: 'dina@gmail.com' } }));

console.log('\n— הזמנה מראש —');
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'invite', email: 'Chana@Gmail.com', name: 'חנה' } }));
t('המנהלת מזמינה מורה', r.status === 200);
const chana = await login('chana@gmail.com', 'חנה ג.');
t('המוזמנת נכנסת ישר, בלי אישור', chana.body.me.role === 'teacher' && chana.body.me.status === 'active');
t('היא שויכה לבית הספר של המנהלת', chana.body.me.schoolId === SA.id);
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'invite', email: 'chana@gmail.com' } }));
t('הזמנה כפולה נחסמת', r.status === 409);

console.log('\n— חשבון Google Workspace של בית ספר —');
const sara = await login('sara@chinuch-ta.org', 'שרה', { hd: 'chinuch-ta.org' });
t('שיוך אוטומטי לפי הדומיין', sara.body.me.schoolId === SA.id && sara.body.me.role === 'pending');

console.log('\n— פריטים והרשאות —');
r = await items(req('POST', '/api/items', {
  cookie: mich.cookie,
  body: { title: 'שילוט פתיחת שנה', cats: ['elul', 'ptichat-shana'], kind: 'link', url: 'https://www.canva.com/design/A/view' },
}));
const itemM = (await j(r)).item;
t('מורה מוסיפה קישור', r.status === 200 && itemM.uploader === 'מיכל כהן');
t('ברירת המחדל: בית הספר שלי בלבד', itemM.visibility === 'school');
r = await items(req('POST', '/api/items', {
  cookie: mich.cookie,
  body: { title: 'קישור עריכה', cats: ['tishrei'], kind: 'link', url: 'https://www.canva.com/design/X/y/edit' },
}));
t('קישור עריכה מזוהה', (await j(r)).item.canvaEdit === true);
r = await items(req('POST', '/api/items', {
  cookie: dina.cookie,
  body: { title: 'מדבקות', cats: ['shotef'], kind: 'link', url: 'https://www.canva.com/design/Q/view', visibility: 'all' },
}));
const itemD = (await j(r)).item;
t('מורה אחרת מוסיפה פריט משותף', itemD.visibility === 'all');
r = await items(req('POST', '/api/items', { cookie: mich.cookie, body: { title: 'ללא קטגוריה', kind: 'link', url: 'https://x.co' } }));
t('בלי קטגוריה נדחה', r.status === 400);
r = await items(req('POST', '/api/items', { cookie: mich.cookie, body: { title: 'js', cats: ['tishrei'], kind: 'link', url: 'javascript:alert(1)' } }));
t('קישור javascript: נדחה', r.status === 400);
r = await items(req('POST', '/api/items', { cookie: mich.cookie, body: { title: 'קובץ מזויף', cats: ['tishrei'], kind: 'file', blob: { url: 'https://evil.example/x.pdf' } } }));
t('כתובת קובץ שאינה Blob נדחית', r.status === 400);

const dm = await j(await items(req('GET', '/api/items', { cookie: mich.cookie })));
const dd = await j(await items(req('GET', '/api/items', { cookie: dina.cookie })));
const db = await j(await items(req('GET', '/api/items', { cookie: boss.cookie })));
t('מורה רואה את של בית הספר שלה + המשותף', dm.items.length === 3);
t('בית ספר אחר לא רואה את הפרטי', !dd.items.some((i) => i.id === itemM.id));
t('המשותף נראה לשניהם', dd.items.some((i) => i.id === itemD.id) && dm.items.some((i) => i.id === itemD.id));
t('מנהלת המערכת רואה הכל', db.items.length === 3);
t('כתובת ה-Blob לא יוצאת לדפדפן', !JSON.stringify(db).includes('blobUrl'));
t('כתובת המייל של המעלה לא נחשפת', !JSON.stringify(dm.items).includes('michal@gmail.com'));

console.log('\n— בעלות על פריט —');
r = await items(req('PUT', '/api/items', { cookie: chana.cookie, body: { id: itemM.id, title: 'ניסיון' } }));
t('מורה אחרת באותו בית ספר לא עורכת', r.status === 403);
t('וגם לא רואה כפתור עריכה', (await j(await items(req('GET', '/api/items', { cookie: chana.cookie })))).items.find((i) => i.id === itemM.id).canEdit === false);
r = await items(req('PUT', '/api/items', { cookie: mich.cookie, body: { id: itemM.id, title: 'שילוט פתיחת שנה תשפ״ז' } }));
t('הבעלת עורכת', r.status === 200 && (await j(r)).item.title === 'שילוט פתיחת שנה תשפ״ז');
r = await items(req('PUT', '/api/items', { cookie: rivka.cookie, body: { id: itemM.id, desc: 'הוספתי הסבר' } }));
t('מנהלת בית הספר עורכת פריט של בית הספר שלה', r.status === 200);
r = await items(req('PUT', '/api/items', { cookie: rivka.cookie, body: { id: itemD.id, title: 'לא שלי' } }));
t('ולא פריט של בית ספר אחר', r.status === 403);

console.log('\n— הצמדה, מחיקה ושחזור —');
r = await items(req('POST', '/api/items', { cookie: rivka.cookie, body: { action: 'pin', id: itemM.id } }));
t('רק מנהלת המערכת מצמידה', r.status === 403);
r = await items(req('POST', '/api/items', { cookie: boss.cookie, body: { action: 'pin', id: itemM.id } }));
t('היא מצמידה', (await j(r)).pinned === true);
t('המוצמד ראשון ברצועה', (await j(await items(req('GET', '/api/items', { cookie: mich.cookie })))).relevant[0].id === itemM.id);
r = await items(req('DELETE', `/api/items?id=${itemM.id}`, { cookie: mich.cookie }));
t('הבעלת מוחקת', r.status === 200);
t('הפריט המחוק לא מוצג', !(await j(await items(req('GET', '/api/items', { cookie: mich.cookie })))).items.some((i) => i.id === itemM.id));
await items(req('POST', '/api/items', { cookie: boss.cookie, body: { action: 'restore', id: itemM.id } }));
t('שחזור מחזיר אותו', (await j(await items(req('GET', '/api/items', { cookie: mich.cookie })))).items.some((i) => i.id === itemM.id));

console.log('\n— הסרת הרשאה —');
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'remove', email: 'michal@gmail.com' } }));
t('המנהלת מסירה מורה', r.status === 200);
t('העוגייה הקיימת מפסיקה לעבוד מיד', (await items(req('GET', '/api/items', { cookie: mich.cookie }))).status === 403);
r = await auth(req('POST', '/api/auth', { body: { credential: await idToken({ email: 'michal@gmail.com', name: 'מיכל' }) } }));
t('וכניסה מחדש עם גוגל נחסמת', r.status === 403);
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'remove', email: 'rivka@gmail.com' } }));
t('אי אפשר להסיר את עצמך', r.status === 400);
r = await usersH(req('POST', '/api/users', { cookie: rivka.cookie, body: { action: 'remove', email: 'boss@chinuch.org' } }));
t('מנהלת בית ספר לא נוגעת במנהלת המערכת', r.status === 403);

console.log('\n— הרלוונטיות והלוח העברי —');
const rel = (await j(await items(req('GET', '/api/items', { cookie: chana.cookie })))).rel;
t('יש תאריך עברי', /תשפ/.test(rel.today), rel.today);
t('החודש העברי מזוהה', Boolean(rel.monthSlug), rel.monthSlug);
const anchors = [
  ['ר״ה תשפ״ו', 5786, 7, 1, 2025, 9, 23], ['יו״כ תשפ״ו', 5786, 7, 10, 2025, 10, 2],
  ['כ״ה כסלו תשפ״ו', 5786, 9, 25, 2025, 12, 15], ['ט״ו בשבט תשפ״ו', 5786, 11, 15, 2026, 2, 2],
  ['פורים תשפ״ו', 5786, 12, 14, 2026, 3, 3], ['פסח תשפ״ו', 5786, 1, 15, 2026, 4, 2],
  ['ל״ג בעומר תשפ״ו', 5786, 2, 18, 2026, 5, 5], ['שבועות תשפ״ו', 5786, 3, 6, 2026, 5, 22],
  ['ר״ה תשפ״ז', 5787, 7, 1, 2026, 9, 12], ['יו״כ תשפ״ז', 5787, 7, 10, 2026, 9, 21],
  ['חנוכה תשפ״ז', 5787, 9, 25, 2026, 12, 5], ['פורים תשפ״ז', 5787, 13, 14, 2027, 3, 23],
  ['פסח תשפ״ז', 5787, 1, 15, 2027, 4, 22], ['ר״ה תשפ״ח', 5788, 7, 1, 2027, 10, 2],
];
let bad = [];
for (const [label, y, m, d, gy, gm, gd] of anchors) {
  const x = H.gregFromAbs(H.absFromHeb(y, m, d));
  if (!(x.y === gy && x.m === gm && x.d === gd)) bad.push(`${label}: ${x.d}.${x.m}.${x.y}`);
}
t(`14 תאריכים ידועים מדויקים`, bad.length === 0, bad.join(', '));
let rt = 0;
const a0 = H.absFromGreg(2020, 1, 1);
for (let a = a0; a < a0 + 7305; a++) {
  const h = H.hebFromAbs(a);
  if (H.absFromHeb(h.year, h.month, h.day) !== a) rt++;
}
t('הלוך-חזור נקי על 20 שנה', rt === 0, String(rt));
const chan = H.relevanceNow(H.absFromGreg(2026, 12, 8));
t('ביום הרביעי של חנוכה — חנוכה "עכשיו"', chan.upcoming.some((u) => u.slug === 'chanuka' && u.active));
const sukk = H.relevanceNow(H.absFromGreg(2026, 10, 1));
t('בתוך סוכות — סוכות "עכשיו"', sukk.upcoming.some((u) => u.slug === 'sukkot' && u.active));

console.log('\n— יציאה —');
r = await auth(req('POST', '/api/auth', { body: { action: 'logout' } }));
t('היציאה מוחקת את העוגייה', /Max-Age=0/.test(r.headers.get('set-cookie') || ''));

console.log(`\nעברו ${pass} · נכשלו ${fail}\n`);
srv.close();
process.exit(fail ? 1 : 0);

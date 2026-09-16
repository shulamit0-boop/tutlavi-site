/* בדיקת קצה-לקצה מול Upstash מדומה בזיכרון */
import http from 'node:http';

const mem = new Map();
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [cmd, ...args] = parts;
  const send = (result) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result }));
  };
  if (cmd === 'get') return send(mem.has(args[0]) ? mem.get(args[0]) : null);
  if (cmd === 'mget') return send(args.map((k) => (mem.has(k) ? mem.get(k) : null)));
  if (cmd === 'del') { mem.delete(args[0]); return send(1); }
  if (cmd === 'incr') { const n = (+(mem.get(args[0]) || 0)) + 1; mem.set(args[0], String(n)); return send(n); }
  if (cmd === 'expire') return send(1);
  if (cmd === 'set') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { mem.set(args[0], b); send('OK'); });
    return;
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'test';
process.env.ADMIN_KEY = 'admin-key-1234';

const auth = (await import('../api/auth.mjs')).default;
const cfgH = (await import('../api/config.mjs')).default;
const items = (await import('../api/items.mjs')).default;

let pass = 0, fail = 0;
const t = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, extra); }
};
const req = (method, path, { body, cookie, headers } = {}) =>
  new Request('https://x.test' + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie: `ck=${encodeURIComponent(cookie)}` } : {}),
      'x-forwarded-for': '1.2.3.4',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const j = async (r) => { try { return await r.json(); } catch { return null; } };

console.log('\n— זיהוי והרשאות —');
t('בלי מפתח: 401 ב-/api/items', (await items(req('GET', '/api/items'))).status === 401);
let r = await auth(req('POST', '/api/auth', { body: { key: 'לא נכון' } }));
t('מפתח שגוי נדחה', r.status === 401);
r = await auth(req('POST', '/api/auth', { body: { key: 'admin-key-1234' } }));
const cookieHdr = r.headers.get('set-cookie') || '';
t('מפתח ניהול נכנס', r.status === 200);
t('העוגייה HttpOnly ו-Secure', /HttpOnly/.test(cookieHdr) && /Secure/.test(cookieHdr), cookieHdr);
t('התפקיד admin', (await j(r)).me.role === 'admin');

console.log('\n— הקמה ראשונה —');
r = await cfgH(req('GET', '/api/config', { cookie: 'admin-key-1234' }));
let cfg = await j(r);
t('נזרעו קטגוריות', cfg.cats.length > 25, String(cfg.cats?.length));
t('נזרע בית ספר עם מפתח', Boolean(cfg.schools[0]?.key), JSON.stringify(cfg.schools));
t('אין קטגוריה כפולה', new Set(cfg.cats.map((c) => c.slug)).size === cfg.cats.length);
t('מורה לא רואה את הקונפיג', (await cfgH(req('GET', '/api/config', { cookie: cfg.schools[0].key }))).status === 403);

console.log('\n— בתי ספר ומפתחות —');
cfg.schools.push({ id: '', name: 'בית חינוך תל אביב', city: 'תל אביב', active: true });
r = await cfgH(req('PUT', '/api/config', { cookie: 'admin-key-1234', body: cfg }));
cfg = await j(r);
const [schoolA, schoolB] = cfg.schools;
t('נוסף בית ספר שני', cfg.schools.length === 2);
t('לכל בית ספר מפתח אחר', schoolA.key !== schoolB.key && schoolB.key.length > 8);
t('המפתח של הראשון לא התחלף', Boolean(schoolA.key));
r = await auth(req('POST', '/api/auth', { body: { key: schoolB.key } }));
t('מורה נכנסת עם מפתח בית הספר', r.status === 200 && (await j(r)).me.schoolId === schoolB.id);

console.log('\n— הוספת פריטים —');
r = await items(req('POST', '/api/items', {
  cookie: schoolA.key,
  body: { title: 'שילוט פתיחת שנה', cats: ['elul', 'ptichat-shana'], kind: 'link',
          url: 'https://www.canva.com/design/ABC123/view?utm=1', uploader: 'מיכל' },
}));
const itemA = (await j(r)).item;
t('נוצר פריט קישור', r.status === 200 && itemA.title === 'שילוט פתיחת שנה');
t('לא סומן ככישור עריכה', itemA.canvaEdit === false);
t('ברירת המחדל: בית הספר שלי בלבד', itemA.visibility === 'school');

r = await items(req('POST', '/api/items', {
  cookie: schoolA.key,
  body: { title: 'קישור עריכה', cats: ['tishrei'], kind: 'link',
          url: 'https://www.canva.com/design/XYZ/abc/edit' },
}));
t('קישור עריכה מזוהה בשרת', (await j(r)).item.canvaEdit === true);

r = await items(req('POST', '/api/items', {
  cookie: schoolB.key,
  body: { title: 'מדבקות לכיתה', cats: ['shotef'], kind: 'link',
          url: 'https://www.canva.com/design/Q/view', visibility: 'all' },
}));
const itemShared = (await j(r)).item;
t('פריט משותף נוצר', itemShared.visibility === 'all');

r = await items(req('POST', '/api/items', { cookie: schoolA.key, body: { title: 'בלי קטגוריה', kind: 'link', url: 'https://x.co' } }));
t('בלי קטגוריה נדחה', r.status === 400);
r = await items(req('POST', '/api/items', { cookie: schoolA.key, body: { title: 'קטגוריה מומצאת', cats: ['לא-קיים'], kind: 'link', url: 'https://x.co' } }));
t('קטגוריה שלא קיימת נדחית', r.status === 400);
r = await items(req('POST', '/api/items', { cookie: schoolA.key, body: { title: 'javascript', cats: ['tishrei'], kind: 'link', url: 'javascript:alert(1)' } }));
t('קישור javascript: נדחה', r.status === 400);
r = await items(req('POST', '/api/items', { cookie: schoolA.key, body: { title: 'קובץ מזויף', cats: ['tishrei'], kind: 'file', blob: { url: 'https://evil.example/x.pdf' } } }));
t('כתובת קובץ שאינה Blob נדחית', r.status === 400);

console.log('\n— מי רואה מה —');
let dataA = await j(await items(req('GET', '/api/items', { cookie: schoolA.key })));
let dataB = await j(await items(req('GET', '/api/items', { cookie: schoolB.key })));
const dataAdmin = await j(await items(req('GET', '/api/items', { cookie: 'admin-key-1234' })));
t('בית ספר א רואה את שלו + המשותף', dataA.items.length === 3, String(dataA.items.length));
t('בית ספר ב לא רואה את של א', !dataB.items.some((i) => i.title === 'שילוט פתיחת שנה'));
t('בית ספר ב רואה את שלו', dataB.items.some((i) => i.title === 'מדבקות לכיתה'));
t('ניהול רואה הכל', dataAdmin.items.length === 3);
t('כתובת ה-Blob לא יוצאת לדפדפן', !JSON.stringify(dataAdmin).includes('blobUrl'));

console.log('\n— רלוונטי עכשיו —');
t('יש תאריך עברי', /תשפ/.test(dataA.rel.today), dataA.rel.today);
t('החודש הנוכחי מזוהה', Boolean(dataA.rel.monthSlug), dataA.rel.monthSlug);
t('הרצועה כוללת את הפריט של החודש', dataA.relevant.some((x) => x.id === itemA.id), JSON.stringify(dataA.relevant));
t('לכל פריט ברצועה יש סיבה', dataA.relevant.every((x) => x.reason));
t('מונה הקטגוריה עלה', dataA.cats.find((c) => c.slug === 'elul').count === 1);

console.log('\n— הצמדה, עריכה, מחיקה —');
r = await items(req('POST', '/api/items', { cookie: schoolA.key, body: { action: 'pin', id: itemA.id } }));
t('מורה לא יכולה להצמיד', r.status === 403);
r = await items(req('POST', '/api/items', { cookie: 'admin-key-1234', body: { action: 'pin', id: itemA.id } }));
t('ניהול מצמידה', (await j(r)).pinned === true);
dataA = await j(await items(req('GET', '/api/items', { cookie: schoolA.key })));
t('מוצמד ראשון ברצועה', dataA.relevant[0].id === itemA.id && dataA.relevant[0].reason === 'נבחר');

r = await items(req('PUT', '/api/items', { cookie: schoolB.key, body: { id: itemA.id, title: 'ניסיון חטיפה' } }));
t('בית ספר אחר לא יכול לערוך', r.status === 403);
r = await items(req('PUT', '/api/items', { cookie: schoolA.key, body: { id: itemA.id, title: 'שילוט פתיחת שנה תשפ״ז' } }));
t('בית הספר שלה כן עורך', (await j(r)).item.title === 'שילוט פתיחת שנה תשפ״ז');

r = await items(req('DELETE', `/api/items?id=${itemShared.id}`, { cookie: schoolA.key }));
t('לא מוחקים פריט של בית ספר אחר', r.status === 403);
r = await items(req('DELETE', `/api/items?id=${itemA.id}`, { cookie: schoolA.key }));
t('מחיקה רכה עוברת', r.status === 200);
dataA = await j(await items(req('GET', '/api/items', { cookie: schoolA.key })));
t('הפריט המחוק לא מוצג', !dataA.items.some((i) => i.id === itemA.id));
t('הוא בסל של הניהול', (await j(await items(req('GET', '/api/items', { cookie: 'admin-key-1234' })))).trash.some((i) => i.id === itemA.id));
r = await items(req('POST', '/api/items', { cookie: 'admin-key-1234', body: { action: 'restore', id: itemA.id } }));
dataA = await j(await items(req('GET', '/api/items', { cookie: schoolA.key })));
t('שחזור מחזיר אותו', dataA.items.some((i) => i.id === itemA.id));

console.log('\n— יציאה —');
r = await auth(req('POST', '/api/auth', { body: { action: 'logout' } }));
t('היציאה מוחקת את העוגייה', /Max-Age=0/.test(r.headers.get('set-cookie') || ''));

console.log(`\nעברו ${pass} · נכשלו ${fail}\n`);
srv.close();
process.exit(fail ? 1 : 0);

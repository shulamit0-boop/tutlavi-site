/* Access-control regression tests.

   The handlers are plain functions over Request/Response, so they can be
   called straight from Node without a Vercel runtime. Whatever else changes
   in these files, an unauthenticated caller must never get past the guard.

   The store points at the discard port: it counts as configured, so the code
   takes the same branches it takes in production, but every read and write
   fails instantly and locally — no network, and nothing real is touched. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_KEY = 'test-key-not-the-real-one';
process.env.KV_REST_API_URL = 'http://127.0.0.1:9';
process.env.KV_REST_API_TOKEN = 'unusable';

const { default: content } = await import('../api/content.mjs');
const { default: booking } = await import('../api/booking.mjs');
const { default: register } = await import('../api/register.mjs');
const { default: availability } = await import('../api/availability.mjs');
const { default: calendar } = await import('../api/calendar.mjs');
const { default: artists } = await import('../api/artists.mjs');
const { default: finance, clean: cleanFinance } = await import('../api/finance.mjs');

const req = (url, init = {}) => new Request('https://tutlavi.com' + url, init);
const json = (url, method, body, headers = {}) =>
  req(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const KEY = { 'x-admin-key': process.env.ADMIN_KEY };
const WRONG = { 'x-admin-key': 'test-key-not-the-real-onX' };   // same length
const SHORT = { 'x-admin-key': 'x' };

test('content: GET is public, writes are not', async () => {
  assert.equal((await content(req('/api/content'))).status, 200);
  assert.equal((await content(json('/api/content', 'PUT', { texts: {} }))).status, 401);
  assert.equal((await content(json('/api/content', 'PUT', { texts: {} }, WRONG))).status, 401);
  assert.equal((await content(json('/api/content', 'PUT', { texts: {} }, SHORT))).status, 401);
  // the right key gets through the guard and stops at the unusable store
  assert.notEqual((await content(json('/api/content', 'PUT', { texts: {} }, KEY))).status, 401);
});

test('availability: the calendar can be read but only the studio may write it', async () => {
  assert.equal((await availability(req('/api/availability'))).status, 200);
  assert.equal((await availability(json('/api/availability', 'PUT', { locked: [] }))).status, 401);
  assert.equal((await availability(json('/api/availability', 'PUT', { locked: [] }, WRONG))).status, 401);
  assert.notEqual((await availability(json('/api/availability', 'PUT', { locked: [] }, KEY))).status, 401);
  // the removed anonymous reserve must stay removed
  assert.equal((await availability(json('/api/availability', 'POST', { action: 'reserve' }))).status, 401);
});

test('availability: a public read never exposes who holds a slot', async () => {
  const res = await availability(req('/api/availability'));
  const body = await res.json();
  for (const w of body.windows || []) assert.equal(w.hold, undefined);
});

test('booking: the list of every renter needs the key', async () => {
  assert.equal((await booking(req('/api/booking?list=1'))).status, 401);
  assert.equal((await booking(req('/api/booking?list=1', { headers: WRONG }))).status, 401);
});

test('booking: a contract id is checked before it is looked up', async () => {
  assert.equal((await booking(req('/api/booking?id=../../etc/passwd'))).status, 400);
  assert.equal((await booking(req('/api/booking?id=ABC'))).status, 400);
  assert.equal((await booking(req('/api/booking?id='))).status, 400);
  // well-formed but unknown: the store is unusable here, so nothing is found
  assert.equal((await booking(req('/api/booking?id=abc123def456'))).status, 404);
});

test('booking: the studio-only actions refuse an unauthenticated caller', async () => {
  for (const action of ['create', 'approve', 'studio-sign', 'decline', 'delete']) {
    const res = await booking(json('/api/booking', 'POST', { action, id: 'abc123def456' }));
    assert.equal(res.status, 401, action);
  }
});

test('booking: signing refuses anything that is not a PNG signature', async () => {
  const res = await booking(json('/api/booking', 'POST', {
    action: 'sign', id: 'abc123def456', idnum: '123456789',
    signature: 'javascript:alert(1)',
  }));
  // the store is unusable here, so it stops earlier — the point is it never 200s
  assert.notEqual(res.status, 200);
});

test('register: the registration list needs the key', async () => {
  assert.equal((await register(req('/api/register'))).status, 401);
  assert.equal((await register(req('/api/register', { headers: WRONG }))).status, 401);
});

test('register: the payment callback refuses a caller without the secret', async () => {
  delete process.env.GI_IPN_SECRET;
  const res = await register(json('/api/register?action=ipn', 'POST', { custom: 'x' }));
  assert.equal(res.status, 401);

  process.env.GI_IPN_SECRET = 'ipn-secret-value';
  const guessed = await register(json('/api/register?action=ipn&t=wrong', 'POST', { custom: 'x' }));
  assert.equal(guessed.status, 401);
  delete process.env.GI_IPN_SECRET;
});

test('register: deleting a registration needs the key', async () => {
  const res = await register(json('/api/register', 'POST', { action: 'delete', id: 'x' }));
  assert.equal(res.status, 401);
});

test('artists: the directory needs the key, for reading and writing', async () => {
  assert.equal((await artists(req('/api/artists'))).status, 401);
  assert.equal((await artists(req('/api/artists', { headers: WRONG }))).status, 401);
  assert.equal((await artists(json('/api/artists', 'POST', { action: 'upsert', artists: [{ name: 'x', phone: '0501234567' }] }))).status, 401);
  assert.equal((await artists(json('/api/artists', 'POST', { action: 'delete', id: 'abc' }, SHORT))).status, 401);
});

test('calendar: the feed says nothing without its own token', async () => {
  const res = await calendar(req('/api/calendar'));
  assert.equal(res.status, 404);
  const guessed = await calendar(req('/api/calendar?k=guess'));
  assert.equal(guessed.status, 404);
  // minting a token is the studio's call
  assert.equal((await calendar(req('/api/calendar', { method: 'POST' }))).status, 401);
});

test('invoice: admin only, and never issues without Green Invoice configured', async () => {
  const { default: invoice } = await import('../api/invoice.mjs');
  for (const h of [{}, WRONG, SHORT]) {
    assert.equal((await invoice(json('/api/invoice', 'POST', { action: 'issue', id: 'abc', price: 100 }, h))).status, 401);
  }
  // GET is the public branded copy: only an exact 32-hex token can ever match
  assert.equal((await invoice(req('/api/invoice'))).status, 404);
  assert.equal((await invoice(req('/api/invoice?v=../../x'))).status, 404);
  assert.equal((await invoice(json('/api/invoice', 'POST', { action: 'credit', id: 'abc', number: 1 }, WRONG))).status, 401);
  assert.equal((await invoice(json('/api/invoice', 'POST', { action: 'issue', id: '../x', price: 100 }, KEY))).status, 400);
});

test('finance: the books need the key, for reading and writing', async () => {
  assert.equal((await finance(req('/api/finance'))).status, 401);
  assert.equal((await finance(req('/api/finance', { headers: WRONG }))).status, 401);
  assert.equal((await finance(json('/api/finance', 'PUT', { fixed: [], entries: [] }))).status, 401);
  assert.equal((await finance(json('/api/finance', 'PUT', { fixed: [] }, SHORT))).status, 401);
});

test('finance: stored values are cleaned', () => {
  const out = cleanFinance({
    fixed: [{ id: 'rent', name: 'שכירות\nX', amount: '4600' }, null, { name: 'x', amount: -5 }],
    entries: [
      { id: 'a1', kind: 'out', date: '2026-11-03', desc: 'תיקון', amount: 400 },
      { kind: 'weird', date: '2026-11-04', amount: '250' },
      { kind: 'in', date: 'not a date', amount: 100 },
      { kind: 'in', date: '2026-11-05', amount: 0 },
    ],
  });
  assert.deepEqual(out.fixed.map((f) => [f.name, f.amount]), [['שכירות X', 4600], ['x', 0]]);
  assert.equal(out.entries.length, 2);
  assert.equal(out.entries[1].kind, 'in');
  assert.equal(out.entries[1].amount, 250);
});

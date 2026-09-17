/* Every inline script in every page must parse.

   This test exists because of a real outage: a Hebrew default that contained
   a line break was written into admin.html as an actual line break inside a
   quoted string. The browser stopped reading the file at that point, so the
   whole admin panel — login, calendar, bookings, content — silently did
   nothing, while the page itself still looked fine. Nothing in the API tests
   could have caught it, because none of it is API code.

   The check is deliberately dumb: pull each <script> block out of the HTML,
   hand it to node --check, and fail if it does not parse. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'vivian.html', 'admin.html', 'contract.html'];
const work = mkdtempSync(join(tmpdir(), 'tut-pages-'));

const blocks = (html) => {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const code = m[2];
    if (code.trim()) out.push({ code, line: html.slice(0, m.index).split('\n').length });
  }
  return out;
};

const check = (file) => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

// the two public pages keep their code in script.js / vivian.js
test('the standalone scripts parse', () => {
  for (const f of ['script.js', 'vivian.js']) {
    try {
      check(join(root, f));
    } catch (e) {
      assert.fail(`${f} does not parse:\n${String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')}`);
    }
  }
});

for (const page of PAGES) {
  test(`${page}: every inline script parses`, () => {
    const html = readFileSync(join(root, page), 'utf8');
    const found = blocks(html);   // index.html and vivian.html have none, by design
    found.forEach((b, i) => {
      const file = join(work, `${page}.${i}.mjs`);
      writeFileSync(file, b.code);
      try {
        check(file);
      } catch (e) {
        const detail = String(e.stderr || e.message).split('\n').slice(0, 4).join('\n');
        assert.fail(`${page}, script starting at line ${b.line} does not parse:\n${detail}`);
      }
    });
  });
}

test('no page loads a script from somewhere else', () => {
  for (const page of PAGES) {
    const html = readFileSync(join(root, page), 'utf8');
    // a src= or an import from another origin is what the CSP no longer allows
    assert.equal(/<script[^>]+src=["']https?:/i.test(html), false, page + ' has a remote <script src>');
    assert.equal(/\bfrom\s+["']https?:/i.test(html), false, page + ' imports from a remote origin');
  }
});

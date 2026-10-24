const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PHONE_WIDTH_LINE_PX, PHONE_WIDTH_QUERY, isPhoneWidth } = require('../web/phone-width');
const { VIEW_PANEL_WIDE_PX } = require('../web/view-panel');

// One width line for the Web: under 760 px the layout is the phone's. The stylesheet and the page
// script both read it from here, so the two never disagree about which side of the line a window is on.

const webDir = path.join(__dirname, '..', 'web');
const read = (f) => fs.readFileSync(path.join(webDir, f), 'utf8');

test('759 px is a phone and 760 px is not, and the line is the option panel\'s', () => {
  assert.strictEqual(isPhoneWidth(759), true);
  assert.strictEqual(isPhoneWidth(760), false);
  assert.strictEqual(isPhoneWidth(390), true);
  assert.strictEqual(isPhoneWidth(1800), false);
  assert.strictEqual(PHONE_WIDTH_LINE_PX, VIEW_PANEL_WIDE_PX);
  assert.strictEqual(PHONE_WIDTH_LINE_PX, 760);
});

test('a width that is not a number is not a phone', () => {
  for (const w of [undefined, null, 'narrow', NaN]) assert.strictEqual(isPhoneWidth(w), false, String(w));
});

test('the media query string is the phone side of the line, as the stylesheet writes it', () => {
  assert.strictEqual(PHONE_WIDTH_QUERY, '(max-width: 759.98px)');
});

test('every width media query in app.css is on that one line', () => {
  const css = read('app.css');
  const found = [...css.matchAll(/@media[^{]*/g)].flatMap((m) => [...m[0].matchAll(/\(\s*((?:min|max)-width)\s*:\s*([^)]*?)\s*\)/g)].map((q) => `${q[1]}: ${q[2]}`));
  assert.ok(found.length >= 3, `only ${found.length} width queries were read, so the pattern no longer matches`);
  const allowed = ['max-width: 759.98px', 'min-width: 760px'];
  for (const q of found) assert.ok(allowed.includes(q), `${q} is not on the phone width line`);
  assert.ok(PHONE_WIDTH_QUERY.includes(allowed[0]));
  assert.strictEqual(allowed[1], `min-width: ${PHONE_WIDTH_LINE_PX}px`);
});

test('phone-width.js loads from one script tag, right after view-panel.js', () => {
  const tags = [...read('app.html').matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.strictEqual(tags.filter((t) => t === '/phone-width.js').length, 1);
  assert.strictEqual(tags.indexOf('/phone-width.js'), tags.indexOf('/view-panel.js') + 1);
});

test('the page script asks matchMedia with the module\'s query, not a width of its own', () => {
  const app = read('app.js');
  assert.ok(app.includes('matchMedia(PHONE_WIDTH_QUERY)'));
  assert.ok(!/matchMedia\(`\(min-width/.test(app));
});

test('phone-width.js has the dual-environment export tail', () => {
  const src = read('phone-width.js');
  assert.match(src, /if \(typeof module !== 'undefined' && module\.exports\)/);
  assert.match(src, /window\.PHONE_WIDTH_QUERY = PHONE_WIDTH_QUERY/);
});

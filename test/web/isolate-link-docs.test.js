const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { nextSearchAddress } = require('../../plugin/skills/web/web/card-history');
const { parseDeepLink } = require('../../plugin/skills/web/web/deep-link');

// The web skill and the web docs say that the link carries isolate and list the Isolate entries of
// the menus. The one example address is held to the address function, so a doc cannot promise an
// address the page does not write.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('plugin', 'skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillIsolate = flat(skill.slice(skill.indexOf('- **Isolate**'), skill.indexOf('- **Preferences sheet**')));
const docsIsolate = flat(docs.slice(docs.indexOf('**Isolate**'), docs.indexOf('**Notifications inbox**')));
const multiAt = skill.indexOf('- **Multi-select**');
const skillMulti = flat(skill.slice(multiAt, skill.indexOf('\n- **', multiAt + 10)));
const BOTH = [['the web skill', skillIsolate], ['the web docs', docsIsolate]];

test('both say the link carries isolate, as a second parameter beside q, with no history entry', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /The link carries it/, where);
    assert.ok(text.includes('`isolate=1`'), `${where}: names the parameter`);
    assert.match(text, /beside `q`/, where);
    assert.match(text, /never as a history entry/, where);
  }
});

test('both say a reload and a link opened in another browser open isolated, in the Graph and every other view', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /reload/, where);
    assert.match(text, /another browser/, where);
    assert.match(text, /Graph/, where);
    assert.match(text, /every other view/, where);
  }
});

test('both say the text from before isolating is kept per board in the browser, is given back after a reload, and is an empty box where it is unknown', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /kept in (your|the) browser/, where);
    assert.match(text, /per board/, where);
    assert.match(text, /empty/, where);
  }
  assert.match(skillIsolate, /`isolate\.kept`/);
  assert.match(skillIsolate, /works without browser storage/);
});

test('both say a link with the parameter and no query opens with isolate off', () => {
  for (const [where, text] of BOTH) assert.match(text, /no query opens with isolate off|no usable `q` opens with isolate off/, where);
});

test('the example address is the one the page writes, and the deep-link reader asks for isolate from it', () => {
  assert.ok(skillIsolate.includes('`?q=%2312+%7C+%235&isolate=1`'));
  const address = nextSearchAddress('', '#12 | #5', true);
  assert.strictEqual(address, '?q=%2312+%7C+%235&isolate=1');
  assert.strictEqual(parseDeepLink(address).isolate, true);
});

test('both list the Isolate entries of the menus: inside the selection, the empty Graph or Map canvas, and Turn isolate off', () => {
  for (const [where, text] of BOTH) {
    assert.ok(text.includes('**Isolate**'), where);
    assert.match(text, /inside the selection/, where);
    assert.match(text, /empty Graph\s+or Map canvas/, where);
    assert.match(text, /Turn isolate off/, where);
    assert.match(text, /card details' own menu/, where);
  }
});

test('the skill\'s menu list names Isolate, and says where it shows and where the canvas menu opens', () => {
  assert.match(skillMulti, /\*\*Explore\*\* \(\*\*Isolate\*\*, \*\*Path\*\* and \*\*Tree\*\*\)/);
  assert.match(skillMulti, /Isolate shows only inside the selection and never in the card details' own menu/);
  assert.match(skillMulti, /empty Graph or Map canvas/);
  assert.match(skillMulti, /`canvas-menu`/);
  assert.match(skillMulti, /browser's menu shows/);
});

test('the deep links entry and the address entry name the isolate parameter', () => {
  const links = flat(skill.slice(skill.indexOf('- **Deep links**'), skill.indexOf('- **Card popup history')));
  assert.ok(links.includes('`isolate=1` beside a query'));
  assert.match(links, /While isolate is on, `isolate=1` stands beside `q`/);
});

test('the bulk actions paragraph of the docs lists isolate among the menu\'s actions', () => {
  const bulk = flat(docs.slice(docs.indexOf('**Bulk actions**'), docs.indexOf('A click on empty space never touches')));
  assert.match(bulk, /isolate \(inside the selection only\)/);
});

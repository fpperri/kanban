const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { withBuiltBoard } = require('./search-table');
const { boxText, openPanel, pill } = require('./panel-table');

// What the snapshot skill and the snapshot docs page promise about the search panel, pinned so
// they keep saying what the page does. The skill's panel text is held to the page for the one
// term it writes out as an example, and to the files it names; the retired-word tests ban
// `.epic` and a backticked `epic:` in the skill docs, so the examples use goal and strategy.

const root = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'snapshot', 'SKILL.md');
const flat = (text) => text.replace(/\s+/g, ' ');
const panel = /\nThe search box has a panel[\s\S]*?\n\nEvery view carries a status-pill row/.exec(skill);
const limits = /\n## What the editor deliberately does not do\n[\s\S]*$/.exec(skill);

test('the skill has a paragraph for the panel, after the search box\'s and before the status pills\'', () => {
  assert.ok(panel, 'a panel section');
  assert.ok(skill.indexOf('A search box under the header') < skill.indexOf('The search box has a panel'));
});

test('the panel text says what opens it, what closes it and what the arrow and p do', () => {
  const text = flat(panel[0]);
  assert.match(text, /arrow[^.]*switch[^.]*`aria-pressed`/);
  assert.match(text, /focusing the box opens the panel/);
  assert.match(text, /`p`[^.]*flips the same switch/);
  assert.match(text, /Esc closes an open panel/);
  assert.match(text, /press[^.]*outside the search bar closes/);
  assert.match(text, /no preferences sheet/);
});

test('the panel text describes the pill section: the built-ins, the board\'s pills, field:*, +N more, and how a click and a right-click filter', () => {
  const text = flat(panel[0]);
  assert.match(text, /blocked, review and waiting/);
  assert.match(text, /`pills:`[^.]*`config\.yaml`/);
  assert.match(text, /`field:\*`/);
  assert.match(text, /first eight/);
  assert.match(text, /\+N more/);
  assert.match(text, /a click turns a pill on[^.]*one more alternative/);
  assert.match(text, /right-click keeps only that pill/);
  assert.match(text, /`tags:"grill"`[^.]*never catches `grilling`/);
  assert.ok(text.includes('`review: | blocked:`'));
});

test('the panel text describes the slice section: the tiers the board uses and the depths, the clicks, the right-click, the keys and the term it writes', () => {
  const text = flat(panel[0]);
  assert.match(text, /tiers[^.]*`hierarchy:`[^.]*some card of the board is in/);
  assert.match(text, /icon[^.]*then every depth/);
  assert.match(text, /outside the run grows it/);
  assert.match(text, /on an end drops that end/);
  assert.match(text, /run of one removes the cut/);
  assert.match(text, /context-menu key and Shift\+F10/);
  assert.match(text, /`\[`[^.]*`\]`[^.]*`\{`[^.]*`\}`/);
  assert.match(text, /a field has focus or a card sheet or a card menu is up/);
  assert.doesNotMatch(text, /card menu or the change tray is up/, 'the tray is in the page, not a dialog');
  assert.ok(text.includes('`slice:strategy..`'));
});

test('the panel text says what the counts are taken over, and describes the chip and the keyboard', () => {
  const text = flat(panel[0]);
  assert.match(text, /after the status pills and the Archive pill, before the box and the cut/);
  assert.match(text, /chip/);
  assert.match(text, /Tab reaches the arrow, both fold controls, every slice entry and every pill/);
  assert.match(text, /Enter and Space act as a click/);
});

test('the panel text names the web modules it embeds and the tests that hold them', () => {
  const text = flat(panel[0]);
  for (const file of ['skills/web/web/pills.js', 'skills/web/web/slice-run.js', 'test/pills-embed.test.js', 'test/slice-run-embed.test.js']) {
    assert.ok(text.includes(`\`${file}\``), file);
  }
});

test('the skill\'s list of what the editor does not do names the missing Isolate switch and the missing selection', () => {
  assert.ok(limits, 'the section is there');
  const text = flat(limits[0]);
  assert.match(text, /\*\*No Isolate switch and no selection\.\*\*/);
  assert.match(text, /Isolate switch[^.]*foot[^.]*shows only the selection in every view/);
  assert.match(text, /no anchor and no Shift addition/);
});

test('the snapshot docs page describes the panel: the switch, the slice section, the pill section and the missing Isolate switch', () => {
  const docs = flat(read('docs', 'snapshot.md'));
  const at = docs.indexOf('## Search panel');
  assert.ok(at > -1, 'a section for the panel');
  const text = docs.slice(at, docs.indexOf('##', at + 5) === -1 ? undefined : docs.indexOf('##', at + 5));
  assert.match(text, /slices and pills/);
  assert.match(text, /arrow/);
  assert.match(text, /pills filter/i);
  assert.match(text, /counts/);
  assert.match(text, /no Isolate switch/);
});

test('the cross-harness note says the generator needs the pill list and the run of slices beside it too', () => {
  const note = flat(read('docs', 'cross-harness.md'));
  assert.match(note, /skills\/web\/web\/pills\.js/);
  assert.match(note, /skills\/web\/web\/slice-run\.js/);
  assert.match(note, /skills\/web\/web\/key-guard\.js/);
  assert.match(note, /skills\/web\/web\/combobox\.js/);
});

test('the skill says which pieces of the panel are the web\'s source and which texts are held to it by a test', () => {
  const text = flat(skill);
  assert.match(text, /key guard's check for a field with focus \(`skills\/web\/web\/key-guard\.js`\)/);
  assert.match(text, /`skills\/web\/web\/combobox\.js`/);
  assert.match(text, /`test\/panel-copies\.test\.js` holds the page's copy of each to the web's source/);
});

test('the one term the skill writes out for a pill is the term the page writes for it', () => {
  withBuiltBoard('plan', (page) => {
    openPanel(page);
    page.click(pill(page, 'review').el);
    page.click(pill(page, 'blocked').el);
    assert.strictEqual(boxText(page), 'review: | blocked:');
  });
});

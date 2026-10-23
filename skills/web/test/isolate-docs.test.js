const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { searchIsolateText } = require('../web/search');
const { cardPart, pathPart, queryPart } = require('../web/selection');

// The web skill and the web docs describe Isolate: the switch at the foot of the search panel and
// the i key, what it writes into the box, what every view shows while it is on, what a click does,
// the chip, how it goes off, and Esc's three stages. The one example of the text it writes is held
// to the search module, so a doc cannot promise what the box does not get.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillIsolate = flat(skill.slice(skill.indexOf('- **Isolate**'), skill.indexOf('- **Preferences sheet**')));
const docsIsolate = flat(docs.slice(docs.indexOf('**Isolate**'), docs.indexOf('**Notifications inbox**')));
const BOTH = [['the web skill', skillIsolate], ['the web docs', docsIsolate]];

test('both have an Isolate entry', () => {
  for (const [where, text] of BOTH) assert.ok(text.length > 500, `${where}: the Isolate entry is found`);
});

test('both say where the switch is and that it is a switch announced as on or off, reached by Tab and flipped by Enter and Space', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /foot of the search panel/, where);
    assert.match(text, /Isolate\*\* switch/, where);
    assert.match(text, /Tab reaches it/, where);
    assert.match(text, /Enter and Space/, where);
  }
  assert.match(skillIsolate, /`role="switch"`/);
  assert.match(skillIsolate, /`aria-checked`/);
  assert.match(docsIsolate, /announced as on or off/);
});

test('both say the i key flips it, and when it does nothing', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`i` key flips it/, where);
    assert.match(text, /field/, where);
    assert.match(text, /card menu|menu/, where);
    assert.match(text, /dialog/, where);
    assert.match(text, /notifications panel/, where);
    assert.match(text, /preferences sheet/, where);
  }
  assert.match(skillIsolate, /shared key guard/);
  assert.match(skillIsolate, /`i` works with it open/, 'the skill says the panel is no popup for the key');
  assert.match(skillIsolate, /chord \(Ctrl, Cmd, Alt\), Shift or a held key is not it/);
  assert.match(flat(skill.slice(skill.indexOf('Both read one **key guard**'), skill.indexOf('- **Comboboxes**'))), /`i`, which flips Isolate/, 'the key guard entry names i');
});

test('both say it writes the selection into the box as part | part, each part by what it names, and that a card that comes to match joins on the next refresh', () => {
  for (const [where, text] of BOTH) {
    assert.ok(text.includes('`#12 | path:40 | tags:grill`'), `${where}: the example is written out`);
    assert.match(text, /writes the selection into the search box|writes (the )?selection into the (search )?box/, where);
    assert.match(text, /joins on the next (poll|refresh)/, where);
  }
  assert.match(skillIsolate, /a card is `#12`, a path `path:40`, a tree `tree:40`/);
  assert.match(skillIsolate, /in brackets when it holds `\|` or spaces/);
  assert.strictEqual(searchIsolateText([cardPart(12), pathPart(40), queryPart('tags:grill')]), '#12 | path:40 | tags:grill');
});

test('both say the box\'s text is given back when it goes off, by the switch, i or Esc, and only a cut stays', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /text the box held is given back when (isolate goes off|you turn it off)/, where);
    assert.match(text, /gives the box back the text it held|box gets its text back/, where);
    assert.match(text, /switch, `i` or Esc/, where);
  }
});

test('both say every view shows only the matches, the Graph hides where a typed search lights, and the Calendar and Gantt jump', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /every view/, where);
    assert.match(text, /Board, Map,\s*Gantt and Calendar|Board, the Map, the Gantt and the Calendar/, where);
    assert.match(text, /Graph/, where);
    assert.match(text, /only lights/, where);
    assert.match(text, /jump to the nearest match/, where);
  }
  assert.match(skillIsolate, /never on a poll/);
  assert.match(skillIsolate, /`graphQueryEffect`/);
});

test('both say a click moves the anchor only, the box and the shown cards stay, and the empty Graph clears nothing', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /move the anchor only|moves the anchor/, where);
    assert.match(text, /leaves the box/, where);
    assert.match(text, /empty space clears nothing|clears nothing/, where);
  }
});

test('both say the closed box\'s chip says isolated', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /chip/, where);
    assert.match(text, /closed|panel closed/, where);
    assert.match(text, /isolated/, where);
  }
  assert.match(skillIsolate, /`2 on: review, isolated`/);
});

test('both give the three Esc stages and where the panel comes in', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /three stages/, where);
    assert.match(text, /isolate off, then (every|the) addition/, where);
    assert.match(text, /then the anchor/, where);
    assert.match(text, /first Esc closes the panel,? and the second turns isolate off/, where);
  }
  assert.match(skillIsolate, /with focus in the box Esc turns isolate off rather than clearing the box/);
});

test('the multi-select entry and the bulk actions entry name isolate in the Esc order', () => {
  const multi = flat(skill.slice(skill.indexOf('**Esc** steps the selection back'), skill.indexOf('Bulk targets are fixed when an')));
  assert.match(multi, /isolate off, then every addition, then the anchor/);
  assert.match(multi, /while isolated, Esc in the box turns isolate off instead of clearing it/);
  const bulk = flat(docs.slice(docs.indexOf('A click on empty space never touches the selection'), docs.indexOf('![Bulk context menu]')));
  assert.match(bulk, /isolate goes off before the additions/);
});

test('the search panel entry says the foot holds the switch, not that it is empty', () => {
  assert.doesNotMatch(flat(skill), /a foot \(empty so far\)/);
  assert.match(flat(skill.slice(skill.indexOf('- **Search panel**'), skill.indexOf('- **Slice section**'))), /a foot that holds the \*\*Isolate\*\* switch/);
});

// The menus and the link were not built when this entry was first written, and a doc test held it
// to saying nothing of them. They are built now, and isolate-link-docs.test.js holds what the entry
// says of them, so this one holds that it does say it.
test('the Isolate entry describes the menu entries and the isolate flag in the link, which are built', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /reload/i, where);
    assert.match(text, /right-click on the empty/i, where);
  }
});

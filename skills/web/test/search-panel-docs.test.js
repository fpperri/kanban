const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { searchAddAlt, searchRemoveAlt } = require('../web/search');
const { pillList } = require('../web/pills');

// The web skill and the web docs describe the search panel: how it opens (the
// toggle, never focus), the built-in pills and their counts, what a click and a
// Shift+click do to the selection and the box, the chip, the fold and its
// preference, and where Esc takes the panel. The one example of the box growing is
// held to the search module so a doc cannot promise what the box does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');

const flat = (text) => text.replace(/\s+/g, ' ');
const skillPanel = flat(skill.slice(skill.indexOf('- **Search panel**'), skill.indexOf('- **Preferences sheet**')));
const docsPanel = flat(docs.slice(docs.indexOf('**Search panel**'), docs.indexOf('**Notifications inbox**')));

const BOTH = [['the web skill', skillPanel], ['the web docs', docsPanel]];

test('both describe the panel as opened by a toggle at the end of the box, and say focusing the box does not open it', () => {
  for (const [where, text] of BOTH) {
    assert.ok(text.length > 400, `${where}: the Search panel entry is found`);
    assert.match(text, /toggle/i, where);
    assert.match(text, /focus(ing)? the (search )?box (does not|never) open/i, where);
  }
});

test('both list the built-in pills in order, each with a count taken before the search box and the cut', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /blocked, review and waiting/, where);
    assert.match(text, /count/i, where);
    assert.match(text, /before the search box/i, where);
    assert.match(text, /status pills/i, where);
  }
  assert.deepStrictEqual(pillList([], () => []).map((p) => p.label), ['blocked', 'review', 'waiting']);
});

test('both say what a click does: either button, the pill\'s query is the anchor and goes in the box, and a second click turns it off', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /either (mouse )?button/i, where);
    assert.match(text, /anchor/, where);
    assert.match(text, /`review:`/, where);
    assert.match(text, /again/, where);
  }
});

test('both say what Shift+click does, with the example of the box that grows, and the example is what the search module writes', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /Shift/, where);
    assert.ok(text.includes('`review: | blocked:`'), `${where}: the grown box is written out`);
  }
  assert.strictEqual(searchAddAlt('review:', 'blocked:'), 'review: | blocked:');
  assert.strictEqual(searchRemoveAlt('review: | blocked:', 'blocked:'), 'review:');
});

test('both say that a pill is on while its query is the anchor or an addition, and that typing in the box turns it off', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /on while its query is the anchor or an addition/, where);
    assert.match(text, /typing/i, where);
  }
});

test('both describe the chip a closed panel shows, and that its name says what is on', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /chip/, where);
    assert.match(text, /closed/, where);
    assert.match(text, /name/, where);
  }
});

test('both describe the fold, and that the preference says how it starts', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /fold/i, where);
    assert.match(text, /starts folded/i, where);
  }
});

test('both give the Esc order: the suggestion list, then the panel with focus back on the toggle, then the selection steps back', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /suggestion list/, where);
    assert.match(text, /Esc/, where);
    assert.match(text, /focus (goes )?back to the toggle/, where);
    assert.ok(text.indexOf('suggestion list') < text.indexOf('toggle', text.indexOf('suggestion list')), `${where}: the list comes first`);
  }
});

test('both say the box keeps its text through the first two Esc presses, and focus stays in the box when Esc was pressed there', () => {
  for (const [where, text] of BOTH) {
    const esc = text.slice(text.indexOf('suggestion list'));
    assert.match(esc, /stays in the box/, where);
    assert.match(esc, /keeps its text/, where);
    assert.match(esc, /browser's own Esc/, where);
  }
  const popups = flat(skill.slice(skill.indexOf('**Esc** closes whichever popup is open'), skill.indexOf('**Alt+Enter**')));
  assert.match(popups, /stays in the box/, 'the popups entry gives the same focus rule');
});

test('both say the panel does not pause the board: the poll runs with it open, and a pill with focus keeps it', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /poll/, where);
    assert.match(text, /keeps (its )?focus|keeps it/, where);
  }
});

test('the preferences entry of each lists the pill section starting folded', () => {
  const skillPrefs = flat(skill.slice(skill.indexOf('- **Preferences sheet**'), skill.indexOf('- **Hover/focus highlight**')));
  const docsPrefs = flat(docs.slice(docs.indexOf('**Preferences**'), docs.indexOf('## Other surfaces')));
  for (const [where, text] of [['the web skill', skillPrefs], ['the web docs', docsPrefs]]) {
    assert.match(text, /Pill section starts folded/, where);
  }
});

test('the Esc paragraph of the multi-select entry names the panel in the chain', () => {
  const multi = flat(skill.slice(skill.indexOf('**Esc** steps the selection back'), skill.indexOf('Bulk targets are fixed when an')));
  assert.match(multi, /search panel/);
  assert.match(multi, /pill/);
});

test('the Esc paragraph of the popups entry names the panel too', () => {
  const popups = flat(skill.slice(skill.indexOf('**Esc** closes whichever popup is open'), skill.indexOf('**Alt+Enter**')));
  assert.match(popups, /search panel/);
});

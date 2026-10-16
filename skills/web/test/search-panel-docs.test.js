const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { searchAddAlt, searchRemoveAlt } = require('../web/search');
const { pillList } = require('../web/pills');

// The web skill and the web docs describe the search panel: how it opens (focusing the
// box while the arrow's switch is on, which the arrow and the p key flip), the built-in
// pills and their counts, what a click (Shift or
// not) and a right-click do to the selection and the box, the chip, the fold and its
// preference, and where Esc takes the panel. The one example of the box growing is
// held to the search module so a doc cannot promise what the box does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');

const flat = (text) => text.replace(/\s+/g, ' ');
const skillPanel = flat(skill.slice(skill.indexOf('- **Search panel**'), skill.indexOf('- **Preferences sheet**')));
const docsPanel = flat(docs.slice(docs.indexOf('**Search panel**'), docs.indexOf('**Notifications inbox**')));

const BOTH = [['the web skill', skillPanel], ['the web docs', docsPanel]];

test('both describe the arrow at the end of the box as the panel\'s switch: on, the default, focusing the box opens the panel; a click switches it off, and a second click on and opens it now', () => {
  for (const [where, text] of BOTH) {
    assert.ok(text.length > 400, `${where}: the Search panel entry is found`);
    assert.match(text, /arrow at its right end/, where);
    assert.match(text, /switch/, where);
    assert.match(text, /the default, focusing the box (\([^)]*\) )?opens the panel/, where);
    assert.match(text, /switches it off/, where);
    assert.match(text, /no longer opens it/, where);
    assert.match(text, /second click switches it on and opens the panel now/, where);
    assert.doesNotMatch(text, /never opens/i, `${where}: focusing the box opens the panel now`);
  }
});

test('both say the p key flips the same switch, and when it does nothing', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`p` key flips the same switch/, where);
    assert.match(text, /text field|field/, where);
    assert.match(text, /card menu|menu/, where);
    assert.match(text, /dialog/, where);
    assert.match(text, /notifications panel/, where);
    assert.match(text, /preferences sheet/, where);
  }
  assert.match(skillPanel, /shared key guard/, 'the skill names the guard');
  assert.match(skillPanel, /`p` works with the panel open/, 'the skill says the panel is no popup for the key');
  assert.match(skillPanel, /chord \(Ctrl, Cmd, Alt\), Shift or a held key is not it/, 'the skill says what is not the key');
});

test('both say the m key steps through the pills: the next pill alone, in the panel\'s order, then every pill off, and Shift+m backwards', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`m` key steps through the pills/, where);
    assert.match(text, /next pill alone/, where);
    assert.match(text, /off, blocked, review, waiting, then the board's own pills, then off again/, where);
    assert.match(text, /Shift\+m steps backwards/, where);
    assert.match(text, /query alone/, where);
    assert.match(text, /every view/, where);
    assert.match(text, /text field|field/, where);
    assert.match(text, /card menu|menu/, where);
    assert.match(text, /dialog/, where);
    assert.match(text, /notifications panel/, where);
    assert.match(text, /preferences sheet/, where);
  }
  assert.match(skillPanel, /as a right-click does/, 'the skill says the step is a solo');
  assert.match(skillPanel, /shared key guard/, 'the skill names the guard');
  assert.match(skillPanel, /with none on or several on it starts from the first pill \(Shift\+m, from the last\)/, 'the skill says where it starts');
  assert.match(skillPanel, /pill that holds a query an earlier pill holds is the same step/, 'the skill says pills of one query are one step');
  assert.match(skillPanel, /\*\*\+N more\*\* button is shown when the step reaches it/, 'the skill says a hidden value pill is shown');
  assert.match(skillPanel, /chip's hover text/, 'the skill says the chip names the pill on in its hover text');
  assert.match(flat(skill.slice(skill.indexOf('does `p`, which flips'), skill.indexOf('- **Comboboxes**'))), /`m`, which steps through the pills/, 'the key guard entry names m');
});

test('both say the arrow announces the switch, shows it off, and that the choice is kept per board and set in the preferences sheet', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /pressed/, where);
    assert.match(text, /struck through/, where);
    assert.match(text, /kept in (the|your) browser per board/, where);
    assert.match(text, /preferences sheet shows and sets it/, where);
  }
  assert.match(skillPanel, /`aria-pressed`/);
  assert.match(skillPanel, /`aria-expanded`/);
});

test('both say Esc leaves the switch on, so the box opens the panel again when it is focused', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /Esc leaves the switch on/, where);
    assert.match(text, /opens the panel again/, where);
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

test('both say what a click does: Shift or not, it turns one pill on or off, its query one more alternative of the box, and the other pills stay as they were', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /on or off/, where);
    assert.match(text, /Shift\+click is a plain click/, where);
    assert.match(text, /one more alternative/, where);
    assert.match(text, /others as they were/, where);
    assert.ok(text.includes('`review:`'), `${where}: the box with one pill is written out`);
    assert.ok(text.includes('`review: | blocked:`'), `${where}: the grown box is written out`);
    assert.doesNotMatch(text, /either (mouse )?button/i, `${where}: a right-click no longer does what a click does`);
    assert.doesNotMatch(text, /Shift\+click (adds|again)/, `${where}: Shift+click no longer adds`);
  }
  assert.strictEqual(searchAddAlt('review:', 'blocked:'), 'review: | blocked:');
  assert.strictEqual(searchRemoveAlt('review: | blocked:', 'blocked:'), 'review:');
});

test('both say what a right-click does: it solos the pill, the box holding its query alone, and on the soloed pill it turns every pill off', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /right-click/, where);
    assert.match(text, /solos/, where);
    assert.match(text, /query alone/, where);
    assert.match(text, /every pill off/, where);
    assert.match(text, /status pills/, where);
  }
});

test('both say the first pill on is the anchor and the later ones are additions, so Esc takes the later pills out first', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /first pill on is the \**anchor/, where);
    assert.match(text, /later ones are additions/, where);
    assert.match(text, /later pills out first/, where);
  }
});

test('both say that a pill is on while its query is the anchor or an addition, that it is announced as pressed, and that typing in the box turns it off', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /on while its query is the anchor or an addition/, where);
    assert.match(text, /announced as pressed/, where);
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

test('both say the chip is a tab stop while it is shown and none while it is hidden, that Enter and Space on it open the panel and so does a click with the mouse, and that it shows the hand the other header buttons show', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /Tab reaches the chip while it is shown/, where);
    assert.match(text, /between the box and the clear button/, where);
    assert.match(text, /no tab stop when it is hidden/, where);
    assert.match(text, /Enter and Space on it open the panel, and so does a click with the mouse/, where);
    assert.match(text, /with focus on the arrow either way/, where);
    assert.match(text, /pointer hand the other header buttons show/, where);
    assert.doesNotMatch(text, /click with the mouse does nothing|mouse does nothing, as before/, `${where}: a click with the mouse opens the panel now`);
  }
  assert.match(skillPanel, /focus ring the arrow shows/, 'the skill says the chip wears the arrow\'s ring');
});

test('both describe the fold, and that the preference says how it starts', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /fold/i, where);
    assert.match(text, /starts folded/i, where);
  }
});

test('both give the Esc order: the suggestion list, then the panel with focus back on the arrow, then the selection steps back', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /suggestion list/, where);
    assert.match(text, /Esc/, where);
    assert.match(text, /focus (goes )?back to the arrow/, where);
    assert.ok(text.indexOf('suggestion list') < text.indexOf('arrow', text.indexOf('suggestion list')), `${where}: the list comes first`);
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
    assert.match(text, /Panel opens when the search box is focused/, where);
    assert.match(text, /on by default/, where);
    assert.match(text, /`p`/, where);
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

test('both say what a pill does beside a hand-picked anchor and an empty box: the box stays empty, the pill is on, and typing drops it', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /anchor is a card, path or tree you picked and the box is empty, a click on a pill leaves the box empty/, where);
    assert.match(text, /an empty box hides nothing/, where);
    assert.match(text, /its query is not in the box or the address, and typing in the box drops it/, where);
  }
});

test("both say a query typed by hand is never a pill, and a reload or a link carries the box's text and not the pill", () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /A query typed by hand is never a pill, even one that reads as a pill's query/, where);
    assert.match(text, /A reload, or a link, carries the box's text and not the selection/, where);
    assert.match(text, /a pill shows off/, where);
  }
});

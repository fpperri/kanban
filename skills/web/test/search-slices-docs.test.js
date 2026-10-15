const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { searchSetSlice } = require('../web/search');
const { sliceCards } = require('../web/slices');
const { sliceListOf, sliceRunValue } = require('../web/slice-run');

// The web skill and the web docs describe the search panel's slice section: what it lists
// and counts, what a click, a right-click and the context-menu key do, what the term in the
// box is, the keys [ ] { }, the chip, and where the setting lives. The one example of a run
// set on a query that holds | is held to the search module, and the term a run writes to the
// slice list, so a doc cannot promise what the box does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillSection = flat(skill.slice(skill.indexOf('- **Slice section**'), skill.indexOf('- **Preferences sheet**')));
const docsSection = flat(docs.slice(docs.indexOf('**Slice section**'), docs.indexOf('**Notifications inbox**')));
const BOTH = [['the web skill', skillSection], ['the web docs', docsSection]];

test('both describe the section: the tiers some card is in with their icon, then the depths, each with a count taken before the box and the run', () => {
  for (const [where, text] of BOTH) {
    assert.ok(text.length > 800, `${where}: the Slice section entry is found`);
    assert.match(text, /first region of the search panel/, where);
    assert.match(text, /tiers some card of the board is in/, where);
    assert.match(text, /icon/, where);
    assert.match(text, /`depth 0`/, where);
    assert.match(text, /after (its|the) status pills and (the )?Archive/, where);
    assert.match(text, /before the search box and the run/, where);
  }
  assert.match(skillSection, /a tier no card is in is left out/);
  assert.match(skillSection, /setting a run or turning a pill on leaves every count as it was/);
});

test('both say the entries in the run are pressed and name their label, count and place in the run', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /pressed/, where);
    assert.match(text, /label, its count and whether it is in the run/, where);
  }
  assert.match(skillSection, /`epic, 3 cards, in the run`/);
  assert.match(skillSection, /`aria-pressed`/);
});

test('both say the run is the slice: term in the box, that a run over every slice writes none, and the Skill adds that an unknown name cuts nothing', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`slice:` term/, where);
    assert.match(text, /a run that covers every slice writes no term/, where);
  }
  assert.match(skillSection, /single unknown name, which cuts nothing, shows every entry as pressed/);
});

test('both say what a click, a click on an end, a click on a run of one and a click inside the run do', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /outside the run grows the run to it/, where);
    assert.match(text, /end of the run drops that end/, where);
    assert.match(text, /run of one brings every slice back/, where);
    assert.match(text, /inside the run that is not an end changes nothing/, where);
  }
});

test('both say a right-click, the context-menu key and Shift+F10 keep only that slice', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /right-click keeps only that slice/, where);
    assert.match(text, /context-menu key and Shift\+F10/, where);
  }
});

test('the example of a run on a query that holds | is what the search module writes', () => {
  const written = searchSetSlice('tags:ui | #12', 'goal..epic');
  assert.strictEqual(written, '(tags:ui | #12) slice:goal..epic');
  for (const [where, text] of BOTH) {
    assert.ok(text.includes('`tags:ui | #12`'), where);
    assert.ok(text.includes(`\`${written}\``), where);
  }
});

test('the skill says a run that reaches an end of the list leaves it open, and the term a run writes is that one', () => {
  assert.match(skillSection, /leaves that end open \(`slice:epic\.\.`\)/);
  const cards = [{ id: 1, type: 'goal' }, { id: 2, type: 'epic' }, { id: 3, type: 'task' }];
  const list = sliceListOf(sliceCards(cards, ['goal', 'epic'], new Map([[1, 0], [2, 0], [3, 0]])), [1, 2, 3]);
  assert.deepStrictEqual(list.map((e) => e.label), ['goal', 'epic', 'depth 0']);
  assert.strictEqual(sliceRunValue(list, { from: 1, to: 2 }), 'epic..');
});

test('both say the four keys, where they work and when they stand still', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /`\[`[^.]*bottom of the run/, where);
    assert.match(text, /`\{`[^.]*its top/, where);
    assert.ok(text.includes('`]`') && text.includes('`}`'), where);
    assert.match(text, /in every view/, where);
    assert.match(text, /(panel|it) open or closed/, where);
    assert.match(text, /top never passes the bottom/, where);
    assert.match(text, /search box (too|included)/, where);
    assert.match(text, /notifications panel/, where);
    assert.match(text, /preferences sheet/, where);
  }
  assert.match(skillSection, /shared key guard/);
  assert.match(skillSection, /a chord \(Ctrl, Cmd, Alt\) is not them/);
});

test('both say the closed panel\'s chip counts a run that cuts, and that the section folds with a setting in the preferences sheet', () => {
  for (const [where, text] of BOTH) {
    assert.match(text, /chip counts a run that cuts/, where);
    assert.match(text, /Slice section starts folded/, where);
    assert.match(text, /on by default/, where);
    assert.match(text, /Tab reaches the fold control and every entry/, where);
    assert.match(text, /Enter and Space act as a click/, where);
  }
  assert.match(skillSection, /`1 on: slice goal\.\.epic`/);
});

test('the skill says what the Graph does with the run, and that a pill leaves the run alone', () => {
  assert.match(skillSection, /hides the cards outside it while the rest of the query lights/);
  assert.match(skillSection, /A run is not an alternative of the box/);
  assert.match(docsSection, /hides the cards outside it while the rest of the query lights/);
});

test('the skill names the module that works the run out, and that it needs no other', () => {
  assert.match(skillSection, /`slice-run\.js`, which needs no other module so that the snapshot can embed it/);
  assert.match(skillSection, /`\.slice-entry` buttons, never the pills' classes/);
});

test('the preferences sheet entry lists the setting, in both', () => {
  const sheetSkill = flat(skill.slice(skill.indexOf('- **Preferences sheet**'), skill.indexOf('- **Hover/focus highlight**')));
  assert.match(sheetSkill, /\*\*Slice section starts folded\*\* is on by default/);
  const sheetDocs = flat(docs.slice(docs.indexOf('- *Slice section starts folded*'), docs.indexOf('The sheet closes with Esc')));
  assert.match(sheetDocs, /\*Slice section starts folded\* is on by default/);
  assert.match(sheetDocs, /\*Pill section starts folded\* is off by default/);
});

test('the key guard paragraph names the keys as readers of the guard, and the panel entry no longer calls the slice region empty', () => {
  assert.match(flat(skill), /so do `\[`, `\]`, `\{` and `\}`, which move the run of slices \(see Slice section\)/);
  assert.doesNotMatch(flat(skill), /one for slices \(empty so far\)/);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { HOTKEYS } = require('../web/hotkeys');

// The edit form opened from a card's details gives the card back when it is saved or left. The docs say
// what returns, which keys leave, when the form asks first, that the address and the details agree, and
// what a form opened any other way does (edit-returns-to-details.test.js proves each on the real page).

const root = path.join(__dirname, '..', '..', '..');
const flat = (s) => s.replace(/\s+/g, ' ');
const docs = flat(fs.readFileSync(path.join(root, 'docs', 'web.md'), 'utf8'));
const skill = flat(fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8'));

const start = docs.indexOf("A form opened from a card's details gives the card back.");
const paragraph = docs.slice(start, start + 1500);

test('docs/web.md has the paragraph on the form that gives the card back', () => {
  assert.ok(start > -1, 'the paragraph is found');
});

test('it says Save writes the card and shows its details again, the card staying open, with the focus on the details', () => {
  assert.match(paragraph, /\*\*Save\*\* \(the button or Ctrl\/Cmd\+S\) writes the card and shows its details again with what was saved/);
  assert.match(paragraph, /focus on the details, and does not close the card/);
});

test('it says Esc, the X and the backdrop leave the form and show the details, asking first when there are unsaved changes', () => {
  assert.match(paragraph, /\*\*Esc\*\*, the X and a click on the backdrop leave the form and show the details as they were/);
  assert.match(paragraph, /unsaved changes, leaving it asks first, and cancel keeps you in the form/);
});

test('it says the details agree with the address after Back or Forward, and a card opened meanwhile stands', () => {
  assert.match(paragraph, /Back or Forward moved the address while the form was up, leaving the form shows the card the address names, or the board when it names none/);
  assert.match(paragraph, /open or close another card while Save is still reading the board, that choice stands/);
});

test('it says a card deleted on disk closes to the board with a toast and leaves the address', () => {
  assert.match(paragraph, /deleted on disk while its form was up closes to the board with a toast saying the card is gone, and `\?card=` leaves the address/);
});

test('it says a form opened any other way closes to the board', () => {
  assert.match(paragraph, /opened any other way \(New card, Add child…\) closes to the board when saved or left/);
});

test('the phone Card line says Save and leaving return to the card in two short sentences, not a chain of ands', () => {
  const line = docs.slice(docs.indexOf('- **Card.** A card opens full screen'), docs.indexOf('- **Card.** A card opens full screen') + 600);
  assert.match(line, /Save returns to the card on the tab of its new status, and so does leaving the form\. `\?card=` links open the card over its tab\./);
  assert.doesNotMatch(line, /and leaving the form returns to the card too/);
});

test('the web skill\'s Esc paragraph says a form opened from a card\'s details returns to those details', () => {
  assert.match(skill, /close directly on Esc \(a form opened from a card's details returns to those details, as it does when saved or left by its X\)/);
});

test('the hotkeys sheet\'s Esc entry says the edit form opened from the details returns to them, after the question', () => {
  const esc = HOTKEYS.find((h) => h.id === 'escape');
  assert.match(esc.what, /In the edit form opened from a card's details, leave it and return to the details \(after the unsaved-changes question, when there are changes\)\./);
});

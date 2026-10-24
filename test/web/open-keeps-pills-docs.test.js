const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill and the web doc say that opening a card changes no filter: a click that opens
// a card leaves every pill that is on, the text in the search box and the cards the view
// shows as they were, and so does closing the card; a click that only selects a card still
// takes the selection's pills out of the box.

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = flat(read('docs', 'web.md'));

function bullet(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the text`);
  const next = text.indexOf('\n- **', start + 4);
  return flat(text.slice(start, next === -1 ? undefined : next));
}

test('the multi-select section says a click that opens a card changes no filter and closing the details leaves the pills and the box', () => {
  const text = bullet(webSkill, '- **Multi-select**');
  assert.match(text, /A click that opens a card changes no filter: every pill that is on stays on, the box keeps its text, and the view behind the card details shows the same cards/);
  assert.match(text, /the click drops only the selection's other parts, and closing the details leaves the pills and the box as they were/);
});

test('the multi-select section says a click that selects a card still takes the pills out of the box, and what a double click does', () => {
  const text = bullet(webSkill, '- **Multi-select**');
  assert.match(text, /A plain click that selects a card \(the Graph's, or a view the preferences sheet sets to selects\) does the same to the pills the selection held: it replaces the selection, so the pills go off and their queries out of the box/);
  assert.match(text, /A double click is two clicks and an open: where a plain click selects \(the Graph, or a view set to selects\) its first click selects the card and takes the pills out, as any selecting click does, and the open that follows changes nothing/);
});

test('the skill no longer says a click that opens a card empties the selection and turns its pills off', () => {
  const text = bullet(webSkill, '- **Multi-select**');
  assert.doesNotMatch(text, /one that opens the card empties the selection/);
  assert.doesNotMatch(text, /either way the pills go off/);
});

test('the web doc says a click that opens a card changes no filter, and one that selects still drops the pills', () => {
  assert.match(webDoc, /a plain click that selects a card drops the pills the same way, but a click that opens a card changes no filter: the pills stay on, the box keeps its text, the view behind the card shows the same cards, and closing the card leaves them so/);
  assert.doesNotMatch(webDoc, /a plain click on a card, which opens it or selects it, drops the pills the same way/);
});

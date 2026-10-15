const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The web skill, the web doc and ADR 0006's amendment of 2026-10-15 say what a
// click and a double click on empty space do: a single click leaves the
// selection, the anchor, the pills and the box; a double click clears them and
// takes the anchor's text out of the box; a double click that already means
// something stays what it is; Esc is the step-by-step way back.

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');
const webSkill = read('skills', 'web', 'SKILL.md');
const webDoc = flat(read('docs', 'web.md'));
const adr = flat(read('docs', 'adr', '0006-one-interaction-grammar.md'));

function bullet(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start !== -1, `${marker} is in the text`);
  const next = text.indexOf('\n- **', start + 4);
  return flat(text.slice(start, next === -1 ? undefined : next));
}

const multiSelect = () => bullet(webSkill, '- **Multi-select**');

test('the multi-select section says a click on empty space leaves the selection, the anchor, the pills and the box', () => {
  const text = multiSelect();
  assert.match(text, /A click on empty space leaves the selection, its anchor, the pills and the search box as they were/);
  assert.match(text, /it can be an accident/);
});

test('the multi-select section says a double click on empty space clears the selection and the anchor, and takes the anchor\'s text out of the box, so the chip goes off', () => {
  const text = multiSelect();
  assert.match(text, /A \*\*double click\*\* on empty space clears them: the additions, the anchor, and the anchor's text in the box \(a pill's query, a search typed in the Graph\), so its chip goes off/);
});

test('the multi-select section says how the page tells a double click, and what empty space is', () => {
  const text = multiSelect();
  assert.match(text, /the second click of a pair \(the click's count, 2\), never as a `dblclick` event/);
  assert.match(text, /Empty space is anywhere but a card or a Graph dot, a button, link, text field or select, a popup or the card menu, or a control wearing the `data-keeps-selection` marker/);
  assert.match(text, /held with Shift, Ctrl or Cmd builds a selection and never clears one/);
});

test('the multi-select section says a double click that already means something stays, the Calendar\'s day cells and time-grid columns first, and that Esc is the way back', () => {
  const text = multiSelect();
  assert.match(text, /Where a double click on empty space already means something, that meaning stands and the selection stays: the Calendar's day cells and time-grid columns start a new card/);
  assert.match(text, /Esc stays the step-by-step way back/);
  assert.doesNotMatch(text, /Any plain click outside the context menu/);
  assert.doesNotMatch(text, /map\/gantt whitespace included/);
});

test('the Graph entries say a click on the empty Graph leaves the selection and a double click clears it', () => {
  assert.match(multiSelect(), /a pan keeps the selection, and a click on the empty Graph leaves it; a double click on the empty Graph clears it/);
  const graph = bullet(webSkill, '- **Graph view**');
  assert.match(graph, /Emptying the box, \*\*Esc\*\* and a double click on the empty Graph drop the anchor and the dimming/);
  assert.doesNotMatch(graph, /and a click on the empty Graph drop/);
});

test('the Calendar entries say a click on an empty day cell leaves the selection and a double click creates a card', () => {
  const calendar = bullet(webSkill, '- **Calendar view**');
  assert.match(calendar, /a click on an empty day cell leaves the selection, and a double click starts a new card there \(\*\*Click-to-create\*\* below\)/);
  assert.match(calendar, /\*\*Click-to-create\*\* — a double click on empty calendar space creates a card, and a single click there leaves the selection/);
  assert.match(calendar, /ADR 0006's 2026-10-15 amendment/);
  assert.doesNotMatch(calendar, /pins a plain click on empty calendar space to clearing the selection/);
  assert.doesNotMatch(calendar, /clicking an empty day cell clears the selection/);
});

test('the web doc says what a click and a double click on empty space do, and that the Calendar keeps its create gesture', () => {
  assert.match(webDoc, /A click on empty space never touches the selection, since it can be an accident\. A double click on empty space clears it: the additions, the anchor, and the anchor's text in the box/);
  assert.match(webDoc, /a pill's query or a search typed in the Graph/);
  assert.match(webDoc, /where a double click already does something, as it does on the Calendar's empty days and time slots, it does that and the selection stays/i);
  assert.match(webDoc, /Esc still steps back/);
  assert.match(webDoc, /Double-click an empty day, or a slot in the time grid, to start a new card there/);
  assert.match(webDoc, /Empty the box, press Esc or double-click the empty Graph to drop it/);
  assert.doesNotMatch(webDoc, /or click the empty Graph to drop it/);
});

test('ADR 0006 has an amendment of 2026-10-15 that reverses the rule that a plain click elsewhere clears the selection', () => {
  assert.match(adr, /Amended: 2026-07-13 \(selection gestures\), 2026-10-14 \(anchor, peek, isolate\), 2026-10-15 \(empty space\)/);
  const start = adr.indexOf('## Amendment (2026-10-15)');
  assert.ok(start !== -1, 'the amendment is there');
  const text = adr.slice(start);
  assert.match(text, /a plain click on empty space no longer clears the selection/);
  assert.match(text, /A double click on empty space clears it: the additions, the anchor, and the anchor's text in the box/);
  assert.match(text, /Esc keeps its order: a popup, then the additions, then the anchor/);
  assert.match(text, /Where a double click on empty space already means something, that meaning stands and the selection stays/);
  assert.match(text, /the Calendar's day cells and time-grid columns, which create a card/);
  assert.match(text, /plain click elsewhere = clear/, 'it names the rule it reverses');
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// A click that selects writes the selection into the search box with isolate off. The web skill and
// the web docs say what it writes and where, and none still says that a click clears the box.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillMirror = flat(skill.slice(skill.indexOf('**The box shows the selection.**'), skill.indexOf('Bulk targets are fixed when an')));
const docsMirror = flat(docs.slice(docs.indexOf('**The box shows the selection**'), docs.indexOf('**Bulk actions**')));
const skillGraph = flat(skill.slice(skill.indexOf('A **search typed in the Graph** is'), skill.indexOf('**Double-click** (or **Enter** on')));
const docsGraph = flat(docs.slice(docs.indexOf('A search typed in the Graph hides nothing'), docs.indexOf('Drag the background to pan')));

test('the web skill says which clicks write the selection into the box, as which text, and that it is no typed search', () => {
  assert.match(skillMirror, /With isolate off a click that selects \(the Graph's plain click; Shift and Ctrl\/Cmd clicks in every view; a Flow lane header as its card; the card menu's Add to selection\) writes the selection into the search box as the text Isolate would write for it, the `slice:` run kept \(`#34`, `#34 \| #36`, `dpath:185 \| #14`; a part that is one query is written as it was typed\)/);
  assert.match(skillMirror, /reason `mirror` \(`mirrorSelectionInBox`, with the text built by `searchMirrorBox` in the search module\): it turns isolate on for no one and never makes the box a typed search, so the next click still sees the card parts/);
});

test('the web skill says what a Ctrl-click out, an open, isolate on, Esc and a view switch do to the box', () => {
  assert.match(skillMirror, /Ctrl-click on a picked card takes it out and the box shows what is left; an empty selection leaves the box its `slice:` run/);
  assert.match(skillMirror, /While isolate is on a click keeps the rule above, and a click that opens a card writes nothing/);
  assert.match(skillMirror, /Esc's step and a double click on empty space take the box down with the selection only while it holds the selection's text/);
  assert.match(skillMirror, /A `mirror` write never makes the Calendar or the Gantt jump to the nearest match, though entering one with the box showing a selection does, as for any query whose matches are off screen/);
  assert.match(skillMirror, /a switch of view writes the selection when it changed it \(leaving the Graph with cards picked beside a typed search\) and leaves a typed search with nothing picked in the box/);
});

test('the web docs say the box shows the selection, in the same cases', () => {
  assert.match(docsMirror, /with isolate off, a click that selects a card writes the selection into the search box as the text Isolate would write for it: `#34`, then `#34 \| #36` as more are added, `dpath:185 \| #14` beside a path you searched, with the `slice:` run kept/);
  assert.match(docsMirror, /Isolate stays off, so the box lights those cards and hides nothing, and the text is the selection's own, not a search you typed: the next click still works on the cards/);
  assert.match(docsMirror, /Ctrl-click on a picked card takes it out and the box shows what is left; with nothing left it holds only its `slice:` run/);
  assert.match(docsMirror, /The Graph's plain click, Shift- and Ctrl-clicks in every view, a Flow lane header and the card menu's Add to selection all write it, and so does a switch of view that changes the selection/);
  assert.match(docsMirror, /A click never pages the Calendar or the Gantt; entering one with the box showing a selection jumps to it, as it does for any query whose matches are off screen/);
  assert.match(docsMirror, /A click that opens a card writes nothing, and while isolate is on a click moves the anchor and leaves the box and its isolate text/);
});

test('the Graph entries say a click shows the card in the box and a Shift or Ctrl click writes it beside the typed query', () => {
  assert.match(skillGraph, /a plain click on a card sets a new card anchor and the box shows that card in place of the search, its cut kept/);
  assert.match(skillGraph, /shift\+click or ctrl\/cmd\+click on an unlit card adds it and writes it beside the query \(`move the \| #5`\), which stays the typed anchor/);
  assert.match(skillGraph, /turns the query into its other cards, which the box then names \(`#2 \| #8`\)/);
  assert.match(docsGraph, /click a card to start a new selection, which the box shows in place of the search \(`#34`\), its cut kept/);
});

test('the address entry and the pill entry say the box is what a click that selects writes', () => {
  assert.match(flat(skill), /a `\?q=` link, and a click that selects a card\) replaces `q` with the box's/);
  assert.match(flat(skill), /turns the pill into its other cards, which the box then names, so the view does not widen under the click/);
});

test('the glossary names the mirror, and says it is the text of the selection itself and not a typed query', () => {
  const glossary = read('GLOSSARY.md');
  const entry = flat(glossary.slice(glossary.indexOf('**Mirror**:'), glossary.indexOf('**On hover show**:')));
  assert.match(entry, /The selection written into the search box as the text Isolate would write for it, when a click that selects, an Add to selection, a step of Esc or a switch of view changes the selection while Isolate is off/);
  assert.match(entry, /the text is the selection's own, not a query typed, so the next click still works on the cards/);
});

test('none of them still says that a click clears the box, or leaves it as it was for the Graph', () => {
  for (const [name, text] of [['skill', flat(skill)], ['docs', flat(docs)]]) {
    assert.doesNotMatch(text, /sets a new card anchor and clears the box/, name);
    assert.doesNotMatch(text, /start a new selection and clear the box but for its cut/, name);
    assert.doesNotMatch(text, /which clears the box but for its cut, since it no longer names the anchor/, name);
    assert.doesNotMatch(text, /adds it and keeps the query, and on a card the query lit/, name);
    assert.doesNotMatch(text, /turns the pill into its other cards and leaves the box/, name);
    assert.doesNotMatch(text, /a click in the Graph that drops a typed search/, name);
  }
});

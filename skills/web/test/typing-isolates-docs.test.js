const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { prefsDefaults, PREFS_TYPING_VIEWS } = require('../web/prefs');
const { ISOLATING_REASONS } = require('../web/selection');

// The web skill, the web docs and the glossary say that outside the Graph the search box hides what
// it does not match only while Isolate is on, and lights its matches otherwise; that typing, a pill,
// a cue and a link turn Isolate on in a view whose Typing isolates is on (every view but the Graph, to
// start); where the checkboxes are and what they keep; and what turning such an isolate off gives back.
// They no longer say the box filters every view, or that Isolate keeps the box's own text beside a
// picked card, path or tree, or that Explore leaves Isolate as it was. What they promise about the
// choices is held to the preferences and the writer's reasons, so a doc cannot promise what the page
// does not do.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', '..', '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const glossary = read('GLOSSARY.md');
const flat = (text) => text.replace(/\s+/g, ' ');

const skillSearch = flat(skill.slice(skill.indexOf('- **Search** —'), skill.indexOf('- **Search panel**') > 0 ? skill.indexOf('- **Search panel**') : skill.indexOf('- **Search** —') + 2500));
const skillIsolate = flat(skill.slice(skill.indexOf('- **Isolate**'), skill.indexOf('- **Preferences sheet**')));
const skillTyping = skillIsolate.slice(skillIsolate.indexOf('**Typing isolates.**'), skillIsolate.indexOf('**The menus offer it.**'));
const docsSearch = flat(docs.slice(docs.indexOf('**Search** —'), docs.indexOf('**Search panel** —')));
const docsTyping = flat(docs.slice(docs.indexOf('**Typing isolates** —'), docs.indexOf('**Notifications inbox**')));

test('the skill\'s Search entry says the box says what and Isolate says hide or light, with the selected look and the cut', () => {
  assert.match(skillSearch, /says \*what\* and Isolate says \*hide or light\*, in every view/);
  assert.match(skillSearch, /with isolate on the box hides what it does not match/);
  assert.match(skillSearch, /with isolate off it lights its matches with the selected look/);
  assert.match(skillSearch, /hides nothing but a top-level `slice:` cut, which hides in every view whatever isolate is/);
  assert.match(skillSearch, /no card is selected by it, and no action reads it/);
});

test('the skill and the docs say which writes turn isolate on, and the views it is on in to start', () => {
  assert.match(skillSearch, /Typing in the box, a pill, a cue on a card and a `\?q=` link turn isolate on in a view whose \*\*Typing isolates\*\* checkbox is ticked/);
  assert.match(skillSearch, /every view but the Graph to start/);
  assert.match(docsSearch, /Typing, a pill, a tag or assignee cue and a link with a search turn Isolate on in a view whose \*\*Typing isolates\*\* is on/);
  assert.match(docsSearch, /every view but the Graph to start/);
  assert.deepStrictEqual(ISOLATING_REASONS, ['typing', 'pill', 'cue', 'link']);
  for (const reason of ISOLATING_REASONS) assert.ok(skillTyping.includes(`\`${reason}\``), `the skill names the reason ${reason}`);
  assert.match(skillTyping, /The clear button, the Ctrl\+F prefill, a cut, a click's selection and a menu item turn nothing on/);
  assert.match(skillTyping, /a box that holds only a `slice:` cut has no query to isolate/);
});

test('both describe the checkboxes: one for each view in the panel\'s foot, kept per board, on in every view but the Graph', () => {
  assert.deepStrictEqual(PREFS_TYPING_VIEWS, ['board', 'map', 'calendar', 'gantt', 'graph']);
  const defaults = prefsDefaults().typingIsolates;
  assert.deepStrictEqual(Object.keys(defaults).filter((view) => !defaults[view]), ['graph'], 'the Graph alone starts unticked');
  assert.match(skillTyping, /one checkbox for each view \(`#search-typing`, an input with `data-typing-view` for Board, Calendar, Gantt, Map and Graph\)/);
  assert.match(skillTyping, /kept per board in the browser's preferences \(`typingIsolates`, `prefs\.js`\)/);
  assert.match(skillTyping, /ticked in every view but the Graph, so typing narrows the Board and lights in the Graph as it always did/);
  assert.match(docsTyping, /a \*\*Typing isolates\*\* checkbox for each view: Board, Calendar, Gantt, Map and Graph/);
  assert.match(docsTyping, /on in every view but the Graph/);
  assert.match(docsTyping, /kept in your browser, per board/);
});

test('both say what an unticked view does: the matches wear the selected look, nothing hides, nothing is selected, and the switch can still isolate it', () => {
  assert.match(skillTyping, /its matches wear the selected look, nothing hides and no card is selected/);
  assert.match(skillTyping, /the switch or `i` can still isolate the query as it stands/);
  assert.match(docsTyping, /lights its matches with the look of a selected card, hides nothing, and selects nothing/);
  assert.match(docsTyping, /the switch or `i` still isolates the query as it stands/);
});

test('both say what turning such an isolate off gives back, and that a view with the checkbox off ends it', () => {
  assert.match(skillTyping, /`\{ previous, following \}`: what turning isolate off gives back is the box's text as it stands, so the typed query stays in the box, lit, and the next Esc clears it/);
  assert.match(skillTyping, /going to a view whose checkbox is unticked ends such an isolate the same way/);
  assert.match(docsTyping, /gives back the box's text as it stands when you turn it off, so the query stays in the box, lit, and the next Esc clears it/);
  assert.match(docsTyping, /going to a view where the checkbox is off does the same/);
});

test('the skill says a pill taken out turns nothing on, that the address carries the isolate parameter, and what the match holds', () => {
  assert.match(skillTyping, /The address then carries `isolate=1` beside `q`/);
  assert.match(skillTyping, /A pill taken out, by a click or by Esc, turns nothing on \(the reason `unpill`\)/);
  assert.match(skillTyping, /`ids` is what it hides by, `matched` what the whole query matches, which the jump to the nearest match and Enter read, and `lit` what it lights/);
});

test('both say a cut hides in every view whatever Isolate is', () => {
  assert.match(docsTyping, /A `slice:` cut hides in every view whatever Isolate is/);
  assert.match(docsSearch, /with Isolate on the box hides what it does not match, and with it off the box lights its matches/);
});

test('Isolate gives back the text the box held, keeps only the cut, and isolates a lit query as it stands', () => {
  assert.match(skillIsolate, /The text the box held is given back when isolate goes off, and a run of slices in it stays in the isolate text/);
  assert.match(skillIsolate, /with isolate off the box hides nothing but a cut, so the selection already holds every card, path and tree it names/);
  assert.match(skillIsolate, /With nothing selected, a query the box lights is isolated as it stands/);
  assert.match(docs, /The text the box held is given back when you turn it off, and a `slice:` cut in it stays\./);
});

test('Explore follows the view\'s Typing isolates, as typing does', () => {
  assert.match(flat(skill), /isolate follows the view's Typing isolates as typing into the box does: ticked, a pick turns isolate on/);
  assert.match(flat(docs), /Isolate follows the Typing isolates of the view, as typing into the box does/);
});

test('a deep link\'s query is isolated where the view isolates what is typed, and a pill\'s chip says so', () => {
  assert.match(flat(skill), /puts the query in the box \(which isolates it where the view's Typing isolates is ticked/);
  assert.match(flat(skill), /`2 on: review, isolated` where the pill turned isolate on/);
});

test('the glossary names the term', () => {
  const entry = flat(glossary.slice(glossary.indexOf('**Typing isolates**:'), glossary.indexOf('**Peek**:')));
  assert.match(entry, /A per-view choice, kept per board, whether a query the person makes/);
  assert.match(entry, /on in every view but the Graph/);
});

test('the words the change made false are gone from all three', () => {
  for (const [where, text] of [['the skill', flat(skill)], ['the docs', flat(docs)], ['the glossary', flat(glossary)]]) {
    assert.doesNotMatch(text, /filters every view as you type/, where);
    assert.doesNotMatch(text, /filters every view at once, except the Graph/, where);
    assert.doesNotMatch(text, /ANDed on/, where);
    assert.doesNotMatch(text, /the box's own text stays beside them/, where);
    assert.doesNotMatch(text, /so those cards stay hidden/, where);
    assert.doesNotMatch(text, /Isolate stays as it was: off stays off/, where);
    assert.doesNotMatch(text, /isolate is left as typing into the box leaves it/, where);
    assert.doesNotMatch(text, /the Board, the Map, the Gantt and the Calendar filter by the box as they always do/, where);
  }
});

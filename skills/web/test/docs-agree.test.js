const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The glossary, ADR 0006's amendments, the README, the web skill and the web doc tell one
// story about pills, the selection, icons and the config keys. Each section has its own
// tests; these tests pin the places where two sections once disagreed, and the places
// no section named: a board pill clicks as a built-in does, the page draws what the
// config carries, a key the guard covers is named with the others, a doc that lists the
// keys of a type lists its icon.

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');

const skill = read('skills', 'web', 'SKILL.md');
const docs = read('docs', 'web.md');
const glossary = read('GLOSSARY.md');
const adr = flat(read('docs', 'adr', '0006-one-interaction-grammar.md'));
const readme = read('README.md');

function between(text, from, to) {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `${from} is in the text`);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end !== -1, `${to} follows ${from}`);
  return flat(text.slice(start, end));
}

const skillBoardPills = between(skill, '- **Board pills**', '- **Isolate**');
const docsBoardPills = between(docs, '**Board pills**', '**Isolate**');

test('a board pill clicks as a built-in does: a click turns it on or off and Shift+click is a plain click', () => {
  for (const [where, text] of [['the web skill', skillBoardPills], ['the web doc', docsBoardPills]]) {
    assert.match(text, /a click turns it on or off/, where);
    assert.match(text, /Shift\+click is a plain click/, where);
    assert.match(text, /first pill on is the anchor/, where);
    assert.doesNotMatch(text, /makes its query the anchor and puts it in the box/, `${where}: a click no longer replaces the anchor`);
    assert.doesNotMatch(text, /Shift\+click grows the box/, `${where}: Shift+click no longer grows the box`);
  }
});

test('the web skill says the page draws the hierarchy and the pills the board answer carries', () => {
  const bullet = between(skill, '- **`pills`** (block form only)', '- **`assignees[].color`**');
  assert.doesNotMatch(bullet, /nothing draws them yet/);
  assert.match(bullet, /search panel draws the pills/);
  assert.match(bullet, /hierarchy/);
});

test('the key guard paragraph names every single key the guard covers, n included', () => {
  const guard = between(skill, 'Both read one **key guard**', '- **Comboboxes**');
  for (const key of ['/', 'p', '?', 'm', 'i', 'l', 'n']) assert.ok(guard.includes(`\`${key}\``), `the guard paragraph names ${key}`);
  assert.match(guard, /`\[`, `\]`, `\{` and `\}`/);
});

test('the multi-select entry does not leave a dangling reason after the list of controls that keep the selection', () => {
  const multi = between(skill, '- **Multi-select**', '- **Search panel**');
  assert.doesNotMatch(multi, /the Graph's controls do\), so the selection/);
  assert.match(multi, /The selection survives switching views and it survives the poll/);
});

test('the multi-select entry says Esc in the box takes a typed Graph search, which is the anchor, with it', () => {
  const multi = between(skill, '- **Multi-select**', '- **Search panel**');
  assert.match(multi, /with focus in the search box Esc clears the box and leaves the selection \(in the Graph, where a typed search is the anchor, clearing the box takes the anchor and the additions with it\)/);
});

test('the Graph entry says where the Unnested cards go by the option, the table among its choices', () => {
  const graph = between(skill, '- **Graph view**', '## Board config');
  assert.match(graph, /on one ring outside the fan by default, or, with the table choice, in the \*\*Unnested\*\* block outside the rim/);
});

test("the web doc says a type's icon starts its chip and draws its Graph dot, and names the six", () => {
  const text = flat(docs);
  assert.match(text, /type chip[^.]*starts with the type's icon/i);
  assert.match(text, /draws its dot in that outline/);
  assert.match(text, /circle, square, diamond, triangle, hexagon or star/);
  assert.match(text, /A shape, never a colour|an icon is a shape, never a colour/i);
});

test('the Graph entry gives no stale reason for the swallowed click that ends a pan: a click no longer clears the selection', () => {
  const graph = between(skill, '- **Graph view**', '## Board config');
  assert.doesNotMatch(graph, /is swallowed, so it never clears the selection/);
  assert.match(graph, /is swallowed, so a pan is never read as a click on empty space and keeps the selection/);
});

test('the kanban skill says a type may carry an icon where it lists the types, and the field:* expansion reaches the snapshot', () => {
  const kanban = read('skills', 'kanban', 'SKILL.md');
  const config = flat(kanban.slice(kanban.indexOf('### `config.yaml`'), kanban.indexOf('### `notifications.md`')));
  assert.match(config, /Entries give a `type:` word a chip color and, optionally, an icon \(see `icon` below\)/);
  assert.match(config, /expands in the web app's search panel \(and the snapshot's\) to one pill per distinct value/);
});

test("the Map entry, where the status-filter row is first described, says these are the glossary's status pills and not the search panel's pills", () => {
  const map = between(skill, '- **Dependency map**', '- **Calendar view**');
  assert.match(map, /These are the glossary's \*\*status pills\*\*: they hide cards, and they are not the search panel's pills, which are queries \(see Search panel\)/);
});

test('ADR 0013 says where the loose cards with no tier go, since the fan draws them as its Unnested option says', () => {
  const adr13 = flat(read('docs', 'adr', '0013-a-board-hierarchy-orders-drawing-and-enforces-nothing.md'));
  assert.match(adr13, /the loose ones, with no parent and no children, sit on a ring of their own outside the rest unless the fan's Unnested option says otherwise/);
});

test('the glossary says a pill follows the status pills\' rules, with the first pill on the anchor', () => {
  const entry = between(glossary, '**Pill** (via **pills:**)', '**Status pill**');
  assert.match(entry, /a click turns one on or off/);
  assert.match(entry, /a right-click keeps only that one/);
  assert.match(entry, /first one on is the anchor/);
  assert.doesNotMatch(entry, /adds them to the selection/);
});

test('the glossary says a type may carry an icon, and that the Graph view draws the fan with its unnested ring', () => {
  const type = between(glossary, '**Card type** (via **type**)', '**Hierarchy**');
  assert.match(type, /its color and icon/);
  const graph = between(glossary, '**Graph view** (web only)', '**Unnested**');
  assert.match(graph, /tier fan/);
  assert.match(graph, /all the way round/);
});

test('the glossary says the waiting state is a search term and a built-in pill, as review is', () => {
  const entry = between(glossary, '**Waiting** (derived, via **waiting_for**)', '**Blocked** (manual');
  assert.match(entry, /bare `waiting:` search term and the built-in pill of the same name/);
});

test('the glossary names what the snapshot shares with the web and what stays web only', () => {
  const parity = between(glossary, '**Parity rule:**', 'Web\'s `tree:<id>`');
  assert.match(parity, /selection, Isolate and Peek are web-only/);
  assert.match(parity, /search grammar, the slices and the pills are shared/);
});

test('ADR 0006 says the Graph always selects, as a fixed choice, where the other views default to open', () => {
  const amendment = adr.slice(adr.indexOf('## Amendment (2026-10-14)'), adr.indexOf('## Amendment (2026-10-15)'));
  assert.doesNotMatch(amendment, /the Graph selects, the other views open/);
  assert.match(amendment, /the other views open, and the Graph always selects/);
});

test('ADR 0006 gives a pill the status pills\' rules and a card\'s click the anchor, with no right-click that replaces', () => {
  const amendment = adr.slice(adr.indexOf('## Amendment (2026-10-14)'), adr.indexOf('## Amendment (2026-10-15)'));
  assert.ok(amendment.length > 500, 'the 2026-10-14 amendment is found');
  assert.doesNotMatch(amendment, /plain click on a card or a pill, with either button/);
  assert.match(amendment, /A pill is not a card: it follows the status pills' rules/);
  assert.match(amendment, /first pill on is the anchor and later ones are additions/);
  assert.match(amendment, /Esc steps back in three stages: isolate off, then every addition at once, then the anchor/);
});

test('the README counts the architecture decision records it links, and says what the web editor\'s search holds', () => {
  assert.match(flat(readme), /ADR 0001.0013/);
  assert.doesNotMatch(flat(readme), /ADR 0001.0010/);
  assert.match(flat(readme), /search panel of slices and pills/);
});

test('no doc mentions the header\'s Bar select or a header archived-leaves checkbox', () => {
  const files = [['README.md'], ['GLOSSARY.md'], ['docs', 'web.md'], ['docs', 'snapshot.md'], ['skills', 'web', 'SKILL.md'], ['skills', 'snapshot', 'SKILL.md'], ['skills', 'kanban', 'SKILL.md']];
  for (const file of files) {
    const text = flat(read(...file));
    assert.doesNotMatch(text, /Bar select|\*\*Bar\*\* select|Archived checkbox|Archived box/i, file.join('/'));
    assert.doesNotMatch(text, /header[^.]{0,80}(archived leaves|roll-up bar mode)[^.]{0,40}(checkbox|select)/i, file.join('/'));
  }
});

const TERMS = [
  ['Hierarchy', /The types a board declares as the levels of its plan, top first[^\n]*enforces nothing/],
  ['Tier', /A card's place in the hierarchy, read from its type: the first type listed is tier 1[^\n]*no tier/],
  ['Slice', /One place on a board's single top-to-bottom axis: each tier of the hierarchy in order, then each depth for the cards without a tier/],
  ['Selection', /The cards picked right now, the same set in every view[^\n]*grows from an anchor by additions/],
  ['Anchor', /What a selection grows from: one card, or one query \(a pill or the search box\)[^\n]*drops the additions first, then the anchor/],
  ['Pill', /A search query offered as one click: blocked, review and waiting are built in, and a board adds its own in `pills:`/],
  ['Status pill', /One status's switch in a view's row: on shows that status's cards, off hides them[^\n]*never touches the selection/],
  ['Isolate', /Showing only the selection, in every view, kept as a query in the search box that names each part by its criterion/],
  ['Peek', /Opening a card's details without changing the selection/],
  ['Unnested', /A card with no parent and no children\. It may still wait for a card or be waited for/],
];

test('the glossary defines hierarchy, tier, slice, selection, anchor, pill, status pill, isolate, peek and unnested, each as shipped', () => {
  for (const [term, definition] of TERMS) {
    const entry = new RegExp(String.raw`^\*\*${term}\*\*[^\n]*:\n([^\n]+)\n_Avoid_:`, 'm').exec(glossary);
    assert.ok(entry, `${term} has an entry with a definition and an Avoid line`);
    assert.match(entry[1], definition, term);
  }
});

test('the glossary says the Graph view leaves the unnested cards where its option row puts them', () => {
  const graph = between(glossary, '**Graph view** (web only)', '**Unnested**');
  assert.match(graph, /unless the layout's option row puts them on the depth 0 ring or in a block, or leaves them out/);
  assert.match(graph, /A card with no parent and no children is \*\*unnested\*\*/);
});

test('ADR 0013 is accepted, says a hierarchy orders drawing and enforces nothing, and says it narrows ADR 0012', () => {
  const adr13 = flat(read('docs', 'adr', '0013-a-board-hierarchy-orders-drawing-and-enforces-nothing.md'));
  assert.match(adr13, /^# 0013\. A board's hierarchy orders how types are drawn and enforces nothing/);
  assert.match(adr13, /Status: accepted/);
  assert.match(adr13, /A card's \*\*tier\*\* is its type's place in that list; a card whose type is not listed has none/);
  assert.match(adr13, /no write path, check or warning compares a card's tier with its parent's/);
  assert.match(adr13, /This narrows ADR 0012's "attaches no meaning" to "enforces nothing"/);
});

test('ADR 0006 lists its three amendments in the header and has a section for each, the anchor, peek and isolate one naming all three', () => {
  assert.match(adr, /Amended: 2026-07-13 \(selection gestures\), 2026-10-14 \(anchor, peek, isolate\), 2026-10-15 \(empty space\)/);
  for (const heading of ['## Amendment (2026-07-13)', '## Amendment (2026-10-14): anchor, peek and isolate', '## Amendment (2026-10-15): empty space']) {
    assert.ok(adr.includes(heading), heading);
  }
  const amendment = adr.slice(adr.indexOf('## Amendment (2026-10-14)'), adr.indexOf('## Amendment (2026-10-15)'));
  for (const term of ['**anchor**', '**Peek**', '**Isolate**']) assert.ok(amendment.includes(term), term);
});

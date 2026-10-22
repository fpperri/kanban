const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sliceCards, sliceDepths } = require('../web/slices');
const { parseSearchQuery, filterCards } = require('../web/search');
const {
  sliceRunBounds, sliceListOf, sliceRunOf, sliceRunClick, sliceRunKeep, sliceRunStep, sliceRunValue, sliceRunCuts, sliceEntryName, sliceEntryKey,
  sliceKeyIsChord,
} = require('../web/slice-run');

// The slice section's run of slices, as pure arithmetic over the list the section
// shows: the slices module's axis with the tiers no card is in left out. A run is
// { from, to }, positions in that list (a run of one has from equal to to), or null
// when the box's slice: terms leave no slice at all.

const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const CARDS = [
  { id: 1, type: 'goal', parent: null },
  { id: 2, type: 'goal', parent: null },
  { id: 3, type: 'strategy', parent: 1 },
  { id: 4, type: 'epic', parent: 3 },
  { id: 5, type: 'story', parent: 4 },
  { id: 6, type: 'task', parent: 5 },
  { id: 7, type: 'story', parent: null },
  { id: 8, type: 'story', parent: 6 },
  { id: 9, type: 'story', parent: 8 },
  { id: 10, type: 'story', parent: 9 },
];
const DEPTHS = sliceDepths(CARDS, HIERARCHY, { board: 'b' });
const sliced = (cards = CARDS, hierarchy = HIERARCHY, depths = DEPTHS) => sliceCards(cards, hierarchy, depths);
const list = () => sliceListOf(sliced(), CARDS.map((c) => c.id));
const run = (from, to) => ({ from, to });

test('the list holds the tiers some card is in, in hierarchy order, then the depths', () => {
  const entries = list();
  assert.deepStrictEqual(entries.map((e) => e.label), ['goal', 'strategy', 'epic', 'depth 0', 'depth 1', 'depth 2', 'depth 3', 'depth 4']);
  assert.deepStrictEqual(entries.map((e) => e.kind), ['tier', 'tier', 'tier', 'depth', 'depth', 'depth', 'depth', 'depth']);
});

test('a tier that no card on the board has is not listed, though the axis has it', () => {
  const s = sliced();
  assert.ok(s.axis.some((a) => a.key === 'objective'), 'the axis holds the unused tier');
  assert.ok(!sliceListOf(s, CARDS.map((c) => c.id)).some((e) => e.name === 'objective'));
});

test('a tier whose only cards are not in the view is still listed, with a count of none', () => {
  const entries = sliceListOf(sliced(), [1, 5]);
  assert.deepStrictEqual(entries.map((e) => [e.label, e.count]), [['goal', 1], ['strategy', 0], ['epic', 0], ['depth 0', 1], ['depth 1', 0], ['depth 2', 0], ['depth 3', 0], ['depth 4', 0]]);
});

test('each count is over the ids given, so the caller picks the basis, and the board\'s cards fix what is listed', () => {
  assert.deepStrictEqual(list().map((e) => e.count), [2, 1, 1, 2, 1, 1, 1, 1]);
  assert.deepStrictEqual(sliceListOf(sliced(), [1, 2, 3]).map((e) => e.count).slice(0, 3), [2, 1, 0]);
  assert.deepStrictEqual(sliceListOf(sliced(), []).map((e) => e.count), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('an id the slices do not know is not counted', () => {
  assert.deepStrictEqual(sliceListOf(sliced(), [99]).map((e) => e.count).reduce((a, b) => a + b, 0), 0);
});

test('every entry keeps its place on the full axis, so a term written from the list reads back', () => {
  assert.deepStrictEqual(list().map((e) => e.index), [0, 1, 3, 4, 5, 6, 7, 8]);
});

test('a board with no hierarchy lists the depths only, and a board with no cards lists nothing', () => {
  const flat = sliceListOf(sliced(CARDS, [], DEPTHS), CARDS.map((c) => c.id));
  assert.deepStrictEqual(flat.map((e) => e.label), ['depth 0', 'depth 1', 'depth 2', 'depth 3', 'depth 4']);
  assert.deepStrictEqual(sliceListOf(sliced([], HIERARCHY, new Map()), []), []);
});

test('a tier is listed once however the hierarchy repeats it or cases it', () => {
  const cards = [{ id: 1, type: 'Goal', parent: null }, { id: 2, type: 'epic', parent: null }];
  const entries = sliceListOf(sliceCards(cards, ['Goal', 'goal', '', 'Epic', 'EPIC'], new Map([[1, 0], [2, 0]])), [1, 2]);
  assert.deepStrictEqual(entries.filter((e) => e.kind === 'tier').map((e) => e.label), ['Goal', 'Epic']);
});

// --- reading the run off the box's terms ---------------------------------------------------------

test('no slice: term is a run over every listed slice', () => {
  assert.deepStrictEqual(sliceRunOf(sliced(), list(), []), run(0, 7));
});

test('a run is the entries between the two ends, a tier by name in any letter case, a depth by number', () => {
  const s = sliced();
  assert.deepStrictEqual(sliceRunOf(s, list(), ['goal..epic']), run(0, 2));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['GOAL..Strategy']), run(0, 1));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['strategy..1']), run(1, 4));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['2']), run(5, 5));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['epic']), run(2, 2));
});

test('an end left open runs to that end of the axis', () => {
  const s = sliced();
  assert.deepStrictEqual(sliceRunOf(s, list(), ['..epic']), run(0, 2));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['epic..']), run(2, 7));
});

test('a reversed pair is swapped, as the term cuts the views', () => {
  assert.deepStrictEqual(sliceRunOf(sliced(), list(), ['epic..goal']), run(0, 2));
});

test('a single unknown name, an end the axis does not have and `..` cut nothing, so every entry is in the run', () => {
  const s = sliced();
  assert.deepStrictEqual(sliceRunOf(s, list(), ['nosuch']), run(0, 7));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['..']), run(0, 7));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['nosuch..nosuch']), run(0, 7));
  assert.deepStrictEqual(sliceRunOf(s, list(), ['nosuch..strategy']), run(0, 1), 'an unknown end is open');
});

test('a run that names the tier no card is in has no entry in it, and one that spans it keeps the entries around it', () => {
  const s = sliced();
  assert.strictEqual(sliceRunOf(s, list(), ['objective']), null);
  assert.deepStrictEqual(sliceRunOf(s, list(), ['strategy..epic']), run(1, 2), 'the unlisted objective sits between them');
});

test('two terms at the top level are both held, so the run is where they overlap, or nothing', () => {
  const s = sliced();
  assert.deepStrictEqual(sliceRunOf(s, list(), ['goal..strategy', 'strategy..epic']), run(1, 1));
  assert.strictEqual(sliceRunOf(s, list(), ['goal', 'epic']), null);
});

test('the run the list gives for a value is the cards the search module cuts to', () => {
  const s = sliced();
  const entries = list();
  const cards = CARDS.map((c) => ({ ...c, title: `c${c.id}`, body: '', status: 'todo', tags: [], waiting_for: [], priority: 'Normal', assignee: '' }));
  const values = ['goal..epic', 'epic..', '..strategy', '1', '1..3', 'nosuch', 'epic..goal', 'strategy', '0..2', 'GOAL'];
  for (const value of values) {
    const found = new Set(filterCards(cards, parseSearchQuery(`slice:${value}`, 'b'), { board: 'b', hierarchy: HIERARCHY }).map((c) => c.id));
    const r = sliceRunOf(s, entries, [value]);
    const inRun = new Set(entries.filter((e, at) => r && at >= r.from && at <= r.to).flatMap((e) => CARDS.filter((c) => s.byId.get(String(c.id)).index === e.index).map((c) => c.id)));
    assert.deepStrictEqual([...inRun].sort((a, b) => a - b), [...found].sort((a, b) => a - b), `slice:${value}`);
  }
});

test('the bounds a value names are the ends of the axis it is read against', () => {
  const { axis } = sliced();
  assert.deepStrictEqual(sliceRunBounds(axis, 'strategy..1'), { from: 1, to: 5 });
  assert.deepStrictEqual(sliceRunBounds(axis, '..'), { from: 0, to: 8 });
  assert.deepStrictEqual(sliceRunBounds(axis, 'epic..goal'), { from: 0, to: 3 });
});

// --- the clicks -----------------------------------------------------------------------------------

test('a click on a slice outside the run grows the run to it, above or below', () => {
  assert.deepStrictEqual(sliceRunClick(list(), run(2, 4), 6), run(2, 6));
  assert.deepStrictEqual(sliceRunClick(list(), run(2, 4), 0), run(0, 4));
  assert.deepStrictEqual(sliceRunClick(list(), run(2, 4), 7), run(2, 7));
});

test('a click on an end of the run drops that end', () => {
  assert.deepStrictEqual(sliceRunClick(list(), run(2, 4), 2), run(3, 4));
  assert.deepStrictEqual(sliceRunClick(list(), run(2, 4), 4), run(2, 3));
  assert.deepStrictEqual(sliceRunClick(list(), run(0, 7), 0), run(1, 7), 'the whole axis is a run too');
  assert.deepStrictEqual(sliceRunClick(list(), run(3, 4), 4), run(3, 3));
});

test('a click inside the run that is not an end changes nothing', () => {
  const before = run(1, 5);
  for (const at of [2, 3, 4]) assert.deepStrictEqual(sliceRunClick(list(), before, at), run(1, 5), `entry ${at}`);
  assert.deepStrictEqual(before, run(1, 5), 'the run it was given is left as it was');
});

test('a click on a run of one brings back every slice', () => {
  assert.deepStrictEqual(sliceRunClick(list(), run(3, 3), 3), run(0, 7));
});

test('a click on another slice when the run is one grows it, and a click when no slice is in the run starts one', () => {
  assert.deepStrictEqual(sliceRunClick(list(), run(3, 3), 5), run(3, 5));
  assert.deepStrictEqual(sliceRunClick(list(), null, 4), run(4, 4));
});

test('keep-only gives a run of one slice, whatever the run was', () => {
  assert.deepStrictEqual(sliceRunKeep(4), run(4, 4));
  assert.deepStrictEqual(sliceRunKeep(0), run(0, 0));
});

// --- the keys -------------------------------------------------------------------------------------

test('[ moves the bottom of the run up and ] moves it down', () => {
  assert.deepStrictEqual(sliceRunStep(list(), run(1, 4), '['), run(1, 3));
  assert.deepStrictEqual(sliceRunStep(list(), run(1, 4), ']'), run(1, 5));
});

test('{ moves the top of the run up and } moves it down', () => {
  assert.deepStrictEqual(sliceRunStep(list(), run(1, 4), '{'), run(0, 4));
  assert.deepStrictEqual(sliceRunStep(list(), run(1, 4), '}'), run(2, 4));
});

test('each key stops at the ends of the axis', () => {
  assert.deepStrictEqual(sliceRunStep(list(), run(0, 7), ']'), run(0, 7), 'the bottom is at the last slice');
  assert.deepStrictEqual(sliceRunStep(list(), run(0, 7), '{'), run(0, 7), 'the top is at the first slice');
  assert.deepStrictEqual(sliceRunStep(list(), run(0, 7), '['), run(0, 6));
  assert.deepStrictEqual(sliceRunStep(list(), run(0, 7), '}'), run(1, 7));
});

test('the top never passes the bottom: a run of one stays one under [ and }', () => {
  assert.deepStrictEqual(sliceRunStep(list(), run(3, 3), '['), run(3, 3));
  assert.deepStrictEqual(sliceRunStep(list(), run(3, 3), '}'), run(3, 3));
  assert.deepStrictEqual(sliceRunStep(list(), run(3, 3), ']'), run(3, 4), 'and the other two still widen it');
  assert.deepStrictEqual(sliceRunStep(list(), run(3, 3), '{'), run(2, 3));
});

test('no run, or a key that is not one of the four, leaves things as they are', () => {
  assert.strictEqual(sliceRunStep(list(), null, ']'), null);
  assert.deepStrictEqual(sliceRunStep(list(), run(1, 4), 'x'), run(1, 4));
});

test('a list of one slice has nowhere to go', () => {
  const one = [list()[0]];
  for (const key of ['[', ']', '{', '}']) assert.deepStrictEqual(sliceRunStep(one, run(0, 0), key), run(0, 0), key);
});

// --- the term a run is written as -----------------------------------------------------------------

test('a run over every slice writes no term', () => {
  assert.strictEqual(sliceRunValue(list(), run(0, 7)), '');
});

test('a run of one writes its name, a tier as the hierarchy wrote it and a depth as a number', () => {
  assert.strictEqual(sliceRunValue(list(), run(1, 1)), 'strategy');
  assert.strictEqual(sliceRunValue(list(), run(3, 3)), '0');
  assert.strictEqual(sliceRunValue(list(), run(0, 0)), 'goal');
});

test('a run that reaches an end of the axis leaves that end open, any other end is named', () => {
  assert.strictEqual(sliceRunValue(list(), run(0, 2)), '..epic');
  assert.strictEqual(sliceRunValue(list(), run(2, 7)), 'epic..');
  assert.strictEqual(sliceRunValue(list(), run(1, 4)), 'strategy..1');
});

test('the term a run is written as reads back as that run, for every run the list has', () => {
  const s = sliced();
  const entries = list();
  for (let from = 0; from < entries.length; from++) {
    for (let to = from; to < entries.length; to++) {
      const value = sliceRunValue(entries, run(from, to));
      assert.deepStrictEqual(sliceRunOf(s, entries, value ? [value] : []), run(from, to), `${from}..${to} as '${value}'`);
    }
  }
});

test('a run with no slice in it has no term to write', () => {
  assert.strictEqual(sliceRunValue(list(), null), '');
});

test('a run cuts when some listed slice is out of it, and an empty run is a cut', () => {
  assert.strictEqual(sliceRunCuts(list(), run(0, 7)), false);
  assert.strictEqual(sliceRunCuts(list(), run(1, 7)), true);
  assert.strictEqual(sliceRunCuts(list(), run(0, 6)), true);
  assert.strictEqual(sliceRunCuts(list(), null), true);
  assert.strictEqual(sliceRunCuts([], null), false, 'no slices, nothing to cut');
});

// --- the name of an entry ------------------------------------------------------------------------

test('an entry\'s name states its label, its count and whether it is in the run', () => {
  assert.strictEqual(sliceEntryName({ label: 'epic', count: 3 }, true), 'epic, 3 cards, in the run');
  assert.strictEqual(sliceEntryName({ label: 'depth 1', count: 0 }, false), 'depth 1, 0 cards, not in the run');
  assert.strictEqual(sliceEntryName({ label: 'goal', count: 1 }, true), 'goal, 1 card, in the run');
});

test('an entry\'s key is its own whatever the list holds, and the same after the list changes', () => {
  const keys = list().map(sliceEntryKey);
  assert.deepStrictEqual(keys, ['t:goal', 't:strategy', 't:epic', 'd:0', 'd:1', 'd:2', 'd:3', 'd:4']);
  assert.strictEqual(new Set(keys).size, keys.length);
  const more = sliceListOf(sliceCards([...CARDS, { id: 11, type: 'objective', parent: null }], HIERARCHY, sliceDepths([...CARDS, { id: 11, type: 'objective', parent: null }], HIERARCHY, { board: 'b' })), [1, 11]);
  assert.deepStrictEqual(more.slice(0, 4).map(sliceEntryKey), ['t:goal', 't:strategy', 't:objective', 't:epic'], 'a tier that joins leaves the others\' keys as they were');
  const cased = sliceListOf(sliceCards([{ id: 1, type: 'Goal', parent: null }], ['Goal'], new Map([[1, 0]])), [1]);
  assert.strictEqual(sliceEntryKey(cased[0]), 't:goal', 'a tier is keyed without regard to letter case');
});

// --- the module -----------------------------------------------------------------------------------

test('the module requires only the id module, so the snapshot can embed its source, and in a page it adds only its own names', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'web', 'slice-run.js'), 'utf8');
  assert.doesNotMatch(source, /\brequire\((?!'\.\/ids'\))/);
  const page = { window: {} };
  page.window = page;
  vm.createContext(page);
  vm.runInContext(source, page);
  for (const name of ['sliceRunBounds', 'sliceListOf', 'sliceRunOf', 'sliceRunClick', 'sliceRunKeep', 'sliceRunStep', 'sliceRunValue', 'sliceRunCuts', 'sliceEntryName', 'sliceEntryKey', 'sliceKeyIsChord']) {
    assert.strictEqual(typeof page[name], 'function', name);
  }
});

// --- the keys are no chord with AltGr ---------------------------------------------------------

test('Ctrl, Cmd and Alt held with a key make a chord, and AltGr, which the browser reports as Ctrl and Alt together, does not', () => {
  const key = (mods, altGraph = false) => ({ metaKey: false, ctrlKey: false, altKey: false, ...mods, getModifierState: (m) => m === 'AltGraph' && altGraph });
  assert.strictEqual(sliceKeyIsChord(key({})), false, 'a bare key');
  assert.strictEqual(sliceKeyIsChord(key({ ctrlKey: true })), true);
  assert.strictEqual(sliceKeyIsChord(key({ altKey: true })), true);
  assert.strictEqual(sliceKeyIsChord(key({ metaKey: true })), true);
  assert.strictEqual(sliceKeyIsChord(key({ ctrlKey: true, altKey: true }, true)), false, 'AltGr');
  assert.strictEqual(sliceKeyIsChord(key({ metaKey: true }, true)), true, 'Cmd stays a chord whatever AltGr says');
  assert.strictEqual(sliceKeyIsChord({ ctrlKey: true, altKey: true, metaKey: false }), true, 'an event that cannot say AltGr is read as a chord');
});

test('the chord rule lives in the module the snapshot embeds, and the page script does not carry its own copy', () => {
  const own = fs.readFileSync(path.join(__dirname, '..', 'web', 'search-slices.js'), 'utf8');
  assert.doesNotMatch(own, /function sliceKeyIsChord\(/);
  assert.match(own, /sliceKeyIsChord\(e\)/, 'and still reads it');
});

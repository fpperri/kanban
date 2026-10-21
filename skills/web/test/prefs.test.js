const { test } = require('node:test');
const assert = require('node:assert');
const { PREFS_FEATURE, prefsDefaults, mergePrefs, prefsWith, loadPrefs, savePrefs } = require('../web/prefs');

// The preferences kept in the browser per board: what a plain click on a card
// does in each view, whether archived leaves count as done, whether the
// search panel's pill section starts folded, and whether the panel opens when
// the search box is focused (the arrow's switch). The roll-up
// bar's open or collapsed choice is the one a click on a bar already writes
// (column-state.js); it is not stored a second time here.

function storageOf(initial = {}) {
  const items = { ...initial };
  return {
    items,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => { items[k] = String(v); },
  };
}

const DEFAULTS = {
  click: { board: 'opens', map: 'opens', gantt: 'opens', calendar: 'opens', graph: 'selects' },
  archivedDone: true,
  pillsFolded: false,
  statusesFolded: false,
  slicesFolded: true,
  panelOnFocus: true,
};

test('with nothing stored, the Board, Map, Gantt and Calendar open on a plain click, the Graph selects, archived leaves count as done, the pill section starts unfolded, the slice section starts folded and the search panel opens on focus', () => {
  assert.deepStrictEqual(prefsDefaults(), DEFAULTS);
  assert.deepStrictEqual(loadPrefs(storageOf(), 'shop'), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(null), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(undefined), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(''), DEFAULTS);
});

test('the defaults are handed out fresh: changing one copy never changes the next', () => {
  const a = prefsDefaults();
  a.click.board = 'selects';
  a.archivedDone = false;
  a.pillsFolded = true;
  a.slicesFolded = false;
  a.panelOnFocus = false;
  assert.deepStrictEqual(prefsDefaults(), DEFAULTS);
  assert.deepStrictEqual(mergePrefs(null), DEFAULTS);
});

test('a saved choice for a view and for archived leaves comes back as saved', () => {
  const saved = JSON.stringify({ click: { board: 'selects', calendar: 'selects' }, archivedDone: false });
  assert.deepStrictEqual(mergePrefs(saved), {
    click: { board: 'selects', map: 'opens', gantt: 'opens', calendar: 'selects', graph: 'selects' },
    archivedDone: false,
    pillsFolded: false,
    statusesFolded: false,
    slicesFolded: true,
    panelOnFocus: true,
  });
});

test('unknown keys are dropped, at the top and inside the click choices', () => {
  const merged = mergePrefs(JSON.stringify({ click: { board: 'selects', list: 'selects' }, archivedDone: false, theme: 'dark' }));
  assert.deepStrictEqual(Object.keys(merged).sort(), ['archivedDone', 'click', 'panelOnFocus', 'pillsFolded', 'slicesFolded', 'statusesFolded']);
  assert.deepStrictEqual(Object.keys(merged.click).sort(), ['board', 'calendar', 'gantt', 'graph', 'map']);
});

test('a bad value falls back to that setting\'s default and leaves the good ones alone', () => {
  const merged = mergePrefs(JSON.stringify({ click: { board: 'doubleclicks', map: 7, gantt: null, calendar: 'selects' }, archivedDone: 'false', pillsFolded: 'true', statusesFolded: 'true', slicesFolded: 'false', panelOnFocus: 'false' }));
  assert.deepStrictEqual(merged, {
    click: { board: 'opens', map: 'opens', gantt: 'opens', calendar: 'selects', graph: 'selects' },
    archivedDone: true,
    pillsFolded: false,
    statusesFolded: false,
    slicesFolded: true,
    panelOnFocus: true,
  });
});

test('a saved panel-on-focus choice comes back as saved, true or false, and an entry saved before the setting existed has the panel opening on focus', () => {
  assert.strictEqual(mergePrefs(JSON.stringify({ panelOnFocus: false })).panelOnFocus, false);
  assert.strictEqual(mergePrefs(JSON.stringify({ panelOnFocus: true })).panelOnFocus, true);
  assert.strictEqual(mergePrefs(JSON.stringify({ archivedDone: false, pillsFolded: true })).panelOnFocus, true);
  assert.strictEqual(mergePrefs(JSON.stringify({ panelOnFocus: 0 })).panelOnFocus, true, 'a value that is not a boolean falls back to the default, which is on');
});

test('the panel-on-focus choice changes alone', () => {
  const off = prefsWith(prefsDefaults(), { panelOnFocus: false });
  assert.strictEqual(off.panelOnFocus, false);
  assert.strictEqual(off.archivedDone, true);
  assert.strictEqual(off.pillsFolded, false);
  assert.deepStrictEqual(off.click, DEFAULTS.click);
  assert.strictEqual(prefsWith(off, { panelOnFocus: 'yes' }).panelOnFocus, false, 'a change that is not a boolean is dropped');
  assert.strictEqual(prefsWith(off, { panelOnFocus: true }).panelOnFocus, true);
  assert.strictEqual(prefsWith(off, { pillsFolded: true }).panelOnFocus, false, 'a change to another setting leaves it alone');
});

test('a saved pill-section choice comes back as saved, true or false', () => {
  assert.strictEqual(mergePrefs(JSON.stringify({ pillsFolded: true })).pillsFolded, true);
  assert.strictEqual(mergePrefs(JSON.stringify({ pillsFolded: false })).pillsFolded, false);
  assert.strictEqual(mergePrefs(JSON.stringify({ archivedDone: false })).pillsFolded, false, 'an entry saved before the setting existed starts it unfolded');
});

test('the pill-section choice changes alone', () => {
  const next = prefsWith(prefsDefaults(), { pillsFolded: true });
  assert.strictEqual(next.pillsFolded, true);
  assert.strictEqual(next.archivedDone, true);
  assert.deepStrictEqual(next.click, DEFAULTS.click);
  assert.strictEqual(prefsWith(next, { pillsFolded: 'no' }).pillsFolded, true, 'a change that is not a boolean is dropped');
});

test('a saved statuses-section choice comes back as saved, and an entry saved before the setting existed starts the section open', () => {
  assert.strictEqual(mergePrefs(JSON.stringify({ statusesFolded: true })).statusesFolded, true);
  assert.strictEqual(mergePrefs(JSON.stringify({ statusesFolded: false })).statusesFolded, false);
  assert.strictEqual(mergePrefs(JSON.stringify({ archivedDone: false })).statusesFolded, false, 'open by default');
  assert.strictEqual(mergePrefs(JSON.stringify({ statusesFolded: 1 })).statusesFolded, false, 'a value that is not a boolean falls back to the default, which is open');
});

test('the statuses-section choice changes alone', () => {
  const next = prefsWith(prefsDefaults(), { statusesFolded: true });
  assert.strictEqual(next.statusesFolded, true);
  assert.strictEqual(next.pillsFolded, false);
  assert.strictEqual(next.slicesFolded, true);
  assert.strictEqual(prefsWith(next, { statusesFolded: 'no' }).statusesFolded, true, 'a change that is not a boolean is dropped');
  assert.strictEqual(prefsWith(next, { pillsFolded: true }).statusesFolded, true, 'a change to another setting leaves it alone');
});

test('a saved slice-section choice comes back as saved, true or false, and an entry saved before the setting existed starts the section folded', () => {
  assert.strictEqual(mergePrefs(JSON.stringify({ slicesFolded: false })).slicesFolded, false);
  assert.strictEqual(mergePrefs(JSON.stringify({ slicesFolded: true })).slicesFolded, true);
  assert.strictEqual(mergePrefs(JSON.stringify({ archivedDone: false })).slicesFolded, true, 'folded by default');
  assert.strictEqual(mergePrefs(JSON.stringify({ slicesFolded: 0 })).slicesFolded, true, 'a value that is not a boolean falls back to the default, which is folded');
});

test('the slice-section choice changes alone', () => {
  const next = prefsWith(prefsDefaults(), { slicesFolded: false });
  assert.strictEqual(next.slicesFolded, false);
  assert.strictEqual(next.pillsFolded, false);
  assert.strictEqual(next.archivedDone, true);
  assert.strictEqual(next.panelOnFocus, true);
  assert.deepStrictEqual(next.click, DEFAULTS.click);
  assert.strictEqual(prefsWith(next, { slicesFolded: 'no' }).slicesFolded, false, 'a change that is not a boolean is dropped');
  assert.strictEqual(prefsWith(next, { pillsFolded: true }).slicesFolded, false, 'a change to another setting leaves it alone');
});

test('the Graph cannot be set to opens, whatever is stored', () => {
  assert.strictEqual(mergePrefs(JSON.stringify({ click: { graph: 'opens' } })).click.graph, 'selects');
  assert.strictEqual(mergePrefs(JSON.stringify({ click: { graph: 'selects' } })).click.graph, 'selects');
});

test('a stored value that is not an object at all gives the defaults', () => {
  for (const raw of ['not json', '[1,2]', '"selects"', '42', 'true', 'null', '{"click":"selects"}', '{"click":[1]}']) {
    assert.deepStrictEqual(mergePrefs(raw), DEFAULTS, raw);
  }
});

test('a prototype key in the stored click choices is dropped, never merged in', () => {
  const merged = mergePrefs('{"click":{"__proto__":{"board":"selects"},"constructor":"selects"}}');
  assert.deepStrictEqual(merged, DEFAULTS);
  assert.strictEqual({}.board, undefined);
});

test('a choice is saved under the board\'s own per-board key, and the next visit reads it back', () => {
  const storage = storageOf();
  const prefs = prefsDefaults();
  prefs.click.map = 'selects';
  prefs.archivedDone = false;
  savePrefs(storage, 'shop', prefs);
  assert.deepStrictEqual(Object.keys(storage.items), ['kanban.shop.prefs']);
  assert.strictEqual(PREFS_FEATURE, 'prefs');
  assert.deepStrictEqual(loadPrefs(storage, 'shop'), prefs);
});

test('two boards keep separate values, each under its own per-board key', () => {
  const storage = storageOf();
  const shop = prefsDefaults();
  shop.click.board = 'selects';
  const lab = prefsDefaults();
  lab.archivedDone = false;
  savePrefs(storage, 'shop', shop);
  savePrefs(storage, 'lab', lab);
  assert.deepStrictEqual(Object.keys(storage.items).sort(), ['kanban.lab.prefs', 'kanban.shop.prefs']);
  assert.deepStrictEqual(loadPrefs(storage, 'shop'), shop);
  assert.deepStrictEqual(loadPrefs(storage, 'lab'), lab);
  assert.deepStrictEqual(loadPrefs(storage, 'third'), DEFAULTS, 'a board that saved nothing keeps the defaults');
});

test('before the board answers, its name is empty and the keys fall under default, as every other per-board choice does', () => {
  const storage = storageOf();
  savePrefs(storage, '', prefsDefaults());
  assert.deepStrictEqual(Object.keys(storage.items), ['kanban.default.prefs']);
});

test('a value saved under the old rollup.archived key, true or false, is ignored and archived leaves count as done', () => {
  for (const old of ['false', 'true', 'garbage']) {
    const storage = storageOf({ 'kanban.shop.rollup.archived': old });
    assert.strictEqual(loadPrefs(storage, 'shop').archivedDone, true, `stored ${old}`);
  }
});

test('the old key stays unread and unwritten even after the new entry is saved', () => {
  const storage = storageOf({ 'kanban.shop.rollup.archived': 'false' });
  const prefs = loadPrefs(storage, 'shop');
  prefs.archivedDone = false;
  savePrefs(storage, 'shop', prefs);
  assert.strictEqual(storage.items['kanban.shop.rollup.archived'], 'false');
  assert.strictEqual(JSON.parse(storage.items['kanban.shop.prefs']).archivedDone, false);
});

test('storage that throws on read or write falls back to the defaults and never throws out', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.deepStrictEqual(loadPrefs(broken, 'shop'), DEFAULTS);
  assert.doesNotThrow(() => savePrefs(broken, 'shop', prefsDefaults()));
  assert.deepStrictEqual(loadPrefs(null, 'shop'), DEFAULTS);
  assert.doesNotThrow(() => savePrefs(null, 'shop', prefsDefaults()));
});

test('what is saved is the merged, validated set, never what the caller passed in raw', () => {
  const storage = storageOf();
  savePrefs(storage, 'shop', { click: { board: 'selects', graph: 'opens', bogus: 'x' }, archivedDone: 'no', pillsFolded: 1, statusesFolded: 1, slicesFolded: 0, panelOnFocus: 'off', extra: 1 });
  assert.deepStrictEqual(JSON.parse(storage.items['kanban.shop.prefs']), {
    click: { board: 'selects', map: 'opens', gantt: 'opens', calendar: 'opens', graph: 'selects' },
    archivedDone: true,
    pillsFolded: false,
    statusesFolded: false,
    slicesFolded: true,
    panelOnFocus: true,
  });
});

test('one view\'s choice changes alone, and the set passed in is not touched', () => {
  const prefs = prefsDefaults();
  const next = prefsWith(prefs, { click: { board: 'selects' } });
  assert.deepStrictEqual(next.click, { board: 'selects', map: 'opens', gantt: 'opens', calendar: 'opens', graph: 'selects' });
  assert.strictEqual(next.archivedDone, true);
  assert.deepStrictEqual(prefs, DEFAULTS, 'the set passed in is left as it was');
});

test('every boolean the defaults hold is read from a stored entry and taken from a change, and neither takes a value that is not a boolean', () => {
  const defaults = prefsDefaults();
  const keys = Object.keys(defaults).filter((key) => typeof defaults[key] === 'boolean');
  assert.deepStrictEqual(keys, ['archivedDone', 'pillsFolded', 'statusesFolded', 'slicesFolded', 'panelOnFocus']);
  for (const key of keys) {
    const flipped = !defaults[key];
    assert.strictEqual(mergePrefs(JSON.stringify({ [key]: flipped }))[key], flipped, `${key} is read`);
    assert.strictEqual(prefsWith(defaults, { [key]: flipped })[key], flipped, `${key} is taken from a change`);
    for (const bad of ['yes', 0, 1, null, [], {}]) {
      assert.strictEqual(mergePrefs(JSON.stringify({ [key]: bad }))[key], defaults[key], `${key} read as ${JSON.stringify(bad)}`);
      assert.strictEqual(prefsWith(prefsWith(defaults, { [key]: flipped }), { [key]: bad })[key], flipped, `${key} changed to ${JSON.stringify(bad)}`);
    }
  }
});

test('the archived-leaves choice changes alone', () => {
  const next = prefsWith(prefsDefaults(), { archivedDone: false });
  assert.strictEqual(next.archivedDone, false);
  assert.deepStrictEqual(next.click, DEFAULTS.click);
});

test('a change the sheet cannot make is dropped: a bad choice, the Graph set to opens, a view that is not listed', () => {
  const prefs = prefsWith(prefsWith(prefsDefaults(), { click: { board: 'selects', map: 'selects' } }), { archivedDone: false });
  const next = prefsWith(prefs, { click: { graph: 'opens', map: 'both', board: 7, list: 'selects' }, archivedDone: 'no' });
  assert.deepStrictEqual(next, prefs, 'what was chosen stays chosen');
  assert.deepStrictEqual(prefsWith(prefs, null), prefs);
  assert.deepStrictEqual(prefsWith(prefs, {}), prefs);
});

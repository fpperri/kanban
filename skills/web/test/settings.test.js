const { test } = require('node:test');
const assert = require('node:assert');
const s = require('../web/settings');

// The rules of the gear's sheet apart from the DOM (settings.js): which layout a width gets, where
// Esc steps, what a switch or a folder sends, and how a page's state reads in the menu.

test('a sheet 760 px wide or more shows the menu and a page side by side, a narrower one drills down', () => {
  assert.strictEqual(s.settingsIsWide(760), true);
  assert.strictEqual(s.settingsIsWide(1280), true);
  assert.strictEqual(s.settingsIsWide(759), false);
  assert.strictEqual(s.settingsIsWide(0), false);
});

test('a wide sheet always has a page: the one asked for, else the one it had, else the first', () => {
  assert.strictEqual(s.settingsOpen('board:groups', 'browser:prefs', true), 'board:groups');
  assert.strictEqual(s.settingsOpen(null, 'board:groups', true), 'board:groups');
  assert.strictEqual(s.settingsOpen(null, null, true), 'browser:prefs');
});

test('a narrow sheet opens on its menu unless a page is asked for', () => {
  assert.strictEqual(s.settingsOpen(null, 'board:groups', false), null);
  assert.strictEqual(s.settingsOpen('browser:hotkeys', null, false), 'browser:hotkeys');
});

test('growing the window gives a menu-only sheet a page', () => {
  assert.strictEqual(s.settingsResized(null, true), 'browser:prefs');
  assert.strictEqual(s.settingsResized('board:logbook', true), 'board:logbook');
  assert.strictEqual(s.settingsResized('board:logbook', false), 'board:logbook');
});

test('Esc on a narrow sheet with a page open steps back to the menu, then closes', () => {
  const back = s.settingsEscape('board:groups', false);
  assert.deepStrictEqual(back, { open: true, page: null });
  assert.deepStrictEqual(s.settingsEscape(back.page, false), { open: false, page: null });
});

test('Esc on a wide sheet closes it and keeps its page for the next time', () => {
  assert.deepStrictEqual(s.settingsEscape('board:groups', true), { open: false, page: 'board:groups' });
});

test('the menu says a feature is on or off, and the groups on with how many were found', () => {
  const settings = { logbook: { on: true }, groups: { on: true }, prefixes: [{}, {}], counters: {} };
  assert.strictEqual(s.settingsPageState('logbook', settings, 3), 'on');
  assert.strictEqual(s.settingsPageState('groups', settings, 3), 'on · 3');
  assert.strictEqual(s.settingsPageState('prefixes', settings, 3), '2');
  assert.strictEqual(s.settingsPageState('counters', settings, 3), '');
  const off = { logbook: { on: false }, groups: { on: false }, prefixes: [], counters: {} };
  assert.strictEqual(s.settingsPageState('logbook', off, 0), 'off');
  assert.strictEqual(s.settingsPageState('groups', off, 0), 'off');
  assert.strictEqual(s.settingsPageState('prefixes', off, 0), '0');
});

test('the Scratchpad page says on, off or locked like the Logbook, and switches on to .scratchpad', () => {
  assert.strictEqual(s.settingsPageState('scratchpad', { scratchpad: { on: true } }, 0), 'on');
  assert.strictEqual(s.settingsPageState('scratchpad', { scratchpad: { on: false } }, 0), 'off');
  assert.strictEqual(s.settingsPageState('scratchpad', { scratchpad: { on: true, locked: true } }, 0), 'on · locked');
  assert.deepStrictEqual(s.settingsSwitchBody('scratchpad', true, ''), { key: 'scratchpad', value: '.scratchpad' });
  assert.deepStrictEqual(s.settingsSwitchBody('scratchpad', false, 'pads'), { key: 'scratchpad', value: null });
});

test('a locked feature says so in the menu', () => {
  const settings = { logbook: { on: true, locked: true }, groups: { on: false } };
  assert.strictEqual(s.settingsPageState('logbook', settings, 0), 'on · locked');
});

test('switching a feature off sends null, on sends the folder it has or its default', () => {
  assert.deepStrictEqual(s.settingsSwitchBody('logbook', false, 'notes'), { key: 'logbook', value: null });
  assert.deepStrictEqual(s.settingsSwitchBody('logbook', true, ''), { key: 'logbook', value: 'logbook' });
  assert.deepStrictEqual(s.settingsSwitchBody('groups', true, ''), { key: 'groups', value: '.groups' });
  assert.deepStrictEqual(s.settingsSwitchBody('groups', true, 'sets'), { key: 'groups', value: 'sets' });
  assert.deepStrictEqual(s.settingsSwitchBody('iterations', true), { key: 'iterations', value: true });
  assert.deepStrictEqual(s.settingsSwitchBody('iterations', false), { key: 'iterations', value: false });
});

test('a folder typed in is trimmed', () => {
  assert.deepStrictEqual(s.settingsFolderBody('logbook', '  notes/day '), { key: 'logbook', value: 'notes/day' });
});

test('the page refuses what plainly leaves the board before it asks the server, and lets the rest through to be judged', () => {
  for (const bad of ['', '   ', '.', './', '..', '../notes', 'a/../../b', '/etc/notes', 'C:\\Windows', 'c:/x', '\\\\server\\share']) {
    assert.match(s.settingsFolderProblem(bad), /\S/, `refuses ${JSON.stringify(bad)}`);
  }
  for (const ok of ['.logbook', 'notes/day', 'my notes (2026)', 'a/./b', 'what: odd']) {
    assert.strictEqual(s.settingsFolderProblem(ok), '', `lets ${JSON.stringify(ok)} through`);
  }
});

test('the page refuses an idDigits that is not a whole number from 1 to 15', () => {
  for (const bad of ['', 'x', '0', '16', '2.5', '-1', '4 # no']) assert.match(s.settingsDigitsProblem(bad), /1 to 15/, bad);
  for (const ok of ['1', ' 6 ', '15']) assert.strictEqual(s.settingsDigitsProblem(ok), '', ok);
});

test('idDigits is sent as typed for the server to judge, and its example shows a padded id', () => {
  assert.deepStrictEqual(s.settingsDigitsBody(' 6 '), { key: 'idDigits', value: '6' });
  assert.strictEqual(s.settingsIdExample(6), '000007');
  assert.strictEqual(s.settingsIdExample(1), '7');
  assert.strictEqual(s.settingsIdExample('x'), '0007');
});

test('the groups found are listed under their type path, in id order, the untyped ones first', () => {
  const list = [
    { id: 'W2', folder: 'workflow', name: 'b' }, { id: 'I10', folder: 'iteration', name: 'x' },
    { id: 'I2', folder: 'iteration', name: 'y' }, { id: '_1', folder: '', name: 'z' }, { id: 'W1', folder: 'workflow', name: 'a' },
  ];
  const found = s.settingsGroupsFound(list);
  assert.deepStrictEqual(found.map((f) => f.folder), ['', 'iteration', 'workflow']);
  assert.deepStrictEqual(found.map((f) => f.label), ['(no type)', 'iteration', 'workflow']);
  assert.deepStrictEqual(found[1].groups.map((g) => g.id), ['I2', 'I10']);
});

test('a prefix row reads as a card type or as a folder of the groups', () => {
  const row = (extra) => ({ prefix: 'X', target: 't', ...extra });
  assert.strictEqual(s.settingsPrefixTarget(row({ kind: 'type', target: 'goal' }), '.groups'), 'card type goal');
  assert.strictEqual(s.settingsPrefixTarget(row({ kind: 'folder', folder: 'workflow' }), '.groups'), '.groups/workflow/');
  assert.strictEqual(s.settingsPrefixTarget(row({ kind: 'folder', folder: '' }), '.groups'), '.groups/ (no type)');
  assert.strictEqual(s.settingsPrefixTarget(row({ kind: 'folder', folder: 'workflow' }), ''), '.groups/workflow/');
});

// --- the Types page (docs/adr/0018): the two areas, the moves, the lists a change writes ----------------

const TYPES = [
  { name: 'goal', color: '#a371f7', icon: 'star' }, { name: 'strategy', icon: 'hexagon' },
  { name: 'epic', color: '#d29922' }, { name: 'story' }, { name: 'bug' },
];
const names = (rows) => rows.map((r) => r.name);

test('the Hierarchy area holds the hierarchy list in order and the Other types area the rest of the types', () => {
  const areas = s.settingsTypeAreas(TYPES, ['strategy', 'goal']);
  assert.deepStrictEqual(names(areas.hierarchy), ['strategy', 'goal']);
  assert.strictEqual(areas.hierarchy[0].type, TYPES[1]);
  assert.deepStrictEqual(names(areas.other), ['epic', 'story', 'bug']);
});

test('a hierarchy name that is not a listed type is a row with no type, still in its place; names meet without regard to case', () => {
  const areas = s.settingsTypeAreas(TYPES, ['Goal', 'objective', 'epic']);
  assert.deepStrictEqual(areas.hierarchy.map((r) => [r.name, r.type && r.type.name]), [['Goal', 'goal'], ['objective', null], ['epic', 'epic']]);
  assert.deepStrictEqual(names(areas.other), ['strategy', 'story', 'bug']);
});

test('no hierarchy puts every type in Other types', () => {
  const areas = s.settingsTypeAreas(TYPES, []);
  assert.deepStrictEqual(areas.hierarchy, []);
  assert.strictEqual(areas.other.length, 5);
});

test('found on cards: the words cards carry that no listed type has, with counts, the most used first', () => {
  const use = { goal: 4, Story: 2, spike: 1, chore: 3, Chore: 2, '': 9 };
  assert.deepStrictEqual(s.settingsFoundOnCards(TYPES, use), [{ word: 'chore', count: 5 }, { word: 'spike', count: 1 }]);
  assert.deepStrictEqual(s.settingsFoundOnCards(TYPES, {}), []);
});

test('how many cards carry a type counts every spelling of its name', () => {
  assert.strictEqual(s.settingsTypeCards({ bug: 2, Bug: 1, bugs: 5 }, 'bug'), 3);
  assert.strictEqual(s.settingsTypeCards({}, 'bug'), 0);
});

test('moving a row down or up rewrites the hierarchy list and stops at the ends', () => {
  const h = ['goal', 'strategy', 'epic'];
  assert.deepStrictEqual(s.settingsMoveType(h, 'goal', 1), ['strategy', 'goal', 'epic']);
  assert.deepStrictEqual(s.settingsMoveType(h, 'epic', -1), ['goal', 'epic', 'strategy']);
  assert.strictEqual(s.settingsMoveType(h, 'goal', -1), null);
  assert.strictEqual(s.settingsMoveType(h, 'epic', 1), null);
  assert.strictEqual(s.settingsMoveType(h, 'bug', 1), null);
  assert.deepStrictEqual(h, ['goal', 'strategy', 'epic'], 'the list given is not changed');
});

test('a drop puts a type into the Hierarchy area at an index, from Other types or from within', () => {
  const h = ['goal', 'strategy', 'epic'];
  assert.deepStrictEqual(s.settingsDropType(h, 'bug', 'hierarchy', 1), ['goal', 'bug', 'strategy', 'epic']);
  assert.deepStrictEqual(s.settingsDropType(h, 'bug', 'hierarchy', 3), ['goal', 'strategy', 'epic', 'bug']);
  assert.deepStrictEqual(s.settingsDropType(h, 'epic', 'hierarchy', 0), ['epic', 'goal', 'strategy']);
  assert.deepStrictEqual(s.settingsDropType(h, 'goal', 'hierarchy', 3), ['strategy', 'epic', 'goal']);
  assert.strictEqual(s.settingsDropType(h, 'goal', 'hierarchy', 0), null, 'dropped where it already is');
  assert.strictEqual(s.settingsDropType(h, 'goal', 'hierarchy', 1), null, 'just after itself is the same place');
});

test('a drop into Other types takes the name out of the hierarchy; within Other types nothing is written', () => {
  const h = ['goal', 'strategy'];
  assert.deepStrictEqual(s.settingsDropType(h, 'Goal', 'other'), ['strategy']);
  assert.deepStrictEqual(s.settingsDropType(['goal'], 'goal', 'other'), []);
  assert.strictEqual(s.settingsDropType(h, 'bug', 'other'), null);
});

test('adding a type appends it, renaming keeps its color and icon, a change of look touches one entry, removing drops it', () => {
  assert.deepStrictEqual(s.settingsTypesAdd([{ name: 'a' }], 'b'), [{ name: 'a' }, { name: 'b' }]);
  assert.deepStrictEqual(s.settingsTypesRename(TYPES, 'goal', 'objective').slice(0, 2), [{ name: 'objective', color: '#a371f7', icon: 'star' }, { name: 'strategy', icon: 'hexagon' }]);
  assert.deepStrictEqual(s.settingsTypesPatch(TYPES, 'story', { color: '#112233', icon: 'circle' })[3], { name: 'story', color: '#112233', icon: 'circle' });
  assert.deepStrictEqual(s.settingsTypesPatch(TYPES, 'goal', { color: '', icon: '' })[0], { name: 'goal' }, 'cleared = written bare');
  assert.deepStrictEqual(names(s.settingsTypesRemove(TYPES, 'Epic')), ['goal', 'strategy', 'story', 'bug']);
  assert.strictEqual(TYPES.length, 5, 'the list given is not changed');
});

test('a save is one block with the version the page read', () => {
  assert.deepStrictEqual(s.settingsBlockBody('types', [{ name: 'x' }], 'abc'), { block: 'types', value: [{ name: 'x' }], version: 'abc' });
  assert.deepStrictEqual(s.settingsBlockBody('hierarchy', [], 'abc'), { block: 'hierarchy', value: [], version: 'abc' });
});

test('the page refuses a blank name or one another type has before it asks the server', () => {
  assert.match(s.settingsTypeNameProblem(TYPES, '  ', null), /name/);
  assert.match(s.settingsTypeNameProblem(TYPES, 'BUG', null), /BUG/);
  assert.strictEqual(s.settingsTypeNameProblem(TYPES, 'Bug', 'bug'), '', 'its own name in other capitals');
  assert.strictEqual(s.settingsTypeNameProblem(TYPES, 'spike', null), '');
});

test('a color the person types is a hex color, or nothing', () => {
  for (const ok of ['', '#fff', '#A371F7', '#a371f7cc']) assert.strictEqual(s.settingsColorProblem(ok), '', ok);
  for (const bad of ['red', '#12', '#12345', 'a371f7', '#gggggg']) assert.match(s.settingsColorProblem(bad), /hex color/, bad);
});

test('the swatches are the colors the starter config uses and the status palette, each once, as hex', () => {
  const swatches = s.SETTINGS_TYPE_SWATCHES;
  for (const hex of ['#e3b341', '#f0883e', '#a371f7', '#58a6ff', '#3fb950']) assert.ok(swatches.includes(hex), hex);
  for (const hex of require('../web/status-colors').STATUS_PALETTE) assert.ok(swatches.includes(hex.toLowerCase()), hex);
  assert.strictEqual(new Set(swatches).size, swatches.length);
  for (const hex of swatches) assert.strictEqual(s.settingsColorProblem(hex), '', hex);
});

test('names that differ only in capitals are separate rows: a move, a drop and an edit act on the one named', () => {
  const types = [{ name: 'Bug', color: 'red' }, { name: 'bug', icon: 'star' }, { name: 'epic' }];
  const h = ['Bug', 'bug', 'epic'];
  const areas = s.settingsTypeAreas(types, h);
  assert.deepStrictEqual(areas.hierarchy.map((r) => r.type), types);
  assert.deepStrictEqual(areas.other, []);
  assert.deepStrictEqual(s.settingsMoveType(h, 'bug', -1), ['bug', 'Bug', 'epic']);
  assert.deepStrictEqual(s.settingsMoveType(h, 'Bug', 1), ['bug', 'Bug', 'epic']);
  assert.deepStrictEqual(s.settingsDropType(h, 'bug', 'other'), ['Bug', 'epic']);
  assert.deepStrictEqual(s.settingsTypesRename(types, 'bug', 'insect').map((t) => t.name), ['Bug', 'insect', 'epic']);
  assert.deepStrictEqual(s.settingsTypesPatch(types, 'bug', { color: '#fff' })[0], { name: 'Bug', color: 'red' });
  assert.deepStrictEqual(s.settingsTypesRemove(types, 'bug').map((t) => t.name), ['Bug', 'epic']);
  assert.match(s.settingsTypeNameProblem(types, 'BUG', 'bug'), /already a card type named BUG/, 'the other spelling is another type');
});

test('a stored color that is a name, or an icon this build does not draw, stays on its entry through a rename and an icon change', () => {
  const types = [{ name: 'bug', color: 'red', icon: 'hexagram' }];
  assert.deepStrictEqual(s.settingsTypesRename(types, 'bug', 'insect'), [{ name: 'insect', color: 'red', icon: 'hexagram' }]);
  assert.deepStrictEqual(s.settingsTypesPatch(types, 'bug', { icon: 'star' }), [{ name: 'bug', color: 'red', icon: 'star' }]);
});

test('each leftover is ONE bullet saying what and why: a hierarchy name no type has', () => {
  const w = s.settingsTypeWarnings({ types: TYPES, hierarchy: ['goal', 'objective'], prefixes: [], typeUse: {}, renamed: {} });
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /^`objective` is still in the hierarchy\. Why: .*changes only the type list; ask an AI to update the hierarchy, the prefixes and the cards\.$/);
  assert.doesNotMatch(w[0], /\n/);
});

test('after a rename, cards still saying the old word are one bullet with their count', () => {
  const base = { types: TYPES, hierarchy: [], prefixes: [], renamed: { spike: 'task', epic2: 'epic' } };
  const w = s.settingsTypeWarnings({ ...base, typeUse: { spike: 3, epic2: 1 } });
  assert.strictEqual(w.length, 2);
  assert.match(w[0], /^3 cards still say `spike`\. Why: renaming a type changes only the type list; ask an AI to update the cards, the hierarchy and the prefixes\.$/);
  assert.match(w[1], /^1 card still says `epic2`\./);
  assert.deepStrictEqual(s.settingsTypeWarnings({ ...base, typeUse: {} }), [], 'no card says it any more');
  assert.deepStrictEqual(s.settingsTypeWarnings({ ...base, renamed: { story: 'x' }, typeUse: { story: 2 } }), [], 'a word that is a listed type again is no leftover');
});

test('a prefix that names a type no longer listed is one warning bullet; a folder prefix and a listed type are not', () => {
  const prefixes = [{ prefix: 'G', kind: 'type', target: 'goal' }, { prefix: 'O', kind: 'type', target: 'objective' }, { prefix: 'W', kind: 'folder', target: 'workflow', folder: 'workflow' }];
  const w = s.settingsPrefixWarnings(prefixes, TYPES);
  assert.strictEqual(w.length, 1);
  assert.match(w[0], /^The prefix `O` still names `objective`, which is not a listed type\. Why: removing or renaming a type changes only the type list; ask an AI to update the prefixes\.$/);
  assert.deepStrictEqual(s.settingsTypeWarnings({ types: TYPES, hierarchy: [], prefixes, typeUse: {}, renamed: {} }), w);
});

test('a type shows the prefix the prefixes: block gives it, read only', () => {
  const prefixes = [{ prefix: 'G', kind: 'type', target: 'Goal' }, { prefix: 'W', kind: 'folder', target: 'workflow', folder: 'workflow' }];
  assert.strictEqual(s.settingsPrefixOf(prefixes, 'goal'), 'G');
  assert.strictEqual(s.settingsPrefixOf(prefixes, 'bug'), '');
  assert.strictEqual(s.settingsPrefixOf(prefixes, 'workflow'), '');
});

test('every page of This board names the file or folder it reads, absolute, and nothing when that is off', () => {
  const st = { paths: { config: '/b/config.yaml', logbook: '/b/logbook', scratchpad: null, groups: '/b/.groups' } };
  for (const id of ['types', 'prefixes', 'counters']) assert.strictEqual(s.settingsPagePath(id, st), '/b/config.yaml', id);
  assert.strictEqual(s.settingsPagePath('logbook', st), '/b/logbook');
  assert.strictEqual(s.settingsPagePath('groups', st), '/b/.groups');
  assert.strictEqual(s.settingsPagePath('scratchpad', st), null);
  assert.strictEqual(s.settingsPagePath('nothing', st), null);
  assert.strictEqual(s.settingsPagePath('types', {}), null);
});

test('the menu says Types is off, else how many types are listed', () => {
  assert.strictEqual(s.settingsPageState('types', { typesOn: false, types: [{}, {}] }, 0), 'off');
  assert.strictEqual(s.settingsPageState('types', { typesOn: true, types: [{}, {}] }, 0), '2');
});

test('the Types switch sends typesOn with the version the page read', () => {
  assert.deepStrictEqual(s.settingsTypesOnBody(false, 'v1'), { key: 'typesOn', value: false, version: 'v1' });
  assert.deepStrictEqual(s.settingsTypesOnBody(true, 'v1'), { key: 'typesOn', value: true, version: 'v1' });
});

test('prefix edits return the whole prefixes list to write, changing only the row asked', () => {
  const rows = [{ prefix: 'G', kind: 'type', target: 'goal' }, { prefix: 'W', kind: 'folder', target: 'workflow', folder: 'workflow' }];
  const list = s.settingsPrefixList(rows);
  assert.deepStrictEqual(list, [{ prefix: 'G', target: 'goal' }, { prefix: 'W', target: 'workflow' }]);
  assert.deepStrictEqual(s.settingsPrefixSet(list, 'G', { prefix: 'X' }), [{ prefix: 'X', target: 'goal' }, { prefix: 'W', target: 'workflow' }]);
  assert.deepStrictEqual(s.settingsPrefixSet(list, 'W', { target: 'flows' })[1], { prefix: 'W', target: 'flows' });
  assert.deepStrictEqual(s.settingsPrefixAdd(list, 'B', 'bug').slice(2), [{ prefix: 'B', target: 'bug' }]);
  assert.deepStrictEqual(s.settingsPrefixRemove(list, 'G'), [{ prefix: 'W', target: 'workflow' }]);
  assert.strictEqual(list.length, 2, 'the list given is not changed');
});

test('a prefix edit finds its row by the prefix it names, and answers null when that row is gone', () => {
  const list = [{ prefix: 'O', target: 'objective' }, { prefix: 'W', target: 'workflow' }];
  assert.strictEqual(s.settingsPrefixSet(list, 'G', { target: 'x' }), null);
  assert.strictEqual(s.settingsPrefixRemove(list, 'G'), null);
  assert.deepStrictEqual(s.settingsPrefixSet(list, 'O', { target: 'x' })[0], { prefix: 'O', target: 'x' });
});

test('the page refuses a blank prefix or target and a prefix another row has, before asking the server', () => {
  const list = [{ prefix: 'G', target: 'goal' }, { prefix: 'W', target: 'workflow' }];
  assert.match(s.settingsPrefixProblem(list, '', 'x', null), /prefix/);
  assert.match(s.settingsPrefixProblem(list, 'X', '  ', null), /card type or a groups folder/);
  assert.match(s.settingsPrefixProblem(list, 'W', 'x', null), /W/);
  assert.strictEqual(s.settingsPrefixProblem(list, 'W', 'x', 'W'), '', 'its own prefix');
  assert.match(s.settingsPrefixProblem(list, 'G', 'x', 'W'), /G/, 'another row\'s prefix');
  assert.strictEqual(s.settingsPrefixProblem(list, 'X', 'x', null), '');
});

test('a prefix change asks first, and says cards already made keep their ids', () => {
  assert.match(s.settingsPrefixConfirm('change', 'G', 'goal'), /^Change the prefix G/);
  assert.match(s.settingsPrefixConfirm('add', 'B', 'bug'), /^Add the prefix B/);
  assert.match(s.settingsPrefixConfirm('remove', 'G', 'goal'), /^Remove the prefix G/);
  for (const k of ['change', 'add', 'remove']) assert.match(s.settingsPrefixConfirm(k, 'G', 'goal'), /keep their ids/);
  assert.match(s.settingsPrefixNote, /changes only the ids given from then on/);
  assert.match(s.settingsPrefixNote, /Why: .*keep their ids; ask an AI to migrate the board/);
});

test('a conflict note says what happened and why, in one bullet', () => {
  assert.match(s.settingsConflictNote, /^config\.yaml changed on disk after this page read it, so nothing was saved\. Why: /);
  assert.doesNotMatch(s.settingsConflictNote, /\n/);
});

test('removing a type that cards use asks first, with the count', () => {
  assert.strictEqual(s.settingsRemoveConfirm('bug', 0), null);
  assert.match(s.settingsRemoveConfirm('bug', 3), /3 cards say `bug`/);
  assert.match(s.settingsRemoveConfirm('bug', 1), /1 card says `bug`/);
});

test('a drop lands among the rows by where the pointer is against their midpoints', () => {
  assert.strictEqual(s.settingsDropIndex([10, 30, 50], 5), 0);
  assert.strictEqual(s.settingsDropIndex([10, 30, 50], 31), 2);
  assert.strictEqual(s.settingsDropIndex([10, 30, 50], 99), 3);
  assert.strictEqual(s.settingsDropIndex([], 4), 0);
});

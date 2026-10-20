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

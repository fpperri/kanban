const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { searchOtherBoardMentions, parseSearchQuery } = require('../../plugin/skills/web/web/search');
const { loadPage, control } = require('./helpers/page-vm');

const mentions = (text, board = 'alpha') => searchOtherBoardMentions(text, board);

test('a bare token naming another board is a mention, with the name as typed and the id', () => {
  assert.deepStrictEqual(mentions('Beta#345'), [{ board: 'Beta', id: '345' }]);
});

test('this board, in any case, is no mention', () => {
  assert.deepStrictEqual(mentions('alpha#3 ALPHA#4'), []);
});

test('the name is one token that may hold dots and hyphens, never a #', () => {
  assert.deepStrictEqual(mentions('my-board.core#7'), [{ board: 'my-board.core', id: '7' }]);
  assert.deepStrictEqual(mentions('a#b#7'), []);
});

test('only what the id module reads as a mention counts: no URL fragment, hex colour, glued scope or | run', () => {
  for (const text of ['http://x.com/#3', '-fpp#3', 'waiting:fpp#4', 'fpp#FF0000', 'beta#1|gamma#2']) {
    assert.deepStrictEqual(mentions(text), [], text);
  }
});

test('the same card named twice, in any case, is one mention', () => {
  assert.deepStrictEqual(mentions('fpp#345 fpp#345'), [{ board: 'fpp', id: '345' }]);
  assert.deepStrictEqual(mentions('fpp#345 FPP#345'), [{ board: 'fpp', id: '345' }]);
  assert.deepStrictEqual(mentions('fpp#345 fpp#346'), [{ board: 'fpp', id: '345' }, { board: 'fpp', id: '346' }]);
});

test('a board with a dot in its name, named in full, is this board', () => {
  assert.deepStrictEqual(mentions('shop.core#3', 'shop.core'), []);
});

test('the id reads through the id module: prefixed ids count, text after the # does not', () => {
  assert.deepStrictEqual(mentions('beta#G5'), [{ board: 'beta', id: 'G5' }]);
  assert.deepStrictEqual(mentions('beta#19a beta# beta#'), []);
});

test('a bare #id, quoted text and scoped terms are no mention', () => {
  assert.deepStrictEqual(mentions('#345 "beta#345" tags:beta#1 tree:beta#1 title:beta#2'), []);
});

test('several mentions come out in order, among other terms, across or and brackets', () => {
  assert.deepStrictEqual(mentions('fix (beta#1 | gamma#2) done'), [{ board: 'beta', id: '1' }, { board: 'gamma', id: '2' }]);
  assert.deepStrictEqual(mentions('(beta#1) | gamma#2'), [{ board: 'beta', id: '1' }, { board: 'gamma', id: '2' }]);
});

test('an other-board mention still searches as text', () => {
  assert.deepStrictEqual(parseSearchQuery('beta#345', 'alpha'), [{ field: null, value: 'beta#345' }]);
});

test('empty input and no board name give nothing', () => {
  assert.deepStrictEqual(mentions(''), []);
  assert.deepStrictEqual(mentions(undefined), []);
  assert.deepStrictEqual(searchOtherBoardMentions('beta#1', ''), [{ board: 'beta', id: '1' }]);
});

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');

test('the panel opens with the note: first in the panel, a status region, hidden to start', () => {
  const html = read('app.html');
  const panel = html.slice(html.indexOf('id="search-panel"'));
  const note = panel.match(/<p[^>]*id="search-board-note"[^>]*>/);
  assert.ok(note, 'the note is in the panel');
  assert.match(note[0], /role="status"/);
  assert.match(note[0], /class="[^"]*\bhidden\b/);
  assert.ok(panel.indexOf('id="search-board-note"') < panel.indexOf('id="search-statuses-section"'));
});

test('the note has rules in the stylesheet in theme tokens only, and no inline style or handler', () => {
  const css = read('app.css');
  const rule = css.match(/\.search-board-note\s*\{[^}]*\}/);
  assert.ok(rule, 'a rule for the note');
  assert.match(rule[0], /var\(--mut\)/);
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,6}\b/);
  assert.doesNotMatch(read('app.html').match(/<p[^>]*id="search-board-note"[^>]*>/)[0], /style=|on\w+=/);
});

test('the note is written with textContent only', () => {
  const src = read('search-panel.js');
  const fn = src.match(/function syncSearchBoardNote\([\s\S]*?\n\}/);
  assert.ok(fn, 'syncSearchBoardNote is in search-panel.js');
  assert.match(fn[0], /textContent/);
  assert.doesNotMatch(fn[0], /innerHTML/);
});

async function openWithNote() {
  const note = control();
  note.classList.add('hidden');
  const board = { projectName: 'alpha', statuses: ['todo'], priorities: ['Normal'], assignees: [], tags: [], types: [], notifications: [], active: [], archived: [] };
  const page = await loadPage({ board, stored: { 'kanban.alpha.view.mode': 'board' }, elements: { '#search-board-note': note } }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  return { page, note };
}

test('typing another board\'s mention shows the sentence; clearing the box hides it', async () => {
  const { page, note } = await openWithNote();
  assert.strictEqual(note.classList.contains('hidden'), true);
  page.input.typed('beta#345');
  assert.strictEqual(note.classList.contains('hidden'), false);
  assert.strictEqual(note.textContent, 'beta#345 is a card on the beta board, not this one.');
  page.input.typed('alpha#345');
  assert.strictEqual(note.classList.contains('hidden'), true);
});

test('two mentions give one sentence each', async () => {
  const { page, note } = await openWithNote();
  page.input.typed('beta#1 Gamma#2');
  assert.strictEqual(note.textContent, 'beta#1 is a card on the beta board, not this one. Gamma#2 is a card on the Gamma board, not this one.');
});

test('the status region is written only when its text changes, so a poll or a repeat keystroke does not announce it again', async () => {
  const { page, note } = await openWithNote();
  const writes = [];
  let text = '';
  Object.defineProperty(note, 'textContent', { get: () => text, set: (v) => { writes.push(v); text = String(v); } });
  page.input.typed('beta#345');
  page.run('renderSearchPanel()');
  page.run('renderSearchPanel()');
  page.input.typed('beta#345 ');
  assert.deepStrictEqual(writes, ['beta#345 is a card on the beta board, not this one.']);
  page.input.typed('');
  assert.deepStrictEqual(writes, ['beta#345 is a card on the beta board, not this one.', '']);
  page.run('renderSearchPanel()');
  assert.strictEqual(writes.length, 2);
});

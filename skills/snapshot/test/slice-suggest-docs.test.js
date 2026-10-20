const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { searchSuggestionItems } = require('../../web/web/search');

// The snapshot skill says its search box suggests slices as the web's does, from the same
// module, and the examples it gives are held to that module.

const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const section = /\nA search box under the header[\s\S]*?\n\n/.exec(skill);
const flat = section && section[0].replace(/\s+/g, ' ');

const card = (id, over = {}) => ({ id: String(id), title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', tags: [], parent: null, ...over });

test('the skill says the box suggests slices after slice: and after .., what they are, what a pick writes, and that it is the web module\'s', () => {
  assert.ok(flat, 'a search section');
  assert.match(flat, /The box suggests as the web's does, from the same module/);
  assert.match(flat, /after `slice:` and after `\.\.`/);
  assert.match(flat, /the tiers in hierarchy order and then the depth numbers from 0 to the deepest card with no tier/);
  assert.match(flat, /a tap on a row writes the whole term \(`slice:goal\.\.objective`\)/);
  assert.match(flat, /quoted, the quote holding both ends \(`slice:"big goal\.\.2"`\)/);
  assert.match(flat, /A bare word opens no list here/);
});

test('the documented suggestions are what the module offers', () => {
  const cards = [card(1, { type: 'goal' }), card(2, { type: 'strategy', parent: '1' }), card(3, { type: 'objective', parent: '2' }), card(4, { parent: '3' })];
  const ctx = { board: 'kanban', hierarchy: ['goal', 'strategy', 'objective'] };
  assert.ok(searchSuggestionItems('slice:goal..', 12, cards, ctx).some((i) => i.value === 'slice:goal..objective'));
  const spaced = [card(1, { type: 'big goal' }), card(2, { parent: '1' }), card(3, { parent: '2' })];
  assert.ok(searchSuggestionItems('slice:"big goal..', undefined, spaced, { board: 'kanban', hierarchy: ['big goal'] }).some((i) => i.value === 'slice:"big goal..2"'));
});

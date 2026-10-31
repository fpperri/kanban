const { test } = require('node:test');
const assert = require('node:assert');
const tempIds = require('../../plugin/skills/web/scripts/temp-ids');

// Where a queued change names a temporary id, and how the real id is put in its place once the board has
// allocated it. Only the places an id goes are read: a title, a note's text or a todo's text that happens
// to read "n1" is text, not a reference.

const change = (method, path, body = {}) => ({ method, path, body });

test('namesIn finds a temporary id in a path, a parent, a waiting_for list, a group list and a note target', () => {
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/cards/n1/archive')), ['n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('PATCH', '/api/cards/7', { parent: 'n2', waiting_for: ['3', 'n1'] })), ['n2', 'n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/groups', { name: 'g', cards: ['n3', '7'] })), ['n3']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/groups/n4/members', { add: ['n1'], remove: ['n2'] })), ['n4', 'n1', 'n2']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/notes', { target: 'n1', note: 'text' })), ['n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('PATCH', '/api/notes', { ref: { day: '2026-10-31', target: 'n1', index: 0 }, note: 'x' })), ['n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/notes/assign', { ref: { target: '7' }, to: 'n2' })), ['n2']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/cards/7/reorder', { prev: 'n1', next: null })), ['n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('PUT', '/api/todos/n5', { text: '- [ ] a', version: 'x' })), ['n5']);
});

test('namesIn lists each id once and ignores text that only reads like one', () => {
  assert.deepStrictEqual(tempIds.namesIn(change('PATCH', '/api/cards/n1', { parent: 'n1', title: 'n2', body: 'see n3', tags: ['n4'] })), ['n1']);
  assert.deepStrictEqual(tempIds.namesIn(change('POST', '/api/notes', { target: '7', note: 'n1' })), []);
  assert.deepStrictEqual(tempIds.namesIn(change('PATCH', '/api/cards/7', { status: 'doing' })), []);
});

test('rewrite puts the real id where a temporary one stood and leaves the rest as it was', () => {
  const input = change('PATCH', '/api/cards/n1', { parent: 'n2', waiting_for: ['3', 'n1'], title: 'n1' });
  const out = tempIds.rewrite(input, { n1: '31', n2: 'G4' });
  assert.deepStrictEqual(out.missing, []);
  assert.deepStrictEqual(out.change, change('PATCH', '/api/cards/31', { parent: 'G4', waiting_for: ['3', '31'], title: 'n1' }));
  assert.deepStrictEqual(input, change('PATCH', '/api/cards/n1', { parent: 'n2', waiting_for: ['3', 'n1'], title: 'n1' }));
});

test('rewrite keeps a query string and the target of a note ref', () => {
  const out = tempIds.rewrite(change('GET', '/api/scratchpad/n1/file?path=a.md'), { n1: '9' });
  assert.strictEqual(out.change.path, '/api/scratchpad/9/file?path=a.md');
  const note = tempIds.rewrite(change('PATCH', '/api/notes', { ref: { day: 'd', target: 'n1', index: 2 }, note: 'x' }), { n1: '9' });
  assert.deepStrictEqual(note.change.body.ref, { day: 'd', target: '9', index: 2 });
});

test('rewrite names every temporary id the map has no entry for, and rewrites the others', () => {
  const out = tempIds.rewrite(change('POST', '/api/cards', { title: 't', parent: 'n1', waiting_for: ['n2', 'n3'] }), { n1: '30' });
  assert.deepStrictEqual(out.missing, ['n2', 'n3']);
  assert.strictEqual(out.change.body.parent, '30');
});

test('a change that names no temporary id comes back as it was', () => {
  const input = change('PATCH', '/api/cards/7', { status: 'done' });
  assert.deepStrictEqual(tempIds.rewrite(input, {}), { change: input, missing: [] });
});

test('createdId reads the id a card or group save made, and nothing else makes one', () => {
  assert.strictEqual(tempIds.createdId('POST', '/api/cards', { id: 'n1', joined: [] }), 'n1');
  assert.strictEqual(tempIds.createdId('POST', '/api/groups', { group: { id: 'n2' } }), 'n2');
  assert.strictEqual(tempIds.createdId('POST', '/api/cards', { id: 31 }), '31');
  assert.strictEqual(tempIds.createdId('PATCH', '/api/cards/7', { id: '7' }), null);
  assert.strictEqual(tempIds.createdId('POST', '/api/notes', { note: {} }), null);
  assert.strictEqual(tempIds.createdId('POST', '/api/cards/7/archive', { id: '7' }), null);
});

test('closure lists a record and every record that names a temporary id it made, and what those made', () => {
  const rec = (id, c, temp) => ({ id, change: c, ...(temp ? { temp } : {}) });
  const tray = [
    rec('d-1', change('POST', '/api/cards', { title: 'a' }), 'n1'),
    rec('d-2', change('PATCH', '/api/cards/7', { status: 'doing' })),
    rec('d-3', change('POST', '/api/cards', { title: 'child', parent: 'n1' }), 'n2'),
    rec('d-4', change('POST', '/api/notes', { target: 'n2', note: 'x' })),
    rec('d-5', change('POST', '/api/notes', { target: '7', note: 'y' })),
  ];
  assert.deepStrictEqual(tempIds.closure(tray, 'd-1'), ['d-1', 'd-3', 'd-4']);
  assert.deepStrictEqual(tempIds.closure(tray, 'd-3'), ['d-3', 'd-4']);
  assert.deepStrictEqual(tempIds.closure(tray, 'd-4'), ['d-4']);
  assert.deepStrictEqual(tempIds.closure(tray, 'd-9'), []);
});

test('nextTemp is one past the highest temporary id the records made', () => {
  assert.strictEqual(tempIds.nextTemp([]), 'n1');
  assert.strictEqual(tempIds.nextTemp([{ temp: 'n1' }, { id: 'x' }, { temp: 'n4' }, { temp: 'n2' }]), 'n5');
});

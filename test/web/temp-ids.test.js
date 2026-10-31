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

test('a scratchpad move to a path that reads like a temporary id is a path, neither found nor rewritten', () => {
  const move = change('POST', '/api/scratchpad/3/move', { from: 'a.md', to: 'n1' });
  assert.deepStrictEqual(tempIds.namesIn(move), []);
  assert.deepStrictEqual(tempIds.rewrite(move, { n1: '31' }), { change: move, missing: [] });
  assert.deepStrictEqual(tempIds.rewrite(move, {}), { change: move, missing: [] });
  const tray = [
    { id: 'd-1', change: change('POST', '/api/cards', { title: 'a' }), temp: 'n1' },
    { id: 'd-2', change: move },
  ];
  assert.deepStrictEqual(tempIds.closure(tray, 'd-1'), ['d-1']);
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

const made = (id, device, temp, c = change('POST', '/api/cards', { title: id })) => ({ id, device, change: c, temp });
const saved = (id, device, c) => ({ id, device, change: c });

test('closure removes only the later saves of the device that made the card when two devices took the same temporary id', () => {
  const tray = [
    made('desk-1', 'desk', 'n1'),
    made('phone-1', 'phone', 'n1'),
    saved('desk-2', 'desk', change('PATCH', '/api/cards/n1', { priority: 'High' })),
    saved('phone-2', 'phone', change('PATCH', '/api/cards/n1', { priority: 'Low' })),
  ];
  assert.deepStrictEqual(tempIds.closure(tray, 'desk-1'), ['desk-1', 'desk-2']);
  assert.deepStrictEqual(tempIds.closure(tray, 'phone-1'), ['phone-1', 'phone-2']);
});

test('whoMade answers the record own device, else the only device that made the id, else null', () => {
  const devicesOf = tempIds.makersOf([made('a-1', 'a', 'n1'), made('b-1', 'b', 'n1'), made('a-2', 'a', 'n2')]);
  assert.strictEqual(tempIds.whoMade(devicesOf, { device: 'b' }, 'n1'), 'b');
  assert.strictEqual(tempIds.whoMade(devicesOf, { device: 'c' }, 'n1'), null);
  assert.strictEqual(tempIds.whoMade(devicesOf, { device: 'c' }, 'n2'), 'a');
  assert.strictEqual(tempIds.whoMade(devicesOf, { device: 'c' }, 'n9'), null);
});

test('shadowed leaves out the other device card made under a temporary id the page holds, and that device later saves that name it', () => {
  const tray = [
    made('desk-1', 'desk', 'n1'),
    made('phone-1', 'phone', 'n1'),
    saved('phone-2', 'phone', change('PATCH', '/api/cards/n1', { priority: 'Low' })),
    saved('desk-2', 'desk', change('PATCH', '/api/cards/n1', { priority: 'High' })),
    saved('phone-3', 'phone', change('PATCH', '/api/cards/7', { priority: 'Low' })),
  ];
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'desk')], ['phone-1', 'phone-2']);
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'phone')], ['desk-1', 'desk-2']);
});

test('shadowed keeps the page own card whichever record comes first in the tray, and the first of two foreign cards otherwise', () => {
  const tray = [made('a-1', 'a', 'n1'), made('b-1', 'b', 'n1'), made('c-1', 'c', 'n1')];
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'c')], ['a-1', 'b-1']);
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'd')], ['b-1', 'c-1']);
});

test('shadowed leaves out a save that names an id several devices made when its own device made none, and keeps one that names a single maker', () => {
  const tray = [
    made('a-1', 'a', 'n1'),
    made('b-1', 'b', 'n1'),
    made('a-2', 'a', 'n2'),
    saved('c-1', 'c', change('PATCH', '/api/cards/n1', { priority: 'Low' })),
    saved('c-2', 'c', change('PATCH', '/api/cards/n2', { priority: 'Low' })),
  ];
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'a')], ['b-1', 'c-1']);
});

test('shadowed leaves out nothing when no two devices took the same temporary id', () => {
  const tray = [made('a-1', 'a', 'n1'), made('b-1', 'b', 'n2'), saved('b-2', 'b', change('PATCH', '/api/cards/n1', { priority: 'Low' }))];
  assert.deepStrictEqual([...tempIds.shadowed(tray, 'a')], []);
});

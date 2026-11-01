const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { describeChange, ROUTES } = require('../../plugin/skills/web/web/tray-describe');

// One plain-words row per queued change, written from its route and body. Every write route route.js
// answers has a description here: the guard lines of route.js are held against the table, so a write
// route added without one fails this test.

const ROUTE_JS = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'route.js'), 'utf8');
const NOTE_REF = { day: '2026-10-16', target: '7', index: 0, file: '2026.10.16.0007.logbook.md', expect: { at: '09:10', by: '@human', note: 'first' } };

// key of a ROUTES entry -> [path, body, record extras, the words]
const SAMPLES = {
  'POST /api/cards': ['/api/cards', { title: 'Made in the page', status: 'todo' }, { temp: 'n1' }, 'created card n1 "Made in the page"'],
  'PATCH /api/cards/:id': ['/api/cards/412', { status: 'doing' }, {}, 'moved #412 to doing'],
  'POST /api/cards/:id/archive': ['/api/cards/412/archive', {}, {}, 'archived #412'],
  'POST /api/cards/:id/restore': ['/api/cards/412/restore', {}, {}, 'restored #412'],
  'POST /api/cards/:id/reorder': ['/api/cards/412/reorder', { prev: '3', next: '7' }, {}, 'reordered #412 between #3 and #7'],
  'DELETE /api/cards/:id': ['/api/cards/412', { logbook: true, todos: true }, {}, 'deleted #412 with its notes and todos'],
  'POST /api/notes': ['/api/notes', { day: '2026-10-16', target: '7', note: 'third' }, {}, 'added a note to #7'],
  'PATCH /api/notes': ['/api/notes', { ref: NOTE_REF, note: 'x' }, {}, 'edited a note on #7'],
  'DELETE /api/notes': ['/api/notes', { ref: NOTE_REF }, {}, 'deleted a note on #7'],
  'POST /api/notes/assign': ['/api/notes/assign', { ref: NOTE_REF, to: '3' }, {}, 'moved a note from #7 to #3'],
  'PUT /api/scratchpad/:id': ['/api/scratchpad/7', { body: 'x' }, {}, 'saved the scratchpad page of #7'],
  'POST /api/scratchpad/:id/file': ['/api/scratchpad/7/file', { path: 'made.md', text: 'x' }, {}, 'created made.md in the scratchpad of #7'],
  'PUT /api/scratchpad/:id/file': ['/api/scratchpad/7/file', { path: 'notes.md', text: 'x', version: 'v' }, {}, 'saved notes.md in the scratchpad of #7'],
  'DELETE /api/scratchpad/:id/file': ['/api/scratchpad/7/file', { path: 'log.txt', version: 'v' }, {}, 'deleted log.txt from the scratchpad of #7'],
  'POST /api/scratchpad/:id/move': ['/api/scratchpad/7/move', { from: 'a.md', to: 'sub/b.md' }, {}, 'moved a.md to sub/b.md in the scratchpad of #7'],
  'POST /api/scratchpad/:id/folder': ['/api/scratchpad/7/folder', { path: 'newsub' }, {}, 'made the folder newsub in the scratchpad of #7'],
  'POST /api/todos/:id': ['/api/todos/7', { text: 'buy milk', version: 'v' }, {}, 'added a todo to #7: "buy milk"'],
  'PATCH /api/todos/:id': ['/api/todos/7', { index: 2, done: true, version: 'v' }, {}, 'ticked a todo on #7'],
  'DELETE /api/todos/:id': ['/api/todos/7', { index: 1, version: 'v' }, {}, 'deleted a todo on #7'],
  'PUT /api/todos/:id': ['/api/todos/7', { text: '- [ ] a\n', version: 'v' }, {}, 'edited the todo list of #7'],
  'POST /api/todos/:id/move': ['/api/todos/7/move', { index: 3, by: -1, version: 'v' }, {}, 'moved a todo on #7'],
  'POST /api/todos/:id/indent': ['/api/todos/7/indent', { index: 3, version: 'v' }, {}, 'indented a todo on #7'],
  'POST /api/todos/:id/outdent': ['/api/todos/7/outdent', { index: 2, version: 'v' }, {}, 'outdented a todo on #7'],
  'POST /api/config': ['/api/config', { key: 'typesOn', value: false }, {}, 'changed the setting typesOn (a desk job)'],
  'POST /api/groups': ['/api/groups', { name: 'zephyr 3' }, { temp: 'n2' }, 'created group n2 "zephyr 3"'],
  'PATCH /api/groups/:id': ['/api/groups/I2', { name: 'zephyr-2b' }, {}, 'renamed group I2 to "zephyr-2b"'],
  'POST /api/groups/:id/members': ['/api/groups/I2/members', { add: ['15'], remove: ['3'] }, {}, 'changed the members of group I2: added #15, removed #3'],
  'DELETE /api/groups/:id': ['/api/groups/I2', {}, {}, 'deleted group I2'],
  'POST /api/notifications/mark-read': ['/api/notifications/mark-read', {}, {}, 'marked notifications read (a desk job)'],
  'DELETE /api/notifications/:id': ['/api/notifications/1', {}, {}, 'removed a notification (a desk job)'],
  'DELETE /api/notifications': ['/api/notifications', {}, {}, 'cleared notifications (a desk job)'],
};

const record = (extra, [p, body], method) => ({ id: 'd1-1', at: '2026-10-31T10:00:00.000Z', device: 'd1', change: { method, path: p, body }, ...extra });

test('every route in the table has a sample and says its words', () => {
  for (const route of ROUTES) {
    const sample = SAMPLES[route.key];
    assert.ok(sample, `no sample for ${route.key}`);
    const [p, body, extra, words] = sample;
    assert.strictEqual(describeChange(record(extra, [p, body], route.method)), words, route.key);
  }
  for (const key of Object.keys(SAMPLES)) assert.ok(ROUTES.some((r) => r.key === key), `${key} is sampled but not in the table`);
});

test('every write route in route.js has a description', () => {
  const guards = ROUTE_JS.split('\n').filter((line) => /method === '(?:POST|PUT|PATCH|DELETE)'/.test(line) && !/^\s*\/\//.test(line));
  assert.ok(guards.length >= 20, `found ${guards.length} write guard lines`);
  for (const line of guards) {
    assert.ok(ROUTES.some((r) => line.includes(r.marker)), `a write route has no description: ${line.trim()}`);
  }
  for (const route of ROUTES) assert.ok(guards.some((line) => line.includes(route.marker)), `${route.key} names a guard that route.js no longer has: ${route.marker}`);
});

test('a card edit names its fields; a status alone is a move', () => {
  const edit = (body) => describeChange(record({}, ['/api/cards/412', body], 'PATCH'));
  assert.strictEqual(edit({ title: 'T', priority: 'High' }), 'edited #412: title, priority');
  assert.strictEqual(edit({ status: 'done', title: 'T' }), 'edited #412: status, title');
});

test('a temporary id reads as it is, a real one with its hash', () => {
  assert.strictEqual(describeChange(record({}, ['/api/cards/n1/archive', {}], 'POST')), 'archived n1');
  assert.strictEqual(describeChange(record({}, ['/api/cards/G7/archive', { package: 'q4' }], 'POST')), 'archived #G7 into the package q4');
});

test('a route nobody described says so plainly, never blank', () => {
  assert.strictEqual(describeChange(record({}, ['/api/surprise', {}], 'POST')), 'POST /api/surprise');
});

test('a card without its temporary id still reads as a created card', () => {
  assert.strictEqual(describeChange(record({}, ['/api/cards', { title: 'T' }], 'POST')), 'created a card "T"');
});

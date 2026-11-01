const { test } = require('node:test');
const assert = require('node:assert');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { routeSources } = require('./helpers/route-sources');

// A place with no counter of its own gives its own ids (card-store's useIdSource): the page hands out
// temporary ids n1, n2, ... for a card or group made in it, and every route that takes an id takes one.

const SOURCES = routeSources();
const card = (id, title) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const FILES = {
  '/p/.kanban/config.yaml': 'name: alpha\nnextId: 30\ngroups: .groups\nlogbook: logbook\nscratchpad: .pads\ntodos: .todos\n',
  '/p/.kanban/0003.three.card.md': card(3, 'Three'),
  '/p/.kanban/.groups/.keep': '',
};

function open(files = FILES) {
  let n = 0;
  const { route, fs } = makeMemoryRoute(SOURCES, { files: { ...files }, dir: '/p/.kanban', newId: () => `n${++n}` });
  return { route, fs };
}

test('a card made through a place that gives its own ids takes that id and leaves the board counter alone', () => {
  const { route, fs } = open();
  const made = route('POST', '/api/cards', { title: 'Fresh' });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.body.id, 'n1');
  assert.ok(fs.readdirSync('/p/.kanban').some((f) => f.startsWith('n0001.') && f.endsWith('.card.md')));
  assert.match(fs.readFileSync('/p/.kanban/config.yaml', 'utf8'), /nextId: 30\b/);
  const board = route('GET', '/api/board').body;
  assert.deepStrictEqual(board.active.map((c) => c.id).sort(), ['3', 'n1']);
});

test('a temporary id is a card id in every route: edit, parent, detail, archive, restore, delete', () => {
  const { route } = open();
  route('POST', '/api/cards', { title: 'Parent' });
  const child = route('POST', '/api/cards', { title: 'Child', parent: 'n1' });
  assert.strictEqual(child.status, 201);
  assert.strictEqual(child.body.id, 'n2');
  assert.strictEqual(child.body.parent, 'n1');
  assert.strictEqual(route('PATCH', '/api/cards/n1', { priority: 'High' }).body.priority, 'High');
  assert.strictEqual(route('GET', '/api/cards/n2/detail').status, 200);
  assert.strictEqual(route('POST', '/api/cards/n1/archive', {}).status, 200);
  assert.deepStrictEqual(route('GET', '/api/board').body.archived.map((c) => c.id), ['n1']);
  assert.strictEqual(route('POST', '/api/cards/n1/restore', {}).status, 200);
  assert.strictEqual(route('DELETE', '/api/cards/n2', {}).status, 200);
  assert.deepStrictEqual(route('GET', '/api/board').body.active.map((c) => c.id).sort(), ['3', 'n1']);
});

test('a note, a todo and a scratchpad page can be filed under a temporary id', () => {
  const { route } = open();
  route('POST', '/api/cards', { title: 'Fresh' });
  const note = route('POST', '/api/notes', { target: 'n1', day: '2026-10-31', at: '09:00', by: '@human', note: 'hello' });
  assert.strictEqual(note.status, 201, JSON.stringify(note.body));
  assert.strictEqual(route('GET', '/api/board').body.logbook.notes.filter((n) => n.target === 'n1').length, 1);
  const version = route('GET', '/api/todos/n1').body.todos.version;
  assert.strictEqual(route('POST', '/api/todos/n1', { text: 'a thing', version }).status, 201);
  assert.strictEqual(route('PUT', '/api/scratchpad/n1', { body: 'page' }).status, 200);
});

test('a group made through it takes the next temporary id, lists a temporary card, and takes more', () => {
  const { route } = open();
  route('POST', '/api/cards', { title: 'Fresh' });
  const group = route('POST', '/api/groups', { name: 'Trip', cards: ['3', 'n1'] });
  assert.strictEqual(group.status, 201, JSON.stringify(group.body));
  assert.strictEqual(group.body.group.id, 'n2');
  assert.deepStrictEqual(group.body.group.cards, ['3', 'n1']);
  route('POST', '/api/cards', { title: 'Another' });
  const more = route('POST', '/api/groups/n2/members', { add: ['n3'] });
  assert.deepStrictEqual(more.body.group.cards, ['3', 'n1', 'n3']);
  assert.strictEqual(route('DELETE', '/api/groups/n2', {}).status, 200);
});

test('with no id source a card still takes the next real id', () => {
  const { route } = makeMemoryRoute(SOURCES, { files: { ...FILES }, dir: '/p/.kanban' });
  assert.strictEqual(route('POST', '/api/cards', { title: 'Real' }).body.id, '30');
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { versionOf } = require('../../plugin/skills/web/scripts/store-common');
const { routeSources, PLUGIN } = require('./helpers/route-sources');

// Every /api route, read or write, answers the same over a real board folder and over the in-memory file
// system the page uses: the same status, the same answer and the same files left behind. The stores and
// route.js are the real ones in both; only what they stand on differs.

const card = (id, title, extra = '') => `---\nid: ${id}\nstatus: todo\npriority: Normal\nwaiting_for: [${extra}]\ntags: []\n---\n\n# ${title}\n\nbody of ${id}\n`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const TODO7 = '# plan\n- [ ] a\n  - [x] a1\n- [ ] b\n- [ ] c\n';
const PAD_NOTES = '# Notes\n\nhello\n';
const PAD_LOG = 'line one\n';

// A group that is running today, so a new card joins it.
const dayFrom = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SEED = {
  'project/.kanban/config.yaml': ['name: t', 'nextId: 30', 'groups: .groups', 'logbook: logbook', 'scratchpad: ../pads/<card>', 'todos: .todos',
    'prefixes:', '  _: .groups', '  I: .groups/iteration', 'counters: { I: 3 }', 'assignees:', '  - handle: "@alex"', '    name: "Alex"', ''].join('\n'),
  'project/.kanban/0003.three.card.md': card(3, 'Three'),
  'project/.kanban/0007.seven.card.md': card(7, 'Seven', '3'),
  'project/.kanban/0015.fifteen.card.md': card(15, 'Fifteen'),
  'project/.kanban/archived/0002.two.card.md': card(2, 'Two'),
  'project/.kanban/notifications.md': '- id: 1\n  at: 2026-07-08T23:40:00\n  from: "workflow:#13-finalizer"\n  message: "Card #13 closed."\n  read: false\n- id: 2\n  at: 2026-07-09T06:15:00\n  from: agent-batch2\n  message: "Batch 2 done."\n  read: true\n',
  'project/.kanban/logbook/2026.10.16.0007.logbook.md': '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: first\n  - at: "10:00"\n    by: "@human"\n    note: second\n---\n',
  'project/.kanban/.groups/iteration/I0002.zephyr-2.md': `---\nid: I2\nname: zephyr-2\nstart_date: ${dayFrom(-3)}\nend_date: ${dayFrom(7)}\nauto_join: true\nowner: "@human"\ncards: [3, 7]\n---\n\nThe second iteration.\n`,
  'project/.kanban/.groups/I0001.loose.md': '---\nid: _1\nname: loose\ncards: [15]\n---\n',
  'project/.kanban/.todos/0007.todo.md': TODO7,
  'project/.kanban/.todos/I0002.todo.md': '- [ ] group item\n',
  'project/pads/7/0007.scratchpad.md': '---\nrefs:\n  - a.md\n---\n\npage body\n',
  'project/pads/7/notes.md': PAD_NOTES,
  'project/pads/7/log.txt': PAD_LOG,
  'project/pads/7/blob.bin': Buffer.from([0, 1, 2, 3, 0]),
  'project/pads/7/shot.png': PNG,
  'project/pads/7/sub/inner.md': 'inner\n',
  'project/pads/I2/I0002.scratchpad.md': 'group page\n',
  'project/pic.png': PNG,
};

const BOARD = 'project/.kanban';

// The calls of each row, in order: [method, path, body]. A body that is a function reads the board first,
// through the same route, so a version it names is the one that side holds.
const ROWS = [
  // reads
  ['the board load', ['GET', '/api/board']],
  ['a card\'s detail', ['GET', '/api/cards/7/detail']],
  ['a card\'s image', ['GET', '/api/cards/7/image?path=' + encodeURIComponent('../pic.png')]],
  ['a card that is not there', ['GET', '/api/cards/99/detail']],
  ['a path that is no route', ['GET', '/api/nothing-here']],
  ['a scratchpad page', ['GET', '/api/scratchpad/7']],
  ['a scratchpad folder listing', ['GET', '/api/scratchpad/7/files?path=']],
  ['a scratchpad subfolder listing', ['GET', '/api/scratchpad/7/files?path=sub']],
  ['a scratchpad file', ['GET', '/api/scratchpad/7/file?path=notes.md']],
  ['a todo list', ['GET', '/api/todos/7']],

  // notifications
  ['notifications: mark all read', ['POST', '/api/notifications/mark-read']],
  ['notifications: mark some read', ['POST', '/api/notifications/mark-read', { ids: [1] }]],
  ['notifications: remove one', ['DELETE', '/api/notifications/1']],
  ['notifications: clear', ['DELETE', '/api/notifications']],

  // notes
  ['notes: add one for a card', ['POST', '/api/notes', { day: '2026-10-16', target: '7', at: '11:00', note: 'third' }]],
  ['notes: add one for no card', ['POST', '/api/notes', { day: '2026-10-17', note: 'standup' }]],
  ['notes: a bad note is refused', ['POST', '/api/notes', { day: '16/10/2026', target: '7', note: 'x' }]],
  ['notes: edit one', ['PATCH', '/api/notes', { ref: { day: '2026-10-16', target: '7', index: 0, file: '2026.10.16.0007.logbook.md', expect: { at: '09:10', by: '@human', note: 'first' } }, at: '09:30', note: 'first, changed' }]],
  ['notes: assign one to another card', ['POST', '/api/notes/assign', { ref: { day: '2026-10-16', target: '7', index: 1, file: '2026.10.16.0007.logbook.md', expect: { at: '10:00', by: '@human', note: 'second' } }, to: '3' }]],
  ['notes: delete one', ['DELETE', '/api/notes', { ref: { day: '2026-10-16', target: '7', index: 0, file: '2026.10.16.0007.logbook.md', expect: { at: '09:10', by: '@human', note: 'first' } } }]],

  // the scratchpad page
  ['scratchpad: write a card\'s page', ['PUT', '/api/scratchpad/7', { body: 'first\nsecond' }]],
  ['scratchpad: write a group\'s page', ['PUT', '/api/scratchpad/I2', { body: 'g' }]],
  ['scratchpad: write a page for an id that is no card', ['PUT', '/api/scratchpad/99', { body: 'x' }]],
  ['scratchpad: write a body that is no text', ['PUT', '/api/scratchpad/7', { body: 5 }]],

  // the scratchpad folder
  ['scratchpad folder: create a file', ['POST', '/api/scratchpad/7/file', { path: 'made.md', text: 'new file\n' }]],
  ['scratchpad folder: create in a subfolder', ['POST', '/api/scratchpad/7/file', { path: 'sub/made.txt', text: 'deep\n' }]],
  ['scratchpad folder: create over a name taken', ['POST', '/api/scratchpad/7/file', { path: 'notes.md', text: 'again\n' }]],
  ['scratchpad folder: save a file', ['PUT', '/api/scratchpad/7/file', { path: 'notes.md', text: '# Notes\n\nchanged\n', version: versionOf(PAD_NOTES) }]],
  ['scratchpad folder: save a stale version', ['PUT', '/api/scratchpad/7/file', { path: 'notes.md', text: 'x', version: versionOf('older') }]],
  ['scratchpad folder: delete a file', ['DELETE', '/api/scratchpad/7/file', { path: 'log.txt', version: versionOf(PAD_LOG) }]],
  ['scratchpad folder: move a file', ['POST', '/api/scratchpad/7/move', { from: 'notes.md', to: 'sub/moved.md' }]],
  ['scratchpad folder: rename a file by case only', ['POST', '/api/scratchpad/7/move', { from: 'log.txt', to: 'LOG.txt' }]],
  ['scratchpad folder: move over a name taken', ['POST', '/api/scratchpad/7/move', { from: 'notes.md', to: 'log.txt' }]],
  ['scratchpad folder: make a subfolder', ['POST', '/api/scratchpad/7/folder', { path: 'newsub' }]],
  ['scratchpad folder: a path out of the folder', ['GET', '/api/scratchpad/7/file?path=' + encodeURIComponent('../../.kanban/config.yaml')]],

  // todos
  ['todos: add an item', ['POST', '/api/todos/7', { text: 'd', version: versionOf(TODO7) }]],
  ['todos: add a child', ['POST', '/api/todos/7', { text: 'child', parent: 1, version: versionOf(TODO7) }]],
  ['todos: add to a list that is not yet a file', ['POST', '/api/todos/3', (call) => ({ text: 'first', version: call('GET', '/api/todos/3').body.todos.version })]],
  ['todos: tick an item', ['PATCH', '/api/todos/7', { index: 2, done: true, version: versionOf(TODO7) }]],
  ['todos: edit an item', ['PATCH', '/api/todos/7', { index: 3, text: 'see #7', version: versionOf(TODO7) }]],
  ['todos: delete an item', ['DELETE', '/api/todos/7', { index: 1, version: versionOf(TODO7) }]],
  ['todos: write the whole text', ['PUT', '/api/todos/7', { text: '- [ ] only\n', version: versionOf(TODO7) }]],
  ['todos: move an item', ['POST', '/api/todos/7/move', { index: 3, by: -1, version: versionOf(TODO7) }]],
  ['todos: indent an item', ['POST', '/api/todos/7/indent', { index: 3, version: versionOf(TODO7) }]],
  ['todos: outdent an item', ['POST', '/api/todos/7/outdent', { index: 2, version: versionOf(TODO7) }]],
  ['todos: a stale version is refused', ['POST', '/api/todos/7', { text: 'x', version: versionOf('older') }]],
  ['todos: two saves in a row, the second on the version the first answered',
    ['POST', '/api/todos/7', { text: 'one', version: versionOf(TODO7) }],
    ['POST', '/api/todos/7', (call) => ({ text: 'two', version: call('GET', '/api/todos/7').body.todos.version })]],

  // the gear's config
  ['config: turn types off', ['POST', '/api/config', { key: 'typesOn', value: false }]],
  ['config: set the id digits', ['POST', '/api/config', { key: 'idDigits', value: 5 }]],
  ['config: move the logbook folder', ['POST', '/api/config', { key: 'logbook', value: 'notes-log' }]],
  ['config: save a block', ['POST', '/api/config', { block: 'types', value: [{ name: 'goal', color: '#e3b341' }, 'task'] }]],
  ['config: a key the gear does not write', ['POST', '/api/config', { key: 'nextId', value: 5 }]],

  // groups
  ['groups: create one', ['POST', '/api/groups', { name: 'zephyr 3', folder: 'iteration', start_date: '2026-10-26', end_date: '2026-11-06', auto_join: true, cards: ['3', '7'] }]],
  ['groups: create a loose one', ['POST', '/api/groups', { name: 'offsite-prep', cards: ['3'] }]],
  ['groups: rename one', ['PATCH', '/api/groups/I2', { name: 'zephyr-2b' }]],
  ['groups: add and remove members', ['POST', '/api/groups/I2/members', { add: ['15'], remove: ['3'] }]],
  ['groups: delete one', ['DELETE', '/api/groups/I2', {}]],
  ['groups: delete one with its members and extras', ['DELETE', '/api/groups/I2', { members: true, logbook: true, scratchpad: true, todos: true, memberLogbook: true, memberScratchpad: true, memberTodos: true }]],
  ['groups: a group that is not there', ['DELETE', '/api/groups/I9', {}]],

  // cards
  ['cards: create one', ['POST', '/api/cards', { title: 'Made', status: 'todo' }]],
  ['cards: create one that joins the running group', ['POST', '/api/cards', { title: 'Joined', status: 'todo', priority: 'High', tags: ['x'] }]],
  ['cards: create one waiting on an open card, refused to doing', ['POST', '/api/cards', { title: 'Gated', status: 'doing', waiting_for: [3] }]],
  ['cards: edit one', ['PATCH', '/api/cards/3', { title: 'Three, renamed', status: 'doing', priority: 'High' }]],
  ['cards: a move to doing past a waiting card is refused', ['PATCH', '/api/cards/7', { status: 'doing' }]],
  ['cards: archive one', ['POST', '/api/cards/3/archive']],
  ['cards: archive one into a package', ['POST', '/api/cards/3/archive', { package: 'q4' }]],
  ['cards: archive into a package that is no name', ['POST', '/api/cards/3/archive', { package: '../x' }]],
  ['cards: restore one', ['POST', '/api/cards/2/restore']],
  ['cards: reorder one', ['POST', '/api/cards/15/reorder', { prev: '3', next: '7' }]],
  ['cards: reorder with a neighbour that is no id', ['POST', '/api/cards/15/reorder', { prev: 'x y', next: null }]],
  ['cards: delete one', ['DELETE', '/api/cards/3']],
  ['cards: delete one with its extras', ['DELETE', '/api/cards/7', { logbook: true, scratchpad: true, todos: true }]],
  ['cards: delete one that is not there', ['DELETE', '/api/cards/99']],
];

const SOURCES = routeSources();
const TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;
const NOW = () => 1788100000000;

// The text of a seed or an answer with the board's place and the clock taken out, so a real folder and a
// memory one can be told apart only by what the route did.
function neutral(root, text) {
  let out = text;
  let moved = false;
  for (const r of new Set([root, root.replace(/\\/g, '/'), root.replace(/\\/g, '\\\\')])) {
    if (out.includes(r)) { out = out.split(r).join('<root>'); moved = true; }
  }
  if (moved) out = out.replace(/<root>[^"'\n]*/g, (m) => m.replace(/\\\\|\\/g, '/'));
  return out.replace(TIME, '<time>');
}

function neutralAnswer(root, answer) {
  if (answer === null) return null;
  const body = Buffer.isBuffer(answer.body) ? { bytes: answer.body.toString('hex') } : JSON.parse(neutral(root, JSON.stringify(answer.body)));
  return { ...answer, body };
}

function realSide() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-route-mem-')));
  for (const [rel, data] of Object.entries(SEED)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  }
  const route = makeRoute(path.join(root, BOARD));
  const files = () => {
    const out = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (e.isDirectory()) { out[`${rel}/`] = null; walk(full); } else out[rel] = fs.readFileSync(full);
      }
    };
    walk(root);
    return out;
  };
  return { root, route, files, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function memorySide() {
  const root = '/root';
  const seeded = {};
  for (const [rel, data] of Object.entries(SEED)) seeded[`${root}/${rel}`] = data;
  const { route, fs: memory } = makeMemoryRoute(SOURCES, { files: seeded, dir: `${root}/${BOARD}`, now: NOW });
  const files = () => {
    const out = {};
    for (const [abs, data] of Object.entries(memory.dump())) {
      if (abs !== `${root}/`) out[abs.slice(root.length + 1)] = data === null ? null : Buffer.from(data);
    }
    return out;
  };
  return { root, route, files, done() {} };
}

function neutralFiles(root, files) {
  const out = {};
  for (const [rel, data] of Object.entries(files)) out[rel] = data === null ? null : neutral(root, data.toString('latin1'));
  return out;
}

function play(side, steps) {
  const call = (method, p, body) => side.route(method, p, body);
  return steps.map(([method, p, body]) => neutralAnswer(side.root, call(method, p, typeof body === 'function' ? body(call) : body)));
}

for (const [name, ...steps] of ROWS) {
  test(`${name}: the same status, answer and files over a real folder and over memory`, () => {
    const real = realSide();
    const mem = memorySide();
    try {
      const a = play(real, steps);
      const b = play(mem, steps);
      assert.deepStrictEqual(b, a);
      assert.deepStrictEqual(neutralFiles(mem.root, mem.files()), neutralFiles(real.root, real.files()));
    } finally { real.done(); }
  });
}

test('the table calls every write route', () => {
  const wrote = ROWS.flatMap(([, ...steps]) => steps).filter(([method]) => method !== 'GET');
  const seen = new Set(wrote.map(([method, p]) => `${method} ${p.split('?')[0].replace(/\/(?:I|_)?\d+/g, '/:id')}`));
  for (const want of [
    'POST /api/notifications/mark-read', 'DELETE /api/notifications/:id', 'DELETE /api/notifications',
    'POST /api/notes', 'PATCH /api/notes', 'DELETE /api/notes', 'POST /api/notes/assign',
    'PUT /api/scratchpad/:id', 'POST /api/scratchpad/:id/file', 'PUT /api/scratchpad/:id/file', 'DELETE /api/scratchpad/:id/file', 'POST /api/scratchpad/:id/move', 'POST /api/scratchpad/:id/folder',
    'POST /api/todos/:id', 'PATCH /api/todos/:id', 'DELETE /api/todos/:id', 'PUT /api/todos/:id', 'POST /api/todos/:id/move', 'POST /api/todos/:id/indent', 'POST /api/todos/:id/outdent',
    'POST /api/config',
    'POST /api/groups', 'PATCH /api/groups/:id', 'POST /api/groups/:id/members', 'DELETE /api/groups/:id',
    'POST /api/cards', 'PATCH /api/cards/:id', 'POST /api/cards/:id/archive', 'POST /api/cards/:id/restore', 'POST /api/cards/:id/reorder', 'DELETE /api/cards/:id',
  ]) assert.ok(seen.has(want), `no row calls ${want}`);
});

test('every script of the web skill but the launcher and the server loads with only the fs, path and crypto shims', () => {
  const { makeLoader } = require('../../plugin/skills/web/scripts/module-loader');
  const { makeMemoryFs } = require('../../plugin/skills/web/scripts/memory-fs');
  const sources = {};
  const scripts = fs.readdirSync(path.join(PLUGIN, 'scripts')).filter((f) => f.endsWith('.js') && !['launcher.js', 'server.js'].includes(f));
  for (const f of scripts) Object.assign(sources, routeSources(`scripts/${f}`));
  const loader = makeLoader({
    sources,
    builtins: { fs: makeMemoryFs(), path: require('../../plugin/skills/web/scripts/posix-path'), crypto: require('../../plugin/skills/web/scripts/crypto-shim') },
  });
  for (const f of scripts) assert.doesNotThrow(() => loader.load(`scripts/${f}`), f);
  assert.ok(scripts.includes('card-store.js') && scripts.includes('todo-store.js') && scripts.includes('scratchpad-folder.js'));
});

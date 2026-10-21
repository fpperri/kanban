const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');
const { parseConfig } = require('../scripts/config-store');

// The gear's This board pages through the server (docs/adr/0017): one top-level line of
// config.yaml is replaced, inserted or removed and every other byte stays; a folder the web
// writes sits inside the board; a folder set by hand outside it works for the server and shows
// locked on the page.

const CONFIG = [
  '# The board of the tests',
  'name: t',
  'nextId: 30   # next plain id',
  'logbook: logbook',
  'groups: .groups',
  'iterations: true',
  'prefixes:',
  '  _: .groups',
  '  I: .groups/iteration',
  '  W: workflow/',
  '  G: goal',
  'counters: { I: 3 }',
  'assignees:',
  '  - handle: "@alex"',
  '    name: "Alex"',
  '',
].join('\n');

function tmpBoard({ config = CONFIG } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-settings-srv-'));
  if (config !== null) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function req(base, method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const set = (base, key, value) => req(base, 'POST', '/api/config', { key, value });
const config = (dir) => fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
const without = (text, line) => text.split('\n').filter((l) => l !== line).join('\n');

// --- reading --------------------------------------------------------------------------

test('the board payload carries the config the gear shows', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const board = (await req(base, 'GET', '/api/board')).json;
    const { settings } = board;
    assert.deepStrictEqual(settings.logbook, { on: true, folder: 'logbook', locked: false, reason: '' });
    assert.deepStrictEqual(settings.groups, { on: true, folder: '.groups', locked: false, reason: '' });
    assert.strictEqual(board.iterations, true, 'the payload\'s own iterations field is what the switch shows');
    assert.strictEqual('iterations' in settings, false, 'and settings carries no second one');
    assert.strictEqual(settings.idDigits, 4);
    assert.strictEqual(settings.nextId, 30);
    assert.deepStrictEqual(settings.counters, { I: 3 });
    assert.deepStrictEqual(settings.prefixes, [
      { prefix: '_', kind: 'folder', target: '.groups', folder: '' },
      { prefix: 'I', kind: 'folder', target: '.groups/iteration', folder: 'iteration' },
      { prefix: 'W', kind: 'folder', target: 'workflow/', folder: 'workflow' },
      { prefix: 'G', kind: 'type', target: 'goal' },
    ]);
  });
});

test('a prefix a line names twice for different targets is answered as a clash, the first line kept', async () => {
  const dir = tmpBoard({ config: 'name: t\nprefixes:\n  G: goal\n  G: epic\n  G: goal\n  W: workflow/\n' });
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(settings.prefixes.map((p) => [p.prefix, p.target]), [['G', 'goal'], ['W', 'workflow/']]);
    assert.deepStrictEqual(settings.prefixClashes, [{ prefix: 'G', kept: 'goal', ignored: 'epic' }]);
  });
});

test('a board with no config.yaml shows every feature off', async () => {
  const dir = tmpBoard({ config: null });
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    assert.strictEqual(settings.logbook.on, false);
    assert.strictEqual(settings.groups.on, false);
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.iterations, false);
    assert.strictEqual(settings.idDigits, 4);
    assert.deepStrictEqual(settings.prefixes, []);
  });
});

test('a folder set by hand outside the board shows locked with the reason', async () => {
  const dir = tmpBoard({ config: 'logbook: ../notes\ngroups: /elsewhere/groups\n' });
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    assert.strictEqual(settings.logbook.locked, true);
    assert.match(settings.logbook.reason, /outside the board/);
    assert.strictEqual(settings.logbook.folder, '../notes');
    assert.strictEqual(settings.groups.locked, true);
  });
});

test('the scratchpad is a folder feature like the logbook: off without the line, locked when set by hand outside the board', async () => {
  await withServer(tmpBoard(), async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.settings.scratchpad, { on: false, folder: '', locked: false, reason: '' });
  });
  await withServer(tmpBoard({ config: 'scratchpad: ../pads\n' }), async (base) => {
    const { scratchpad } = (await req(base, 'GET', '/api/board')).json.settings;
    assert.strictEqual(scratchpad.locked, true);
    assert.match(scratchpad.reason, /outside the board/);
    assert.strictEqual((await set(base, 'scratchpad', null)).status, 409);
  });
});

// --- on and off -----------------------------------------------------------------------

test('switching the logbook off removes its line and every other byte stays; on writes it back in place', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    const off = await set(base, 'logbook', null);
    assert.strictEqual(off.status, 200);
    assert.strictEqual(config(dir), without(before, 'logbook: logbook'));
    assert.strictEqual(off.json.settings.logbook.on, false);
    const on = await set(base, 'logbook', 'logbook');
    assert.strictEqual(on.status, 200);
    assert.strictEqual(config(dir).split('\n').filter((l) => l.startsWith('logbook:')).length, 1);
    assert.strictEqual(on.json.settings.logbook.on, true);
    assert.deepStrictEqual(parseConfig(config(dir)), parseConfig(before));
    assert.strictEqual(without(config(dir), 'logbook: logbook'), without(before, 'logbook: logbook'));
  });
});

test('a feature switched on on a bare board writes its line below the id lines', async () => {
  const dir = tmpBoard({ config: '# c\nname: t\nnextId: 5\nassignees:\n  - handle: "@a"\n' });
  await withServer(dir, async (base) => {
    await set(base, 'logbook', 'logbook');
    await set(base, 'groups', '.groups');
    assert.strictEqual(config(dir), '# c\nname: t\nnextId: 5\nlogbook: logbook\ngroups: .groups\nassignees:\n  - handle: "@a"\n');
  });
});

test('the scratchpad line goes below the logbook line, and the groups line below it', async () => {
  const dir = tmpBoard({ config: 'name: t\nnextId: 5\nlogbook: logbook\nassignees:\n  - handle: "@a"\n' });
  await withServer(dir, async (base) => {
    const on = await set(base, 'scratchpad', '.scratchpad');
    assert.strictEqual(on.status, 200);
    assert.strictEqual(on.json.settings.scratchpad.on, true);
    await set(base, 'groups', '.groups');
    assert.strictEqual(config(dir), 'name: t\nnextId: 5\nlogbook: logbook\nscratchpad: .scratchpad\ngroups: .groups\nassignees:\n  - handle: "@a"\n');
    assert.strictEqual((await set(base, 'scratchpad', '../out')).status, 400, 'a folder from the page sits inside the board');
    await set(base, 'scratchpad', null);
    assert.strictEqual(config(dir), 'name: t\nnextId: 5\nlogbook: logbook\ngroups: .groups\nassignees:\n  - handle: "@a"\n');
  });
});

test('a board with no config.yaml gets one when a feature is switched on', async () => {
  const dir = tmpBoard({ config: null });
  await withServer(dir, async (base) => {
    assert.strictEqual((await set(base, 'groups', '.groups')).status, 200);
    assert.strictEqual(config(dir), 'groups: .groups\n');
  });
});

test('a file with CRLF line endings keeps them', async () => {
  const dir = tmpBoard({ config: 'name: t\r\nnextId: 5\r\nassignees:\r\n  - handle: "@a"\r\n' });
  await withServer(dir, async (base) => {
    await set(base, 'logbook', 'logbook');
    assert.strictEqual(config(dir), 'name: t\r\nnextId: 5\r\nlogbook: logbook\r\nassignees:\r\n  - handle: "@a"\r\n');
  });
});

// --- the folder -----------------------------------------------------------------------

test('a folder inside the board saves and changes only the line', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    const r = await set(base, 'logbook', 'notes/day');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(config(dir), before.replace('logbook: logbook', 'logbook: notes/day'));
    assert.strictEqual(r.json.settings.logbook.folder, 'notes/day');
  });
});

test('a folder is kept as a relative path: a leading ./, a trailing slash and backslashes are tidied', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await set(base, 'logbook', './notes\\day/');
    assert.match(config(dir), /^logbook: notes\/day$/m);
  });
});

test('an absolute folder inside the board is saved relative to it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await set(base, 'groups', path.join(dir, 'sets'));
    assert.match(config(dir), /^groups: sets$/m);
  });
});

test('a folder outside the board, or the board itself, is refused and nothing is written', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    for (const bad of ['../notes', '..', 'a/../../b', path.join(os.tmpdir(), 'elsewhere'), '/etc', 'C:\\Windows', '.', './', '', '   ', 'a/./..']) {
      const r = await set(base, 'logbook', bad);
      assert.strictEqual(r.status, 400, `refuses ${JSON.stringify(bad)}`);
      assert.ok(r.json.error);
    }
    assert.strictEqual(config(dir), before);
  });
});

test('a folder that would need quoting in config.yaml is refused', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    for (const bad of ['a # b', '"x"', "it's", 'a: b', '-x', '[x]', 'a\nb', 'x\u0000', 'a*b', 'a?b', 'a|b', 'a/ b/c ', 'a./b.']) {
      const r = await set(base, 'logbook', bad);
      assert.strictEqual(r.status, 400, `refuses ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(config(dir), before);
    assert.strictEqual((await set(base, 'logbook', 'my notes (2026)')).status, 200);
  });
});

test('a folder set by hand outside the board still works for the logbook, and the page cannot change it', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-settings-outside-'));
  const dir = tmpBoard({ config: `name: t\nlogbook: ${outside.replace(/\\/g, '/')}\n` });
  const before = config(dir);
  await withServer(dir, async (base) => {
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.strictEqual(board.logbook.folder, outside.replace(/\\/g, '/'));
    assert.strictEqual(board.settings.logbook.locked, true);
    for (const value of [null, 'inside', outside]) {
      const r = await set(base, 'logbook', value);
      assert.strictEqual(r.status, 409, `refuses ${JSON.stringify(value)}`);
      assert.match(r.json.error, /outside the board/);
    }
    assert.strictEqual(config(dir), before);
  });
});

test('a folder is not touched in its files: changing the line moves nothing', async () => {
  const dir = tmpBoard();
  fs.mkdirSync(path.join(dir, 'logbook'));
  fs.writeFileSync(path.join(dir, 'logbook', 'keep.txt'), 'x');
  await withServer(dir, async (base) => {
    await set(base, 'logbook', 'elsewhere');
    assert.ok(fs.existsSync(path.join(dir, 'logbook', 'keep.txt')));
    assert.ok(!fs.existsSync(path.join(dir, 'elsewhere')));
  });
});

// --- groups and iterations ------------------------------------------------------------

test('turning groups off removes only the groups line; the iterations line stays and is ignored until groups are back', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    const r = await set(base, 'groups', null);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(config(dir), without(before, 'groups: .groups'));
    assert.ok(config(dir).includes('iterations: true'));
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.iterations, false, 'the payload ignores it without groups');
    const back = await set(base, 'groups', '.groups');
    assert.strictEqual(back.status, 200);
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.iterations, true, 'and picks it up again with them');
  });
});

test('turning iterations on needs groups', async () => {
  const dir = tmpBoard({ config: 'name: t\n' });
  await withServer(dir, async (base) => {
    const refused = await set(base, 'iterations', true);
    assert.strictEqual(refused.status, 409);
    assert.match(refused.json.error, /groups/i);
    assert.strictEqual(config(dir), 'name: t\n');
    await set(base, 'groups', '.groups');
    const ok = await set(base, 'iterations', true);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(config(dir), 'name: t\ngroups: .groups\niterations: true\n');
    const off = await set(base, 'iterations', false);
    assert.strictEqual(off.status, 200);
    assert.strictEqual(config(dir), 'name: t\ngroups: .groups\n');
  });
});

test('a groups folder set by hand outside the board cannot be switched off from the page, and iterations stay', async () => {
  const dir = tmpBoard({ config: 'groups: ../g\niterations: true\n' });
  await withServer(dir, async (base) => {
    assert.strictEqual((await set(base, 'groups', null)).status, 409);
    assert.strictEqual(config(dir), 'groups: ../g\niterations: true\n');
  });
});

// --- idDigits -------------------------------------------------------------------------

test('changing idDigits changes only new file names', async () => {
  const dir = tmpBoard({ config: 'name: t\nnextId: 3\nidDigits: 4\n' });
  fs.writeFileSync(path.join(dir, '0002.old.card.md'), '---\nid: 2\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Old\n');
  await withServer(dir, async (base) => {
    const r = await set(base, 'idDigits', 6);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(config(dir), 'name: t\nnextId: 3\nidDigits: 6\n');
    assert.strictEqual(r.json.settings.idDigits, 6);
    const made = await req(base, 'POST', '/api/cards', { title: 'New', status: 'todo' });
    assert.strictEqual(made.status, 201);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).sort();
    assert.deepStrictEqual(files, ['000003.new.card.md', '0002.old.card.md']);
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(board.active.map((c) => String(c.id)).sort(), ['2', '3']);
  });
});

test('idDigits takes a whole number from 1 to 15 and nothing else', async () => {
  const dir = tmpBoard({ config: 'name: t\nidDigits: 4\n' });
  await withServer(dir, async (base) => {
    for (const bad of [0, 16, 2.5, -1, 'x', '', null, true, '4 # no']) {
      const r = await set(base, 'idDigits', bad);
      assert.strictEqual(r.status, 400, `refuses ${JSON.stringify(bad)}`);
    }
    assert.strictEqual(config(dir), 'name: t\nidDigits: 4\n');
    assert.strictEqual((await set(base, 'idDigits', '8')).status, 200);
    assert.strictEqual(config(dir), 'name: t\nidDigits: 8\n');
  });
});

test('idDigits is written below nextId when it was not there', async () => {
  const dir = tmpBoard({ config: 'name: t\nnextId: 3\ngroups: g\n' });
  await withServer(dir, async (base) => {
    await set(base, 'idDigits', 5);
    assert.strictEqual(config(dir), 'name: t\nnextId: 3\nidDigits: 5\ngroups: g\n');
  });
});

// --- what the route refuses -----------------------------------------------------------

test('only the gear\'s keys are written, and no other line changes', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    for (const key of ['nextId', 'name', 'port', 'prefixes', 'counters', 'assignees', 'x y', '__proto__', undefined, 7]) {
      const r = await set(base, key, 'x');
      assert.strictEqual(r.status, 400, `refuses ${String(key)}`);
    }
    assert.strictEqual(config(dir), before);
  });
});

test('a folder value must be text, an iterations value true or false', async () => {
  const dir = tmpBoard();
  const before = config(dir);
  await withServer(dir, async (base) => {
    assert.strictEqual((await set(base, 'logbook', 5)).status, 400);
    assert.strictEqual((await set(base, 'logbook', ['a'])).status, 400);
    assert.strictEqual((await set(base, 'iterations', 'yes')).status, 400);
    assert.strictEqual(config(dir), before);
  });
});

test('the inside-the-board rule reads POSIX and Windows spellings of a path alike, on any OS', () => {
  const { insideBoard } = require('../scripts/settings-store');
  const dir = path.resolve(os.tmpdir(), 'a-board');
  for (const out of ['../outside', '..\\outside', 'a/../../b', 'a\\..\\..\\b', '..', '/etc/notes', '', '   ', '.', './']) {
    assert.strictEqual(insideBoard(dir, out), null, `refuses ${JSON.stringify(out)}`);
  }
  assert.strictEqual(insideBoard(dir, 'notes/day'), 'notes/day');
  assert.strictEqual(insideBoard(dir, 'notes\\day'), 'notes/day');
  assert.strictEqual(insideBoard(dir, './notes/../notes/day'), 'notes/day');
});

// --- a whole block: types, hierarchy, prefixes (docs/adr/0018) ------------------------------

const PLAN = [
  '# The board of the tests',
  'name: t',
  'nextId: 30   # next plain id',
  'prefixes:   # who takes which letters',
  '  G: goal',
  '  # a note in the block',
  '  I: .groups/iteration',
  'counters: { G: 3 }',
  'groups: .groups',
  '',
  '# Card types, one colour each.',
  'types:',
  '  - name: goal',
  '    color: "#e3b341"',
  '    icon: star',
  '  - epic',
  '',
  '# The levels.',
  'hierarchy: [goal, epic]',
  'assignees:',
  '  - handle: "@alex"',
  '    name: "Alex"',
  '',
].join('\n');

const block = (base, name, value, version) => req(base, 'POST', '/api/config', { block: name, value, version });
const card = (dir, file, type) => fs.writeFileSync(path.join(dir, file), `---\nid: ${parseInt(file, 10)}\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n${type ? `type: ${type}\n` : ''}---\n\n# Card ${file}\n`);

test('reading answers types, hierarchy, typesOn, a version, the pages\' paths and how many cards carry each type word', async () => {
  const dir = tmpBoard({ config: PLAN });
  fs.mkdirSync(path.join(dir, 'archived', 'pkg'), { recursive: true });
  card(dir, '0001.a.card.md', 'goal');
  card(dir, '0002.b.card.md', 'goal');
  card(dir, '0003.c.card.md', 'story');
  card(dir, '0004.d.card.md', '');
  card(path.join(dir, 'archived'), '0005.e.card.md', 'story');
  card(path.join(dir, 'archived', 'pkg'), '0006.f.card.md', 'story');
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(settings.types, [{ name: 'goal', color: '#e3b341', icon: 'star' }, { name: 'epic', color: '' }]);
    assert.deepStrictEqual(settings.hierarchy, ['goal', 'epic']);
    assert.strictEqual(settings.typesOn, true);
    assert.deepStrictEqual(settings.typeUse, { goal: 2, story: 3 });
    assert.match(settings.version, /^[0-9a-f]{16,}$/);
    assert.strictEqual(settings.paths.config, path.resolve(dir, 'config.yaml'));
    assert.strictEqual(settings.paths.groups, path.resolve(dir, '.groups'));
    assert.strictEqual(settings.paths.logbook, null, 'a feature that is off has no folder to copy');
    assert.strictEqual(settings.paths.scratchpad, null);
  });
});

test('a folder is answered resolved whether or not it exists, and a folder set by hand outside the board as written', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-settings-outside-'));
  const dir = tmpBoard({ config: `name: t\nlogbook: notes\nscratchpad: ${outside.replace(/\\/g, '/')}\n` });
  await withServer(dir, async (base) => {
    const { paths } = (await req(base, 'GET', '/api/board')).json.settings;
    assert.strictEqual(paths.logbook, path.resolve(dir, 'notes'));
    assert.strictEqual(paths.scratchpad, path.resolve(outside));
    assert.ok(!fs.existsSync(paths.logbook));
  });
});

test('the version changes with the file and not with the id counters the board keeps itself', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const v1 = (await req(base, 'GET', '/api/board')).json.settings.version;
    fs.writeFileSync(path.join(dir, 'config.yaml'), PLAN.replace('nextId: 30', 'nextId: 31').replace('{ G: 3 }', '{ G: 4 }'));
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.settings.version, v1, 'a new card moves nextId and counters');
    fs.writeFileSync(path.join(dir, 'config.yaml'), PLAN.replace('  - epic', '  - story'));
    assert.notStrictEqual((await req(base, 'GET', '/api/board')).json.settings.version, v1);
  });
});

test('a types save rewrites the block clean, drops its comments, and every byte outside it stays', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const r = await block(base, 'types', [
      { name: 'goal', color: '#e3b341', icon: 'star' },
      { name: 'task', icon: 'triangle' },
      { name: 'epic', color: '#58a6ff' },
      { name: 'bug' },
      'chore',
    ]);
    assert.strictEqual(r.status, 200);
    const after = [
      '  - name: goal', '    color: "#e3b341"', '    icon: star',
      '  - name: task', '    icon: triangle',
      '  - name: epic', '    color: "#58a6ff"',
      '  - bug', '  - chore',
    ].join('\n');
    assert.strictEqual(config(dir), PLAN.replace(/  - name: goal[\s\S]*?  - epic\n/, `${after}\n`));
    assert.deepStrictEqual(r.json.settings.types.map((t) => t.name), ['goal', 'task', 'epic', 'bug', 'chore']);
    assert.deepStrictEqual(r.json.settings.types[1], { name: 'task', color: '', icon: 'triangle' });
  });
});

test('a comment inside a rewritten block is gone, and the comment above the next key stays', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    await block(base, 'prefixes', { G: 'goal' });
    assert.ok(!config(dir).includes('a note in the block'));
    assert.ok(!config(dir).includes('who takes which letters'));
    await block(base, 'types', ['goal']);
    assert.ok(config(dir).includes('# The levels.\nhierarchy:'));
    assert.ok(config(dir).includes('# Card types, one colour each.\ntypes:'));
  });
});

test('a block save in a CRLF file keeps every line ending', async () => {
  const crlf = PLAN.replace(/\n/g, '\r\n');
  const dir = tmpBoard({ config: crlf });
  await withServer(dir, async (base) => {
    assert.strictEqual((await block(base, 'types', ['goal'])).status, 200);
    assert.strictEqual(config(dir), crlf.replace(/types:\r\n[\s\S]*?  - epic\r\n/, 'types:\r\n  - goal\r\n'));
    assert.ok(!/[^\r]\n/.test(config(dir)), 'no bare LF crept in');
  });
});

test('an absent block is inserted in the config order', async () => {
  const dir = tmpBoard({ config: 'name: t\nnextId: 5\nassignees:\n  - handle: "@a"\n' });
  await withServer(dir, async (base) => {
    assert.strictEqual((await block(base, 'types', ['goal', 'epic'])).status, 200);
    assert.strictEqual((await block(base, 'hierarchy', ['goal', 'epic'])).status, 200);
    assert.strictEqual((await block(base, 'prefixes', { G: 'goal', I: '.groups/iteration' })).status, 200);
    assert.strictEqual(config(dir), 'name: t\nnextId: 5\nprefixes:\n  G: goal\n  I: .groups/iteration\nassignees:\n  - handle: "@a"\ntypes:\n  - goal\n  - epic\nhierarchy: [goal, epic]\n');
  });
});

test('an empty or absent hierarchy removes the line; so do an empty types and prefixes', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    assert.strictEqual((await block(base, 'hierarchy', [])).status, 200);
    assert.strictEqual(config(dir), PLAN.replace('hierarchy: [goal, epic]\n', ''));
    assert.strictEqual((await block(base, 'hierarchy', undefined)).status, 200, 'absent removes nothing more');
    assert.strictEqual((await block(base, 'prefixes', {})).status, 200);
    assert.ok(!/^prefixes:/m.test(config(dir)));
    assert.strictEqual((await block(base, 'types', null)).status, 200);
    assert.ok(!/^types:/m.test(config(dir)));
    assert.ok(config(dir).includes('counters: { G: 3 }'));
  });
});

test('the hierarchy is written in the starter\'s inline layout, and as a block when a name will not sit in a flow list', async () => {
  const dir = tmpBoard({ config: 'name: t\n' });
  await withServer(dir, async (base) => {
    await block(base, 'hierarchy', ['goal', 'epic']);
    assert.match(config(dir), /^hierarchy: \[goal, epic\]$/m);
    await block(base, 'hierarchy', ['goal', 'a, b', 'x: y']);
    assert.match(config(dir), /^hierarchy:\n {2}- goal\n {2}- a, b\n {2}- "x: y"\n/m);
    assert.deepStrictEqual(parseConfig(config(dir)).hierarchy, ['goal', 'a, b', 'x: y']);
  });
});

test('a type name that would not read back bare is quoted, and every name reads back as typed', async () => {
  const dir = tmpBoard({ config: 'name: t\n' });
  const names = ['plain', 'a: b', '#hash', 'x #y', '[br]', 'say "hi"', "it's", 'back\\slash', 'ünï', 'two words'];
  await withServer(dir, async (base) => {
    assert.strictEqual((await block(base, 'types', names)).status, 200);
    assert.deepStrictEqual(parseConfig(config(dir)).types.map((t) => t.name), names);
    assert.match(config(dir), /^ {2}- plain$/m);
    assert.match(config(dir), /^ {2}- "a: b"$/m);
  });
});

test('a prefixes save writes the block clean and reads back; the target that is a folder stays a folder', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const r = await block(base, 'prefixes', [{ prefix: 'G', target: 'goal' }, { prefix: 'E', target: 'epic' }, { prefix: '_', target: '.groups' }, { prefix: 'W', target: 'workflow/' }]);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(config(dir), PLAN.replace(/prefixes:   # who takes[\s\S]*?  I: \.groups\/iteration\n/, 'prefixes:\n  G: goal\n  E: epic\n  _: .groups\n  W: workflow/\n'));
    assert.deepStrictEqual(r.json.settings.prefixes.map((p) => [p.prefix, p.kind]), [['G', 'type'], ['E', 'type'], ['_', 'folder'], ['W', 'folder']]);
  });
});

test('renaming a type rewrites types and nothing else: hierarchy, prefixes and cards keep the old word', async () => {
  const dir = tmpBoard({ config: PLAN });
  card(dir, '0001.a.card.md', 'goal');
  const cardBefore = fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8');
  await withServer(dir, async (base) => {
    const r = await block(base, 'types', [{ name: 'objective', color: '#e3b341', icon: 'star' }, 'epic']);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(config(dir), PLAN.replace(/  - name: goal[\s\S]*?  - epic\n/, '  - name: objective\n    color: "#e3b341"\n    icon: star\n  - epic\n'));
    assert.ok(config(dir).includes('hierarchy: [goal, epic]'));
    assert.ok(config(dir).includes('  G: goal'));
    assert.deepStrictEqual(r.json.settings.hierarchy, ['goal', 'epic']);
    assert.deepStrictEqual(r.json.settings.typeUse, { goal: 1 }, 'the page can say 1 card still says goal');
    assert.strictEqual(fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8'), cardBefore);
  });
});

test('a block save refuses what the page could get wrong, with a message, and writes nothing', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const bad = [
      ['types', 'goal', /list/i],
      ['types', [{ name: '' }], /name/i],
      ['types', ['  ']], ['types', [{ color: '#fff' }]], ['types', [7]],
      ['types', [{ name: 'a\nb' }]],
      ['types', [{ name: 'a', color: 'red\nicon: x' }], /color/i],
      ['types', [{ name: 'a', color: 7 }], /color/i],
      ['types', [{ name: 'a', icon: 'x\ny' }], /icon/i],
      ['types', [{ name: 'a', icon: 7 }], /icon/i],
      ['hierarchy', 'goal'], ['hierarchy', ['goal', '']], ['hierarchy', [3]], ['hierarchy', ['a\nb']],
      ['prefixes', ['G']], ['prefixes', { g: 'goal' }, /prefix/i], ['prefixes', { G1: 'goal' }], ['prefixes', { '': 'goal' }],
      ['prefixes', { G: '' }, /G/], ['prefixes', { G: 5 }], ['prefixes', { G: 'a\nb' }], ['prefixes', { G: '../x/' }],
      ['prefixes', [{ prefix: 'G', target: 'a' }, { prefix: 'G', target: 'b' }], /G/],
      ['nope', ['x']], [undefined, ['x']], [7, ['x']], ['name', ['x']],
    ];
    for (const [name, value, message] of bad) {
      const r = await block(base, name, value);
      assert.strictEqual(r.status, 400, `refuses ${name} ${JSON.stringify(value)}`);
      assert.ok(r.json.error);
      if (message) assert.match(r.json.error, message);
    }
    assert.strictEqual(config(dir), PLAN);
  });
});

test('a color and an icon from the file pass through as written: a color name, a hex, an icon this build does not draw (docs/adr/0004)', async () => {
  const dir = tmpBoard({ config: 'name: t\ntypes:\n  - name: bug\n    color: red\n    icon: hexagram\n  - name: ok\n    color: "#e3b341"\n' });
  card(dir, '0001.a.card.md', 'spike');
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    const r = await block(base, 'types', [...settings.types, { name: 'spike' }], settings.version);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(parseConfig(config(dir)).types, [{ name: 'bug', color: 'red', icon: 'hexagram' }, { name: 'ok', color: '#e3b341' }, { name: 'spike', color: '' }]);
    for (const color of ['#fff', '#E3B341', '#e3b34180', 'rebeccapurple', 'rgb(1, 2, 3)', '#12', 'a: b']) {
      assert.strictEqual((await block(base, 'types', [{ name: 'a', color }])).status, 200, color);
      assert.strictEqual(parseConfig(config(dir)).types[0].color, color);
    }
    for (const icon of ['hexagram', 'x y', 'a: b', '#c']) {
      assert.strictEqual((await block(base, 'types', [{ name: 'a', icon }])).status, 200, icon);
      assert.strictEqual(parseConfig(config(dir)).types[0].icon, icon);
    }
    assert.strictEqual((await block(base, 'types', [{ name: 'a', color: '' }])).status, 200, 'no color is allowed');
    assert.strictEqual((await block(base, 'types', [{ name: 'a', color: null, icon: '' }])).status, 200, 'and so is no icon');
    assert.match(config(dir), /^ {2}- a$/m);
  });
});

test('names that differ only in capitals are kept as written in types and in the hierarchy', async () => {
  const dir = tmpBoard({ config: 'name: t\ntypes:\n  - Bug\n  - bug\nhierarchy: [Bug, bug, Epic]\n' });
  await withServer(dir, async (base) => {
    const { settings } = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(settings.hierarchy, ['Bug', 'bug', 'Epic']);
    const moved = await block(base, 'hierarchy', ['bug', 'Bug', 'Epic'], settings.version);
    assert.strictEqual(moved.status, 200);
    assert.match(config(dir), /^hierarchy: \[bug, Bug, Epic\]$/m);
    const types = await block(base, 'types', [{ name: 'Bug', color: 'red' }, 'bug', 'BUG']);
    assert.strictEqual(types.status, 200);
    assert.deepStrictEqual(parseConfig(config(dir)).types.map((t) => t.name), ['Bug', 'bug', 'BUG']);
  });
});

// --- types off, the version, the conflict ----------------------------------------------------

test('typesOn off writes the line below the feature lines, on removes it, and nothing else moves', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const off = await set(base, 'typesOn', false);
    assert.strictEqual(off.status, 200);
    assert.strictEqual(off.json.settings.typesOn, false);
    assert.strictEqual(config(dir), PLAN.replace('groups: .groups\n', 'groups: .groups\ntypesOn: false\n'));
    assert.deepStrictEqual(off.json.settings.types.map((t) => t.name), ['goal', 'epic'], 'the lists stay as written');
    const on = await set(base, 'typesOn', true);
    assert.strictEqual(on.status, 200);
    assert.strictEqual(on.json.settings.typesOn, true);
    assert.strictEqual(config(dir), PLAN);
    assert.strictEqual((await set(base, 'typesOn', 'no')).status, 400);
    assert.strictEqual((await set(base, 'typesOn', null)).status, 400);
    assert.strictEqual(config(dir), PLAN);
  });
});

test('a save that carries a stale version is refused with 409 and writes nothing; a current one, or none, goes through', async () => {
  const dir = tmpBoard({ config: PLAN });
  await withServer(dir, async (base) => {
    const v1 = (await req(base, 'GET', '/api/board')).json.settings.version;
    fs.writeFileSync(path.join(dir, 'config.yaml'), `${PLAN}# edited by hand\n`);
    const edited = config(dir);
    const stale = await block(base, 'types', ['goal'], v1);
    assert.strictEqual(stale.status, 409);
    assert.match(stale.json.error, /changed on disk/);
    const staleLine = await req(base, 'POST', '/api/config', { key: 'typesOn', value: false, version: v1 });
    assert.strictEqual(staleLine.status, 409);
    for (const body of [{ key: 'idDigits', value: 6 }, { key: 'logbook', value: 'notes' }, { key: 'groups', value: null }, { key: 'iterations', value: false }]) {
      const refused = await req(base, 'POST', '/api/config', { ...body, version: v1 });
      assert.strictEqual(refused.status, 409, body.key);
      assert.match(refused.json.error, /changed on disk/);
    }
    assert.strictEqual(config(dir), edited);
    const v2 = (await req(base, 'GET', '/api/board')).json.settings.version;
    const ok = await block(base, 'types', ['goal'], v2);
    assert.strictEqual(ok.status, 200);
    assert.notStrictEqual(ok.json.settings.version, v2, 'the answer carries the new version');
    assert.strictEqual((await block(base, 'types', ['epic'], ok.json.settings.version)).status, 200, 'the answer\'s version is the next save\'s');
    assert.strictEqual((await set(base, 'idDigits', 5)).status, 200, 'a caller with no version keeps working');
  });
});

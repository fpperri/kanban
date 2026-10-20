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

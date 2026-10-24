const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

function tmpBoard({ config = 'name: t\nlogbook: logbook\n' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-logbook-srv-'));
  fs.writeFileSync(path.join(dir, '0007.seven.card.md'), '---\nid: 7\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Seven\n');
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

const names = (dir) => (fs.existsSync(path.join(dir, 'logbook')) ? fs.readdirSync(path.join(dir, 'logbook')).sort() : []);

test('with no logbook: line the board payload carries no logbook and a note write is refused', async () => {
  const dir = tmpBoard({ config: 'name: t\n' });
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/board')).json.logbook, null);
    const r = await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', note: 'x' });
    assert.strictEqual(r.status, 404);
    assert.match(r.json.error, /logbook/);
  });
  assert.deepStrictEqual(names(dir), []);
});

test('a note posted for a card lands in that card\'s day file and comes back in the board payload', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.deepStrictEqual((await req(base, 'GET', '/api/board')).json.logbook, { folder: 'logbook', notes: [] });
    const r = await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:10', note: 'two enum renames left' });
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual(r.json.note, { day: '2026-10-16', target: '7', index: 0, at: '09:10', by: '@human', note: 'two enum renames left', file: '2026.10.16.0007.logbook.md' });
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(board.logbook.notes, [r.json.note]);
  });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'logbook', '2026.10.16.0007.logbook.md'), 'utf8'), '---\nentries:\n  - at: "09:10"\n    by: "@human"\n    note: two enum renames left\n---\n');
});

test('a note with no card goes to the day file with no id, untimed when no time is sent', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/notes', { day: '2026-10-16', note: 'standup' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.note.target, '');
    assert.strictEqual(r.json.note.at, null);
  });
  assert.deepStrictEqual(names(dir), ['2026.10.16.logbook.md']);
});

test('a bad day, id, time or note is a 400 and writes nothing', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const body of [
      { day: '16/10/2026', target: '7', note: 'x' },
      { day: '2026-10-16', target: '../7', note: 'x' },
      { day: '2026-10-16', target: '7', at: '25:00', note: 'x' },
      { day: '2026-10-16', target: '7', note: '  ' },
      { day: '2026-10-16', target: '7', note: 'x', by: 7 },
    ]) {
      const r = await req(base, 'POST', '/api/notes', body);
      assert.strictEqual(r.status, 400, JSON.stringify(body));
      assert.ok(r.json.error);
    }
  });
  assert.deepStrictEqual(names(dir), []);
});

test('an author is kept as written: any text, one line, trimmed, and quoted when the YAML needs it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const by of ['me', 'Dana (build bot)', '  @afk  ', 'a: b # c', 'say "hi"', 'two\nlines']) {
      const r = await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:10', note: `by ${by}`, by });
      assert.strictEqual(r.status, 201, by);
    }
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(board.logbook.notes.map((n) => n.by), ['me', 'Dana (build bot)', '@afk', 'a: b # c', 'say "hi"', 'two lines']);
    const blank = await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:11', note: 'blank', by: '   ' });
    assert.strictEqual(blank.json.note.by, '@human', 'a blank author is the human, as an absent one is');
  });
});

test('two notes written one after the other to the same day file both land', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await Promise.all([
      req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:10', note: 'one' }),
      req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:20', note: 'two' }),
    ]);
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(board.logbook.notes.map((n) => n.note), ['one', 'two']);
  });
});

test('a note an agent wrote to the file is in the payload with its author, and a web write beside it keeps it', async () => {
  const dir = tmpBoard();
  fs.mkdirSync(path.join(dir, 'logbook'));
  fs.writeFileSync(path.join(dir, 'logbook', '2026.10.16.0007.logbook.md'), '---\nentries:\n  - at: "08:00"\n    by: "@afk"\n    note: agent line\n    ref: build-12\n---\nfree text\n');
  await withServer(dir, async (base) => {
    await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:10', note: 'web line' });
    const board = (await req(base, 'GET', '/api/board')).json;
    assert.deepStrictEqual(board.logbook.notes.map((n) => [n.at, n.by, n.note]), [['08:00', '@afk', 'agent line'], ['09:10', '@human', 'web line']]);
  });
  const text = fs.readFileSync(path.join(dir, 'logbook', '2026.10.16.0007.logbook.md'), 'utf8');
  assert.ok(text.includes('    ref: build-12\n'));
  assert.ok(text.endsWith('---\nfree text\n'));
});

test('edit, delete and assign work from the refs the payload gave', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '09:10', note: 'a' });
    await req(base, 'POST', '/api/notes', { day: '2026-10-16', target: '7', at: '10:00', note: 'b' });
    let notes = (await req(base, 'GET', '/api/board')).json.logbook.notes;
    const refOf = (n) => ({ day: n.day, target: n.target, index: n.index, file: n.file, expect: { at: n.at, by: n.by, note: n.note } });

    const edited = await req(base, 'PATCH', '/api/notes', { ref: refOf(notes[0]), at: '11:30', note: 'a, changed' });
    assert.strictEqual(edited.status, 200);
    assert.strictEqual(edited.json.note.at, '11:30');
    notes = (await req(base, 'GET', '/api/board')).json.logbook.notes;
    assert.deepStrictEqual(notes.map((n) => [n.at, n.note]), [['10:00', 'b'], ['11:30', 'a, changed']]);

    const moved = await req(base, 'POST', '/api/notes/assign', { ref: refOf(notes[0]), to: '' });
    assert.strictEqual(moved.status, 200);
    assert.strictEqual(moved.json.note.target, '');
    notes = (await req(base, 'GET', '/api/board')).json.logbook.notes;
    assert.deepStrictEqual(notes.map((n) => [n.target, n.note]).sort(), [['', 'b'], ['7', 'a, changed']]);

    const gone = notes.find((n) => n.target === '7');
    assert.strictEqual((await req(base, 'DELETE', '/api/notes', { ref: refOf(gone) })).status, 200);
    assert.strictEqual((await req(base, 'DELETE', '/api/notes', { ref: refOf(gone) })).status, 409);
    notes = (await req(base, 'GET', '/api/board')).json.logbook.notes;
    assert.deepStrictEqual(notes.map((n) => n.note), ['b']);
  });
  assert.deepStrictEqual(names(dir), ['2026.10.16.logbook.md']);
});

test('a ref that names a path is refused, not followed', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const ref of [{ day: '../../x', target: '', index: 0 }, { day: '2026-10-16', target: '../7', index: 0 }]) {
      assert.strictEqual((await req(base, 'DELETE', '/api/notes', { ref })).status, 400);
    }
    assert.strictEqual((await req(base, 'DELETE', '/api/notes', {})).status, 400);
  });
});

test('the note routes answer a write only: a GET on them is not a route', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/notes`);
    assert.strictEqual(res.status, 404);
  });
});

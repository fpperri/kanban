const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/server');

function cardFile(id, extra) {
  return `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra || ''}---\n\n# Card ${id}\n`;
}

// Parent 1 with children 2..5 ranked as given, an unrelated root 6, and a second
// parent 7 whose children 8 and 9 sit at ranks 10 and 11.
function tmpBoard(ranks, options) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-reorder-'));
  const put = (id, extra, sub) => {
    const folder = sub ? path.join(dir, sub) : dir;
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${String(id).padStart(4, '0')}.card-${id}.card.md`), cardFile(id, extra));
  };
  put(1, '');
  ranks.forEach((r, i) => {
    const id = i + 2;
    const archived = options && options.archived && options.archived.includes(id);
    put(id, `parent: 1\n${r === null ? '' : `rank: ${r}\n`}`, archived ? 'archived' : null);
  });
  put(6, 'rank: 10\n');
  put(7, '');
  put(8, 'parent: 7\nrank: 10\n');
  put(9, 'parent: 7\nrank: 11\n');
  return dir;
}

function snapshotFiles(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.card.md')) out.set(path.relative(dir, full), fs.readFileSync(full, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

function changedFiles(before, after) {
  return [...after.keys()].filter((f) => before.get(f) !== after.get(f)).map((f) => path.basename(f).slice(0, 4)).sort();
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

async function req(base, method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const rankOf = (dir, id) => {
  const f = [...snapshotFiles(dir).entries()].find(([name]) => path.basename(name).startsWith(String(id).padStart(4, '0')));
  const m = /^rank:\s*(.+)$/m.exec(f[1]);
  return m ? m[1].trim() : null;
};

test('dropping between ranks 10 and 20 writes rank 15 to that card and touches no other file', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  const before = snapshotFiles(dir);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/5/reorder', { prev: 2, next: 3 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.card.id, 5);
    assert.strictEqual(res.json.card.rank, 15);
    assert.deepStrictEqual(res.json.renumbered, []);
  });
  const after = snapshotFiles(dir);
  assert.deepStrictEqual(changedFiles(before, after), ['0005']);
  assert.strictEqual(rankOf(dir, 5), '15');
  assert.match(after.get('0005.card-5.card.md'), /^updated: /m, 'a write bumps the card');
});

test('dropping between ranks 10 and 11 renumbers that parent\'s children in tens and no other card', async () => {
  const dir = tmpBoard([10, 11, 12, 13]);
  const before = snapshotFiles(dir);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/5/reorder', { prev: 2, next: 3 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.card.rank, 20);
    assert.deepStrictEqual(res.json.renumbered.map((c) => [c.id, c.rank]), [[3, 30], [4, 40]]);
  });
  const after = snapshotFiles(dir);
  assert.deepStrictEqual(changedFiles(before, after), ['0003', '0004', '0005']);
  assert.deepStrictEqual([2, 5, 3, 4].map((id) => rankOf(dir, id)), ['10', '20', '30', '40']);
  for (const untouched of ['0001.card-1.card.md', '0002.card-2.card.md', '0006.card-6.card.md', '0007.card-7.card.md', '0008.card-8.card.md', '0009.card-9.card.md']) {
    assert.strictEqual(after.get(untouched), before.get(untouched), `${untouched} is byte-identical`);
  }
});

test('an archived sibling is renumbered in its own file when the gap is full', async () => {
  const dir = tmpBoard([10, 11, 90], { archived: [3] });
  const before = snapshotFiles(dir);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/4/reorder', { prev: 2, next: 3 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.json.renumbered.map((c) => [c.id, c.rank, c.archived]), [[3, 30, true]]);
  });
  const after = snapshotFiles(dir);
  assert.deepStrictEqual(changedFiles(before, after), ['0003', '0004']);
  assert.ok(after.has(path.join('archived', '0003.card-3.card.md')), 'the archived card stays archived');
  assert.strictEqual(rankOf(dir, 3), '30');
});

test('dropping where the card already stands writes no file at all', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  const before = snapshotFiles(dir);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/3/reorder', { prev: 2, next: 4 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.card.id, 3);
    assert.strictEqual(res.json.card.rank, 20);
    assert.deepStrictEqual(res.json.renumbered, []);
  });
  assert.deepStrictEqual(changedFiles(before, snapshotFiles(dir)), []);
});

test('the board lists the new order after a drop', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  await withServer(dir, async (base) => {
    await req(base, 'POST', '/api/cards/5/reorder', { prev: null, next: 2 });
    const board = await req(base, 'GET', '/api/board');
    const ranks = board.json.active.filter((c) => c.parent === 1).sort((a, b) => a.rank - b.rank).map((c) => c.id);
    assert.deepStrictEqual(ranks, [5, 2, 3, 4]);
  });
});

test('a card that is renumbered keeps its other lines, and one that is not renumbered is not rewritten', async () => {
  const dir = tmpBoard([10, 11, 12, 13]);
  const keep = path.join(dir, '0002.card-2.card.md');
  const edited = path.join(dir, '0003.card-3.card.md');
  fs.writeFileSync(keep, cardFile(2, 'parent: 1\nrank:   10\ncolor: teal\n'));
  fs.writeFileSync(edited, cardFile(3, 'parent: 1\nrank: 11\ncolor: teal\n'));
  const keptBefore = fs.readFileSync(keep, 'utf8');
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/5/reorder', { prev: 2, next: 3 });
    assert.strictEqual(res.status, 200);
  });
  assert.strictEqual(fs.readFileSync(keep, 'utf8'), keptBefore, 'rank 10 stays 10, so the file is not rewritten');
  const rewritten = fs.readFileSync(edited, 'utf8');
  assert.match(rewritten, /^rank: 30$/m);
  assert.match(rewritten, /^color: teal$/m);
});

test('a card that does not exist answers 404', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/99/reorder', { prev: 2, next: 3 });
    assert.strictEqual(res.status, 404);
  });
});

test('a neighbour that does not exist, is not a sibling, or is not an id answers 400 and writes nothing', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  const before = snapshotFiles(dir);
  await withServer(dir, async (base) => {
    for (const body of [
      { prev: 99, next: 3 },
      { prev: 8, next: 9 },
      { prev: 9, next: 8 },
      { prev: 9, next: null },
      { prev: 3, next: 2 },
      { prev: 5, next: 2 },
      { prev: 'two', next: 3 },
      { prev: 2.5, next: 3 },
      { prev: -1, next: 3 },
      { prev: [2], next: 3 },
    ]) {
      const res = await req(base, 'POST', '/api/cards/4/reorder', body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
      assert.ok(res.json.error, JSON.stringify(body));
    }
  });
  assert.deepStrictEqual(changedFiles(before, snapshotFiles(dir)), []);
});

test('a neighbour sent as a digit string reads as that id, and an absent one reads as none', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  await withServer(dir, async (base) => {
    const res = await req(base, 'POST', '/api/cards/5/reorder', { prev: '4' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.card.rank, 40, 'already last, so it keeps its rank');
    const first = await req(base, 'POST', '/api/cards/5/reorder', { next: 2 });
    assert.strictEqual(first.json.card.rank, 0);
  });
});

test('only POST reorders', async () => {
  const dir = tmpBoard([10, 20, 30, 40]);
  await withServer(dir, async (base) => {
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/api/cards/5/reorder`, { method });
      assert.notStrictEqual(res.status, 200, method);
    }
  });
});

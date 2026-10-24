const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../../plugin/skills/web/scripts/server');

const CONFIG = `nextId: 40
assignees:
  - handle: "@alex"
    name: "Alex"
    kind: human
    description: "The human."
  - handle: "@claude-afk"
    name: "Claude (AFK)"
    kind: ai-afk
    description: "Unattended agents."
`;

function tmpBoard({ withConfig = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-cfg-srv-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n\nbody\n`);
  if (withConfig) fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

test('GET /api/board carries assignees from config.yaml', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.strictEqual(data.assignees.length, 2);
    assert.strictEqual(data.assignees[0].handle, '@alex');
    assert.strictEqual(data.assignees[1].kind, 'ai-afk');
  });
});

test('GET /api/board returns assignees: [] when config.yaml is absent', async () => {
  const dir = tmpBoard({ withConfig: false });
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.assignees, []);
  });
});

test('POST /api/cards uses the config.yaml id counter and advances it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/cards`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Counter test' }),
    });
    assert.strictEqual(res.status, 201);
    const card = await res.json();
    assert.strictEqual(card.id, '40'); // counter (40) beats scanMax+1 (2)
    assert.match(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), /nextId: 41/);
    assert.match(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), /@alex/); // assignees preserved
  });
});

test('POST /api/cards without config.yaml keeps scan behavior and creates no config file', async () => {
  const dir = tmpBoard({ withConfig: false });
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/cards`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Scan test' }),
    });
    assert.strictEqual((await res.json()).id, '2');
    assert.ok(!fs.existsSync(path.join(dir, 'config.yaml')));
  });
});

test('the SPA html carries the context menu and new modules in order — and no <datalist> (misrenders in VSCode Simple Browser)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /<datalist/);
    assert.doesNotMatch(html, /list="/);
    assert.match(html, /id="context-menu"/);
    for (const mod of ['/form-guard.js', '/selection.js', '/combobox.js', '/priority-badge.js', '/bulk-edit.js']) {
      const res = await fetch(`${base}${mod}`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/javascript/);
      assert.ok(html.indexOf(mod.slice(1)) > -1 && html.indexOf(mod.slice(1)) < html.indexOf('app.js'), `${mod} loads before app.js`);
    }
  });
});

// --- /api/board carries the official priorities/tags lists ---

test('GET /api/board carries priorities and tags lists from config.yaml', async () => {
  const dir = tmpBoard({ withConfig: false });
  fs.writeFileSync(path.join(dir, 'config.yaml'),
    'nextId: 40\npriorities: [High, Normal, Low]\ntags:\n  - skills\n  - config\n');
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.priorities, ['High', 'Normal', 'Low']);
    assert.deepStrictEqual(data.tags, ['skills', 'config']);
  });
});

test('GET /api/board returns empty priorities/tags when config.yaml is absent', async () => {
  const dir = tmpBoard({ withConfig: false });
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.priorities, []);
    assert.deepStrictEqual(data.tags, []);
  });
});

// --- /api/board carries the official statuses list ---

test('GET /api/board carries the statuses list from config.yaml', async () => {
  const dir = tmpBoard({ withConfig: false });
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'statuses: [triage, doing, review, done]\n');
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.statuses, ['triage', 'doing', 'review', 'done']);
  });
});

test('GET /api/board returns statuses: [] when config.yaml is absent (built-in four apply client-side)', async () => {
  const dir = tmpBoard({ withConfig: false });
  await withServer(dir, async (base) => {
    const data = await (await fetch(`${base}/api/board`)).json();
    assert.deepStrictEqual(data.statuses, []);
  });
});

// --- no-store everywhere — a stale cached SPA mixing old
// markup with new scripts broke the form's datalists; localhost + tiny files
// means caching buys nothing and costs correctness.

test('static and API responses carry Cache-Control: no-store', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const p of ['/', '/app.js', '/priority-badge.js', '/api/board']) {
      const res = await fetch(`${base}${p}`);
      assert.strictEqual(res.headers.get('cache-control'), 'no-store', `missing on ${p}`);
    }
  });
});

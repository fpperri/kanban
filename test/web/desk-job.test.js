const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deskJob } = require('../../plugin/skills/web/scripts/desk-job');
const { applyTray, APPLIED_FILE } = require('../../plugin/skills/web/scripts/apply-tray');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { makePageSource, makeTrayStore } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');

// Settings and notifications are a desk job. The page and the apply both refuse them, and both read a path
// the way the route does (a URL against a dummy base), so an alias the route reaches the config by is refused too.

const ALIASES = ['/api/config', '/api/./config', '/api/x/../config', '/api/config#x', '/api/con\tfig', '/api/con\nfig', '/api' + String.fromCharCode(92) + 'config', '/api/config/', '/api/config?a=1', '/api/notifications/mark-read', '/api/./notifications/mark-read', '/api/notifications/1'];
const KEYS = ['typesOn', 'idDigits', 'logbook', 'scratchpad', 'todos', 'groups', 'types', 'hierarchy', 'prefixes', 'private', 'artifact', 'name'];
const CONFIG = 'name: t\nnextId: 30\ntodos: .todos\n';
const card = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# C${id}\n\nbody\n`;

function makeBoard() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-job-')), '.kanban');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3));
  fs.writeFileSync(path.join(dir, '0012.twelve.card.md'), card(12));
  return dir;
}

let n = 0;
const rec = (method, p, body) => ({ id: `phone-${++n}`, at: '2026-10-31T09:00:00', device: 'phone', change: { method, path: p, body } });

test('deskJob names the reason for a settings or notifications path, under every alias, and for a path it cannot read', () => {
  for (const p of ALIASES) assert.match(deskJob({ method: 'POST', path: p, body: {} }), /desk job/, JSON.stringify(p));
  assert.match(deskJob({ method: 'POST', path: 'http://[', body: {} }), /cannot be read/);
  assert.strictEqual(deskJob({ method: 'PATCH', path: '/api/cards/3', body: {} }), null);
  assert.strictEqual(deskJob({ method: 'PUT', path: '/api/todos/3', body: {} }), null);
  assert.strictEqual(deskJob({ method: 'POST', path: '/api/configuration', body: {} }), null);
});

test('the apply refuses every settings key and every alias, keeps the records beside them, and writes no config', () => {
  const dir = makeBoard();
  const before = rec('PATCH', '/api/cards/3', { priority: 'High' });
  const records = [before];
  for (const key of KEYS) records.push(rec('POST', '/api/config', { key, value: key === 'name' ? 'x' : true }));
  for (const p of ALIASES) records.push(rec('POST', p, { key: 'logbook', value: true }));
  const after = rec('PATCH', '/api/cards/12', { priority: 'Low' });
  records.push(after);
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [before.id, after.id]);
  assert.strictEqual(report.refused.length, records.length - 2);
  for (const r of report.refused) assert.match(r.reason, /desk job/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), CONFIG);
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, APPLIED_FILE), 'utf8').trim().split('\n'), [before.id, after.id]);
});

test('the apply refuses a notifications record', () => {
  const dir = makeBoard();
  const report = applyTray({ dir, records: [rec('POST', '/api/notifications/mark-read', {}), rec('DELETE', '/api/notifications/1', {})] });
  assert.deepStrictEqual(report.applied, []);
  assert.strictEqual(report.refused.length, 2);
});

test('the page answers 403 for every alias and queues nothing', async () => {
  const files = { '/p/.kanban/config.yaml': CONFIG, '/p/.kanban/0003.three.card.md': card(3) };
  const { route } = makeMemoryRoute(routeSources(), { files, dir: '/p/.kanban' });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  const src = makePageSource({ route, tray: makeTrayStore(storage, 'k', 'dev'), board: { name: 'a', id: 'x', base: '2026-10-31T01:00:00.000Z' } });
  for (const p of ALIASES) {
    const res = await src.request('POST', p, { key: 'logbook', value: true });
    assert.strictEqual(res.status, 403, JSON.stringify(p));
    assert.match(res.json.error, /desk job/);
  }
  assert.deepStrictEqual(src.records(), []);
});

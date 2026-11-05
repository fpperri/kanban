const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deskJob, canonical } = require('../../plugin/skills/web/scripts/desk-job');
const { applyTray, APPLIED_FILE } = require('../../plugin/skills/web/scripts/apply-tray');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { makePageSource, makeTrayStore } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');
const { makeRoute } = require('../../plugin/skills/web/scripts/route');
const cs = require('../../plugin/skills/web/scripts/card-store');

// Settings and notifications are a desk job. The page and the apply both refuse them. The page records a path
// in canonical form (the route's own reading of it), and the apply takes only a path already in that form, so
// no spelling is read one way where it is checked and another where it is run.

const BS = String.fromCharCode(92);
const DESK_PATHS = ['/api/config', '/api/config/', '/api/config?a=1', '/api/notifications', '/api/notifications/mark-read', '/api/notifications/1'];
const ALIASES = [
  '/api/./config', '/api/x/../config', '/api/config#x', '/api/con\tfig', '/api/con\nfig', `/api${BS}config`,
  '/api/./notifications/mark-read', `x:/api/..${BS}/h/api/config`, `x:/api/%2e%2e${BS}/h/api/config`,
  `X-Y.z+1:/api/..${BS}/h/api/config`, `x:/api/..${BS}/h/api/notifications/mark-read`,
  'http://localhost/api/config', ' /api/config', './api/config', 'api/config',
];
const KEYS = ['typesOn', 'idDigits', 'logbook', 'scratchpad', 'todos', 'groups', 'types', 'hierarchy', 'prefixes', 'private', 'artifact', 'name'];
const CONFIG = 'name: t\nnextId: 30\ntodos: .todos\n';
const NOTIF = '- id: 1\n  at: 2026-11-01T10:00:00\n  level: info\n  message: "hello"\n  read: false\n';
const card = (id) => `---\nid: ${id}\nstatus: todo\npriority: Normal\ntags: []\n---\n\n# C${id}\n\nbody\n`;

function makeBoard() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-job-')), '.kanban');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yaml'), CONFIG);
  fs.writeFileSync(path.join(dir, 'notifications.md'), NOTIF);
  fs.writeFileSync(path.join(dir, '0003.three.card.md'), card(3));
  fs.writeFileSync(path.join(dir, '0012.twelve.card.md'), card(12));
  fs.writeFileSync(path.join(dir, 'G0007.g.card.md'), card('G7'));
  return dir;
}
const files = (dir) => Object.fromEntries(fs.readdirSync(dir).filter((f) => f !== APPLIED_FILE).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

let n = 0;
const rec = (method, p, body, extra = {}) => ({ id: `phone-${++n}`, at: '2026-10-31T09:00:00', device: 'phone', change: { method, path: p, body }, ...extra });

function openPage(boardFiles) {
  const { route } = makeMemoryRoute(routeSources(), { files: boardFiles, dir: '/p/.kanban' });
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  return makePageSource({ route, tray: makeTrayStore(storage, 'k', 'dev'), board: { name: 'a', id: 'x', base: '2026-10-31T01:00:00.000Z' } });
}

test('deskJob names the reason for a settings or notifications path, under every spelling, and for a path it cannot read', () => {
  for (const p of [...DESK_PATHS, ...ALIASES.slice(0, 11)]) assert.match(deskJob({ method: 'POST', path: p, body: {} }), /desk job|cannot be read/, JSON.stringify(p));
  assert.match(deskJob({ method: 'POST', path: 'http://[', body: {} }), /cannot be read/);
  assert.strictEqual(deskJob({ method: 'PATCH', path: '/api/cards/3', body: {} }), null);
  assert.strictEqual(deskJob({ method: 'PUT', path: '/api/todos/3', body: {} }), null);
  assert.strictEqual(deskJob({ method: 'POST', path: '/api/configuration', body: {} }), null);
});

test('canonical takes a path only when reading it as a URL changes nothing', () => {
  for (const p of ['/api/cards/3', '/api/cards/3?a=1', '/api/cards/caf%C3%A9%20x', '/api/scratchpad/x/file?path=a%20b%2Fc']) assert.strictEqual(canonical(p), p);
  for (const p of [...ALIASES, '/api/cards/ 3', '/other', null, 7]) assert.strictEqual(canonical(p), null, JSON.stringify(p));
});

test('the apply refuses every settings key, keeps the records beside them, and writes no config', () => {
  const dir = makeBoard();
  const before = rec('PATCH', '/api/cards/3', { priority: 'High' });
  const records = [before];
  for (const key of KEYS) records.push(rec('POST', '/api/config', { key, value: key === 'idDigits' ? 5 : '.x' }));
  const after = rec('PATCH', '/api/cards/12', { priority: 'Low' });
  records.push(after);
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [before.id, after.id]);
  assert.strictEqual(report.refused.length, KEYS.length);
  for (const r of report.refused) assert.match(r.reason, /desk job/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), CONFIG);
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, APPLIED_FILE), 'utf8').trim().split('\n'), [before.id, after.id]);
});

test('the apply refuses every spelling of a settings or notifications path and changes neither file', () => {
  const dir = makeBoard();
  const start = files(dir);
  const records = [];
  for (const p of ALIASES) for (const method of ['POST', 'DELETE', 'PUT']) records.push(rec(method, p, { key: 'logbook', value: '.moved' }));
  for (const tail of ['config', 'notifications', 'notifications/mark-read', 'notifications/1']) {
    for (const head of [`x:/api/..${BS}/h/api/`, `x:/api/%2e%2e${BS}/h/api/`, `X-Y.z+1:/api/..${BS}/h/api/`]) records.push(rec('POST', head + tail, { key: 'idDigits', value: 6 }));
  }
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.applied, []);
  assert.strictEqual(report.refused.length, records.length);
  assert.deepStrictEqual(files(dir), start);
});

test('the apply refuses an aliased card edit instead of rewriting it, so it cannot dodge the stale guard', () => {
  for (const p of ['/api/./cards/3', '/api/x/../cards/3', '/api/cards/3#x', '/api/cards/\t3', `x:/api/..${BS}/h/api/cards/3`]) {
    const dir = makeBoard();
    assert.strictEqual(makeRoute(dir)('PATCH', '/api/cards/3', { title: 'At the desk' }).status, 200);
    const stale = rec('PATCH', p, { title: 'Renamed' }, { before: { title: 'C3' } });
    const report = applyTray({ dir, records: [stale] });
    assert.deepStrictEqual(report.applied, [], JSON.stringify(p));
    assert.strictEqual(report.refused.length, 1);
    assert.strictEqual(cs.toJSON(cs.readCardFile(cs.findCardFile(dir, 3), false)).title, 'At the desk');
  }
});

test('a record for a route that does not exist is refused and the rest still apply', () => {
  const dir = makeBoard();
  const ok = rec('PATCH', '/api/cards/3', { priority: 'High' });
  const odd = [
    rec('POST', '/api//config', {}), rec('POST', '/api/%63onfig', {}), rec('POST', '/api/nope', {}), rec('PUT', '/api/cards', {}),
    rec('POST', '/api/cards', { title: 'x' }, { temp: { toString: 1 } }), rec('POST', '/api/cards', { title: 'x' }, { device: { toString: 1 } }),
    { id: 'm-1', change: { method: { toString: 1 }, path: '/api/cards', body: {} } },
  ];
  const report = applyTray({ dir, records: [...odd, ok] });
  assert.deepStrictEqual(report.applied.map((a) => a.id), [ok.id]);
  assert.strictEqual(report.refused.length, odd.length);
});

test('a prefixed id with leading zeros meets the stale guard like the plain one', () => {
  for (const seg of ['G7', 'G07', 'G0000007']) {
    const dir = makeBoard();
    assert.strictEqual(makeRoute(dir)('PATCH', '/api/cards/G7', { title: 'At the desk' }).status, 200);
    const report = applyTray({ dir, records: [rec('PATCH', `/api/cards/${seg}`, { title: 'Renamed' }, { before: { title: 'CG7' } })] });
    assert.deepStrictEqual(report.applied, [], seg);
    assert.match(report.refused[0].reason, /title changed at the desk since/, seg);
  }
});

test('a desk-job record whose id is already applied reports as skipped', () => {
  const dir = makeBoard();
  const r = rec('POST', '/api/config', { key: 'logbook', value: '.x' });
  fs.writeFileSync(path.join(dir, APPLIED_FILE), `${r.id}\n`);
  const report = applyTray({ dir, records: [r] });
  assert.deepStrictEqual(report.skipped, [r.id]);
  assert.deepStrictEqual(report.refused, []);
});

test('the page answers 403 for every spelling and queues nothing', async () => {
  const src = openPage({ '/p/.kanban/config.yaml': CONFIG, '/p/.kanban/0003.three.card.md': card(3) });
  for (const p of [...DESK_PATHS, ...ALIASES]) {
    const res = await src.request('POST', p, { key: 'logbook', value: '.logbook' });
    assert.strictEqual(res.status, 403, JSON.stringify(p));
  }
  assert.deepStrictEqual(src.records(), []);
});

test('a save in the page is recorded in canonical form, and a real tray with spaces and unicode applies whole', async () => {
  const dir = makeBoard();
  const boardFiles = {};
  for (const [name, text] of Object.entries(files(dir))) boardFiles[`/p/.kanban/${name}`] = text;
  const src = openPage(boardFiles);
  assert.strictEqual((await src.request('PATCH', '/api/./cards/3', { title: 'Caf\u00e9 one' })).status, 200);
  assert.strictEqual((await src.request('POST', '/api/cards', { title: 'Made \u00fcber x', status: 'todo' })).status, 201);
  assert.strictEqual((await src.request('PATCH', '/api/cards/12?note=caf\u00e9 x', { priority: 'High' })).status, 200);
  const records = src.records();
  for (const r of records) assert.strictEqual(canonical(r.change.path), r.change.path);
  assert.strictEqual(records[0].change.path, '/api/cards/3');
  const report = applyTray({ dir, records });
  assert.deepStrictEqual(report.refused, []);
  assert.strictEqual(report.applied.length, records.length);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, read, fenced } = require('./helpers/doc-text');
const { makeMemoryRoute } = require('../../plugin/skills/web/scripts/memory-route');
const { makePageSource, makeTrayStore } = require('../../plugin/skills/web/scripts/page-source');
const { routeSources } = require('./helpers/route-sources');

// What the artifact skill's SKILL.md tells a person or an agent to run or parse: the build command, with
// its script and flag, and the change payload it shows, taken from what the page copies.

const DOC = read('plugin', 'skills', 'artifact', 'SKILL.md');
const SKILL_DIR = path.join(ROOT, 'plugin', 'skills', 'artifact');

test('the build command in the skill runs: its script is where the doc puts it, and it writes the file --out names', () => {
  const [command] = fenced(DOC, 'bash').map((b) => b.trim()).filter((b) => b.startsWith('node '));
  const m = /^node <skill dir>\/(\.\.\/web\/scripts\/artifact-build\.js) <board dir> --out <file\.html>$/.exec(command);
  assert.ok(m, command);
  const script = path.join(SKILL_DIR, m[1]);
  assert.ok(fs.existsSync(script), script);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-doc-')), 'board.html');
  try {
    const ran = spawnSync(process.execPath, [script, path.join(ROOT, 'test', 'web', 'browser', 'fixture'), '--out', out], { encoding: 'utf8' });
    assert.strictEqual(ran.status, 0, ran.stderr);
    assert.ok(fs.statSync(out).size > 0);
  } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
});

test('the change payload the skill shows is the one the page copies: its header line and the keys of a change', async () => {
  const [shown] = fenced(DOC, '').filter((b) => b.startsWith('Apply kanban changes'));
  assert.ok(shown, 'the doc shows a payload');
  const files = { '/p/.kanban/config.yaml': 'name: n\nnextId: 5\n', '/p/.kanban/0001.one.card.md': '---\nid: 1\nstatus: todo\n---\n\n# One\n' };
  const { route } = makeMemoryRoute(routeSources(), { files, dir: '/p/.kanban' });
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); } };
  const src = makePageSource({ route, tray: makeTrayStore(storage, 'k', 'dev'), board: { name: 'n', id: 'x', base: '2026-10-31T00:00:00.000Z' } });
  await src.request('PATCH', '/api/cards/1', { status: 'doing' });
  const [realHead, ...realRest] = src.payload().split('\n');
  const [docHead, ...docRest] = shown.trim().split('\n');
  const shape = (head) => head.replace(/"[^"]*"/, '"<name>"').replace(/base \S+,/, 'base <ISO time>,').replace(/\d+ changes?\)/, '<N> changes)');
  assert.strictEqual(shape(realHead), docHead);
  const keysOf = (records) => records.map((r) => [Object.keys(r).sort(), Object.keys(r.change).sort()]);
  assert.deepStrictEqual(keysOf(JSON.parse(docRest.join('\n'))), keysOf(JSON.parse(realRest.join('\n'))));
});

test('the skill description names the header the page copies, so a payload from a file reaches the apply here and not the Snapshot protocol', () => {
  const description = /^description: (.*)$/m.exec(DOC)[1];
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v); } };
  const src = makePageSource({ route: () => null, tray: makeTrayStore(storage, 'k', 'dev'), board: { name: 'n', id: 'x', base: '2026-10-31T00:00:00.000Z' } });
  const header = 'Apply kanban changes (board "';
  assert.ok(src.payload().startsWith(header));
  assert.ok(description.includes(header), description);
});

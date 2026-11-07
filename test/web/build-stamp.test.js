const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const stamp = require('../../plugin/skills/web/scripts/build-stamp');

// A page records the plugin commit and the board commit it was built from; the check counts how far each
// has moved since, from local git alone. These tests run it over throwaway repositories.

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
};

function repo(files = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stamp-')));
  git(root, 'init', '-q', '-b', 'main');
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  if (Object.keys(files).length) commit(root, 'first');
  return root;
}
function put(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}
function commit(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', '--short', 'HEAD');
}

// A plugin repository and a board repository, as the cloud session has them.
function world() {
  const plug = repo({ 'plugin/skills/web/x.js': '1', 'README.md': 'r' });
  const brd = repo({ '.kanban/config.yaml': 'name: b\n', '.kanban/0001.a.card.md': 'a', 'src/app.txt': 'app' });
  return {
    plug, brd,
    pluginDir: path.join(plug, 'plugin'),
    boardDir: path.join(brd, '.kanban'),
    stampFile: path.join(brd, '.kanban', stamp.STAMP_FILE),
  };
}

const stampAndCommit = (w) => {
  stamp.record(w.boardDir, stamp.stampNow({ boardDir: w.boardDir, pluginDir: w.pluginDir }));
  commit(w.brd, 'board: stamp');
};

test('the stamp is the short id of the last commit that touched the plugin and the last that touched the board', () => {
  const w = world();
  const now = stamp.stampNow({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(now.plugin, git(w.plug, 'rev-parse', '--short', 'HEAD'));
  assert.strictEqual(now.board, git(w.brd, 'rev-parse', '--short', 'HEAD'));
  put(w.plug, 'README.md', 'changed');
  commit(w.plug, 'docs only');
  assert.strictEqual(stamp.stampNow({ boardDir: w.boardDir, pluginDir: w.pluginDir }).plugin, now.plugin, 'a commit outside plugin/ is not page code');
});

test('nothing moved: the page is current', () => {
  const w = world();
  stampAndCommit(w);
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(r.verdict, 'current');
  assert.strictEqual(r.plugin.behind, 0);
  assert.strictEqual(r.board.behind, 0, 'committing the stamp file is not a board change');
});

test('commits to the board folder count as the board moving, commits elsewhere in its repository do not', () => {
  const w = world();
  stampAndCommit(w);
  put(w.brd, 'src/app.txt', 'app2');
  commit(w.brd, 'app');
  assert.strictEqual(stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir }).verdict, 'current');
  put(w.brd, '.kanban/0001.a.card.md', 'a2');
  commit(w.brd, 'board: 1 done');
  put(w.brd, '.kanban/0002.b.card.md', 'b');
  commit(w.brd, 'board: 2 added');
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(r.verdict, 'board');
  assert.strictEqual(r.board.behind, 2);
  assert.strictEqual(r.plugin.behind, 0);
});

test('a board edit not yet committed counts as the board having moved', () => {
  const w = world();
  stampAndCommit(w);
  put(w.brd, '.kanban/0001.a.card.md', 'edited at the desk');
  assert.strictEqual(stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir }).verdict, 'board');
});

test('the plugin moved: the count and the merged PR titles since, from merge commit subjects and squashes', () => {
  const w = world();
  stampAndCommit(w);
  git(w.plug, 'checkout', '-q', '-b', 'feature');
  put(w.plug, 'plugin/skills/web/x.js', '2');
  commit(w.plug, 'feature work');
  put(w.plug, 'plugin/skills/web/y.js', '3');
  commit(w.plug, 'more feature work');
  git(w.plug, 'checkout', '-q', 'main');
  git(w.plug, 'merge', '--no-ff', '-q', 'feature', '-m', 'Merge pull request #7 from o/feature', '-m', 'Hover sides on the tray');
  put(w.plug, 'plugin/skills/web/z.js', '4');
  commit(w.plug, 'web: a squashed change (#8)');
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(r.verdict, 'plugin');
  assert.strictEqual(r.plugin.behind, 3);
  assert.deepStrictEqual(r.plugin.titles, ['web: a squashed change (#8)', '#7 Hover sides on the tray']);
});

test('a plugin move wins over a board move in the verdict, and both counts are given', () => {
  const w = world();
  stampAndCommit(w);
  put(w.plug, 'plugin/skills/web/x.js', '9');
  commit(w.plug, 'web: change');
  put(w.brd, '.kanban/0001.a.card.md', 'a3');
  commit(w.brd, 'board: change');
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(r.verdict, 'plugin');
  assert.deepStrictEqual([r.plugin.behind, r.board.behind], [1, 1]);
});

test('no stamp recorded, or one whose commit this checkout lacks: it cannot tell', () => {
  const w = world();
  assert.strictEqual(stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir }).verdict, 'unknown');
  stamp.record(w.boardDir, { plugin: 'deadbee', board: 'deadbee' });
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.strictEqual(r.verdict, 'unknown');
  assert.match(r.reason, /deadbee/);
});

test('a plugin or a board that is not a git checkout gives no ids and the check cannot tell', () => {
  const w = world();
  const loose = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-nogit-')));
  put(loose, 'plugin/x.js', '1');
  put(loose, 'board/config.yaml', 'name: b\n');
  const now = stamp.stampNow({ boardDir: path.join(loose, 'board'), pluginDir: path.join(loose, 'plugin') });
  assert.deepStrictEqual(now, { plugin: null, board: null });
  assert.strictEqual(stamp.check({ boardDir: path.join(loose, 'board'), pluginDir: w.pluginDir }).verdict, 'unknown');
  stampAndCommit(w);
  const r = stamp.check({ boardDir: w.boardDir, pluginDir: path.join(loose, 'plugin') });
  assert.strictEqual(r.verdict, 'unknown');
  assert.match(r.reason, /plugin/);
});

test('a stamp taken from a tree with uncommitted changes ends in "+" and never reads as current', () => {
  const w = world();
  put(w.plug, 'plugin/skills/web/x.js', 'dirty');
  const now = stamp.stampNow({ boardDir: w.boardDir, pluginDir: w.pluginDir });
  assert.match(now.plugin, /^[0-9a-f]+\+$/);
  stamp.record(w.boardDir, now);
  commit(w.brd, 'board: stamp');
  assert.strictEqual(stamp.check({ boardDir: w.boardDir, pluginDir: w.pluginDir }).verdict, 'plugin');
});

test('the check command prints a line, and its exit code is the verdict', () => {
  const w = world();
  const script = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'artifact-check.js');
  const run = (...args) => spawnSync(process.execPath, [script, w.boardDir, '--plugin', w.pluginDir, ...args], { encoding: 'utf8' });
  assert.strictEqual(run().status, 12);
  assert.match(run().stdout, /cannot tell/);
  const rec = run('--record');
  assert.strictEqual(rec.status, 0, rec.stderr);
  assert.ok(fs.existsSync(w.stampFile));
  commit(w.brd, 'board: stamp');
  const cur = run();
  assert.strictEqual(cur.status, 0);
  assert.match(cur.stdout, /current/);
  put(w.brd, '.kanban/0001.a.card.md', 'a2');
  commit(w.brd, 'board: change');
  assert.strictEqual(run().status, 10);
  put(w.plug, 'plugin/skills/web/x.js', '5');
  commit(w.plug, 'web: change');
  const behind = run();
  assert.strictEqual(behind.status, 11);
  assert.match(behind.stdout, /1 commit/);
  const j = JSON.parse(run('--json').stdout);
  assert.strictEqual(j.verdict, 'plugin');
});

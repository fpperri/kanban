const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The double-click launcher's own kanban_web.cmd/.pid/.lock (and the
// lock's temp/reclaim-ticket siblings) live IN the board directory itself,
// beside the *.card.md files. build_editor.py globs
// *.card.md explicitly (see collect.py/build_editor.py's own os.listdir
// filter), so these ought to be invisible to it — this pins that with a
// real build, the same way markdown-body.test.js/notif-split.test.js build
// a fixture board through build_editor.py rather than asserting on source
// text alone.

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');

function buildBoard(withLauncherFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-launcher-files-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: Fixture Board\n');
  fs.writeFileSync(path.join(dir, '0001.first.card.md'), '---\nid: 1\nstatus: todo\n---\n# First\nbody\n');
  fs.writeFileSync(path.join(dir, '0002.second.card.md'), '---\nid: 2\nstatus: doing\n---\n# Second\nbody\n');
  fs.writeFileSync(path.join(dir, 'notifications.md'), '');
  if (withLauncherFiles) {
    fs.writeFileSync(path.join(dir, 'kanban_web.cmd'), '@echo off\r\n');
    fs.writeFileSync(path.join(dir, 'kanban_web.pid'), '123\n7777\n');
    fs.writeFileSync(path.join(dir, 'kanban_web.lock'), '123 sometoken');
    fs.writeFileSync(path.join(dir, 'kanban_web.lock.123.abcd.tmp'), '');
  }
  const outHtml = path.join(dir, 'out.html');
  execFileSync('python', [buildScript, dir, '--out', outHtml], { encoding: 'utf8' });
  const html = fs.readFileSync(outHtml, 'utf8');
  const dataMatch = /const DATA=(\[[\s\S]*?\]);\s*\nconst NOTIFS=/.exec(html);
  assert.ok(dataMatch, 'could not find const DATA=... in the built HTML');
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(dataMatch[1]);
}

test('build_editor.py loads exactly the same cards whether or not the launcher\'s own files (kanban_web.cmd/.pid/.lock/.lock.*.tmp) sit in the board directory', () => {
  const without = buildBoard(false);
  const withFiles = buildBoard(true);
  const ids = (arr) => arr.map((c) => c.id).sort();
  assert.deepStrictEqual(ids(withFiles), [1, 2], 'exactly the two real cards, nothing derived from the launcher\'s own files');
  assert.deepStrictEqual(ids(withFiles), ids(without), 'identical to a build with no launcher files present at all');
});

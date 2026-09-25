const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- kanban-cli retired, no dangling references ------------------------------
// The conversational surface was retired and deleted outright (tracked
// deletion, recoverable via git history), the same way skills-deprecated/ was.
// Guard that it doesn't resurface and that the live docs and manifests that
// used to route the human to it no longer do. docs/adr/ is excluded on
// purpose: an ADR records what was decided under the names of the time.

const repoRoot = path.join(__dirname, '..', '..', '..');

// Walked, not listed. The first version of this guard was a hand-maintained
// array of .md paths, and a live reference survived retirement in
// skills/kanban/scripts/view_board.sh — a shell comment, so neither a .md file
// nor on the list. A guard whose coverage is a list only ever catches what
// somebody remembered to add to it.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'adr']);
const TEXT_EXT = new Set(['.md', '.js', '.py', '.sh', '.json', '.css', '.html', '.yaml', '.yml']);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (TEXT_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// This file names the retired surface in its own assertions, by necessity.
const SELF = path.join(__dirname, 'cli-skill-retired.test.js');

test('skills/cli/ and docs/cli.md are gone from the repo', () => {
  assert.ok(!fs.existsSync(path.join(repoRoot, 'skills', 'cli')));
  assert.ok(!fs.existsSync(path.join(repoRoot, 'docs', 'cli.md')));
});

test('nothing anywhere in the repo still names the retired surface', () => {
  // Bare "CLI" is deliberately NOT matched: it is ordinary prose for a
  // command-line argument in server.js and config-store.js, a different sense
  // of the word that has nothing to do with the retired skill.
  const offenders = [];
  for (const file of walk(repoRoot, [])) {
    if (file === SELF) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    if (text.includes('kanban-cli')) offenders.push(`${rel} names kanban-cli`);
    if (/skills\/cli/.test(text)) offenders.push(`${rel} points at skills/cli`);
    if (/\(cli\.md\)|docs\/cli\.md/.test(text)) offenders.push(`${rel} links docs/cli.md`);
    if (/CLI board print/.test(text)) offenders.push(`${rel} says "CLI board print"`);
  }
  assert.deepStrictEqual(offenders, [], 'live references to the retired surface survive: ' + offenders.join(' | '));
});

test('both plugin manifests describe three surfaces, not four', () => {
  for (const rel of [path.join('.claude-plugin', 'plugin.json'),
                     path.join('.claude-plugin', 'marketplace.json')]) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(text.includes('three surfaces'), `${rel} still claims four surfaces`);
    assert.ok(!/\bcli\b/.test(text), `${rel} still lists the cli surface`);
  }
});

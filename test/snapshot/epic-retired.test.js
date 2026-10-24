const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The epic flag retired: the snapshot no longer reads `epic:`, offers an epic:
// search term, draws an Epics chip or owns an epic color. An `epic: true` line
// on a card is just another frontmatter line, shown and kept like any other.

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const EPIC_WORD = /\bepic|Epic|EPIC/;

function build(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-epic-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), config);
    fs.writeFileSync(path.join(dir, '0001.old-epic.card.md'), '---\nid: 1\nstatus: todo\nepic: true\ntype: epic\n---\n\n# Old epic\n\nbody\n');
    fs.writeFileSync(path.join(dir, '0002.child.card.md'), '---\nid: 2\nstatus: todo\nparent: 1\n---\n\n# Child\n');
    const out = path.join(dir, 'out.html');
    execFileSync('python', [buildScript, dir, '--out', out], { encoding: 'utf8' });
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const source = fs.readFileSync(buildScript, 'utf8').replace(/\r\n/g, '\n');

test('the builder never says epic', () => {
  const stray = source.split('\n').filter((l) => EPIC_WORD.test(l));
  assert.deepStrictEqual(stray, []);
});

test('the built page has no epic chip, epic search scope, epic token or epic card field', () => {
  const html = build('name: Fixture\n');
  assert.doesNotMatch(html, /epicchip|--id-epic|--epic-wash|EFIELDS|isEpicSearchActive/);
  assert.doesNotMatch(html, /c\.ep\b|"ep":/);
});

test('a card still carries its raw epic: line in frontmatter, shown like any unknown field', () => {
  const html = build('name: Fixture\n');
  assert.match(html, /epic: true|"epic":\s*"true"/);
});

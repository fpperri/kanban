const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../scripts/config-store');

function tmpBoard() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-config-'));
}

const SAMPLE = `nextId: 28
assignees:
  - handle: "@alex"
    name: "Alex"
    kind: human
    description: "The human. Final say."
  - handle: "@claude-afk"
    name: "Claude (AFK)"
    kind: ai-afk
    description: "Unattended workflow agents."
`;

test('parseConfig reads nextId scalar and the assignees list', () => {
  const c = cfg.parseConfig(SAMPLE);
  assert.strictEqual(c.nextId, 28);
  assert.strictEqual(c.assignees.length, 2);
  assert.deepStrictEqual(c.assignees[0], {
    handle: '@alex', name: 'Alex', kind: 'human', description: 'The human. Final say.', color: '',
  });
  assert.strictEqual(c.assignees[1].kind, 'ai-afk');
});

// --- OPTIONAL reserved color, same suggest-never-validate field ----

test('parseConfig reads an assignee\'s optional color field; absent defaults to empty string', () => {
  const withColor = cfg.parseConfig('assignees:\n  - handle: "@alex"\n    color: "#a371f7"\n');
  assert.strictEqual(withColor.assignees[0].color, '#a371f7');
  const withoutColor = cfg.parseConfig('assignees:\n  - handle: "@bob"\n');
  assert.strictEqual(withoutColor.assignees[0].color, '');
});

test('parseConfig tolerates an unquoted hex color (the leading # is the value, not a comment marker)', () => {
  const c = cfg.parseConfig('assignees:\n  - handle: "@alex"\n    color: #a371f7\n');
  assert.strictEqual(c.assignees[0].color, '#a371f7');
});

test('serializeConfig round-trips a reserved color through parseConfig', () => {
  const c = cfg.parseConfig('assignees:\n  - handle: "@alex"\n    color: "#a371f7"\n');
  assert.deepStrictEqual(cfg.parseConfig(cfg.serializeConfig(c)), c);
});

test('parseConfig tolerates missing sections: assignees only, nextId only, empty', () => {
  const onlyAssignees = cfg.parseConfig('assignees:\n  - handle: "@x"\n');
  assert.strictEqual(onlyAssignees.nextId, null);
  assert.strictEqual(onlyAssignees.assignees.length, 1);

  const onlyCounter = cfg.parseConfig('nextId: 5\n');
  assert.strictEqual(onlyCounter.nextId, 5);
  assert.deepStrictEqual(onlyCounter.assignees, []);

  assert.deepStrictEqual(cfg.parseConfig(''), { name: '', nextId: null, port: null, assignees: [], priorities: [], tags: [], statuses: [] });
});

test('parseConfig skips assignee entries without a handle and non-numeric nextId', () => {
  const c = cfg.parseConfig('nextId: soon\nassignees:\n  - name: "no handle"\n  - handle: "@ok"\n');
  assert.strictEqual(c.nextId, null);
  assert.strictEqual(c.assignees.length, 1);
  assert.strictEqual(c.assignees[0].handle, '@ok');
});

test('serializeConfig round-trips through parseConfig', () => {
  const c = cfg.parseConfig(SAMPLE);
  assert.deepStrictEqual(cfg.parseConfig(cfg.serializeConfig(c)), c);
});

test('readConfig returns defaults when config.yaml is absent', () => {
  const dir = tmpBoard();
  assert.deepStrictEqual(cfg.readConfig(dir), { name: '', nextId: null, port: null, assignees: [], priorities: [], tags: [], statuses: [] });
});

// --- `statuses` joins LIST_KEYS — the official column list ----------

test('parseConfig reads an inline statuses list, order preserved (= column order)', () => {
  const c = cfg.parseConfig('statuses: [triage, doing, review, done]   # column order\n');
  assert.deepStrictEqual(c.statuses, ['triage', 'doing', 'review', 'done']);
});

test('parseConfig reads a block-form statuses list', () => {
  const c = cfg.parseConfig('statuses:\n  - triage\n  - "in progress"\n  - done\n');
  assert.deepStrictEqual(c.statuses, ['triage', 'in progress', 'done']);
});

test('parseConfig defaults statuses to [] when the key is absent (built-in four apply)', () => {
  assert.deepStrictEqual(cfg.parseConfig('nextId: 5\n').statuses, []);
});

test('allocateId without config.yaml falls back to the scan candidate and does NOT create the file', () => {
  const dir = tmpBoard();
  assert.strictEqual(cfg.allocateId(dir, 10), 10); // caller passes scan-max + 1
  assert.ok(!fs.existsSync(path.join(dir, 'config.yaml')));
});

test('allocateId uses the counter when it leads the scan, and advances it', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'nextId: 40\n');
  assert.strictEqual(cfg.allocateId(dir, 28), 40); // counter wins over the scan candidate 28
  assert.strictEqual(cfg.readConfig(dir).nextId, 41); // persisted advance
});

test('allocateId self-heals a stale counter that lags the scan', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'nextId: 3\n');
  assert.strictEqual(cfg.allocateId(dir, 28), 28); // scan wins — a lagging counter never re-issues a taken id
  assert.strictEqual(cfg.readConfig(dir).nextId, 29);
});

test('allocateId preserves the assignees section when advancing the counter', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), SAMPLE);
  cfg.allocateId(dir, 2);
  const after = cfg.readConfig(dir);
  assert.strictEqual(after.nextId, 29);
  assert.strictEqual(after.assignees.length, 2);
});

test('allocateId preserves comments and unknown keys — surgical nextId replace, not a rewrite', () => {
  const dir = tmpBoard();
  const raw = '# board config — hand-edited\nnextId: 40\ntheme: dark\nassignees:\n  - handle: "@alex"\n    name: "Alex"   # the boss\n';
  fs.writeFileSync(path.join(dir, 'config.yaml'), raw);
  cfg.allocateId(dir, 2);
  const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  assert.match(after, /# board config — hand-edited/);
  assert.match(after, /theme: dark/);
  assert.match(after, /# the boss/);
  assert.match(after, /nextId: 41/);
  assert.doesNotMatch(after, /nextId: 40/);
});

test('allocateId inserts a nextId line without disturbing a config that lacks one', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), '# just assignees\nassignees:\n  - handle: "@x"\n');
  assert.strictEqual(cfg.allocateId(dir, 6), 6);
  const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  assert.match(after, /^nextId: 7\n/);
  assert.match(after, /# just assignees/);
  assert.match(after, /@x/);
});

test('parseConfig tolerates inline # comments — the SKILL.md example parses as documented', () => {
  const c = cfg.parseConfig('nextId: 28   # monotonic id counter\nassignees:\n  - handle: "@alex"   # the boss\n    name: "Fr#anc"\n    kind: human   # kinds are free strings\n');
  assert.strictEqual(c.nextId, 28);
  assert.strictEqual(c.assignees[0].handle, '@alex');
  assert.strictEqual(c.assignees[0].name, 'Fr#anc'); // hash inside quotes survives
  assert.strictEqual(c.assignees[0].kind, 'human');
});

// --- official priorities/tags lists — suggest, never validate ---

test('parseConfig reads an inline flow list for priorities and tags', () => {
  const c = cfg.parseConfig('nextId: 5\npriorities: [High, Normal, Low]\ntags: [skills, config, design]\n');
  assert.deepStrictEqual(c.priorities, ['High', 'Normal', 'Low']);
  assert.deepStrictEqual(c.tags, ['skills', 'config', 'design']);
});

test('parseConfig reads block lists for priorities and tags', () => {
  const c = cfg.parseConfig('priorities:\n  - High\n  - Normal\n  - Low\ntags:\n  - skills\n  - "with: colon"\n');
  assert.deepStrictEqual(c.priorities, ['High', 'Normal', 'Low']);
  assert.deepStrictEqual(c.tags, ['skills', 'with: colon']);
});

test('parseConfig defaults priorities/tags to empty arrays when absent', () => {
  const c = cfg.parseConfig('nextId: 3\n');
  assert.deepStrictEqual(c.priorities, []);
  assert.deepStrictEqual(c.tags, []);
});

test('parseConfig priorities/tags tolerate inline comments, quotes, and blank entries', () => {
  const c = cfg.parseConfig('priorities: [High, "Normal"]   # ordered, highest first\ntags:\n  - auth   # backend\n  -\n  - ""\n');
  assert.deepStrictEqual(c.priorities, ['High', 'Normal']);
  assert.deepStrictEqual(c.tags, ['auth']); // blank/empty entries skipped, never fatal
});

test('readConfig returns empty priorities/tags when config.yaml is missing', () => {
  const dir = tmpBoard();
  const c = cfg.readConfig(dir);
  assert.deepStrictEqual(c.priorities, []);
  assert.deepStrictEqual(c.tags, []);
});


// --- `name`: the board name that qualifies a card mention -----------

test('parseConfig reads a top-level name and strips its trailing comment', () => {
  const c = cfg.parseConfig('name: webapp   # board name for card mentions\nnextId: 7\n');
  assert.strictEqual(c.name, 'webapp');
  assert.strictEqual(c.nextId, 7);
});

test('parseConfig defaults name to empty string when the key is absent (caller falls back to the parent folder)', () => {
  assert.strictEqual(cfg.parseConfig('nextId: 5\n').name, '');
});

test("parseConfig does not mistake an assignee's indented name for the board name", () => {
  const c = cfg.parseConfig(SAMPLE); // assignees carry `name:` at indent, no top-level key
  assert.strictEqual(c.name, '');
  assert.strictEqual(c.assignees[0].name, 'Alex');
});

test('a top-level name above the assignees block wins, and the assignee names survive intact', () => {
  const c = cfg.parseConfig('name: webapp\n' + SAMPLE);
  assert.strictEqual(c.name, 'webapp');
  assert.deepStrictEqual(c.assignees.map((a) => a.name), ['Alex', 'Claude (AFK)']);
});

test('serializeConfig round-trips a board name, and emits it ABOVE the assignees block', () => {
  const c = cfg.parseConfig('name: webapp\n' + SAMPLE);
  const out = cfg.serializeConfig(c);
  assert.ok(out.indexOf('name: webapp') < out.indexOf('assignees:'), 'top-level name must precede assignees');
  assert.deepStrictEqual(cfg.parseConfig(out), c);
});

// --- `port`: pins the board's serving port (kanban.proj #254) -----------

test('parseConfig reads a top-level port as a number', () => {
  const c = cfg.parseConfig('port: 7781\nnextId: 7\n');
  assert.strictEqual(c.port, 7781);
});

test('parseConfig defaults port to null when the key is absent (caller falls back to CLI-arg/7777 auto-increment)', () => {
  assert.strictEqual(cfg.parseConfig('nextId: 5\n').port, null);
});

test("parseConfig does not mistake an assignee's indented port for the board's pinned port", () => {
  const c = cfg.parseConfig('assignees:\n  - handle: "@alex"\n    name: "Alex"\n    port: 9999\n');
  assert.strictEqual(c.port, null);
  assert.strictEqual(c.assignees[0].handle, '@alex'); // the indented line was consumed, not fatal
});

test('parseConfig ignores a non-numeric or non-positive port (tolerant: never fatal)', () => {
  assert.strictEqual(cfg.parseConfig('port: not-a-number\n').port, null);
  assert.strictEqual(cfg.parseConfig('port: 0\n').port, null);
  assert.strictEqual(cfg.parseConfig('port: -1\n').port, null);
});

test('serializeConfig round-trips a pinned port', () => {
  const c = cfg.parseConfig('port: 7781\n' + SAMPLE);
  const out = cfg.serializeConfig(c);
  assert.deepStrictEqual(cfg.parseConfig(out), c);
});

test('advanceCounter keeps a line-1 name byte-for-byte when the web app allocates an id', () => {
  const dir = tmpBoard();
  const raw = 'name: webapp   # board name for card mentions\n' + SAMPLE.replace('nextId: 28', 'nextId: 40');
  fs.writeFileSync(path.join(dir, 'config.yaml'), raw);
  assert.strictEqual(cfg.allocateId(dir, 2), 40);
  const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  assert.strictEqual(after.split('\n')[0], 'name: webapp   # board name for card mentions');
  assert.strictEqual(after, raw.replace('nextId: 40', 'nextId: 41'));
});

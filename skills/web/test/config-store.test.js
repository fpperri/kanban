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

  assert.deepStrictEqual(cfg.parseConfig(''), { name: '', nextId: null, idDigits: 4, logbook: '', groups: '', iterations: false, prefixes: {}, counters: {}, port: null, portInvalid: null, assignees: [], priorities: [], tags: [], statuses: [], hierarchy: [], types: [], pills: [] });
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
  assert.deepStrictEqual(cfg.readConfig(dir), cfg.parseConfig(''));
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

// --- `types` — the card-type vocabulary: entries are {name, color} ----

test('parseConfig reads block-form types entries with an optional color, config order kept', () => {
  const c = cfg.parseConfig('types:\n  - name: objective\n    color: "#a371f7"\n  - name: task\n');
  assert.deepStrictEqual(c.types, [
    { name: 'objective', color: '#a371f7' },
    { name: 'task', color: '' },
  ]);
});

test('parseConfig reads bare and inline types lists as colourless entries', () => {
  assert.deepStrictEqual(cfg.parseConfig('types:\n  - epic\n  - "user story"\n').types, [
    { name: 'epic', color: '' },
    { name: 'user story', color: '' },
  ]);
  assert.deepStrictEqual(cfg.parseConfig('types: [epic, story]   # suggested\n').types, [
    { name: 'epic', color: '' },
    { name: 'story', color: '' },
  ]);
});

test('parseConfig mixes bare and block types entries without reordering them', () => {
  const c = cfg.parseConfig('types:\n  - epic\n  - name: story\n    color: tomato\n  - task\n');
  assert.deepStrictEqual(c.types.map((t) => t.name), ['epic', 'story', 'task']);
  assert.strictEqual(c.types[1].color, 'tomato');
});

test('parseConfig takes an unquoted hex types color as the value and drops a trailing comment', () => {
  const c = cfg.parseConfig('types:\n  - name: epic\n    color: #a371f7   # purple\n');
  assert.deepStrictEqual(c.types, [{ name: 'epic', color: '#a371f7' }]);
});

test('parseConfig skips types entries without a name and defaults types to [] when absent', () => {
  const c = cfg.parseConfig('types:\n  - color: "#fff"\n  - name: ""\n  - name: ok\n');
  assert.deepStrictEqual(c.types, [{ name: 'ok', color: '' }]);
  assert.deepStrictEqual(cfg.parseConfig('nextId: 5\n').types, []);
});

test('types entries do not leak into assignees, and the next top-level key ends the section', () => {
  const c = cfg.parseConfig('types:\n  - name: epic\n    color: red\nassignees:\n  - handle: "@a"\n    name: "A"\nnextId: 9\n');
  assert.deepStrictEqual(c.types, [{ name: 'epic', color: 'red' }]);
  assert.deepStrictEqual(c.assignees.map((a) => a.handle), ['@a']);
  assert.strictEqual(c.nextId, 9);
});

test('assignee fields after a types block still belong to the assignee', () => {
  const c = cfg.parseConfig('assignees:\n  - handle: "@a"\n    color: "#111"\ntypes:\n  - name: t\n    color: "#222"\n');
  assert.strictEqual(c.assignees[0].color, '#111');
  assert.strictEqual(c.types[0].color, '#222');
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

// The hierarchy, pills and icon lines are human text: the counter's write
// replaces its own line and nothing else, whatever the file's line endings.
const KEYED = [
  'name: plan',
  'nextId: 30',
  'hierarchy: [goal, strategy, objective, epic]',
  'types:',
  '  - name: goal',
  '    color: "#a371f7"',
  '    icon: star   # five points',
  '  - name: epic',
  '    icon: Square',
  'pills:',
  "  - next: 'tags:\"next-up\"'   # the queue",
  '  - "assignee:@human"',
  '  - tags: grill',
  '  -',
  'unknown: kept  ',
  '',
];

for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`creating a card advances the counter and keeps the hierarchy, pills and icon lines byte for byte (${label})`, () => {
    const dir = tmpBoard();
    const before = KEYED.join(eol);
    fs.writeFileSync(path.join(dir, 'config.yaml'), before);
    assert.strictEqual(cfg.allocateId(dir, 2), 30);
    const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    assert.strictEqual(after, before.replace('nextId: 30', 'nextId: 31'));
    assert.deepStrictEqual(cfg.parseConfig(after).hierarchy, ['goal', 'strategy', 'objective', 'epic']);
    assert.strictEqual(cfg.parseConfig(after).pills.length, 3);
  });

  test(`a counter inserted above the keys leaves every one of their lines as it was (${label})`, () => {
    const dir = tmpBoard();
    const keyed = KEYED.filter((l) => l !== 'nextId: 30');
    fs.writeFileSync(path.join(dir, 'config.yaml'), keyed.join(eol));
    assert.strictEqual(cfg.allocateId(dir, 6), 6);
    const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    assert.match(after, /^nextId: 7\r?\n/);
    assert.strictEqual(after.slice(after.indexOf('name: plan')), keyed.join(eol));
  });
}

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

test('parseConfig rejects an out-of-range or malformed port AND hands the raw value back for the warning', () => {
  // 65536+ matters as much as 'abc': srv.listen() throws ERR_SOCKET_BAD_PORT
  // outside 1-65535, so an unscreened out-of-range pin crashed the server
  // with a raw stack instead of the clear message the key promises.
  for (const raw of ['65536', '99999', '0', '-1', 'not-a-number']) {
    const c = cfg.parseConfig(`port: ${raw}\n`);
    assert.strictEqual(c.port, null, `${raw} must never become a pin`);
    assert.strictEqual(c.portInvalid, raw, `${raw} must come back so the server can name it`);
  }
});

test('parseConfig leaves portInvalid null for a usable pin and for an absent key', () => {
  assert.strictEqual(cfg.parseConfig('port: 65535\n').port, 65535);
  assert.strictEqual(cfg.parseConfig('port: 65535\n').portInvalid, null);
  assert.strictEqual(cfg.parseConfig('port: 1\n').port, 1);
  assert.strictEqual(cfg.parseConfig('nextId: 5\n').portInvalid, null);
  assert.strictEqual(cfg.parseConfig("assignees:\n  - handle: \"@alex\"\n    port: 70000\n").portInvalid, null);
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

test('a comment after the types or priorities key opens the block list, as the docs write it', () => {
  const c = cfg.parseConfig('types:   # suggested card types\n  - name: objective\n    color: "#a371f7"\n  - story\npriorities:   # high first\n  - Urgent\n  - Normal\ntags: # areas\n  - ui\n');
  assert.deepStrictEqual(c.types, [{ name: 'objective', color: '#a371f7' }, { name: 'story', color: '' }]);
  assert.deepStrictEqual(c.priorities, ['Urgent', 'Normal']);
  assert.deepStrictEqual(c.tags, ['ui']);
});

// --- the pill-entry splitter and the icon names, shared with the snapshot's reader ---

test('splitPillEntry splits an entry into a label and a query, or null', () => {
  const split = cfg.splitPillEntry;
  assert.deepStrictEqual(split('tags:*'), { label: 'tags:*', query: 'tags:*' });
  assert.deepStrictEqual(split('"assignee:@human"'), { label: 'assignee:@human', query: 'assignee:@human' });
  assert.deepStrictEqual(split("next: 'tags:\"next-up\"'"), { label: 'next', query: 'tags:"next-up"' });
  assert.deepStrictEqual(split('tags: grill'), { label: 'tags', query: 'grill' });
  assert.deepStrictEqual(split('"two words": review:'), { label: 'two words', query: 'review:' });
  assert.deepStrictEqual(split('assignee:@human # who: me'), { label: 'assignee:@human', query: 'assignee:@human' });
  assert.deepStrictEqual(split('"say \\"hi\\"": x'), { label: 'say "hi"', query: 'x' });
  assert.deepStrictEqual(split('"unterminated'), { label: '"unterminated', query: '"unterminated' });
  for (const blank of ['', '   ', '# comment', '""', "''", 'next:', 'next: ""', 'next: # nothing', '"": x', ': x']) {
    assert.strictEqual(split(blank), null, JSON.stringify(blank));
  }
});

test('ICON_NAMES is the six outline glyphs, and cannot be changed by a consumer', () => {
  assert.deepStrictEqual([...cfg.ICON_NAMES], ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']);
  assert.ok(Object.isFrozen(cfg.ICON_NAMES));
});

// --- logbook (ADR 0016) --------------------------------------------------------------------------

test('parseConfig reads the logbook folder: a scalar, quoted or not, comment stripped, empty when absent', () => {
  assert.strictEqual(cfg.parseConfig('').logbook, '');
  assert.strictEqual(cfg.parseConfig('logbook: logbook\n').logbook, 'logbook');
  assert.strictEqual(cfg.parseConfig('logbook: "my notes"   # where\n').logbook, 'my notes');
  assert.strictEqual(cfg.parseConfig('logbook:\nname: x\n').logbook, '');
  assert.strictEqual(cfg.parseConfig('assignees:\n  - handle: "@x"\n    logbook: nope\n').logbook, '', 'an indented logbook is not the key');
});

// --- prefixes, counters and idDigits (ADR 0014) --------------------------------------------------

test('parseConfig reads idDigits as a width from 1 to 15 and defaults to 4', () => {
  assert.strictEqual(cfg.parseConfig('').idDigits, 4);
  assert.strictEqual(cfg.parseConfig('idDigits: 6   # wide\n').idDigits, 6);
  assert.strictEqual(cfg.parseConfig('idDigits: "3"\n').idDigits, 3);
  for (const bad of ['0', '-2', '16', 'wide', '4.5', '']) assert.strictEqual(cfg.parseConfig(`idDigits: ${bad}\n`).idDigits, 4, bad);
});

test('parseConfig reads a prefixes block of prefix to card type or folder, in config order', () => {
  const c = cfg.parseConfig([
    'prefixes:',
    '  G: goal',
    '  O: "objective"   # the layer under it',
    "  'DW': deep work",
    '  W: workflow/',
    '  _: loose/',
    'nextId: 5',
  ].join('\n'));
  assert.deepStrictEqual(c.prefixes, { G: 'goal', O: 'objective', DW: 'deep work', W: 'workflow/', _: 'loose/' });
  assert.deepStrictEqual(Object.keys(c.prefixes), ['G', 'O', 'DW', 'W', '_']);
  assert.strictEqual(c.nextId, 5, 'the next top-level key ends the block');
});

test('parseConfig skips a prefixes entry whose key is no prefix or whose value is blank, and the first of a repeated prefix wins', () => {
  const c = cfg.parseConfig('prefixes:\n  g: lower\n  G1: digit\n  H:\n  I: # nothing\n  J: ok\n  J: second\n  K-L: dash\n');
  assert.deepStrictEqual(c.prefixes, { J: 'ok' });
});

test('parseConfig answers no prefixes for a scalar or a list, and an indented prefix of an assignee is not one', () => {
  assert.deepStrictEqual(cfg.parseConfig('prefixes: G\n').prefixes, {});
  assert.deepStrictEqual(cfg.parseConfig('prefixes: [G, O]\n').prefixes, {});
  assert.deepStrictEqual(cfg.parseConfig('assignees:\n  - handle: "@a"\n    G: goal\n').prefixes, {});
});

test('parseConfig reads counters from one flow-map line, skipping what is no counter', () => {
  assert.deepStrictEqual(cfg.parseConfig('counters: { G: 4, O: 6 }\n').counters, { G: 4, O: 6 });
  assert.deepStrictEqual(cfg.parseConfig('counters: {G: 4,O: 6}   # one line\n').counters, { G: 4, O: 6 });
  assert.deepStrictEqual(cfg.parseConfig('counters: {"G": "4", DW: 12}\n').counters, { G: 4, DW: 12 });
  assert.deepStrictEqual(cfg.parseConfig('counters: { G: 0, H: -1, I: x, j: 3, K: 2.5, L: 7 }\n').counters, { L: 7 });
  assert.deepStrictEqual(cfg.parseConfig('counters: { G: 4\n').counters, { G: 4 }, 'no closing brace: take what is there');
  assert.deepStrictEqual(cfg.parseConfig('counters: G\n').counters, {});
  assert.deepStrictEqual(cfg.parseConfig('counters:\n  G: 4\n').counters, {}, 'the block form is not read');
  assert.deepStrictEqual(cfg.parseConfig('').counters, {});
});

test('prefixForType gives the prefix a card type declares, ignoring case and folder entries', () => {
  const c = cfg.parseConfig('prefixes:\n  G: goal\n  O: Objective\n  W: workflow/\n  X: goal\n');
  assert.strictEqual(cfg.prefixForType(c, 'goal'), 'G');
  assert.strictEqual(cfg.prefixForType(c, 'GOAL'), 'G', 'the first prefix naming a type wins');
  assert.strictEqual(cfg.prefixForType(c, 'objective'), 'O');
  assert.strictEqual(cfg.prefixForType(c, 'workflow'), '', 'a path is a folder, not a type');
  assert.strictEqual(cfg.prefixForType(c, 'epic'), '');
  assert.strictEqual(cfg.prefixForType(c, null), '');
  assert.strictEqual(cfg.prefixForType(c, ''), '');
  assert.strictEqual(cfg.prefixForType(cfg.parseConfig(''), 'goal'), '');
});

test('allocateId with a prefix uses that prefix counter, advances it and leaves nextId alone', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'nextId: 40\ncounters: { G: 7 }\n');
  assert.strictEqual(cfg.allocateId(dir, 1, 'G'), 7);
  assert.strictEqual(cfg.allocateId(dir, 1, 'G'), 8);
  const c = cfg.readConfig(dir);
  assert.deepStrictEqual(c.counters, { G: 9 });
  assert.strictEqual(c.nextId, 40);
});

test('parseConfig reads the groups folder and a missing or blank line is none', () => {
  assert.strictEqual(cfg.parseConfig('groups: .groups\n').groups, '.groups');
  assert.strictEqual(cfg.parseConfig('groups: "my groups"   # where\n').groups, 'my groups');
  assert.strictEqual(cfg.parseConfig('groups:\nname: x\n').groups, '');
  assert.strictEqual(cfg.parseConfig('assignees:\n  - handle: "@x"\n    groups: nope\n').groups, '', 'an indented groups is not the key');
});

test('parseConfig reads iterations: true as on, and any other value or a missing line as off', () => {
  assert.strictEqual(cfg.parseConfig('iterations: true\n').iterations, true);
  assert.strictEqual(cfg.parseConfig('iterations: true   # the dropdown\n').iterations, true);
  assert.strictEqual(cfg.parseConfig('iterations: "true"\n').iterations, true);
  for (const off of ['iterations: false\n', 'iterations:\n', 'iterations: yes\n', 'iterations: 1\n', 'name: x\n']) assert.strictEqual(cfg.parseConfig(off).iterations, false, off);
  assert.strictEqual(cfg.parseConfig('assignees:\n  - handle: "@x"\n    iterations: true\n').iterations, false, 'an indented iterations is not the key');
});

test('groupFolderOf reads a prefixes value as a groups folder: a path, or the groups folder itself, the root included', () => {
  const c = cfg.parseConfig('groups: .groups\nprefixes:\n  _: .groups\n  I: .groups/iteration\n  W: workflow/\n  DW: workflow/dynamic\n  G: goal\n  X: .groups/\n');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes._), '', 'the groups folder itself is the root, which has no slash');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes.I), 'iteration');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes.W), 'workflow', 'a path with a slash is a folder, relative to the groups folder');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes.DW), 'workflow/dynamic');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes.G), null, 'a bare word is a card type');
  assert.strictEqual(cfg.groupFolderOf(c, c.prefixes.X), '');
  assert.strictEqual(cfg.groupFolderOf(cfg.parseConfig('prefixes:\n  _: .groups\n'), '.groups'), null, 'with no groups: line a bare word is still a type');
  assert.strictEqual(cfg.groupFolderOf(cfg.parseConfig('groups: groups\n'), 'GROUPS'), null, 'the folder is matched exactly');
});

test('prefixForType leaves a type alone when its name is the groups folder, and prefixForGroupFolder gives the exact folder its prefix or _', () => {
  const c = cfg.parseConfig('groups: .groups\nprefixes:\n  G: goal\n  _: .groups\n  I: .groups/iteration\n  W: workflow/\n  DW: workflow/dynamic\n');
  assert.strictEqual(cfg.prefixForType(c, '.groups'), '', 'the groups folder is a folder, not a type');
  assert.strictEqual(cfg.prefixForType(c, 'goal'), 'G');
  assert.strictEqual(cfg.prefixForGroupFolder(c, 'iteration'), 'I');
  assert.strictEqual(cfg.prefixForGroupFolder(c, 'workflow'), 'W');
  assert.strictEqual(cfg.prefixForGroupFolder(c, 'workflow/dynamic'), 'DW', 'the exact folder, not its parent');
  assert.strictEqual(cfg.prefixForGroupFolder(c, 'workflow/other'), '_', 'a folder no prefix names takes the loose prefix');
  assert.strictEqual(cfg.prefixForGroupFolder(c, ''), '_', 'the root maps to the prefix naming the groups folder, here _');
  assert.strictEqual(cfg.prefixForGroupFolder(cfg.parseConfig('groups: g\nprefixes:\n  Q: .groups\n'), ''), '_', 'no prefix names the root');
  assert.strictEqual(cfg.prefixForGroupFolder(cfg.parseConfig('groups: g\nprefixes:\n  Q: g\n'), ''), 'Q');
  assert.strictEqual(cfg.prefixForGroupFolder(cfg.parseConfig('groups: g\n'), 'iteration'), '_');
});

test('allocateId with a prefix self-heals a counter that lags the scan, and starts a prefix at the scan candidate', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'nextId: 40\ncounters: { G: 2 }\n');
  assert.strictEqual(cfg.allocateId(dir, 12, 'G'), 12);
  assert.strictEqual(cfg.allocateId(dir, 1, 'O'), 1);
  assert.deepStrictEqual(cfg.readConfig(dir).counters, { G: 13, O: 2 });
});

test('allocateId without a prefix never touches counters', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'nextId: 40\ncounters: {   G: 7 }  # keep\n');
  assert.strictEqual(cfg.allocateId(dir, 2), 40);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), 'nextId: 41\ncounters: {   G: 7 }  # keep\n');
});

test('allocateId without config.yaml gives the scan candidate for a prefix too and creates no file', () => {
  const dir = tmpBoard();
  assert.strictEqual(cfg.allocateId(dir, 3, 'G'), 3);
  assert.ok(!fs.existsSync(path.join(dir, 'config.yaml')));
});

for (const [label, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
  test(`a prefix's first counter is inserted below nextId and every other line stays byte for byte (${label})`, () => {
    const dir = tmpBoard();
    const before = KEYED.join(eol);
    fs.writeFileSync(path.join(dir, 'config.yaml'), before);
    assert.strictEqual(cfg.allocateId(dir, 1, 'G'), 1);
    const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    assert.strictEqual(after, before.replace(`nextId: 30${eol}`, `nextId: 30${eol}counters: { G: 2 }${eol}`));
  });

  test(`a counters line is replaced in place, keeping its neighbours byte for byte (${label})`, () => {
    const dir = tmpBoard();
    const before = ['name: plan', 'counters: { G: 3, O: 5 }   # per prefix', 'nextId: 30', 'unknown: kept  ', ''].join(eol);
    fs.writeFileSync(path.join(dir, 'config.yaml'), before);
    assert.strictEqual(cfg.allocateId(dir, 1, 'O'), 5);
    const after = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    assert.strictEqual(after, before.replace('counters: { G: 3, O: 5 }   # per prefix', 'counters: { G: 3, O: 6 }'));
  });

  test(`a counters line is inserted at the top when nextId is absent (${label})`, () => {
    const dir = tmpBoard();
    const before = ['assignees:', '  - handle: "@x"', ''].join(eol);
    fs.writeFileSync(path.join(dir, 'config.yaml'), before);
    assert.strictEqual(cfg.allocateId(dir, 1, 'G'), 1);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), `counters: { G: 2 }${eol}${before}`);
  });
}

test('writeConfigLine replaces, inserts or removes one top-level line and nothing else', () => {
  const dir = tmpBoard();
  const raw = '# hand edited\nname: plan\nidDigits: 4   # width\nassignees:\n  - handle: "@x"\n    idDigits: 9\n';
  fs.writeFileSync(path.join(dir, 'config.yaml'), raw);
  const read = () => fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
  cfg.writeConfigLine(dir, 'idDigits', '6');
  assert.strictEqual(read(), raw.replace('idDigits: 4   # width', 'idDigits: 6'), 'the indented idDigits of an assignee is not the line');
  cfg.writeConfigLine(dir, 'logbook', 'notes');
  assert.match(read(), /^logbook: notes\n# hand edited\n/);
  cfg.writeConfigLine(dir, 'logbook', null);
  cfg.writeConfigLine(dir, 'idDigits', null);
  assert.strictEqual(read(), '# hand edited\nname: plan\nassignees:\n  - handle: "@x"\n    idDigits: 9\n');
  cfg.writeConfigLine(dir, 'absent', null);
  assert.strictEqual(read(), '# hand edited\nname: plan\nassignees:\n  - handle: "@x"\n    idDigits: 9\n', 'removing what is not there writes nothing');
});

test('writeConfigLine takes the indented lines of a block it replaces or removes along with its key', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: plan\ncounters:\n  G: 4\n  O: 6\nnextId: 9\n');
  cfg.writeConfigLine(dir, 'counters', '{ G: 5 }');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), 'name: plan\ncounters: { G: 5 }\nnextId: 9\n');
});

test('writeConfigLine refuses a key that is not a plain word and a value that breaks the line', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: plan\n');
  assert.throws(() => cfg.writeConfigLine(dir, 'a.b', '1'), /key/);
  assert.throws(() => cfg.writeConfigLine(dir, 'name', 'a\nb'), /value/);
});

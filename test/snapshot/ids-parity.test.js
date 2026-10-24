const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const cases = require('../web/ids-cases.json');
const webIds = require('../../plugin/skills/web/web/ids');

// The snapshot's Python copy of the id module (scripts/ids.py) runs the same table of
// cases as the web module (test/web/ids.test.js). The table is read here from
// the web suite's folder and handed to Python as it is, so the two copies are held to
// one set of hand-written answers.

const scripts = path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts');
const tablePath = path.join(__dirname, '..', 'web', 'ids-cases.json');

// One Python run answers every case; the answers come back as JSON, in table order.
const py = JSON.parse(execFileSync('python', ['-B', '-c', [
  'import json, sys',
  `sys.path.insert(0, ${JSON.stringify(scripts)})`,
  'import ids',
  'sys.stdout.reconfigure(encoding="utf-8")',
  `t = json.load(open(${JSON.stringify(tablePath)}, encoding="utf-8"))`,
  'def key(m): return ids.id_key(m)',
  'out = {',
  '  "parse": [ids.parse_id(c["in"]) for c in t["parse"]],',
  '  "key": [ids.id_key(c["in"]) for c in t["key"]],',
  '  "compare": [ids.compare_ids(c["a"], c["b"]) for c in t["compare"]],',
  '  "sort": [ids.sort_ids(c["in"]) for c in t["sort"]],',
  '  "format": [ids.format_id(c["id"]) if c["digits"] is None else ids.format_id(c["id"], c["digits"]) for c in t["format"]],',
  '  "mention": [(lambda m: m and {"board": m["board"], "id": key(m)})(ids.parse_mention(c["in"])) for c in t["mention"]],',
  '  "mentions": [[{"match": m["match"], "board": m["board"], "id": key(m), "start": m["start"], "end": m["end"]} for m in ids.find_mentions(c["text"])] for c in t["mentions"]],',
  '  "source": ids.MENTION_SOURCE,',
  '}',
  'print(json.dumps(out))',
].join('\n')], { encoding: 'utf8' }));

test('the Python copy parses every id in the table as the table says', () => {
  cases.parse.forEach((c, i) => assert.deepStrictEqual(py.parse[i], c.id, JSON.stringify(c.in)));
});

test('the Python copy writes every id key as the table says', () => {
  cases.key.forEach((c, i) => assert.strictEqual(py.key[i], c.key, JSON.stringify(c.in)));
});

test('the Python copy compares ids as the table says', () => {
  cases.compare.forEach((c, i) => assert.strictEqual(Math.sign(py.compare[i]), c.order, `${c.a} vs ${c.b}`));
});

test('the Python copy sorts ids as the table says', () => {
  cases.sort.forEach((c, i) => assert.deepStrictEqual(py.sort[i], c.out, JSON.stringify(c.in)));
});

test('the Python copy formats ids with padding as the table says', () => {
  cases.format.forEach((c, i) => assert.strictEqual(py.format[i], c.out, `${c.id} at ${c.digits}`));
});

test('the Python copy reads whole mentions as the table says', () => {
  cases.mention.forEach((c, i) => {
    const want = c.id === null ? null : { board: c.board, id: c.id };
    assert.deepStrictEqual(py.mention[i], want, JSON.stringify(c.in));
  });
});

test('the Python copy finds the mentions in a text as the table says, each with its place', () => {
  cases.mentions.forEach((c, i) => {
    const found = py.mentions[i];
    assert.deepStrictEqual(found.map(({ match, board, id }) => ({ match, board, id })), c.found, JSON.stringify(c.text));
    for (const m of found) assert.strictEqual(c.text.slice(m.start, m.end), m.match);
  });
});

test('the Python copy and the web module hold the very same mention pattern', () => {
  assert.strictEqual(py.source, webIds.MENTION_SOURCE);
});

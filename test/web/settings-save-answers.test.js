const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ss = require('../../plugin/skills/web/scripts/settings-store');

// What a scratchpad: save answers, case by case. The gear's words about a <word> changed; what it saves,
// what it refuses and with which status did not, and the locked reason stays as it was.

const BS = '\\';
const VARS = `vars:\n  kanban: .\n  sprints: ..${BS}.execution${BS}sprints\n`;

function board(line) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gear-answers-'));
  const dir = path.join(root, '.kanban');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'config.yaml'), `name: w\ngroups: .groups\niterations: true\n${VARS}scratchpad: ${line}\n`);
  return dir;
}

function save(dir, value) {
  const before = ss.readSettings(dir);
  try {
    const after = ss.writeSetting(dir, { key: 'scratchpad', value, version: before.version });
    return { saved: true, locked: after.scratchpad.locked, line: fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8').split('\n').find((l) => l.startsWith('scratchpad')) };
  } catch (e) {
    return { saved: false, status: e.status, message: e.message };
  }
}

const WORD = (w) => `${w} is a word the gear does not write: it is a hand edit in config.yaml.`;

const CASES = [
  ['starter path, resave as is', '<kanban>/.scratchpad/<iteration>/<card>/', '<kanban>/.scratchpad/<iteration>/<card>/', false, 400, WORD('<kanban>')],
  ['starter path, edit a folder', '<kanban>/.scratchpad/<iteration>/<card>/', '<kanban>/.pages/<iteration>/<card>/', false, 400, WORD('<kanban>')],
  ['inside board, <card> only', '.scratchpad', '.scratchpad/<card>', false, 400, WORD('<card>')],
  ['inside board, <iteration> and <card>', '.scratchpad', '.scratchpad/<iteration>/<card>', false, 400, WORD('<card>')],
  ['outside var, resave as is', '<sprints>/<iteration>/<card>/.scratchpad', '<sprints>/<iteration>/<card>/.scratchpad', false, 400, WORD('<sprints>')],
  ['outside var, a fixed sprint', '<sprints>/<iteration>/<card>/.scratchpad', '<sprints>/sprint 497/<card>/.scratchpad', false, 400, WORD('<sprints>')],
  ['outside var, .. after the var', '<sprints>/<iteration>/<card>/.scratchpad', '<sprints>/../../evil/<card>', false, 400, /^A folder from the page sits inside the board/],
  ['outside var, an unknown word', '<sprints>/<iteration>/<card>/.scratchpad', '<nope>/<card>', false, 400, WORD('<nope>')],
  ['plain name with a bad character', '.scratchpad', 'a b/x:y', false, 400, /^x:y is not a plain folder name/],
];

for (const [what, start, value, locked, status, message] of CASES) {
  test(`scratchpad save, ${what}: refused ${status}, starts ${locked ? '' : 'not '}locked`, () => {
    const dir = board(start);
    assert.strictEqual(ss.readSettings(dir).scratchpad.locked, locked);
    const before = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
    const r = save(dir, value);
    assert.strictEqual(r.saved, false);
    assert.strictEqual(r.status, status);
    if (message instanceof RegExp) assert.match(r.message, message);
    else assert.strictEqual(r.message, message);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'), before, 'nothing written');
  });
}

test('scratchpad save, outside var dropped for a plain path: saved, the line is .scratchpad, not locked', () => {
  const dir = board('<sprints>/<iteration>/<card>/.scratchpad');
  assert.deepStrictEqual(save(dir, '.scratchpad'), { saved: true, locked: false, line: 'scratchpad: .scratchpad' });
});

test('scratchpad save, a locked path to <iteration>: starts locked, 409, with the reason as it was', () => {
  const dir = board(`..${BS}.execution${BS}sprints${BS}sprint 496${BS}<card>${BS}.scratchpad`);
  assert.strictEqual(ss.readSettings(dir).scratchpad.locked, true);
  const r = save(dir, `..${BS}.execution${BS}sprints${BS}<iteration>${BS}<card>${BS}.scratchpad`);
  assert.strictEqual(r.saved, false);
  assert.strictEqual(r.status, 409);
  assert.match(r.message, /^This folder is outside the board\. It was set by hand in config\.yaml, and only a hand edit changes it\./);
});

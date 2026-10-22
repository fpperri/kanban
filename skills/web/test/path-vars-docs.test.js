const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The docs say what ADR 0022 decided: a `vars:` block, `<repo>` and `<card>` in the logbook, scratchpad and
// todos paths. The rules live in path-vars.js and iteration-folders.js and are tested there; these tests pin
// that the places a person or an agent reads say them.

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
const flat = (text) => text.replace(/\s+/g, ' ');

const docs = flat(read('docs', 'web.md'));
const webSkill = flat(read('skills', 'web', 'SKILL.md'));
const kanbanText = read('skills', 'kanban', 'SKILL.md');
const kanbanSkill = flat(kanbanText);
const readme = flat(read('README.md'));

test('the kanban skill lists vars: among the config keys, with a comment', () => {
  const start = kanbanText.indexOf('### `config.yaml`');
  const keys = kanbanText.slice(start, kanbanText.indexOf('```', kanbanText.indexOf('```yaml', start) + 7));
  assert.match(keys, /^vars: +# .+$/m);
});

test('the kanban skill tells an agent the variables, <repo> and <card> rules', () => {
  const section = kanbanSkill.slice(kanbanSkill.indexOf('### The placeholders in the logbook, scratchpad and todo paths'), kanbanSkill.indexOf('### Groups: files that list their cards'));
  for (const part of ['`vars:`', 'letters, digits, `-` and `_`', 'relative to the board or absolute', 'not other variables', 'named like a built-in word',
    '`<repo>`', 'nearest folder at or above the board\'s folder that has a `.git` entry', 'is off', '`<card>`', '`0007.fix-login`', '`I0002.zephyr-2`',
    'the id at the front of its name', 'the segment is dropped', 'names it on stderr at startup']) {
    assert.ok(section.includes(part), part);
  }
});

test('the web doc and skill say the same, and the README names the words', () => {
  for (const [where, text] of [['the web doc', docs], ['the web skill', webSkill]]) {
    assert.match(text, /`vars:`/, where);
    assert.match(text, /`<repo>`/, where);
    assert.match(text, /`<card>`/, where);
    assert.match(text, /0007\.fix-login/, where);
    assert.match(text, /\.git/, where);
  }
  assert.match(readme, /`<card>`/);
  assert.match(readme, /`<repo>`/);
  assert.match(readme, /`vars:`/);
});

test('ADR 0022 amends 0019', () => {
  const name = fs.readdirSync(path.join(ROOT, 'docs', 'adr')).find((f) => f.startsWith('0022-'));
  const adr = read('docs', 'adr', name);
  assert.match(adr, /^Date: 2026-10-21 · Status: accepted · Amends: 0019$/m);
});

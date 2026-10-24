const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ids = require('../../plugin/skills/web/web/ids');

// The id pattern lives in the id module (docs/adr/0014): the page, the server and the
// snapshot take it from ids.js / ids.py rather than writing `_?[A-Z]*` again.

const SKILLS = path.join(__dirname, '..', '..', 'plugin', 'skills');
const read = (...parts) => fs.readFileSync(path.join(SKILLS, ...parts), 'utf8');
const PREFIX_PATTERN = /_\?\[A-Z\]\*/;

const sources = [
  ...fs.readdirSync(path.join(SKILLS, 'web', 'scripts')).filter((f) => f.endsWith('.js')).map((f) => ['web', 'scripts', f]),
  ...fs.readdirSync(path.join(SKILLS, 'web', 'web')).filter((f) => f.endsWith('.js') && f !== 'ids.js').map((f) => ['web', 'web', f]),
  ['snapshot', 'scripts', 'build_editor.py'],
];

for (const parts of sources) {
  test(`${parts.slice(1).join('/')} does not write the id prefix pattern itself`, () => {
    assert.ok(!PREFIX_PATTERN.test(read(...parts)), 'take it from the id module');
  });
}

test('the id module hands out the pattern of a whole id and of its prefix', () => {
  const whole = new RegExp(`^${ids.ID_SOURCE}$`);
  for (const ok of ['7', '0007', 'G3', '_12', 'DW845']) assert.ok(whole.test(ok), ok);
  for (const bad of ['', 'g3', 'G', '#G3', 'G3x', '1234567890123456']) assert.ok(!whole.test(bad), bad);
  const prefix = new RegExp(`^${ids.PREFIX_SOURCE}$`);
  for (const ok of ['', 'G', '_', '_G', 'DW']) assert.ok(prefix.test(ok), ok);
  for (const bad of ['g', 'G3', '#', '__']) assert.ok(!prefix.test(bad), bad);
});

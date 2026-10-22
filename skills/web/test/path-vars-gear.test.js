const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ss = require('../scripts/settings-store');

// The gear never writes `vars:` and keeps the block byte for byte through every write it does
// (docs/adr/0023).

const VARS = '# where the host keeps things\nvars:\n  cortex: ../.cortex   # the host\'s folder\n  notes: "../shared notes"\n';

function board(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-path-gear-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), text);
  return dir;
}

const read = (dir) => fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8');
const save = (dir, key, value) => ss.writeSetting(dir, { key, value, version: ss.readSettings(dir).version });

for (const eol of ['\n', '\r\n']) {
  const name = eol === '\n' ? 'LF' : 'CRLF';
  const withEol = (text) => text.replace(/\n/g, eol);

  test(`a gear write leaves the vars block as it was (${name})`, () => {
    const dir = board(withEol(`name: t\n${VARS}logbook: <cortex>/logbook\nidDigits: 4\n`));
    save(dir, 'scratchpad', '.scratchpad');
    save(dir, 'todos', '.todos');
    save(dir, 'idDigits', '5');
    save(dir, 'typesOn', false);
    save(dir, 'logbook', null);
    assert.ok(read(dir).includes(withEol(VARS)), read(dir));
    save(dir, 'logbook', 'logbook');
    assert.ok(read(dir).includes(withEol(VARS)), read(dir));
  });

  test(`a gear write with vars as the last block leaves it as it was (${name})`, () => {
    const dir = board(withEol(`name: t\n${VARS}`));
    save(dir, 'logbook', 'logbook');
    save(dir, 'groups', '.groups');
    assert.ok(read(dir).includes(withEol(VARS)), read(dir));
  });
}

test('the gear does not write vars', () => {
  const dir = board(`name: t\n${VARS}`);
  assert.throws(() => save(dir, 'vars', 'x'), { status: 400 });
  assert.ok(read(dir).includes(VARS));
});

test('the gear shows a variable path as written and does not lock it', () => {
  const dir = board('name: t\nvars:\n  work: runs\nlogbook: <work>/log\n');
  const settings = ss.readSettings(dir);
  assert.strictEqual(settings.logbook.folder, '<work>/log');
  assert.strictEqual(settings.logbook.locked, false);
});

test('a path that needs a git root and has none shows locked with the reason, and the gear refuses to write it', () => {
  const dir = board(['name: t', 'logbook: <repo>/.l', ''].join(String.fromCharCode(10)));
  const settings = ss.readSettings(dir);
  assert.strictEqual(settings.logbook.locked, true);
  assert.match(settings.logbook.reason, /needs a git root.*none was found/);
  assert.strictEqual(settings.logbook.folder, '<repo>/.l');
  assert.throws(() => save(dir, 'logbook', null), { status: 409, message: /needs a git root/ });
  assert.strictEqual(settings.scratchpad.locked, false);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Helpers the stores share are written once: the day reader, the status error, the atomic
// write, the posix path. Each store takes them from the one place; nothing declares its own copy.

const SCRIPTS = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts');
const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('the group and logbook stores and the iteration rules read a day through days.js, not their own date math', () => {
  for (const [dir, file] of [[SCRIPTS, 'group-store.js'], [SCRIPTS, 'logbook-store.js'], [WEB, 'iterations.js']]) {
    assert.ok(!/Date\.UTC\(/.test(read(dir, file)), `${file} reads days through days.js`);
  }
});

test('the group, logbook, scratchpad, todo and settings stores refuse with the one status error', () => {
  const { StatusError } = require('../../plugin/skills/web/scripts/store-common');
  const server = read(SCRIPTS, 'server.js');
  for (const file of ['group-store.js', 'logbook-store.js', 'scratchpad-store.js', 'todo-store.js', 'settings-store.js']) {
    assert.ok(!/class \w+Error/.test(read(SCRIPTS, file)), `${file} declares no error class of its own`);
  }
  assert.ok(!/(?:GroupError|LogbookError|ScratchpadError|SettingsError)/.test(server), 'the server names none of them');
  const e = new StatusError('nope', 404);
  assert.deepStrictEqual([e instanceof Error, e.message, e.status], [true, 'nope', 404]);
  const gs = require('../../plugin/skills/web/scripts/group-store');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kanban-status-'));
  assert.throws(() => gs.updateGroup(dir, 'I1', {}), (err) => err instanceof StatusError && err.status === 404);
});

test('the stores write through card-store\'s writeAtomic and name no tmp file of their own', () => {
  for (const file of ['group-store.js', 'logbook-store.js', 'scratchpad-store.js', 'todo-store.js']) {
    assert.ok(!/\.tmp`/.test(read(SCRIPTS, file)), `${file} has no tmp-and-rename of its own`);
    assert.match(read(SCRIPTS, file), /writeAtomic/, `${file} writes through writeAtomic`);
  }
  assert.strictEqual(typeof require('../../plugin/skills/web/scripts/card-store').writeAtomic, 'function');
});

test('posix is one helper, and the scratchpad store\'s listing no longer shares a name with the server\'s served files', () => {
  const declared = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.js') && /const posix = /.test(read(SCRIPTS, f)));
  assert.deepStrictEqual(declared, ['store-common.js']);
  assert.ok(!/\bpageFiles\b/.test(read(SCRIPTS, 'scratchpad-store.js')));
});

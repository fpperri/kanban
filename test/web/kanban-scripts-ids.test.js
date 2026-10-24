const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ids = require('../../plugin/skills/web/web/ids');

// The kanban skill's scripts read ids by the id rule (docs/adr/0014): the whole pair is the
// identity, plain numbers sort first and then each prefix by its number, a `waiting_for`
// entry names a card whatever its padding, and a file name takes the board's idDigits.

const SCRIPTS = path.join(__dirname, '..', '..', 'plugin', 'skills', 'kanban', 'scripts');
const bash = spawnSync('bash', ['--version']);
const skip = bash.status === 0 ? false : 'bash is not available';

// The scripts are LF in git and CRLF in a Windows checkout; bash runs the LF copy.
const lfCopies = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-scripts-'));
function run(script, args = []) {
  const copy = path.join(lfCopies, script);
  if (!fs.existsSync(copy)) fs.writeFileSync(copy, fs.readFileSync(path.join(SCRIPTS, script), 'utf8').replace(/\r\n/g, '\n'));
  const res = spawnSync('bash', [copy, ...args], { encoding: 'utf8' });
  return { status: res.status, out: res.stdout.replace(/\r\n/g, '\n'), err: res.stderr.replace(/\r\n/g, '\n') };
}

const card = (id, extra = '', title = `Card ${id}`) => `---\nid: ${id}\nstatus: todo\npriority: Normal\n${extra}---\n\n# ${title}\n`;

function board(files, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-ids-sh-'));
  if (config) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const MIXED = {
  '0002.two.card.md': card('2'),
  '0009.nine.card.md': card('9'),
  '0010.ten.card.md': card('10'),
  'DW0845.deep.card.md': card('DW845'),
  'G0003.group.card.md': card('G3', '', 'Group three'),
  'G0010.group.card.md': card('G10'),
  '_0012.loose.card.md': card('_12'),
};

test('list_all_cards sorts by the id rule: plain numbers, then each prefix by its number', { skip }, () => {
  const { status, out } = run('list_all_cards.sh', [board(MIXED)]);
  assert.strictEqual(status, 0);
  const listed = out.trim().split('\n').map((l) => l.split('|')[0]);
  assert.deepStrictEqual(listed, ['2', '9', '10', 'DW845', 'G3', 'G10', '_12']);
  assert.deepStrictEqual(listed, ids.sortIds(listed), 'the same order as the id module');
});

test('eligible_cards sorts by the id rule and keeps #G3 and #3 two cards', { skip }, () => {
  const dir = board({
    ...MIXED,
    '0004.waits-on-plain-three.card.md': card('4', 'waiting_for: [3]\n'),
    '0005.waits-on-group.card.md': card('5', 'waiting_for: [G3]\n'),
    '0006.waits-on-padded-group.card.md': card('6', 'waiting_for: [G0003]\n'),
    'G0011.group-done.card.md': card('G11', 'waiting_for: [G3, 9]\n').replace('status: todo', 'status: done'),
  });
  const { status, out } = run('eligible_cards.sh', [dir]);
  assert.strictEqual(status, 0);
  const listed = out.trim().split('\n').map((l) => l.split('|')[0]);
  assert.deepStrictEqual(listed, ['2', '4', '9', '10', 'DW845', 'G3', 'G10', '_12']);
});

test('eligible_cards frees a card whose G3 dependency is done, while card 3 is another card', { skip }, () => {
  const dir = board({
    '0003.plain-three.card.md': card('3'),
    'G0003.group-three.card.md': card('G3').replace('status: todo', 'status: done'),
    '0007.waits-on-group.card.md': card('7', 'waiting_for: [G3]\n'),
    '0008.waits-on-plain.card.md': card('8', 'waiting_for: [3]\n'),
  });
  const listed = run('eligible_cards.sh', [dir]).out.trim().split('\n').map((l) => l.split('|')[0]);
  assert.deepStrictEqual(listed, ['3', '7']);
});

test('show_waiting and view_board name a G3 dependency under its whole id, however it is padded', { skip }, () => {
  const dir = board({
    'G0003.group.card.md': card('G3', '', 'Group three'),
    '0005.waits.card.md': card('5', 'waiting_for: [G0003]\n', 'Waits on the group'),
    '0006.plain.card.md': card('6', 'waiting_for: [3]\n', 'Waits on a missing card'),
  });
  const waiting = run('show_waiting.sh', [dir]).out;
  assert.match(waiting, /#5 +\[todo\] +Waits on the group\n  waiting on: #G0003 \(todo\)/);
  assert.doesNotMatch(waiting, /Waits on a missing card/);
  const view = run('view_board.sh', [dir]).out;
  assert.match(view, /#5 Waits on the group \[waiting: #G0003\]/);
  assert.match(view, /#G3 Group three/);
  assert.doesNotMatch(view, /#6 .*\[waiting/);
});

test('migrate_card_names pads a prefixed id to idDigits and leaves a file already in form', { skip }, () => {
  const dir = board({
    '7.seven.card.md': card('7'),
    'G3.three.card.md': card('G3'),
    'G0010.ten.card.md': card('G10'),
    '9x-weird.card.md': card('_12'),
  }, 'idDigits: 5\n');
  const dry = run('migrate_card_names.sh', [dir]);
  assert.strictEqual(dry.status, 0, dry.err);
  assert.match(dry.out, /would rename: 7\.seven\.card\.md -> 00007\.seven\.card\.md/);
  assert.match(dry.out, /would rename: G3\.three\.card\.md -> G00003\.three\.card\.md/);
  assert.match(dry.out, /would rename: G0010\.ten\.card\.md -> G00010\.ten\.card\.md/);
  assert.match(dry.out, /would rename: 9x-weird\.card\.md -> _00012\.9x-weird\.card\.md/, 'a digit-leading slug is not an id prefix');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['7.seven.card.md', '9x-weird.card.md', 'G0010.ten.card.md', 'G3.three.card.md', 'config.yaml']);
  const applied = run('migrate_card_names.sh', [dir, '--apply']);
  assert.strictEqual(applied.status, 0, applied.err);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['00007.seven.card.md', 'G00003.three.card.md', 'G00010.ten.card.md', '_00012.9x-weird.card.md', 'config.yaml']);
  const again = run('migrate_card_names.sh', [dir, '--apply']);
  assert.match(again.out, /done — 0 renamed, 0 skipped/);
});

test('migrate_card_names skips an id wider than idDigits and an id that is no id, and says so', { skip }, () => {
  const dir = board({ '1.wide.card.md': card('G12345'), '2.none.card.md': card('g3'), '3.ok.card.md': card('3') });
  const res = run('migrate_card_names.sh', [dir, '--apply']);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.err, /SKIP \(id G12345 exceeds the 4-digit prefix\)/);
  assert.match(res.err, /SKIP \(no id\)/);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['0003.ok.card.md', '1.wide.card.md', '2.none.card.md']);
});

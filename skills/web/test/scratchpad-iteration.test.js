const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sp = require('../scripts/scratchpad-store');

// The scratchpad path may hold <iteration> (docs/adr/0019): a page goes to the iteration its card or
// group is a member of, else the one holding the day it is first written, else the segment is dropped;
// a page that exists is read and written where it is.

function tmpBoard(config = 'name: t\nscratchpad: pads/<iteration>/.scratchpad\ngroups: .groups\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-pad-iter-'));
  fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

function iteration(dir, id, fileName, start, end, cards = []) {
  const folder = path.join(dir, '.groups', 'iteration');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${fileName}.md`), `---\nid: ${id}\nname: x\n${start ? `start_date: ${start}\n` : ''}${end ? `end_date: ${end}\n` : ''}cards: [${cards.join(', ')}]\n---\n`);
}

const at = (dir, ...parts) => path.join(dir, ...parts);
const list = (p) => (fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
const pads = (dir) => list(at(dir, 'pads'));
const TODAY = '2026-10-16';

test('a card that is a member of an iteration keeps its page in that iteration\'s folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06', [8]);
  const pad = sp.writePad(dir, '7', 'hello', { today: '2026-12-01' });
  assert.deepStrictEqual(list(at(dir, 'pads', '0005.sprint-496', '.scratchpad')), ['0007.scratchpad.md']);
  assert.deepStrictEqual(pad, { target: '7', exists: true, file: '0007.scratchpad.md', folder: 'pads/0005.sprint-496/.scratchpad', refs: [], body: 'hello' });
});

test('a card in several iterations: the one that started first', () => {
  const dir = tmpBoard();
  iteration(dir, '6', '0006.later', '2026-10-14', '2026-10-30', [7]);
  iteration(dir, '5', '0005.earlier', '2026-10-12', '2026-10-23', [7]);
  sp.writePad(dir, '7', 'x', { today: TODAY });
  assert.deepStrictEqual(pads(dir), ['0005.earlier']);
});

test('a card in no iteration goes to the iteration holding the day it is first written', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06');
  sp.writePad(dir, '7', 'x', { today: '2026-10-27' });
  assert.deepStrictEqual(pads(dir), ['0006.sprint-497']);
});

test('with no iteration at all, the segment is dropped', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  const pad = sp.writePad(dir, '7', 'x', { today: '2026-11-20' });
  assert.deepStrictEqual(pads(dir), ['.scratchpad']);
  assert.strictEqual(pad.folder, 'pads/.scratchpad');
  assert.deepStrictEqual(pads(tmpBoard('name: t\nscratchpad: pads/<iteration>/.scratchpad\n')), []);
});

test('an iteration\'s own page goes to its own folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23');
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06');
  sp.writePad(dir, '6', 'x', { today: TODAY });
  assert.deepStrictEqual(pads(dir), ['0006.sprint-497']);
});

test('a page that exists is read and written where it is, even after its card changes iteration', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  sp.writePad(dir, '7', 'first', { today: TODAY });
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', []);
  iteration(dir, '6', '0006.sprint-497', '2026-10-26', '2026-11-06', [7]);
  assert.strictEqual(sp.readPad(dir, '7', { today: '2026-10-27' }).body, 'first');
  const again = sp.writePad(dir, '7', 'second', { today: '2026-10-27' });
  assert.strictEqual(again.body, 'second');
  assert.strictEqual(again.folder, 'pads/0005.sprint-496/.scratchpad');
  assert.deepStrictEqual(pads(dir), ['0005.sprint-496']);
});

test('a page not written yet reads as empty and names the folder a write would use', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  assert.deepStrictEqual(sp.readPad(dir, '7', { today: TODAY }), { target: '7', exists: false, file: '0007.scratchpad.md', folder: 'pads/0005.sprint-496/.scratchpad', refs: [], body: '' });
  assert.deepStrictEqual(pads(dir), []);
});

test('the iteration folder that exists under another name for the id is the one used', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.new-name', '2026-10-12', '2026-10-23', [7]);
  fs.mkdirSync(at(dir, 'pads', '0005.old-name', '.scratchpad'), { recursive: true });
  sp.writePad(dir, '7', 'x', { today: TODAY });
  assert.deepStrictEqual(list(at(dir, 'pads', '0005.old-name', '.scratchpad')), ['0007.scratchpad.md']);
});

test('reading finds a page in any folder, and lists every target of every folder', () => {
  const dir = tmpBoard();
  const put = (rel, text) => {
    fs.mkdirSync(at(dir, ...rel.slice(0, -1)), { recursive: true });
    fs.writeFileSync(at(dir, ...rel), text);
  };
  put(['pads', '0003.gone', '.scratchpad', '0002.scratchpad.md'], 'old');
  put(['pads', '.scratchpad', '0010.scratchpad.md'], 'loose');
  put(['pads', 'notes', '.scratchpad', '0099.scratchpad.md'], 'not an iteration folder');
  assert.deepStrictEqual(sp.listTargets(dir), ['2', '10']);
  assert.strictEqual(sp.readPad(dir, '2').body, 'old');
  assert.strictEqual(sp.readPad(dir, '10').body, 'loose');
  assert.strictEqual(sp.readPad(dir, '99').exists, false);
});

test('deleting a target\'s pages sweeps every folder', () => {
  const dir = tmpBoard();
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  sp.writePad(dir, '7', 'in', { today: TODAY });
  fs.mkdirSync(at(dir, 'pads', '.scratchpad'), { recursive: true });
  fs.writeFileSync(at(dir, 'pads', '.scratchpad', '0007.scratchpad.md'), 'loose');
  fs.writeFileSync(at(dir, 'pads', '.scratchpad', '0008.scratchpad.md'), 'other');
  assert.strictEqual(sp.deleteTargetFiles(dir, '7'), 2);
  assert.deepStrictEqual(sp.listTargets(dir), ['8']);
});

test('an unknown placeholder is an ordinary folder name and never an error', () => {
  const dir = tmpBoard('name: t\nscratchpad: pads/<sprint>/.scratchpad\n');
  assert.deepStrictEqual(sp.listTargets(dir), []);
  assert.strictEqual(sp.readPad(dir, '7').exists, false);
  if (process.platform === 'win32') return;
  sp.writePad(dir, '7', 'x');
  assert.deepStrictEqual(list(at(dir, 'pads', '<sprint>', '.scratchpad')), ['0007.scratchpad.md']);
});

test('a path without the placeholder is one folder and its records carry no folder', () => {
  const dir = tmpBoard('name: t\nscratchpad: .scratchpad\ngroups: .groups\n');
  iteration(dir, '5', '0005.sprint-496', '2026-10-12', '2026-10-23', [7]);
  assert.deepStrictEqual(sp.writePad(dir, '7', 'x'), { target: '7', exists: true, file: '0007.scratchpad.md', refs: [], body: 'x' });
  assert.deepStrictEqual(list(at(dir, '.scratchpad')), ['0007.scratchpad.md']);
});

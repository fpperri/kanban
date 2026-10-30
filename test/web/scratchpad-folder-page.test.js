const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The folder list is drawn only when the board's scratchpad path holds <card>; scratchpad-ui.js asks
// scratchFolderOn() and appends scratchFolderPanel() under the box. The panel itself is exercised in the
// browser (scenarios/scratchpad-folder.js).

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');

function on(folder) {
  const sandbox = { state: { scratchpad: folder === null ? null : { folder, targets: [] } }, document: {}, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(read('scratchpad-folder-ui.js'), sandbox);
  return vm.runInContext('scratchFolderOn()', sandbox);
}

test('the folder list shows only for a scratchpad path with <card> as a whole segment', () => {
  assert.strictEqual(on('.scratchpad/<card>'), true);
  assert.strictEqual(on('../work/<iteration>/<card>/.scratchpad'), true);
  assert.strictEqual(on('.scratchpad'), false);
  assert.strictEqual(on('.scratchpad/<iteration>'), false);
  assert.strictEqual(on('x<card>'), false);
  assert.strictEqual(on(null), false);
});

test('scratchpad-ui.js draws the list under the box only when scratchFolderOn() says so', () => {
  const ui = read('scratchpad-ui.js');
  assert.ok(/if \(scratchFolderOn\(\) && notesCard\(target\) !== null\) wrap\.append\(scratchFolderPanel\(target/.test(ui));
});

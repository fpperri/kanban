const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const path = require('node:path');

const { parseArgs, selectScenarios, chromeArgs, keyEvents, contextMenuExpr, serverScriptOf } = require('./browser/harness');

// The browser runner's harness is the part that does not need a browser: how
// the command line picks scenarios, how Chrome is started, and how a key press
// and a right-click are built. What the harness does with a scenario that
// throws or hangs is in browser-scenario-loop.test.js; what it does with
// processes is in browser-cleanup.test.js.

const names = (list) => list.map((s) => s.name);
const ALL = [{ name: 'graph' }, { name: 'smoke' }, { name: 'third' }];

test('no arguments run everything, with no screenshots and no fault', () => {
  assert.deepStrictEqual(parseArgs([]), { shots: null, only: [], reverse: false, list: false, fault: null, plugin: null });
});

test('--shots takes a directory and resolves it', () => {
  assert.strictEqual(parseArgs(['--shots', 'out']).shots, path.resolve('out'));
});

test('--only names scenarios, comma separated or repeated', () => {
  assert.deepStrictEqual(parseArgs(['--only', 'graph']).only, ['graph']);
  assert.deepStrictEqual(parseArgs(['--only', 'graph,smoke']).only, ['graph', 'smoke']);
  assert.deepStrictEqual(parseArgs(['--only', 'graph', '--only', 'smoke']).only, ['graph', 'smoke']);
});

test('--reverse and --list are switches', () => {
  assert.strictEqual(parseArgs(['--reverse']).reverse, true);
  assert.strictEqual(parseArgs(['--list']).list, true);
});

test('--plugin names another checkout of the plugin, whose server serves the boards, and resolves it', () => {
  assert.strictEqual(parseArgs(['--plugin', 'older']).plugin, path.resolve('older'));
  assert.throws(() => parseArgs(['--plugin']), /--plugin needs a plugin checkout/);
});

test('the server script is the one of this checkout unless --plugin names another (one from before the plugin folder too), and one with no server is refused', () => {
  const here = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'scripts', 'server.js');
  assert.strictEqual(serverScriptOf(null), here);
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-'));
  try {
    assert.throws(() => serverScriptOf(dir), /no server at .*server\.js/);
    fs.mkdirSync(path.join(dir, 'plugin', 'skills', 'web', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin', 'skills', 'web', 'scripts', 'server.js'), '');
    assert.strictEqual(serverScriptOf(dir), path.join(dir, 'plugin', 'skills', 'web', 'scripts', 'server.js'));
    const older = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-plugin-'));
    try {
      fs.mkdirSync(path.join(older, 'skills', 'web', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(older, 'skills', 'web', 'scripts', 'server.js'), '');
      assert.strictEqual(serverScriptOf(older), path.join(older, 'skills', 'web', 'scripts', 'server.js'));
    } finally {
      fs.rmSync(older, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--fault forces a scenario to throw or kills Chrome mid-run', () => {
  assert.deepStrictEqual(parseArgs(['--fault', 'throw:graph']).fault, { kind: 'throw', scenario: 'graph' });
  assert.deepStrictEqual(parseArgs(['--fault', 'kill-chrome']).fault, { kind: 'kill-chrome' });
  assert.throws(() => parseArgs(['--fault', 'explode']), /unknown fault/);
  assert.throws(() => parseArgs(['--fault', 'throw:']), /unknown fault/);
});

test('an unknown argument, or an option with no value, is refused', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown argument: --nope/);
  assert.throws(() => parseArgs(['--only']), /--only needs a scenario name/);
  assert.throws(() => parseArgs(['--shots']), /--shots needs a directory/);
});

test('naming one scenario runs that scenario alone', () => {
  assert.deepStrictEqual(names(selectScenarios(ALL, { only: ['smoke'] })), ['smoke']);
});

test('naming several scenarios runs them in the registry order', () => {
  assert.deepStrictEqual(names(selectScenarios(ALL, { only: ['third', 'graph'] })), ['graph', 'third']);
});

test('an unknown scenario name is refused and the known names are listed', () => {
  assert.throws(() => selectScenarios(ALL, { only: ['nope'] }), /unknown scenario 'nope'.*graph, smoke, third/);
});

test('--reverse runs the same scenarios last to first', () => {
  assert.deepStrictEqual(names(selectScenarios(ALL, { only: [], reverse: true })), ['third', 'smoke', 'graph']);
  assert.deepStrictEqual(names(selectScenarios(ALL, { only: ['graph', 'third'], reverse: true })), ['third', 'graph']);
});

const base = { cdpPort: 9222, profileDir: '/tmp/profile' };

test('Chrome starts with its sandbox when nothing asks otherwise', () => {
  assert.ok(!chromeArgs({ ...base, env: {}, uid: 1000 }).includes('--no-sandbox'));
});

test('Chrome drops its sandbox for root, as before', () => {
  assert.ok(chromeArgs({ ...base, env: {}, uid: 0 }).includes('--no-sandbox'));
});

test('the sandbox switch drops the sandbox for a user who is not root', () => {
  assert.ok(chromeArgs({ ...base, env: { KANBAN_BROWSER_NO_SANDBOX: '1' }, uid: 1000 }).includes('--no-sandbox'));
});

test('a switch that is empty, 0 or false leaves the sandbox on', () => {
  for (const v of ['', '0', 'false']) {
    assert.ok(!chromeArgs({ ...base, env: { KANBAN_BROWSER_NO_SANDBOX: v }, uid: 1000 }).includes('--no-sandbox'), `value ${JSON.stringify(v)}`);
  }
});

test('Chrome is headless on the debug port and profile it is given, and opens about:blank last', () => {
  const args = chromeArgs({ ...base, env: {}, uid: 1000 });
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--remote-debugging-port=9222'));
  assert.ok(args.includes('--user-data-dir=/tmp/profile'));
  assert.strictEqual(args[args.length - 1], 'about:blank');
});

test('a plain key is a key down with its text and a key up', () => {
  const [down, up] = keyEvents('a');
  assert.deepStrictEqual(down, { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0, text: 'a' });
  assert.deepStrictEqual(up, { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0 });
});

test('Escape and the arrows carry their key codes and no text, Enter types a carriage return', () => {
  assert.deepStrictEqual(keyEvents('Escape')[0], { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, modifiers: 0 });
  assert.strictEqual(keyEvents('Enter')[0].windowsVirtualKeyCode, 13);
  assert.strictEqual(keyEvents('Enter')[0].text, '\r');
  assert.strictEqual(keyEvents('ArrowLeft')[0].windowsVirtualKeyCode, 37);
  assert.strictEqual(keyEvents('ContextMenu')[0].windowsVirtualKeyCode, 93);
  assert.strictEqual(keyEvents('F10')[0].windowsVirtualKeyCode, 121);
});

test('modifiers add up to the protocol bit mask: alt 1, ctrl 2, meta 4, shift 8', () => {
  assert.strictEqual(keyEvents('a', { alt: true })[0].modifiers, 1);
  assert.strictEqual(keyEvents('a', { ctrl: true })[0].modifiers, 2);
  assert.strictEqual(keyEvents('a', { meta: true })[0].modifiers, 4);
  assert.strictEqual(keyEvents('a', { shift: true })[0].modifiers, 8);
  assert.strictEqual(keyEvents('F10', { shift: true })[0].modifiers, 8);
  assert.strictEqual(keyEvents('a', { ctrl: true, shift: true })[0].modifiers, 10);
});

test('a key held with ctrl or meta types no text, one held with shift does', () => {
  assert.strictEqual('text' in keyEvents('a', { ctrl: true })[0], false);
  assert.strictEqual('text' in keyEvents('a', { meta: true })[0], false);
  assert.strictEqual(keyEvents('{', { shift: true })[0].text, '{');
});

test('the slice keys carry the code of the physical key', () => {
  assert.strictEqual(keyEvents('[')[0].code, 'BracketLeft');
  assert.strictEqual(keyEvents('{', { shift: true })[0].code, 'BracketLeft');
  assert.strictEqual(keyEvents(']')[0].code, 'BracketRight');
  assert.strictEqual(keyEvents('/')[0].code, 'Slash');
});

test('? is Shift with the slash key, as a US keyboard types it, and carries its text', () => {
  const [down, up] = keyEvents('?', { shift: true });
  assert.deepStrictEqual(down, { type: 'keyDown', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8, text: '?' });
  assert.deepStrictEqual(up, { type: 'keyUp', key: '?', code: 'Slash', windowsVirtualKeyCode: 191, modifiers: 8 });
});

test('a key the table does not know is refused rather than sent as nothing', () => {
  assert.throws(() => keyEvents('Hyper'), /unknown key 'Hyper'/);
});

// A right-click is a synthetic contextmenu event dispatched through the page,
// because a real right-button press fires contextmenu at different moments on
// different systems. The expression is run here against a stub document.
function runContextMenu(expr, el) {
  const fired = [];
  const sandbox = {
    document: { querySelector: (sel) => (sel === el.selector ? el : null) },
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    window: {},
  };
  el.dispatchEvent = (e) => { fired.push(e); return true; };
  const out = vm.runInNewContext(expr, sandbox);
  return { fired, out };
}

test('a right-click on a selector fires a bubbling, cancelable contextmenu at the middle of the element', () => {
  const el = { selector: '.graph-node[data-id="3"]', getBoundingClientRect: () => ({ left: 100, top: 40, width: 20, height: 10 }) };
  const { fired, out } = runContextMenu(contextMenuExpr(el.selector), el);
  assert.strictEqual(fired.length, 1);
  assert.strictEqual(fired[0].type, 'contextmenu');
  assert.strictEqual(fired[0].bubbles, true);
  assert.strictEqual(fired[0].cancelable, true);
  assert.strictEqual(fired[0].button, 2);
  assert.strictEqual(fired[0].buttons, 2);
  assert.deepStrictEqual([fired[0].clientX, fired[0].clientY], [110, 45]);
  assert.strictEqual(out, true);
});

test('a right-click on a missing element reports it instead of throwing inside the page', () => {
  const el = { selector: '.here', getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) };
  const { fired, out } = runContextMenu(contextMenuExpr('.missing'), el);
  assert.strictEqual(fired.length, 0);
  assert.strictEqual(out, false);
});

test('a right-click can name the point it lands on, for an empty canvas', () => {
  const el = { selector: '.graph-canvas', getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 300 }) };
  const { fired } = runContextMenu(contextMenuExpr(el.selector, { x: 12, y: 34 }), el);
  assert.deepStrictEqual([fired[0].clientX, fired[0].clientY], [12, 34]);
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guard = require('../web/key-guard');
const hotkey = require('../web/search-hotkey');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

function fn(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  const end = appSrc.indexOf('\n}', start);
  assert.ok(start !== -1 && end !== -1, `${name} found in app.js`);
  return appSrc.slice(start, end + 2);
}

const field = (tagName) => ({ tagName, isContentEditable: false });
const SELECTOR = Object.fromEntries(guard.KEY_GUARD_SURFACES.map((s) => [s.name, s.selector]));

// The two search-box key handlers app.js registers, run against a fake page:
// which surfaces are open, what has focus, what the box holds.
function page({ active = field('BODY'), open = [], value = '' } = {}) {
  const log = { focused: 0, renders: 0, selection: null };
  const input = {
    value,
    focus() { log.focused++; },
    setSelectionRange(a, b) { log.selection = [a, b]; },
  };
  const sandbox = {
    document: { activeElement: active, querySelector: (sel) => (open.includes(sel) ? { id: 'open' } : null) },
    $: (sel) => (sel === '#search-input' ? input : null),
    renderBoard() { log.renders++; },
    ...guard,
    searchHotkeyPrefill: hotkey.searchHotkeyPrefill,
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('onSearchSlashKey') + '\n' + fn('onSearchChordKey'), sandbox);
  return { sandbox, input, log };
}

function press(p, handler, key, mods = {}) {
  const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, ...mods, preventDefault() { this.defaultPrevented = true; } };
  p.sandbox[handler](e);
  return e;
}

test('/ focuses the search box when nothing is typing and nothing is open', () => {
  const p = page();
  const e = press(p, 'onSearchSlashKey', '/');
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(p.log.focused, 1);
});

test('/ leaves focus alone behind an open dialog', () => {
  const p = page({ active: field('BUTTON'), open: [SELECTOR.dialog] });
  const e = press(p, 'onSearchSlashKey', '/');
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(p.log.focused, 0);
});

test('/ does nothing while a card menu, the notifications panel or the preferences sheet is open', () => {
  for (const name of ['menu', 'notifications', 'preferences']) {
    const p = page({ open: [SELECTOR[name]] });
    const e = press(p, 'onSearchSlashKey', '/');
    assert.strictEqual(e.defaultPrevented, false, name);
    assert.strictEqual(p.log.focused, 0, name);
  }
});

test('/ does nothing while a field has focus', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const p = page({ active: field(tag) });
    press(p, 'onSearchSlashKey', '/');
    assert.strictEqual(p.log.focused, 0, tag);
  }
});

test('/ still works with the search panel open', () => {
  const p = page({ open: ['.search-panel:not(.hidden)'] });
  press(p, 'onSearchSlashKey', '/');
  assert.strictEqual(p.log.focused, 1);
});

test('only / is read by the slash handler', () => {
  const p = page();
  const e = press(p, 'onSearchSlashKey', 'a');
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(p.log.focused, 0);
});

test('Ctrl+F from a text field outside any dialog still focuses the search box and prefills #', () => {
  const p = page({ active: field('INPUT') });
  const e = press(p, 'onSearchChordKey', 'f', { ctrlKey: true });
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(p.input.value, '#');
  assert.strictEqual(p.log.focused, 1);
  assert.deepStrictEqual(p.log.selection, [1, 1]);
  assert.strictEqual(p.log.renders, 1);
});

test('Ctrl+F on a box that holds a query selects it instead of clobbering it', () => {
  const p = page({ value: 'status:todo' });
  press(p, 'onSearchChordKey', 'f', { ctrlKey: true });
  assert.strictEqual(p.input.value, 'status:todo');
  assert.deepStrictEqual(p.log.selection, [0, 11]);
  assert.strictEqual(p.log.renders, 0);
});

test('Ctrl+F leaves the browser find bar alone behind an open dialog', () => {
  const p = page({ active: field('BUTTON'), open: [SELECTOR.dialog] });
  const e = press(p, 'onSearchChordKey', 'f', { ctrlKey: true });
  assert.strictEqual(e.defaultPrevented, false);
  assert.strictEqual(p.log.focused, 0);
  assert.strictEqual(p.input.value, '');
});

test('Ctrl+F leaves the browser find bar alone while a card menu, the notifications panel or the preferences sheet is open', () => {
  for (const name of ['menu', 'notifications', 'preferences']) {
    const p = page({ open: [SELECTOR[name]] });
    const e = press(p, 'onSearchChordKey', 'f', { ctrlKey: true });
    assert.strictEqual(e.defaultPrevented, false, name);
    assert.strictEqual(p.log.focused, 0, name);
  }
});

test('Ctrl+F still works with the search panel open', () => {
  const p = page({ open: ['.search-panel:not(.hidden)'] });
  const e = press(p, 'onSearchChordKey', 'f', { ctrlKey: true });
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(p.log.focused, 1);
});

test('app.js registers both handlers on the document keydown', () => {
  assert.match(appSrc, /document\.addEventListener\('keydown', onSearchSlashKey\)/);
  assert.match(appSrc, /document\.addEventListener\('keydown', onSearchChordKey\)/);
});

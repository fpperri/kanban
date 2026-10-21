const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const guard = require('../web/key-guard');

// e on the card details opens the card's edit form, as the details' Edit button does. It reads the key
// guard the way n does: off in a field and behind any popup but the details (NOTES_DETAIL), and it is
// the notes palette's while that is up. The handler runs here in a vm against a stand-in page.

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8');

function fn(name) {
  const start = appSrc.indexOf('function ' + name + '(');
  const end = appSrc.indexOf('\n}', start);
  assert.ok(start !== -1 && end !== -1, `${name} found in app.js`);
  return appSrc.slice(start, end + 2);
}

const OTHER_DIALOG = '.modal-backdrop:not(.hidden):not(#detail-modal)';
const field = (tagName) => ({ tagName, isContentEditable: false });

function page({ detail = '7', archived = false, hidden = false, active = field('BODY'), open = [], palette = null } = {}) {
  const log = { edits: 0 };
  const sandbox = {
    document: { activeElement: active, querySelector: (sel) => (open.includes(sel) ? { id: 'open' } : null) },
    $: () => ({ classList: { contains: (c) => c === 'hidden' && hidden } }),
    currentDetailId: detail,
    currentDetailArchived: archived,
    NOTES_DETAIL: '#detail-modal',
    notesUi: { sub: palette },
    editFromDetail() { log.edits++; },
    ...guard,
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('onDetailEditKey'), sandbox);
  return { sandbox, log };
}

function press(p, over = {}) {
  const e = { key: 'e', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...over };
  p.sandbox.onDetailEditKey(e);
  return e;
}

test('e with the details open and nothing else up opens the edit form', () => {
  const p = page();
  const e = press(p);
  assert.strictEqual(p.log.edits, 1);
  assert.strictEqual(e.defaultPrevented, true);
});

test('E without Shift held is read too, as the other letter keys are', () => {
  const p = page();
  press(p, { key: 'E' });
  assert.strictEqual(p.log.edits, 1);
});

test('e does nothing with no details open, or with the details hidden', () => {
  for (const over of [{ detail: null }, { hidden: true }]) {
    const p = page(over);
    const e = press(p);
    assert.strictEqual(p.log.edits, 0, JSON.stringify(over));
    assert.strictEqual(e.defaultPrevented, false);
  }
});

test('e does nothing on an archived card, whose Edit button is hidden', () => {
  const p = page({ archived: true });
  const e = press(p);
  assert.strictEqual(p.log.edits, 0);
  assert.strictEqual(e.defaultPrevented, false);
});

test('e in a field types an e', () => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const p = page({ active: field(tag) });
    const e = press(p);
    assert.strictEqual(p.log.edits, 0, tag);
    assert.strictEqual(e.defaultPrevented, false, tag);
  }
});

test('e does nothing while a popup besides the details is up: the edit form, a menu, the preferences sheet', () => {
  for (const open of [[OTHER_DIALOG], ['#context-menu:not(.hidden)'], ['#prefs-sheet:not(.hidden)'], ['#notif-modal:not(.hidden)']]) {
    const p = page({ open });
    const e = press(p);
    assert.strictEqual(p.log.edits, 0, open[0]);
    assert.strictEqual(e.defaultPrevented, false);
  }
});

test('e is the notes palette\'s while it is up: it never reaches the details', () => {
  const p = page({ palette: { kind: 'card', id: '7' } });
  const e = press(p);
  assert.strictEqual(p.log.edits, 0);
  assert.strictEqual(e.defaultPrevented, false);
});

test('a chord or a held e is not the key', () => {
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { key: 'f' }]) {
    const p = page();
    press(p, over);
    assert.strictEqual(p.log.edits, 0, JSON.stringify(over));
  }
});

test('app.js registers the handler on the document keydown, reading the details exception notes-palette.js names', () => {
  assert.match(appSrc, /document\.addEventListener\('keydown', onDetailEditKey\)/);
  assert.match(fn('onDetailEditKey'), /keyGuardOff\(document, NOTES_DETAIL\)/);
});

test('the details\' Edit button names the key in its title and keeps its accessible name', () => {
  assert.match(html, /id="detail-edit-btn" class="icon-btn" title="Edit card fields \(e\)" aria-label="Edit card fields" aria-keyshortcuts="e"/);
});

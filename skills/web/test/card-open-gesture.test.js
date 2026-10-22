const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// In a view whose plain click selects a card (the Graph always, any other view
// when the preferences sheet says so), Enter on a focused card opens it. The one
// key handler that carries this out is run here against a fake page, with the
// real decision from selection.js. A double click is the second click of the card
// click handler, not an event of its own (card-click-page.test.js drives it).

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function gesturePage({ view = 'board', click = {}, dragging = {}, matched = null, surface = null } = {}) {
  const calls = { open: [] };
  const sandbox = {
    ...require('../web/selection'),
    loadViewMode: () => view,
    loadPrefsState: () => ({ click }),
    ...require('../web/search-enter'),
    searchEnterMatchIds: () => matched,
    openCard: (id) => { calls.open.push(id); },
    document: {}, keyGuardSurface: () => surface,
    isDragging: false, ganttDrag: null, calTimeDrag: null,
    calls,
  };
  Object.assign(sandbox, dragging);
  vm.createContext(sandbox);
  vm.runInContext(fn('onCardOpenKey'), sandbox);
  return sandbox;
}

// An element and the selectors it sits inside, the way closest() reads them. The
// card itself is `card`; `inside` names what else the target is within.
function targetIn({ card = true, inside = [], isCard = false } = {}) {
  const el = { dataset: { id: '7' } };
  const chain = { '.card-el': card ? el : null };
  for (const sel of inside) chain[sel] = {};
  const target = {
    closest(list) {
      for (const sel of list.split(',').map((s) => s.trim())) if (chain[sel]) return chain[sel];
      return null;
    },
  };
  if (isCard) { el.closest = target.closest; return Object.assign(el, { dataset: el.dataset }); }
  return target;
}

const enter = (target, extra = {}) => ({
  type: 'keydown', key: 'Enter', repeat: false, target, shiftKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra,
});

const SELECTS = { board: 'selects', map: 'selects', gantt: 'selects', calendar: 'selects' };

test('Enter on a focused card opens it in each view the preferences set to selects, and keeps the key from doing anything else', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const page = gesturePage({ view, click: SELECTS });
    const e = enter(targetIn({ isCard: true }));
    page.onCardOpenKey(e);
    assert.deepStrictEqual(page.calls.open, ['7'], view);
    assert.strictEqual(e.defaultPrevented, true, view);
  }
});

test('in a view whose plain click opens the card, Enter adds nothing', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const page = gesturePage({ view });
    page.onCardOpenKey(enter(targetIn({ isCard: true })));
    assert.deepStrictEqual(page.calls.open, [], view);
  }
});

test('a view left at opens stays at opens when another is set to selects', () => {
  const page = gesturePage({ view: 'calendar', click: { board: 'selects' } });
  page.onCardOpenKey(enter(targetIn({ isCard: true })));
  assert.deepStrictEqual(page.calls.open, []);
});

test('the Graph keeps its own Enter: the handler leaves a Graph node alone', () => {
  const page = gesturePage({ view: 'graph' });
  page.onCardOpenKey(enter(targetIn({ isCard: true, inside: ['.graph-node'] })));
  assert.deepStrictEqual(page.calls.open, []);
});

test('Enter only counts on the card itself: on a button or a field inside it, it belongs to that control', () => {
  const page = gesturePage({ click: SELECTS });
  for (const control of ['button', 'select', 'input', 'a']) {
    const e = enter(targetIn({ inside: [control] }));
    page.onCardOpenKey(e);
    assert.strictEqual(e.defaultPrevented, false, control);
  }
  const inner = enter(targetIn());
  page.onCardOpenKey(inner);
  assert.strictEqual(inner.defaultPrevented, false, 'a child of the card, not the card');
  assert.deepStrictEqual(page.calls.open, []);
});

test('Enter on a roll-up bar inside a card opens nothing', () => {
  const page = gesturePage({ click: SELECTS });
  page.onCardOpenKey(enter(targetIn({ isCard: true, inside: ['.rollup'] })));
  assert.deepStrictEqual(page.calls.open, []);
});

test('Enter held down opens once, and other keys open nothing', () => {
  const page = gesturePage({ click: SELECTS });
  page.onCardOpenKey(enter(targetIn({ isCard: true }), { repeat: true }));
  for (const key of [' ', 'Escape', 'a', 'Tab']) page.onCardOpenKey(enter(targetIn({ isCard: true }), { key }));
  assert.deepStrictEqual(page.calls.open, []);
});

test('a held Shift, Ctrl or Cmd belongs to building a selection, so Enter opens nothing', () => {
  const page = gesturePage({ click: SELECTS });
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey']) {
    page.onCardOpenKey(enter(targetIn({ isCard: true }), { [mod]: true }));
  }
  assert.deepStrictEqual(page.calls.open, []);
});

test('nothing opens from empty space, or while a drag is under way', () => {
  const page = gesturePage({ click: SELECTS });
  page.onCardOpenKey(enter(targetIn({ card: false })));
  assert.deepStrictEqual(page.calls.open, []);
  for (const dragging of [{ isDragging: true }, { ganttDrag: {} }, { calTimeDrag: {} }]) {
    const busy = gesturePage({ click: SELECTS, dragging });
    busy.onCardOpenKey(enter(targetIn({ isCard: true })));
    assert.deepStrictEqual(busy.calls.open, [], JSON.stringify(dragging));
  }
});

test('Enter opens nothing behind an open popup: the key guard surface check turns it off', () => {
  for (const surface of ['menu', 'dialog', 'notifications', 'preferences']) {
    const page = gesturePage({ click: SELECTS, matched: new Set(['7']), surface });
    const e = enter(targetIn({ isCard: true }));
    page.onCardOpenKey(e);
    assert.deepStrictEqual(page.calls.open, [], surface);
    assert.strictEqual(e.defaultPrevented, false, surface);
  }
});

test('the page registers the key handler on the document and no double click handler: opening rides the click', () => {
  assert.match(appSrc, /document\.addEventListener\('keydown', onCardOpenKey\);/);
  assert.doesNotMatch(appSrc, /document\.addEventListener\('dblclick'/);
});

test('a double click on a Calendar card is not a create gesture: the Calendar keeps skipping cards', () => {
  const m = appSrc.match(/\$\('#calendar-view'\)\.addEventListener\('dblclick', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(m, 'the Calendar create handler is found');
  assert.match(m[0], /if \(e\.target\.closest\('\.card-el'\)\) return;/);
});

test('Enter on the one card a search matched opens it in every view, whatever the click preference says', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    for (const click of [{}, SELECTS]) {
      const page = gesturePage({ view, click, matched: new Set(['7']) });
      const e = enter(targetIn({ isCard: true }));
      page.onCardOpenKey(e);
      assert.deepStrictEqual(page.calls.open, ['7'], view);
      assert.strictEqual(e.defaultPrevented, true, view);
    }
  }
});

test('with several matches, or a match that is another card, Enter does what it did before', () => {
  for (const matched of [new Set(['7', '8']), new Set(['8']), null]) {
    const plain = gesturePage({ view: 'board', matched });
    plain.onCardOpenKey(enter(targetIn({ isCard: true })));
    assert.deepStrictEqual(plain.calls.open, [], JSON.stringify([...(matched || [])]));
    const selects = gesturePage({ view: 'board', click: SELECTS, matched });
    selects.onCardOpenKey(enter(targetIn({ isCard: true })));
    assert.deepStrictEqual(selects.calls.open, ['7'], JSON.stringify([...(matched || [])]));
  }
});

test('a held Shift, Ctrl, Cmd or Alt keeps a lone match from opening on Enter', () => {
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey']) {
    const page = gesturePage({ view: 'board', matched: new Set(['7']) });
    page.onCardOpenKey(enter(targetIn({ isCard: true }), { [mod]: true }));
    assert.deepStrictEqual(page.calls.open, [], mod);
  }
});

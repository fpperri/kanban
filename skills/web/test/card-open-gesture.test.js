const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// In a view whose plain click selects a card (the Graph always, any other view
// when the preferences sheet says so), a double click or Enter on a focused card
// opens it. The one delegate that carries this out is run here against a fake
// page, with the real decision from selection.js.

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function gesturePage({ view = 'board', click = {}, dragging = {} } = {}) {
  const calls = { open: [] };
  const sandbox = {
    ...require('../web/selection'),
    loadViewMode: () => view,
    loadPrefsState: () => ({ click }),
    openCard: (id) => { calls.open.push(id); },
    isDragging: false, ganttDrag: null, calTimeDrag: null,
    calls,
  };
  Object.assign(sandbox, dragging);
  vm.createContext(sandbox);
  vm.runInContext(fn('onCardOpenGesture'), sandbox);
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

const dbl = (target, extra = {}) => ({
  type: 'dblclick', target, shiftKey: false, ctrlKey: false, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra,
});
const enter = (target, extra = {}) => ({ ...dbl(target), type: 'keydown', key: 'Enter', repeat: false, ...extra });

const SELECTS = { board: 'selects', map: 'selects', gantt: 'selects', calendar: 'selects' };

test('a double click on a card opens it in each view the preferences set to selects', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const page = gesturePage({ view, click: SELECTS });
    page.onCardOpenGesture(dbl(targetIn()));
    assert.deepStrictEqual(page.calls.open, [7], view);
  }
});

test('Enter on a focused card opens it in each view the preferences set to selects, and keeps the key from doing anything else', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const page = gesturePage({ view, click: SELECTS });
    const e = enter(targetIn({ isCard: true }));
    page.onCardOpenGesture(e);
    assert.deepStrictEqual(page.calls.open, [7], view);
    assert.strictEqual(e.defaultPrevented, true, view);
  }
});

test('in a view whose plain click opens the card, a double click and Enter add nothing', () => {
  for (const view of ['board', 'map', 'gantt', 'calendar']) {
    const page = gesturePage({ view });
    page.onCardOpenGesture(dbl(targetIn()));
    page.onCardOpenGesture(enter(targetIn({ isCard: true })));
    assert.deepStrictEqual(page.calls.open, [], view);
  }
});

test('a view left at opens stays at opens when another is set to selects', () => {
  const page = gesturePage({ view: 'calendar', click: { board: 'selects' } });
  page.onCardOpenGesture(dbl(targetIn()));
  assert.deepStrictEqual(page.calls.open, []);
});

test('the Graph keeps its own double click and Enter: the delegate leaves a Graph node alone', () => {
  const page = gesturePage({ view: 'graph' });
  page.onCardOpenGesture(dbl(targetIn({ inside: ['.graph-node'] })));
  page.onCardOpenGesture(enter(targetIn({ isCard: true, inside: ['.graph-node'] })));
  assert.deepStrictEqual(page.calls.open, []);
});

test('Enter only counts on the card itself: on a button or a field inside it, it belongs to that control', () => {
  const page = gesturePage({ click: SELECTS });
  for (const control of ['button', 'select', 'input', 'a']) {
    const e = enter(targetIn({ inside: [control] }));
    page.onCardOpenGesture(e);
    assert.strictEqual(e.defaultPrevented, false, control);
  }
  const inner = enter(targetIn());
  page.onCardOpenGesture(inner);
  assert.strictEqual(inner.defaultPrevented, false, 'a child of the card, not the card');
  assert.deepStrictEqual(page.calls.open, []);
});

test('a double click on a button, a field, a cue or a roll-up bar inside a card opens nothing', () => {
  const page = gesturePage({ click: SELECTS });
  for (const inside of ['button', 'select', 'input', 'a', '.card-assignee', '.tag', '.blocked-pill', '.review-pill', '.rollup']) {
    page.onCardOpenGesture(dbl(targetIn({ inside: [inside] })));
  }
  assert.deepStrictEqual(page.calls.open, []);
});

test('Enter held down opens once, and other keys open nothing', () => {
  const page = gesturePage({ click: SELECTS });
  page.onCardOpenGesture(enter(targetIn({ isCard: true }), { repeat: true }));
  for (const key of [' ', 'Escape', 'a', 'Tab']) page.onCardOpenGesture(enter(targetIn({ isCard: true }), { key }));
  assert.deepStrictEqual(page.calls.open, []);
});

test('a held Shift, Ctrl or Cmd belongs to building a selection, so the gesture opens nothing', () => {
  const page = gesturePage({ click: SELECTS });
  for (const mod of ['shiftKey', 'ctrlKey', 'metaKey']) {
    page.onCardOpenGesture(dbl(targetIn(), { [mod]: true }));
    page.onCardOpenGesture(enter(targetIn({ isCard: true }), { [mod]: true }));
  }
  assert.deepStrictEqual(page.calls.open, []);
});

test('nothing opens from empty space, or while a drag is under way', () => {
  const page = gesturePage({ click: SELECTS });
  page.onCardOpenGesture(dbl(targetIn({ card: false })));
  assert.deepStrictEqual(page.calls.open, []);
  for (const dragging of [{ isDragging: true }, { ganttDrag: {} }, { calTimeDrag: {} }]) {
    const busy = gesturePage({ click: SELECTS, dragging });
    busy.onCardOpenGesture(dbl(targetIn()));
    assert.deepStrictEqual(busy.calls.open, [], JSON.stringify(dragging));
  }
});

test('the page registers the delegate once for the double click and once for the key, on the document', () => {
  assert.match(appSrc, /document\.addEventListener\('dblclick', onCardOpenGesture\);/);
  assert.match(appSrc, /document\.addEventListener\('keydown', onCardOpenGesture\);/);
});

test('a double click on a Calendar card is not a create gesture: the Calendar keeps skipping cards', () => {
  const m = appSrc.match(/\$\('#calendar-view'\)\.addEventListener\('dblclick', \(e\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(m, 'the Calendar create handler is found');
  assert.match(m[0], /if \(e\.target\.closest\('\.card-el'\)\) return;/);
});

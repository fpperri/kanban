const { test } = require('node:test');
const assert = require('node:assert');
const { plainClickBehaviour, plainTapBehaviour, plainBehaviour, cardClickAction, selectionBeforeTap, cardPart, addPart, NO_SELECTION } = require('../../plugin/skills/web/web/selection');

// The phone layout's touch grammar, as pure rules: what a tap and a double tap on a card
// decide, from the phone's own tap choices, with the layout passed in. The desk's click
// rules are tabled again beside them, unchanged (selection.test.js holds the rest).

const VIEWS = ['board', 'map', 'gantt', 'calendar', 'graph'];
const DESK_VIEWS = ['board', 'map', 'gantt', 'calendar'];
const gesture = (extra) => cardClickAction({ cue: false, shiftKey: false, ctrlKey: false, metaKey: false, ...extra });

test('a tap selects in every view unless the phone choice for that view is opens, and the Graph always selects', () => {
  for (const view of VIEWS) assert.strictEqual(plainTapBehaviour(view, undefined), 'selects', `${view}: nothing chosen`);
  for (const view of DESK_VIEWS) {
    assert.strictEqual(plainTapBehaviour(view, { [view]: 'opens' }), 'opens', `${view}: chosen opens`);
    assert.strictEqual(plainTapBehaviour(view, { [view]: 'selects' }), 'selects', `${view}: chosen selects`);
  }
  assert.strictEqual(plainTapBehaviour('graph', { graph: 'opens' }), 'selects');
});

test('a tap choice for one view changes only that view, and a choice that is not opens or a view that is not listed selects', () => {
  const taps = { board: 'opens' };
  for (const view of ['map', 'gantt', 'calendar']) assert.strictEqual(plainTapBehaviour(view, taps), 'selects', view);
  assert.strictEqual(plainTapBehaviour('board', { board: 'maybe' }), 'selects');
  assert.strictEqual(plainTapBehaviour('board', null), 'selects');
  for (const view of ['', 'nope', 'constructor', '__proto__', 'toString', undefined, null]) assert.strictEqual(plainTapBehaviour(view, {}), 'selects', String(view));
});

test('the layout picks the map: the desk reads the click choices and the phone reads the tap choices, neither reads the other', () => {
  const prefs = { click: { board: 'selects', map: 'opens' }, tap: { board: 'opens', map: 'selects' } };
  assert.strictEqual(plainBehaviour('board', prefs, false), 'selects');
  assert.strictEqual(plainBehaviour('board', prefs, true), 'opens');
  assert.strictEqual(plainBehaviour('map', prefs, false), 'opens');
  assert.strictEqual(plainBehaviour('map', prefs, true), 'selects');
  assert.strictEqual(plainBehaviour('graph', prefs, false), 'selects');
  assert.strictEqual(plainBehaviour('graph', prefs, true), 'selects');
});

test('the desk answers exactly what the click lookup answers, and the phone selects where the preferences hold no tap choices at all', () => {
  for (const view of VIEWS) {
    for (const click of [undefined, {}, { [view]: 'opens' }, { [view]: 'selects' }]) {
      assert.strictEqual(plainBehaviour(view, { click }, false), plainClickBehaviour(view, click), `${view} ${JSON.stringify(click)}`);
    }
    assert.strictEqual(plainBehaviour(view, { click: { [view]: 'opens' } }, true), 'selects', `${view}: opens saved for clicks only`);
    assert.strictEqual(plainBehaviour(view, undefined, true), 'selects', `${view}: no preferences`);
  }
});

test('on the phone a tap on a card toggles it, and the second tap of a double tap opens it and puts the selection back', () => {
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true, detail: 1 }), 'toggle');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true }), 'toggle', 'a click that names no count is a first tap');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true, detail: 2 }), 'restore-open');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true, detail: 3 }), 'toggle', 'a third tap is a first tap again, not a second opening');
});

test('on the phone, where the view\'s tap choice is opens, a tap opens the card whatever the count', () => {
  for (const detail of [1, 2, 3, undefined]) assert.strictEqual(gesture({ plainClick: 'opens', phone: true, detail }), 'open', String(detail));
});

test('a modifier, a cue and a range are the same on the phone layout as at the desk', () => {
  for (const phone of [false, true]) {
    for (const plainClick of ['opens', 'selects']) {
      assert.strictEqual(gesture({ plainClick, phone, ctrlKey: true }), 'toggle');
      assert.strictEqual(gesture({ plainClick, phone, metaKey: true }), 'toggle');
      assert.strictEqual(gesture({ plainClick, phone, shiftKey: true }), 'range');
      assert.strictEqual(gesture({ plainClick, phone, shiftKey: true, ranges: false }), 'toggle');
      assert.strictEqual(gesture({ plainClick, phone, cue: true }), 'cue');
      assert.strictEqual(gesture({ plainClick, phone, cue: true, ctrlKey: true, detail: 2 }), 'cue');
      assert.strictEqual(gesture({ plainClick, phone, ctrlKey: true, detail: 2 }), 'toggle', 'a double tap with a modifier held is not a restore');
    }
  }
});

test('at the desk a plain click selects and a double click peeks, with the phone flag off or left out', () => {
  for (const phone of [false, undefined]) {
    assert.strictEqual(gesture({ plainClick: 'selects', phone, detail: 1 }), 'select');
    assert.strictEqual(gesture({ plainClick: 'selects', phone, detail: 2 }), 'peek');
    assert.strictEqual(gesture({ plainClick: 'selects', phone, detail: 3 }), 'select');
    for (const detail of [1, 2]) assert.strictEqual(gesture({ plainClick: 'opens', phone, detail }), 'open');
  }
});

// --- the selection a double tap goes back to ---------------------------------------------

const picked = addPart(addPart(NO_SELECTION, cardPart('3')), cardPart('5'));

test('the second tap on the card the first tap landed on goes back to the selection and range start from before that tap', () => {
  const memory = { id: '7', selection: picked, rangeStart: '5' };
  assert.deepStrictEqual(selectionBeforeTap(memory, '7'), { selection: picked, rangeStart: '5' });
  const none = { id: '7', selection: NO_SELECTION, rangeStart: null };
  assert.deepStrictEqual(selectionBeforeTap(none, '7'), { selection: NO_SELECTION, rangeStart: null });
});

test('a second tap on another card, or with no first tap remembered, has nothing to go back to', () => {
  assert.strictEqual(selectionBeforeTap({ id: '7', selection: picked, rangeStart: '5' }, '8'), null);
  assert.strictEqual(selectionBeforeTap(null, '7'), null);
  assert.strictEqual(selectionBeforeTap(undefined, '7'), null);
});

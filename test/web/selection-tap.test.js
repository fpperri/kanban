const { test } = require('node:test');
const assert = require('node:assert');
const { plainClickBehaviour, plainTapBehaviour, plainBehaviour, cardClickAction, graphDblClickOpens, selectionBeforeTap, cardPart, addPart, NO_SELECTION } = require('../../plugin/skills/web/web/selection');

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

test('a view that opens on its own dblclick event at the desk (peeks false) takes its second click for a select, and on the phone the count still decides', () => {
  assert.strictEqual(gesture({ plainClick: 'selects', phone: false, detail: 2, peeks: false }), 'select');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: false, detail: 1, peeks: false }), 'select');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true, detail: 2, peeks: false }), 'restore-open');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: true, detail: 1, peeks: false }), 'toggle');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: false, detail: 2 }), 'peek', 'peeks is true unless said');
  assert.strictEqual(gesture({ plainClick: 'selects', phone: false, detail: 2, peeks: false, ctrlKey: true }), 'toggle');
});

test('the Graph\'s own dblclick opens the card at the desk with no modifier held, and never on the phone layout', () => {
  const no = { shiftKey: false, ctrlKey: false, metaKey: false };
  assert.strictEqual(graphDblClickOpens({ ...no, phone: false }), true);
  assert.strictEqual(graphDblClickOpens({ ...no, phone: true }), false, 'the second tap\'s click has opened it');
  for (const key of ['shiftKey', 'ctrlKey', 'metaKey']) {
    for (const phone of [false, true]) assert.strictEqual(graphDblClickOpens({ ...no, [key]: true, phone }), false, `${key} ${phone}`);
  }
});

// --- the selection a double tap goes back to ---------------------------------------------

const picked = addPart(addPart(NO_SELECTION, cardPart('3')), cardPart('5'));
const made = addPart(picked, cardPart('7'));

test('the second tap on the card the first tap landed on goes back to the selection and range start from before that tap, while the selection is the one that tap made', () => {
  const memory = { id: '7', selection: picked, rangeStart: '5', after: made };
  assert.deepStrictEqual(selectionBeforeTap(memory, '7', made), { selection: picked, rangeStart: '5' });
  const none = { id: '7', selection: NO_SELECTION, rangeStart: null, after: made };
  assert.deepStrictEqual(selectionBeforeTap(none, '7', made), { selection: NO_SELECTION, rangeStart: null });
});

test('a second tap on another card, or with no first tap remembered, has nothing to go back to', () => {
  const memory = { id: '7', selection: picked, rangeStart: '5', after: made };
  assert.strictEqual(selectionBeforeTap(memory, '8', made), null);
  assert.strictEqual(selectionBeforeTap(null, '7', made), null);
  assert.strictEqual(selectionBeforeTap(undefined, '7', made), null);
});

test('a first tap whose selection has since changed is forgotten: the second tap has nothing to go back to, even where the new selection reads the same', () => {
  const memory = { id: '7', selection: picked, rangeStart: '5', after: made };
  assert.strictEqual(selectionBeforeTap(memory, '7', NO_SELECTION), null, 'cleared since');
  assert.strictEqual(selectionBeforeTap(memory, '7', picked), null, 'stepped back since');
  const sameParts = addPart(picked, cardPart('7'));
  assert.deepStrictEqual(sameParts, made);
  assert.notStrictEqual(sameParts, made);
  assert.strictEqual(selectionBeforeTap(memory, '7', sameParts), null, 'a selection built again is another selection, whatever it holds');
});

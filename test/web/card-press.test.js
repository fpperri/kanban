const { test } = require('node:test');
const assert = require('node:assert');
const { CARD_PRESS_MS, CARD_PRESS_SLOP_PX, CARD_PRESS_ECHO_MS, createCardPress, litCardsShown, selectionWithCards } = require('../../plugin/skills/web/web/card-press');
const { NO_SELECTION, cardPart, addPart } = require('../../plugin/skills/web/web/selection');

// The long press on a card, as a pure rule with the clock and the timer handed in: when a hold fires,
// when the lift opens the menu, when a move or a lift turns it into something else, and the echo that
// follows (the browser's own contextmenu and the click under the lifted finger). The page wires it to
// the touch events (card-press-page.test.js); the browser scenarios run it with a real finger.

function press() {
  const clock = { at: 1000, timers: [] };
  const log = [];
  const drags = [];
  const rule = createCardPress({
    now: () => clock.at,
    setTimer: (fn, ms) => { const t = { fn, at: clock.at + ms }; clock.timers.push(t); return t; },
    clearTimer: (t) => { clock.timers = clock.timers.filter((o) => o !== t); },
    onHold: (who, x, y) => log.push(['hold', who, x, y]),
    onLift: (who, x, y) => log.push(['lift', who, x, y]),
    onDrag: (who, x, y) => drags.push([who, x, y]),
  });
  const wait = (ms) => {
    clock.at += ms;
    for (const t of clock.timers.filter((o) => o.at <= clock.at)) { clock.timers = clock.timers.filter((o) => o !== t); t.fn(); }
  };
  return { rule, log, drags, wait, clock };
}

test('the hold is 500 ms, the slop 10 px, the echo 800 ms', () => {
  assert.strictEqual(CARD_PRESS_MS, 500);
  assert.strictEqual(CARD_PRESS_SLOP_PX, 10);
  assert.strictEqual(CARD_PRESS_ECHO_MS, 800);
});

test('a finger held still for 500 ms fires the hold, once, with the card and the point it went down on', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(499);
  assert.deepStrictEqual(p.log, [], 'not before 500 ms');
  p.wait(1);
  assert.deepStrictEqual(p.log, [['hold', '12', 100, 200]]);
  p.wait(2000);
  assert.strictEqual(p.log.length, 1, 'a hold fires once');
});

test('lifting a held finger without moving opens the menu: the lift fires once, at the point the finger went down', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  assert.strictEqual(p.rule.end(), 'lift');
  assert.deepStrictEqual(p.log, [['hold', '12', 100, 200], ['lift', '12', 100, 200]]);
  assert.strictEqual(p.rule.end(), 'none', 'a second lift is nothing');
  assert.strictEqual(p.log.length, 2);
});

test('a small wobble inside the slop is still a hold in place, and the lift after it opens the menu', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.rule.move(106, 207);
  p.wait(500);
  p.rule.move(104, 205);
  assert.strictEqual(p.rule.end(), 'lift');
  assert.deepStrictEqual(p.log.map((l) => l[0]), ['hold', 'lift']);
});

test('a finger that lifts before 500 ms is a tap: no hold, no lift, and no echo', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(300);
  assert.strictEqual(p.rule.end(), 'tap');
  p.wait(500);
  assert.deepStrictEqual(p.log, [], 'the timer was cleared with the lift');
  assert.strictEqual(p.rule.echoing(), false);
  assert.strictEqual(p.rule.inProgress(), false);
});

test('a finger that moves more than 10 px before 500 ms is a scroll or a swipe: the hold never fires', () => {
  for (const [x, y] of [[111, 200], [89, 200], [100, 211], [100, 189], [108, 208]]) {
    const p = press();
    p.rule.start(100, 200, '12');
    p.wait(200);
    p.rule.move(x, y);
    p.wait(1000);
    assert.deepStrictEqual(p.log, [], `moved to ${x},${y}`);
    assert.strictEqual(p.rule.end(), 'none', `moved to ${x},${y}`);
    assert.strictEqual(p.rule.inProgress(), false);
  }
});

test('exactly 10 px is still inside the slop', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.rule.move(110, 200);
  p.wait(500);
  assert.deepStrictEqual(p.log.map((l) => l[0]), ['hold']);
});

test('a finger that moves after the hold fired turns the hold into a drag: the light stays, no menu opens on the lift', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.move(100, 230);
  assert.strictEqual(p.rule.end(), 'dragged');
  assert.deepStrictEqual(p.log.map((l) => l[0]), ['hold'], 'no lift');
});

test('a move back to where it started does not undo the drag', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.move(100, 230);
  p.rule.move(100, 200);
  assert.strictEqual(p.rule.end(), 'dragged');
});

test('every move of a held finger past the slop is a drag, with the card held and the point the finger is at', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.move(104, 204);
  assert.deepStrictEqual(p.drags, [], 'inside the slop the hold is still a hold in place');
  p.rule.move(100, 230);
  p.rule.move(100, 260);
  assert.deepStrictEqual(p.drags, [['12', 100, 230], ['12', 100, 260]]);
});

test('once the hold is a drag every move is one, back inside the slop of the point it went down on too', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.move(100, 230);
  p.rule.move(103, 202);
  assert.deepStrictEqual(p.drags, [['12', 100, 230], ['12', 103, 202]]);
});

test('a move before the hold is a scroll or a swipe, not a drag, and so is a move after the lift', () => {
  const early = press();
  early.rule.start(100, 200, '12');
  early.wait(200);
  early.rule.move(100, 260);
  early.wait(1000);
  early.rule.move(100, 300);
  assert.deepStrictEqual(early.drags, []);

  const lifted = press();
  lifted.rule.start(100, 200, '12');
  lifted.wait(500);
  lifted.rule.end();
  lifted.rule.move(100, 300);
  assert.deepStrictEqual(lifted.drags, []);
});

test('the press is holding from the hold to the lift, the moment the page keeps the browser from scrolling', () => {
  const p = press();
  assert.strictEqual(p.rule.holding(), false);
  p.rule.start(100, 200, '12');
  p.wait(499);
  assert.strictEqual(p.rule.holding(), false, 'not before 500 ms');
  p.wait(1);
  assert.strictEqual(p.rule.holding(), true);
  p.rule.move(100, 260);
  assert.strictEqual(p.rule.holding(), true, 'and a drag holds too');
  p.rule.end();
  assert.strictEqual(p.rule.holding(), false);

  const scroll = press();
  scroll.rule.start(100, 200, '12');
  scroll.wait(200);
  scroll.rule.move(100, 260);
  scroll.wait(1000);
  assert.strictEqual(scroll.rule.holding(), false, 'a finger that scrolled before the hold never holds');

  const taken = press();
  taken.rule.start(100, 200, '12');
  taken.wait(500);
  taken.rule.cancel();
  assert.strictEqual(taken.rule.holding(), false);
});

test('a touch that dragged is dragging until the next finger comes down, so the listeners that hear its lift after the press can tell', () => {
  const p = press();
  assert.strictEqual(p.rule.dragging(), false);
  p.rule.start(100, 200, '12');
  p.wait(500);
  assert.strictEqual(p.rule.dragging(), false, 'held in place is no drag');
  p.rule.move(100, 260);
  assert.strictEqual(p.rule.dragging(), true);
  p.rule.end();
  assert.strictEqual(p.rule.dragging(), true, 'through the lift');
  p.rule.fingerDown();
  assert.strictEqual(p.rule.dragging(), false);

  const again = press();
  again.rule.start(100, 200, '12');
  again.wait(500);
  again.rule.move(100, 260);
  again.rule.end();
  again.rule.start(100, 200, '12');
  assert.strictEqual(again.rule.dragging(), false, 'a new press starts clean');
});

test('the browser cancelling the touch before the hold ends the press; after the hold it ends it without a lift', () => {
  const early = press();
  early.rule.start(100, 200, '12');
  early.wait(200);
  early.rule.cancel();
  early.wait(1000);
  assert.deepStrictEqual(early.log, []);
  assert.strictEqual(early.rule.inProgress(), false);

  const late = press();
  late.rule.start(100, 200, '12');
  late.wait(500);
  late.rule.cancel();
  assert.deepStrictEqual(late.log.map((l) => l[0]), ['hold'], 'a cancelled touch is no lift');
  assert.strictEqual(late.rule.inProgress(), false);
  assert.strictEqual(late.rule.echoing(), true, 'the browser may still echo a contextmenu');
});

test('a new press starts clean: the one before is dropped with its timer', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(300);
  p.rule.start(50, 60, '7');
  p.wait(300);
  assert.deepStrictEqual(p.log, [], 'the first press would have fired by now');
  p.wait(200);
  assert.deepStrictEqual(p.log, [['hold', '7', 50, 60]]);
});

test('the press is in progress from the finger going down to the finger coming up, for a bounded time', () => {
  const p = press();
  assert.strictEqual(p.rule.inProgress(), false);
  p.rule.start(100, 200, '12');
  assert.strictEqual(p.rule.inProgress(), true);
  p.wait(500);
  assert.strictEqual(p.rule.inProgress(), true);
  p.wait(4000);
  assert.strictEqual(p.rule.inProgress(), true);
  p.wait(1500);
  assert.strictEqual(p.rule.inProgress(), false, 'a touch the page never heard the end of stops counting');
});

test('the echo runs 800 ms from a lift that opened the menu, and from a hold that turned into a drag', () => {
  const lifted = press();
  lifted.rule.start(100, 200, '12');
  lifted.wait(500);
  assert.strictEqual(lifted.rule.echoing(), false, 'while the finger is down the press itself is what holds back the browser');
  lifted.rule.end();
  assert.strictEqual(lifted.rule.inProgress(), false);
  assert.strictEqual(lifted.rule.echoing(), true);
  lifted.wait(799);
  assert.strictEqual(lifted.rule.echoing(), true);
  lifted.wait(1);
  assert.strictEqual(lifted.rule.echoing(), false);

  const dragged = press();
  dragged.rule.start(100, 200, '12');
  dragged.wait(500);
  dragged.rule.move(100, 260);
  dragged.rule.end();
  assert.strictEqual(dragged.rule.echoing(), true);
});

test('a tap that never held leaves no echo, and a press that starts again ends the echo of the last', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.end();
  assert.strictEqual(p.rule.echoing(), true);
  p.rule.start(10, 20, '3');
  assert.strictEqual(p.rule.echoing(), false);
  p.wait(100);
  p.rule.end();
  assert.strictEqual(p.rule.echoing(), false);
});

test('a finger that comes down anywhere ends the echo: what the last finger left behind is over', () => {
  const p = press();
  p.rule.start(100, 200, '12');
  p.wait(500);
  p.rule.end();
  p.wait(300);
  assert.strictEqual(p.rule.echoing(), true);
  p.rule.fingerDown();
  assert.strictEqual(p.rule.echoing(), false);
  assert.strictEqual(p.rule.inProgress(), false, 'it starts no press');
  p.wait(600);
  assert.deepStrictEqual(p.log, [['hold', '12', 100, 200], ['lift', '12', 100, 200]], 'and fires no hold');
});

// --- Select lit -------------------------------------------------------------------------------

test('the cards Select lit adds are the lit cards the view shows, the pressed card first', () => {
  const lit = new Set(['4', '9', '2', '7']);
  const shown = new Set(['2', '4', '7', '8']);
  assert.deepStrictEqual(litCardsShown('7', lit, shown), ['7', '4', '2']);
});

test('a lit card the view does not show is not counted, and a light that holds only the card is just the card', () => {
  assert.deepStrictEqual(litCardsShown('1', new Set(['1', '2', '3']), new Set(['1'])), ['1']);
  assert.deepStrictEqual(litCardsShown('1', new Set(['1']), new Set(['1', '2'])), ['1']);
  assert.deepStrictEqual(litCardsShown('1', null, new Set(['1'])), ['1']);
});

test('ids with a prefix are whole ids: G3 is not 3', () => {
  assert.deepStrictEqual(litCardsShown('G3', new Set(['G3', '3', 'G4']), new Set(['G3', 'G4'])), ['G3', 'G4']);
});

test('Select lit adds the cards as card parts, after what the selection holds, and a card it holds stays where it was', () => {
  const held = addPart(addPart(NO_SELECTION, cardPart('5')), cardPart('2'));
  const next = selectionWithCards(held, ['7', '2', '4']);
  assert.deepStrictEqual(next, { anchor: cardPart('5'), additions: [cardPart('2'), cardPart('7'), cardPart('4')] });
  assert.deepStrictEqual(held, { anchor: cardPart('5'), additions: [cardPart('2')] }, 'the selection it was given is not changed');
});

test('with nothing selected the first card becomes the anchor', () => {
  assert.deepStrictEqual(selectionWithCards(NO_SELECTION, ['7', '4']), { anchor: cardPart('7'), additions: [cardPart('4')] });
  assert.strictEqual(selectionWithCards(NO_SELECTION, []), NO_SELECTION);
});

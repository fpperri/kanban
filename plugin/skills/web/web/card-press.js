'use strict';
// The long press on a card, on the phone layout. A finger held on a card for 500 ms lights the card
// (the hold), and lifted without having moved it opens the card menu (the lift). A move of more than
// 10 px before the hold is a scroll or a swipe and ends the press; a move after it turns the hold into
// a drag, which reports every point the finger reaches (onDrag) and whose lift opens nothing. The page runs its own timer because iOS fires no contextmenu for
// a long press, and Android's fires while the finger is still down. Both are held back while a press
// is on and for 800 ms after it (the echo), together with the click the lifted finger makes, so the
// menu opens once. The next finger to come down, on a card or not, ends the echo. The notes list has a
// press of its own (notes-palette.js); this one shares nothing with it.
//
// The rule takes the clock and the timer, so a test drives it without waiting. Pure. Same
// dual-environment export pattern as phone-width.js.

const CARD_PRESS_SELECTION = (typeof module !== 'undefined' && module.exports)
  ? require('./selection')
  : window;

const CARD_PRESS_MS = 500;
const CARD_PRESS_SLOP_PX = 10;
const CARD_PRESS_ECHO_MS = 800;
// A press whose end the page never heard stops holding back the browser's contextmenu after this long.
const CARD_PRESS_HELD_MS = 5000;

// `who` is whatever the caller wants back (the card's id); `onHold(who, x, y)` and `onLift(who, x, y)`
// get the point the finger went down on, `onDrag(who, x, y)` the point it has moved to.
function createCardPress({ now, setTimer, clearTimer, onHold, onLift, onDrag = () => {} }) {
  let phase = 'idle'; // 'armed' (finger down, not held yet) | 'held' (hold fired) | 'dragged' (held, then moved)
  let timer = null;
  let who = null;
  let x0 = 0;
  let y0 = 0;
  let startedAt = 0;
  let echoUntil = 0;
  let dragged = false; // the touch held and then moved; stays through its lift

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function finish(echoes) {
    stopTimer();
    phase = 'idle';
    if (echoes) echoUntil = now() + CARD_PRESS_ECHO_MS;
  }

  return {
    start(x, y, card) {
      stopTimer();
      echoUntil = 0;
      dragged = false;
      phase = 'armed';
      who = card;
      x0 = x;
      y0 = y;
      startedAt = now();
      timer = setTimer(() => {
        timer = null;
        phase = 'held';
        onHold(who, x0, y0);
      }, CARD_PRESS_MS);
    },

    move(x, y) {
      if (phase === 'idle') return;
      const beyondSlop = Math.hypot(x - x0, y - y0) > CARD_PRESS_SLOP_PX;
      if (phase === 'armed') { if (beyondSlop) finish(false); return; }
      if (phase === 'held' && !beyondSlop) return;
      phase = 'dragged';
      dragged = true;
      onDrag(who, x, y);
    },

    // The finger came up. 'lift' when a held finger came up in place (the menu opens), 'dragged' when
    // a held finger moved first, 'tap' when it came up before the hold, 'none' when no press was on.
    end() {
      const was = phase;
      if (was === 'idle') return 'none';
      finish(was !== 'armed');
      if (was === 'held') { onLift(who, x0, y0); return 'lift'; }
      return was === 'armed' ? 'tap' : 'dragged';
    },

    // The browser took the touch (a scroll began, a native drag, a second finger).
    cancel() {
      if (phase !== 'idle') finish(phase !== 'armed');
    },

    // The hold has fired and the finger is still down: the page keeps the browser from scrolling the touch.
    holding() {
      return phase === 'held' || phase === 'dragged';
    },

    // The touch held and then moved. It stays true through the lift, until the next finger comes down, so
    // a listener that hears the lift after the press (the Board's swipe) can tell what the touch was.
    dragging() {
      return dragged;
    },

    inProgress() {
      return phase !== 'idle' && now() - startedAt < CARD_PRESS_HELD_MS;
    },

    echoing() {
      return now() < echoUntil;
    },

    // A finger came down somewhere, a card or not: the lifted finger's click and contextmenu are over, so
    // the echo ends and what this finger does (a tap on the menu that just opened) is its own.
    fingerDown() {
      echoUntil = 0;
      dragged = false;
    },
  };
}

// The cards Select lit adds: the lit cards the view shows, the pressed card first so it is the
// anchor of an empty selection. `lit` is the Set of ids the light holds (null for none) and `shown`
// the Set of ids the view shows.
function litCardsShown(id, lit, shown) {
  const first = String(id);
  const rest = [...(lit || [])].map(String).filter((other) => other !== first && shown.has(other));
  return [first, ...rest];
}

// The selection with these cards added as card parts, in order; a card it holds stays where it was.
function selectionWithCards(selection, ids) {
  return ids.reduce((next, id) => CARD_PRESS_SELECTION.addPart(next, CARD_PRESS_SELECTION.cardPart(id)), selection);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CARD_PRESS_MS, CARD_PRESS_SLOP_PX, CARD_PRESS_ECHO_MS, createCardPress, litCardsShown, selectionWithCards };
} else {
  window.CARD_PRESS_MS = CARD_PRESS_MS;
  window.CARD_PRESS_SLOP_PX = CARD_PRESS_SLOP_PX;
  window.CARD_PRESS_ECHO_MS = CARD_PRESS_ECHO_MS;
  window.createCardPress = createCardPress;
  window.litCardsShown = litCardsShown;
  window.selectionWithCards = selectionWithCards;
}

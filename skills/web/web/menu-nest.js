'use strict';
// The rules of the nested card menu (docs/adr/0003: built by hand), apart from the DOM: which groups
// and separators show, where a panel opens, what each key does and how long a hover waits.
// menu-nest-ui.js draws and wires it.
//
// The card menu groups its entries under Edit, Group and Explore. A group is a row with a panel of
// entries; the panel opens beside the row (on the left when the right has no room) and, on a phone,
// under it. The page decides which entries show, as it always has; here a group shows only while one
// of its entries does, and a separator only between two things that show.
//
// Pure: Node tests drive it with plain values. Same dual-environment export pattern as
// phone-width.js.

const MENU_OPEN_MS = 120;
const MENU_SWITCH_MS = 300;
const MENU_MARGIN_PX = 8;

// A group shows while any of its entries does.
function menuSubShown(entriesShown) {
  return entriesShown.some(Boolean);
}

// `rows` is the menu's children in order, { shown, sep }. -> for each row, whether it shows: a
// separator only when something shows before it (after the last separator that shows) and something
// shows after it (before the next separator); every other row as it was.
function menuSeparators(rows) {
  const shown = rows.map((r) => !!r.shown);
  let before = false;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].sep) { before = before || shown[i]; out.push(shown[i]); continue; }
    let after = false;
    for (let j = i + 1; j < rows.length && !rows[j].sep; j++) after = after || shown[j];
    const show = before && after;
    out.push(show);
    if (show) before = false;
  }
  return out;
}

// The highlight after Up or Down among `count` entries, from `at` (-1: none). It wraps; Down from
// nothing lands on the first and Up from nothing on the last. Any other key leaves it.
function menuStep(count, at, key) {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % count;
  if (key === 'ArrowUp') return at <= 0 ? count - 1 : at - 1;
  return at;
}

// What a key does in the open menu. `ctx` is { level: 'top' | 'sub', onParent: the highlight is on a
// group's row, subOpen: a panel is open }. -> 'next' | 'prev' | 'first' | 'last' | 'open' | 'close-sub' | null; null
// is not the menu's: an entry's own Enter is its click, and Esc at the top level closes the whole
// menu, which the page already does. Home and End are 'first' and 'last' of the level.
function menuKeyAction(key, ctx) {
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'prev';
  if (key === 'Home') return 'first';
  if (key === 'End') return 'last';
  if ((key === 'ArrowRight' || key === 'Enter' || key === ' ') && ctx.onParent) return 'open';
  if (key === 'ArrowLeft' && ctx.level === 'sub') return 'close-sub';
  if (key === 'Escape' && (ctx.level === 'sub' || ctx.subOpen)) return 'close-sub';
  return null;
}

// Where a panel opens from its row: `parent` is the row's rect, `panel` its size, `viewport` the
// window's. -> { flip, shiftY }: flip puts it on the left of the row, when it does not fit on the
// right and the left has more room; shiftY (zero or negative) lifts it by what it runs over the
// bottom, never above the top margin.
function menuSubPlacement({ parent, panel, viewport }) {
  const right = viewport.width - MENU_MARGIN_PX - parent.right;
  const left = parent.left - MENU_MARGIN_PX;
  const flip = panel.width > right && left > right;
  const over = parent.top + panel.height - (viewport.height - MENU_MARGIN_PX);
  const shiftY = over > 0 ? -Math.min(over, Math.max(0, parent.top - MENU_MARGIN_PX)) : 0;
  return { flip, shiftY };
}

// How long a hovered row waits before its panel opens: longer when another panel is open, so the
// pointer crossing the rows on its way to that panel does not swap it away.
function menuHoverDelay(otherOpen) {
  return otherOpen ? MENU_SWITCH_MS : MENU_OPEN_MS;
}

const MENU_NEST_EXPORTS = { MENU_OPEN_MS, MENU_SWITCH_MS, menuSubShown, menuSeparators, menuStep, menuKeyAction, menuSubPlacement, menuHoverDelay };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MENU_NEST_EXPORTS;
} else {
  Object.assign(window, MENU_NEST_EXPORTS);
}

'use strict';
// The card menu's groups on the page (docs/adr/0003: built by hand). #context-menu holds plain entries
// and three groups, Edit, Group and Explore: a `.ctx-sub` is a row (`.ctx-parent`, a button with
// aria-haspopup and aria-expanded) and its panel (`.ctx-sub-panel`) of entries. A panel opens when its
// row is hovered for a moment (a longer one when another is open, so the pointer crossing the rows on its
// way to the open panel does not swap it away), when its row is clicked, and from the keyboard; it opens
// beside the row, on the left when the right has no room, and under the row at phone width, where the
// stylesheet draws it in the flow. The rules (which groups and separators show, where a panel opens,
// what each key does) are menu-nest.js.
//
// Up and Down move the highlight, Right or Enter on a row open its panel and highlight its first entry,
// Left or Esc close it and return to the row, and Esc at the top level closes the menu as it always has.
// The menu takes the focus when it opens (and gives it back when it closes), and its keys are read in the
// capture phase only while focus is inside it, so they reach nothing behind it and nothing in a field
// outside it. Home and End go to the first and last entry of the level.
//
// showContextMenu (app.js) decides which entries show and then calls menuNestSync; hideContextMenu
// calls menuNestClose. Every entry keeps its own id and its own click handler. This script reads
// app.js's globals at the moment it runs, never when it loads: $, isPhoneWidth, and menu-nest.js's
// functions.

let menuNestTimer = 0;
let menuNestBack = null; // what had the focus when the menu opened

const menuNestRoot = () => $('#context-menu');
const menuNestSubs = () => [...menuNestRoot().querySelectorAll('.ctx-sub')];
const menuNestIsShown = (el) => !el.classList.contains('hidden');
const menuNestOpenSub = () => menuNestSubs().find((s) => s.classList.contains('open')) || null;
const menuNestPanelEntries = (sub) => [...sub.querySelectorAll('.ctx-sub-panel button')];

// After the page has decided which entries show: a group shows while one of its entries does, and a
// separator between two things that show. `canvas` is the small menu of the empty Graph or Map
// canvas, where Isolate alone shows, drawn without its group's row.
function menuNestSync(canvas) {
  menuNestClose();
  const root = menuNestRoot();
  for (const sub of menuNestSubs()) {
    const entries = menuNestPanelEntries(sub).map((b) => menuNestIsShown(b) && (!canvas || b.id === 'ctx-isolate'));
    sub.classList.toggle('hidden', !menuSubShown(entries));
  }
  const children = [...root.children];
  const rows = children.map((el) => ({
    sep: el.classList.contains('ctx-sep'),
    shown: menuNestIsShown(el) && (!canvas || el.classList.contains('ctx-sub')),
  }));
  const shown = menuSeparators(rows);
  children.forEach((el, i) => { if (rows[i].sep) el.classList.toggle('hidden', !shown[i]); });
}

// The menu has opened: it takes the focus, so its keys are read, and remembers where the focus was.
function menuNestFocus() {
  const root = menuNestRoot();
  if (!root.contains(document.activeElement)) menuNestBack = document.activeElement;
  root.focus({ preventScroll: true });
}

// The menu has closed: the focus goes back, unless it has gone elsewhere since (a popup the menu opened).
function menuNestRelease() {
  const back = menuNestBack;
  menuNestBack = null;
  if (menuNestRoot().contains(document.activeElement) && back && back.focus && back.isConnected !== false) back.focus({ preventScroll: true });
}

function menuNestClose() {
  clearTimeout(menuNestTimer);
  menuNestTimer = 0;
  for (const sub of menuNestSubs()) {
    sub.classList.remove('open');
    const parent = sub.querySelector('.ctx-parent');
    if (parent) parent.setAttribute('aria-expanded', 'false');
    const panel = sub.querySelector('.ctx-sub-panel');
    if (panel) { panel.classList.remove('flip'); panel.style.top = ''; }
  }
}

function menuNestOpen(sub, { focusFirst = false } = {}) {
  menuNestClose();
  sub.classList.add('open');
  const parent = sub.querySelector('.ctx-parent');
  const panel = sub.querySelector('.ctx-sub-panel');
  parent.setAttribute('aria-expanded', 'true');
  if (!isPhoneWidth(window.innerWidth)) {
    const size = panel.getBoundingClientRect();
    const place = menuSubPlacement({ parent: parent.getBoundingClientRect(), panel: { width: size.width, height: size.height }, viewport: { width: window.innerWidth, height: window.innerHeight } });
    panel.classList.toggle('flip', place.flip);
    if (place.shiftY) panel.style.top = `${-5 + place.shiftY}px`; // -5: the panel's own padding and border, so its first entry sits level with the row
  }
  if (focusFirst) {
    const first = menuNestPanelEntries(sub).find(menuNestIsShown);
    if (first) first.focus();
  }
}

function menuNestSchedule(action, ms) {
  clearTimeout(menuNestTimer);
  menuNestTimer = setTimeout(() => { menuNestTimer = 0; action(); }, ms);
}

function onMenuNestOver(e) {
  const target = e.target;
  if (!target || !target.closest) return;
  clearTimeout(menuNestTimer);
  menuNestTimer = 0;
  const open = menuNestOpenSub();
  const sub = target.closest('.ctx-sub');
  if (sub) {
    if (sub !== open) menuNestSchedule(() => menuNestOpen(sub), menuHoverDelay(open !== null));
  } else if (open && target.closest('button')) {
    menuNestSchedule(menuNestClose, MENU_SWITCH_MS);
  }
}

function onMenuNestClick(e) {
  const parent = e.target && e.target.closest && e.target.closest('.ctx-parent');
  if (!parent) return;
  const sub = parent.closest('.ctx-sub');
  if (sub.classList.contains('open') && isPhoneWidth(window.innerWidth)) menuNestClose();
  else menuNestOpen(sub);
}

// The entries a key moves among at the top level: the plain entries that show and each group's row. In
// the empty canvas's menu the group has no row and its panel stands in the menu: its entries are the level.
function menuNestTopEntries() {
  if (menuNestRoot().classList.contains('canvas-menu')) {
    return menuNestSubs().filter(menuNestIsShown).flatMap((sub) => menuNestPanelEntries(sub).filter((b) => menuNestIsShown(b) && b.id === 'ctx-isolate'));
  }
  return [...menuNestRoot().children]
    .filter((el) => menuNestIsShown(el) && !el.classList.contains('ctx-sep'))
    .map((el) => (el.classList.contains('ctx-sub') ? el.querySelector('.ctx-parent') : el));
}

function onMenuNestKey(e) {
  const root = menuNestRoot();
  if (root.classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  if (!active || !root.contains(active)) return;
  const open = menuNestOpenSub();
  const panel = !root.classList.contains('canvas-menu') && active.closest ? active.closest('.ctx-sub-panel') : null;
  const action = menuKeyAction(e.key, { level: panel ? 'sub' : 'top', onParent: active.classList.contains('ctx-parent'), subOpen: open !== null });
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (action === 'open') {
    menuNestOpen(active.closest('.ctx-sub'), { focusFirst: true });
  } else if (action === 'close-sub') {
    const sub = panel ? panel.closest('.ctx-sub') : open;
    menuNestClose();
    sub.querySelector('.ctx-parent').focus();
  } else {
    const entries = panel ? menuNestPanelEntries(panel.closest('.ctx-sub')).filter(menuNestIsShown) : menuNestTopEntries();
    const at = menuStep(entries.length, entries.indexOf(active), e.key);
    const to = action === 'first' ? entries[0] : action === 'last' ? entries[entries.length - 1] : entries[at];
    if (!panel) menuNestClose();
    if (to) to.focus();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const root = menuNestRoot();
  root.addEventListener('mouseover', onMenuNestOver);
  root.addEventListener('click', onMenuNestClick);
  document.addEventListener('keydown', onMenuNestKey, true);
});

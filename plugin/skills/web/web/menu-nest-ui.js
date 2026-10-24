'use strict';
// The card menu's groups on the page (docs/adr/0003: built by hand). #context-menu holds plain
// entries and three groups, Edit, Group and Explore. A `.ctx-sub` is a group: a row (`.ctx-parent`,
// a button with aria-haspopup and aria-expanded) and its panel (`.ctx-sub-panel`) of entries. A
// panel's entries may be groups themselves, one level down: Explore holds Path and Tree, each a
// group of Hierarchy and Dependency. menuNestTopGroups are the menu's own groups, and a nested group
// is reached through the group that holds it.
//
// A panel opens when its row is hovered for a moment (a longer one when another is open, so the
// pointer crossing the rows on its way to the open panel does not swap it away), when its row is
// clicked, and from the keyboard. It opens beside the row, on the left when the right has no room,
// and under the row at phone width, where the stylesheet draws it in the flow. The rules (which
// groups and separators show, where a panel opens, what each key does) are menu-nest.js.
//
// Up and Down move the highlight, Right or Enter on a row open its panel and highlight its first
// entry, and Left or Esc close it and return to the row. Esc at the top level closes the menu as it
// always has. At a nested level the keys work as at the first: Right or Enter on Path or Tree open
// it, Left or Esc close that panel alone and return to its row, one level back. Left and Esc agree
// from a row whose own panel is open: both close that panel and keep the highlight on the row.
// Home and End go to the first and last entry of the level.
//
// The menu takes the focus when it opens (and gives it back when it closes), and its keys are read
// in the capture phase only while focus is inside it, so they reach nothing behind it and nothing
// in a field outside it.
//
// showContextMenu (app.js) decides which entries show and then calls menuNestSync; hideContextMenu
// calls menuNestClose. Every entry keeps its own id and its own click handler. This script reads
// app.js's globals at the moment it runs, never when it loads: $, isPhoneWidth, and menu-nest.js's
// functions.

let menuNestTimer = 0;
let menuNestBack = null; // what had the focus when the menu opened

const menuNestRoot = () => $('#context-menu');
const menuNestChild = (el, cls) => [...el.children].find((c) => c.classList.contains(cls)) || null;
const menuNestRowOf = (group) => menuNestChild(group, 'ctx-parent');
const menuNestPanelOf = (group) => menuNestChild(group, 'ctx-sub-panel');
// The groups that are children of the menu or of a panel (not the ones nested in those).
const menuNestGroupsIn = (holder) => [...holder.children].filter((c) => c.classList.contains('ctx-sub'));
// The menu's own groups.
const menuNestTopGroups = () => menuNestGroupsIn(menuNestRoot());
// Every group at every level, a group before the groups nested in it.
const menuNestAllGroups = () => [...menuNestRoot().querySelectorAll('.ctx-sub')];
// The group whose panel holds this group, or null for one of the menu's own.
const menuNestHoldingGroup = (group) => group.parentElement.closest('.ctx-sub');
const menuNestIsShown = (el) => !el.classList.contains('hidden');
// The menu's own group whose panel is open, or null.
const menuNestOpenTopGroup = () => menuNestTopGroups().find((g) => g.classList.contains('open')) || null;
// The group nested in this group's panel whose own panel is open, or null.
const menuNestOpenGroupIn = (group) => menuNestGroupsIn(menuNestPanelOf(group)).find((g) => g.classList.contains('open')) || null;
// What a key moves among in one holder (the menu or a panel): the plain entries that show and each
// group's row.
const menuNestItems = (holder) => [...holder.children]
  .filter((el) => menuNestIsShown(el) && !el.classList.contains('ctx-sep'))
  .map((el) => (el.classList.contains('ctx-sub') ? menuNestRowOf(el) : el));

// After the page has decided which entries show: a group shows while one of its entries does, and a
// separator between two things that show. `canvas` is the small menu of the empty Graph or Map
// canvas, where Isolate alone shows, drawn without its group's row.
function menuNestSync(canvas) {
  menuNestClose();
  const root = menuNestRoot();
  for (const group of menuNestAllGroups().reverse()) { // a nested group before the group that holds it
    const entries = [...menuNestPanelOf(group).children].map((b) => menuNestIsShown(b) && (!canvas || b.id === 'ctx-isolate'));
    group.classList.toggle('hidden', !menuSubShown(entries));
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

function menuNestCloseGroup(group) {
  group.classList.remove('open');
  menuNestRowOf(group).setAttribute('aria-expanded', 'false');
  const panel = menuNestPanelOf(group);
  panel.classList.remove('flip');
  panel.style.top = '';
}

function menuNestClose() {
  clearTimeout(menuNestTimer);
  menuNestTimer = 0;
  for (const group of menuNestAllGroups()) menuNestCloseGroup(group);
}

// The groups inside one group's panel, but for `except`.
function menuNestCloseGroupsIn(holder, except) {
  for (const group of menuNestGroupsIn(menuNestPanelOf(holder))) if (group !== except) menuNestCloseGroup(group);
}

// Opening a group shuts the others of its level; the panels one level up stay.
function menuNestOpen(group, { focusFirst = false } = {}) {
  const holder = menuNestHoldingGroup(group);
  if (holder) menuNestCloseGroupsIn(holder, group); else menuNestClose();
  group.classList.add('open');
  const parent = menuNestRowOf(group);
  const panel = menuNestPanelOf(group);
  parent.setAttribute('aria-expanded', 'true');
  if (!isPhoneWidth(window.innerWidth)) {
    const size = panel.getBoundingClientRect();
    const place = menuSubPlacement({ parent: parent.getBoundingClientRect(), panel: { width: size.width, height: size.height }, viewport: { width: window.innerWidth, height: window.innerHeight } });
    panel.classList.toggle('flip', place.flip);
    if (place.shiftY) panel.style.top = `${-5 + place.shiftY}px`; // -5: the panel's own padding and border, so its first entry sits level with the row
  }
  if (focusFirst) {
    const first = menuNestItems(panel)[0];
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
  const open = menuNestOpenTopGroup();
  const group = target.closest('.ctx-sub');
  const holder = group ? menuNestHoldingGroup(group) : null;
  if (holder) {
    const sibling = menuNestOpenGroupIn(holder);
    if (group !== sibling) menuNestSchedule(() => menuNestOpen(group), menuHoverDelay(sibling !== null));
  } else if (group) {
    if (group !== open) menuNestSchedule(() => menuNestOpen(group), menuHoverDelay(open !== null));
    else if (target.closest('button') && menuNestOpenGroupIn(group)) menuNestSchedule(() => menuNestCloseGroupsIn(group, null), MENU_SWITCH_MS);
  } else if (open && target.closest('button')) {
    menuNestSchedule(menuNestClose, MENU_SWITCH_MS);
  }
}

function onMenuNestClick(e) {
  const parent = e.target && e.target.closest && e.target.closest('.ctx-parent');
  if (!parent) return;
  const group = parent.closest('.ctx-sub');
  if (group.classList.contains('open') && isPhoneWidth(window.innerWidth)) {
    if (menuNestHoldingGroup(group)) menuNestCloseGroup(group); else menuNestClose();
  } else menuNestOpen(group);
}

// The entries a key moves among at the top level: the plain entries that show and each group's row. In
// the empty canvas's menu the group has no row and its panel stands in the menu: its entries are the level.
function menuNestTopEntries() {
  if (menuNestRoot().classList.contains('canvas-menu')) {
    return menuNestTopGroups().filter(menuNestIsShown).flatMap((group) => menuNestItems(menuNestPanelOf(group)).filter((b) => b.id === 'ctx-isolate'));
  }
  return menuNestItems(menuNestRoot());
}

function onMenuNestKey(e) {
  const root = menuNestRoot();
  if (root.classList.contains('hidden') || e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  if (!active || !root.contains(active)) return;
  const open = menuNestOpenTopGroup();
  const panel = !root.classList.contains('canvas-menu') && active.closest ? active.closest('.ctx-sub-panel') : null;
  const onParent = active.classList.contains('ctx-parent');
  const ownOpen = onParent && active.closest('.ctx-sub').classList.contains('open');
  const action = menuKeyAction(e.key, { level: panel ? 'sub' : 'top', onParent, subOpen: open !== null, ownOpen });
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (action === 'open') {
    menuNestOpen(active.closest('.ctx-sub'), { focusFirst: true });
  } else if (action === 'close-sub') {
    // From a row whose own panel is open, that panel; else the panel the highlight is in, else the open one.
    const target = ownOpen ? active.closest('.ctx-sub') : panel ? panel.closest('.ctx-sub') : open;
    if (menuNestHoldingGroup(target)) menuNestCloseGroup(target); else menuNestClose();
    menuNestRowOf(target).focus();
  } else {
    const owner = panel ? panel.closest('.ctx-sub') : null;
    const entries = panel ? menuNestItems(panel) : menuNestTopEntries();
    const at = menuStep(entries.length, entries.indexOf(active), e.key);
    const to = action === 'first' ? entries[0] : action === 'last' ? entries[entries.length - 1] : entries[at];
    if (!panel) menuNestClose();
    else if (!menuNestHoldingGroup(owner)) menuNestCloseGroupsIn(owner, null); // moving off a nested group's row shuts its panel
    if (to) to.focus();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const root = menuNestRoot();
  root.addEventListener('mouseover', onMenuNestOver);
  root.addEventListener('click', onMenuNestClick);
  document.addEventListener('keydown', onMenuNestKey, true); // key-guard: exempt (acts only while the menu is open and focus is inside it)
});

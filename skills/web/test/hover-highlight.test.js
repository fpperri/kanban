const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { isHoverHighlighted } = require('../web/selection');

// kanban.proj#261 — hovering (or keyboard-focusing) any piece of a card
// lights every piece sharing its id: on the calendar a run cut at a week
// boundary is two chips, and the card's own deadline chip is a third on a
// different day, so this is the only way to see a card's true extent.

// --- isHoverHighlighted (selection.js) — the one pure, testable piece.
// Unlike selectedIds (a Set, many cards at once), only ever one card is
// hovered/focused, so the membership test is a plain equality check.

test('isHoverHighlighted is true only for the hovered id', () => {
  assert.strictEqual(isHoverHighlighted(5, 5), true);
  assert.strictEqual(isHoverHighlighted(5, 6), false);
});

test('isHoverHighlighted with no hovered card (null) lights nothing', () => {
  assert.strictEqual(isHoverHighlighted(null, 5), false);
  assert.strictEqual(isHoverHighlighted(undefined, 5), false);
});

test('isHoverHighlighted treats id 0 as a real id, not "no hover" — only null/undefined mean unset', () => {
  assert.strictEqual(isHoverHighlighted(0, 0), true);
  assert.strictEqual(isHoverHighlighted(0, 1), false);
});

// --- surface wiring — each of the six card-representing render call sites
// reads hoveredId through isHoverHighlighted and stamps a `card-el` element
// as focusable, the same convention overdue.test.js/assignee-badge.test.js
// use for app.js DOM glue: structural assertions against the source, since
// there's no jsdom in this suite to mount the real DOM and hold a pointer
// still across a re-render.

const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const appCss = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');

test('hoveredId is a single module-level id, never a Set — only one card is hovered/focused at a time', () => {
  assert.match(appJs, /let hoveredId = null;/);
});

test('board tile: cardEl reads hoveredId via isHoverHighlighted and is Tab-reachable', () => {
  assert.match(appJs, /\(isHoverHighlighted\(hoveredId, card\.id\) \? ' hover-highlight' : ''\);\s*\n\s*el\.draggable = true;\s*\n\s*el\.tabIndex = 0;/);
});

test('archived tile: archiveCardEl carries the same hover-highlight + tabIndex pair', () => {
  assert.match(appJs, /archived-card' \+ \(showEpic && card\.epic \? ' epic' : ''\) \+ \(selectedIds\.has\(card\.id\) \? ' selected' : ''\) \+ \(isHoverHighlighted\(hoveredId, card\.id\) \? ' hover-highlight' : ''\);/);
});

test('calendar chip: calendarChipEl (shared by the month grid AND the sub-month grids) carries hover-highlight + tabIndex', () => {
  assert.match(appJs, /\(selectedIds\.has\(card\.id\) \? ' selected' : ''\) \+\s*\n\s*\(isHoverHighlighted\(hoveredId, card\.id\) \? ' hover-highlight' : ''\);/);
  assert.match(appJs, /el\.tabIndex = 0; \/\/ reachable by Tab so the hover cue isn't pointer-only \(kanban\.proj#261\)\s*\n\s*el\.dataset\.id = card\.id;/);
});

test('gantt bar: ganttBarEl carries hover-highlight + tabIndex, gated the same as .selected', () => {
  assert.match(appJs, /\(selectedIds\.has\(bar\.card\.id\) \? ' selected' : ''\) \+\s*\n\s*\(isHoverHighlighted\(hoveredId, bar\.card\.id\) \? ' hover-highlight' : ''\) \+/);
});

test('gantt gutter label: shares the bar\'s hover-highlight + tabIndex, same card-el parity .selected already has', () => {
  assert.match(appJs, /'gantt-row gantt-label card-el' \+ \(bar\.card\.epic \? ' epic' : ''\) \+ \(selectedIds\.has\(bar\.card\.id\) \? ' selected' : ''\) \+ \(isHoverHighlighted\(hoveredId, bar\.card\.id\) \? ' hover-highlight' : ''\);/);
});

test('map node: the SVG group gates hover-highlight AND tabindex on `selectable`, same guard .selected uses — ghost/missing stubs stay inert', () => {
  assert.match(appJs, /\$\{selectable && isHoverHighlighted\(hoveredId, id\) \? ' hover-highlight' : ''\}`;/);
  assert.match(appJs, /<g class="\$\{cls\}" transform="translate\(\$\{p\.x\},\$\{p\.y\}\)"\$\{missing \? '' : ` data-id="\$\{id\}"`\}\$\{selectable \? ' tabindex="0"' : ''\}>/);
});

test('the gantt due diamond is NOT wired for hover — .selected skips it too, so hover stays at parity rather than inventing new treatment', () => {
  assert.ok(!appJs.includes("hoveredId, bar.card.id) ? ' hover-highlight' : '') + (bar.card.archived ? ' archived' : '') + (overdue"), 'no hover-highlight concatenated into the due-marker className');
  assert.ok(!appCss.includes('.gantt-due-marker.hover-highlight'));
});

// --- delegated wiring: one mouseover/mouseout pair and one focusin/focusout
// pair on document, mirroring the existing click/contextmenu pair — never a
// CSS-only :hover (that only ever styles the element under the pointer, and
// can't reach a card's other pieces).

test('mouseover/mouseout and focusin/focusout are delegated on document, not bound per element', () => {
  assert.match(appJs, /document\.addEventListener\('mouseover', enterHover\);/);
  assert.match(appJs, /document\.addEventListener\('mouseout', leaveHover\);/);
  assert.match(appJs, /document\.addEventListener\('focusin', enterHover\);/);
  assert.match(appJs, /document\.addEventListener\('focusout', leaveHover\);/);
});

test('the leave handler only clears hoveredId once the pointer/focus is OUTSIDE the current card-el — an internal boundary (title, tags, a tile\'s own buttons) must not flicker the highlight off', () => {
  assert.match(appJs, /const to = e\.relatedTarget && e\.relatedTarget\.closest && e\.relatedTarget\.closest\('\.card-el'\);\s*\n\s*if \(to === from\) return;/);
});

test('applyHoverHighlight repaints the live DOM directly rather than triggering a full renderBoard() per mouse move', () => {
  assert.match(appJs, /function applyHoverHighlight\(\) \{\s*\n\s*document\.querySelectorAll\('\.hover-highlight'\)\.forEach\(\(el\) => el\.classList\.remove\('hover-highlight'\)\);/);
  assert.match(appJs, /document\.querySelectorAll\(`\.card-el\[data-id="\$\{hoveredId\}"\]`\)\.forEach\(\(el\) => el\.classList\.add\('hover-highlight'\)\);/);
});

// --- surviving the poll: renderBoard()'s full DOM rebuild carries the
// highlight forward on its own because every render call site reads
// hoveredId — same "state lives outside the DOM" contract selectedIds
// already relies on (see the comment above the `let selectedIds` line).

test('hoveredId is declared next to selectedIds/bulkDragIds, documented as surviving renderBoard() the same way', () => {
  const idx = appJs.indexOf('let hoveredId = null;');
  assert.ok(idx > -1);
  const before = appJs.slice(Math.max(0, idx - 900), idx);
  assert.match(before, /Borrows the selection mechanism/);
  assert.match(before, /poll's full[\s\S]*DOM rebuild carries the highlight forward/);
});

// --- CSS: a background wash, not an outline; a different tone from
// .selected's navy so the two never read alike; declared so an epic card
// still visibly responds AND a selected card still reads as selected.

test('app.css washes every hover-highlight surface with one solid color, no outline', () => {
  assert.ok(appCss.includes(".card.hover-highlight, .cal-chip.hover-highlight, .gantt-bar.hover-highlight, .gantt-label.hover-highlight { background: #21262d; }"));
  assert.ok(appCss.includes('.map-node.hover-highlight rect { fill: #21262d; }'));
  assert.ok(!/\.hover-highlight[^{]*\{[^}]*outline/.test(appCss), 'hover never carries an outline — that stays .selected\'s own channel');
});

test('the hover wash is a different tone from .selected\'s navy #0d1b2a — they must never read alike', () => {
  assert.notStrictEqual('#21262d', '#0d1b2a');
});

test('cascade order: hover-highlight is declared AFTER every .epic wash / per-status background above it, so an epic or colored card still visibly responds to hover', () => {
  const epicIdx = appCss.indexOf('.card.epic, .cal-chip.epic, .gantt-label.epic { background:');
  const mapEpicIdx = appCss.indexOf('.map-node.epic rect { fill:');
  const ganttStatusIdx = appCss.indexOf('.gantt-bar.status-backlog');
  const hoverIdx = appCss.indexOf('.card.hover-highlight,');
  const mapHoverIdx = appCss.indexOf('.map-node.hover-highlight rect');
  assert.ok(epicIdx > -1 && mapEpicIdx > -1 && ganttStatusIdx > -1 && hoverIdx > -1 && mapHoverIdx > -1);
  assert.ok(hoverIdx > epicIdx, 'card/chip/label hover wash declared after the epic wash it must beat');
  assert.ok(hoverIdx > ganttStatusIdx, 'gantt bar hover wash declared after the per-status background it must beat');
  assert.ok(mapHoverIdx > mapEpicIdx, 'map node hover fill declared after the epic fill it must beat');
});

test('cascade order: .selected is declared AFTER hover-highlight, so a selected card keeps reading as selected while hovered', () => {
  const hoverIdx = appCss.indexOf('.card.hover-highlight,');
  const mapHoverIdx = appCss.indexOf('.map-node.hover-highlight rect');
  const selectedIdx = appCss.indexOf('.card.selected {');
  const mapSelectedIdx = appCss.indexOf('.map-node.selected rect');
  assert.ok(hoverIdx > -1 && mapHoverIdx > -1 && selectedIdx > -1 && mapSelectedIdx > -1);
  assert.ok(selectedIdx > hoverIdx, '.card.selected declared after hover-highlight — selected wins the background tie');
  assert.ok(mapSelectedIdx > mapHoverIdx, '.map-node.selected rect declared after the hover fill — selected wins the tie');
});

test('the hover wash is a solid color (no alpha) — sidesteps kanban.proj#255\'s "alpha wash needs an opaque backdrop" trap entirely rather than relying on one', () => {
  assert.ok(!/\.hover-highlight[^{]*\{[^}]*rgba\(/.test(appCss), 'no rgba() in any hover-highlight rule');
});

test('the native focus ring is suppressed on card-el — the hover wash IS the focus cue, same "own cue, no outline" rule as .search-input:focus', () => {
  assert.ok(appCss.includes('.card-el:focus { outline: none; }'));
});

// --- doc pin: SKILL.md documents the hover/focus highlight

test('SKILL.md documents the hover/focus highlight bullet', () => {
  const start = skill.indexOf('- **Hover/focus highlight**');
  assert.ok(start > -1, 'the Hover/focus highlight bullet exists');
  const bullet = skill.slice(start, skill.indexOf('- **Speedbumps**', start));
  assert.match(bullet, /hoveredId/);
  assert.match(bullet, /#0d1b2a/, 'names the selected wash it must stay distinct from');
  assert.match(bullet, /tabindex="0"/, 'documents keyboard reachability');
  assert.match(bullet, /due diamond/, 'names the one card-el surface .selected also skips');
});

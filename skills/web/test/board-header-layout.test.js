const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- equal-length board columns + fixed page header + a
// scrolling card list per column -----------------------------------------
// Three independent CSS-only requirements pinned as structure tests (same
// convention as status-colors.test.js): (1) every board column fills the
// row's shared height, regardless of its own card count; (2) the page
// header stays on screen while a column's card list scrolls past, via
// position: sticky; (3) each column's OWN header stays visible above its
// OWN independently-scrolling card list — no sticky needed, since the
// header sits outside the region that scrolls. A fourth piece (app.js
// keeping main#board's height in sync with the page header's real height)
// is pinned as a JS structure test since jsdom isn't wired into this suite.
//
// The bug these tests guard: the original cut of
// these tests was regex-only against source text, so `.column-header { ...
// position: sticky ... }` read as "passing" even though the column headers
// never actually stuck — main#board's pre-existing `overflow-x: auto` forces
// its computed overflow-y to auto too (CSS Overflow spec: an unset/visible
// axis paired with a non-visible one computes to auto), silently making
// main#board — not the document — the scroll container .column-header's
// sticky position resolved against, and main#board had no bounded height to
// ever scroll on its own. Confirmed with a real browser (headless Edge over
// CDP, getComputedStyle + getBoundingClientRect before/after a scroll — same
// verification method as the calendar-drag defect fix below in
// server.test.js). A first fix attempt (bounding main#board's height +
// `overflow-y: auto`) LOOKED right and passed a shallow repro, but a second
// CDP pass against a real 25-card column caught a follow-on bug the shallow
// repro missed: align-items: stretch on a definite-height flex container
// caps every `.column` at that height, so overflowing card content spilled
// out past the column's own box unclipped, and the sticky header's own
// containing block (the capped .column) exhausted before the user finished
// scrolling. The actual fix scraps per-column sticky entirely and gives
// each `.column-cards` its own `overflow-y: auto` (Trello-style per-column
// scroll) — the assertions below pin that shape so a regression back to
// board-wide sticky/scroll fails loudly here instead of silently passing
// the old regex-only checks.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');

test('main#board stretches its columns to equal height instead of sizing each to its own content', () => {
  assert.match(css, /main#board\s*\{[^}]*align-items:\s*stretch/, 'align-items: stretch replaces the old flex-start');
  assert.doesNotMatch(css, /main#board\s*\{[^}]*align-items:\s*flex-start/, 'the old per-column sizing rule is gone');
});

test('main#board is bounded to the viewport under the page header, so align-items: stretch gives every column the same definite, working height (regression)', () => {
  assert.doesNotMatch(css, /main#board\s*\{[^}]*height:\s*auto/,
    'height is bounded, not auto — a column stretched to an unbounded main#board never gets a definite, scrollable box');
  assert.match(css, /main#board\s*\{[^}]*height:\s*calc\([^)]*var\(--board-header-h/,
    'the bound is derived from the real page-header height (--board-header-h), not a guessed fixed px');
});

test('each .column is a column flexbox (header, then an independently-scrolling card list) and clips content to its own rounded box (regression)', () => {
  assert.match(css, /\.column\s*\{[^}]*display:\s*flex/, 'column is a flex container');
  assert.match(css, /\.column\s*\{[^}]*flex-direction:\s*column/, 'stacks header above card list, not side by side');
  assert.match(css, /\.column\s*\{[^}]*overflow:\s*hidden/, 'clips to its own box — no more content spilling out past a height-capped column');
});

test('.column-cards — not main#board or .column — is what actually scrolls vertically, one column at a time (regression)', () => {
  assert.match(css, /\.column-cards\s*\{[^}]*flex:\s*1/, 'fills whatever height .column-header did not use');
  assert.match(css, /\.column-cards\s*\{[^}]*min-height:\s*0/, 'without this, a flex item refuses to shrink below its content size and the scroll never engages');
  assert.match(css, /\.column-cards\s*\{[^}]*overflow-y:\s*auto/, 'this column\'s own card list scrolls independently of every other column');
  assert.doesNotMatch(css, /main#board\s*\{[^}]*overflow-y:\s*auto/, 'main#board itself has no reason to scroll vertically any more — that would fight each column\'s own scroll');
});

test('the page header is sticky to the viewport top, opaque, and layered above ordinary board content', () => {
  assert.match(css, /header\s*\{[^}]*position:\s*sticky/, 'header sticks');
  assert.match(css, /header\s*\{[^}]*top:\s*0/, 'sticks to the very top');
  assert.match(css, /header\s*\{[^}]*background:\s*var\(--paper\)/, 'opaque background — matches <body> so scrolled cards do not show through');
  const zMatch = css.match(/header\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(zMatch, 'header declares a z-index');
  assert.ok(Number(zMatch[1]) < 30, 'header stacks below the modal backdrop (30) so popups still overlay it');
});

test('each column header stays visible above its own column\'s scrolling card list without needing position: sticky (regression)', () => {
  assert.doesNotMatch(css, /\.column-header\s*\{[^}]*position:\s*sticky/,
    'sticky is gone — the header is simply outside the region that scrolls (.column-cards), so it can never scroll away in the first place');
  assert.match(css, /\.column-header\s*\{[^}]*flex-shrink:\s*0/, 'stays its natural height even if the header row wraps');
  assert.match(css, /\.column-header\s*\{[^}]*background:\s*var\(--surface\)/, 'opaque background — matches .column');
});

test('--board-header-h has a sane CSS fallback for the instant before app.js\'s first measurement runs', () => {
  const m = css.match(/main#board\s*\{[^}]*height:\s*calc\([^)]*var\(--board-header-h,\s*(\d+)px\)/);
  assert.ok(m, 'a var() fallback value is present');
  assert.ok(Number(m[1]) > 0, 'fallback is a positive pixel value');
});

test('app.js defines syncBoardHeaderHeight, publishing the page header\'s real rendered height as --board-header-h', () => {
  assert.match(appJs, /function syncBoardHeaderHeight\s*\(/, 'the sync function exists');
  assert.match(appJs, /setProperty\(\s*['"]--board-header-h['"]/, 'it writes the exact CSS var app.css consumes');
  assert.match(appJs, /header\.offsetHeight/, 'it measures the header\'s real rendered height, not a guess');
});

test('syncBoardHeaderHeight is wired at DOMContentLoaded (static markup, no need to wait on the board fetch) and kept live via ResizeObserver', () => {
  assert.match(appJs, /DOMContentLoaded[\s\S]*?syncBoardHeaderHeight\(\)/, 'called eagerly at DOMContentLoaded');
  assert.match(appJs, /ResizeObserver\(syncBoardHeaderHeight\)\.observe\(headerEl\)/, 'kept current across wraps/resizes via ResizeObserver');
  assert.match(appJs, /window\.addEventListener\(\s*['"]resize['"]\s*,\s*syncBoardHeaderHeight\)/, 'falls back to a resize listener when ResizeObserver is unavailable');
});

test('renderBoardColumns preserves every column\'s own scroll position (and #board\'s horizontal one) across a rebuild (regression follow-on)', () => {
  // Now that each .column-cards scrolls independently (see the per-column
  // scroll test above), wiping and rebuilding #board's children on every
  // renderBoard() call — including the unconditional 5s auto-refresh poll,
  // AUTO_REFRESH_MS below — would silently snap every column back to its
  // top every few seconds unless each one's position is read before the
  // wipe and restored after, keyed by column id (not index — a column can
  // be added/removed/reordered by a config change between renders). Same
  // fix class as renderMapView's pre-existing keepLeft/keepTop.
  assert.match(appJs, /function renderBoardColumns\s*\(/, 'renderBoardColumns is defined');
  assert.match(appJs, /const\s+AUTO_REFRESH_MS\s*=\s*5000/, 'sanity: the poll really is unconditional and frequent enough that this matters');
  assert.match(appJs,
    /const\s+keepColumnTops\s*=\s*new Map\(\);[\s\S]{0,300}\.column-cards[\s\S]{0,300}keepColumnTops\.set\(/,
    'reads each column\'s .column-cards scrollTop, keyed by column id, before the wipe');
  assert.match(appJs, /board\.innerHTML\s*=\s*['"]{2}/, 'still wipes and rebuilds #board\'s children');
  // The restore must happen AFTER board.appendChild(colEl) — an unattached
  // node has no layout, so scrollHeight/clientHeight both read 0 and the
  // browser silently clamps any assigned scrollTop back to 0 (a real bug
  // caught by this same real-app CDP verification: the first cut of this
  // fix set list.scrollTop while colEl was still detached and it silently
  // no-opped every time).
  assert.match(appJs,
    /board\.appendChild\(colEl\);[\s\S]{0,500}keepColumnTops\.has\(col\)[\s\S]{0,120}colEl\.querySelector\('\.column-cards'\)\.scrollTop\s*=\s*keepColumnTops\.get\(col\)/,
    'restores that column\'s saved scroll position only after colEl is attached to the live #board');
  assert.match(appJs, /board\.scrollLeft\s*=\s*keepBoardLeft/,
    'main#board\'s own horizontal scroll (pre-existing, unrelated to this card) is preserved too');
});

// --- other views must be untouched (card ask: "other views must be unaffected") -

test('the sticky/stretch board-layout rules never touch #map-view/#calendar-view/#gantt-view', () => {
  for (const sel of ['.map-view', '.calendar-view', '.gantt-view']) {
    const rule = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*\\}`);
    const m = css.match(rule);
    assert.ok(m, `${sel} still has its own rule block`);
    assert.doesNotMatch(m[0], /position:\s*sticky/, `${sel} did not gain a sticky rule from this card`);
  }
});

test('app.html loads app.js after the header markup exists, so syncBoardHeaderHeight can measure it synchronously', () => {
  assert.ok(appHtml.indexOf('<header>') < appHtml.indexOf('<script src="/app.js">'), 'header markup precedes the app.js script tag');
});

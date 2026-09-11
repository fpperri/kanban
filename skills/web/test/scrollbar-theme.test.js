const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- theme every visible scrollbar to match the dark page
// palette instead of default OS chrome (a follow-up to the per-column
// scroll containers) --------------------------------------------------
// CSS-only, so pinned as structure tests against app.css's source text (same
// convention as status-colors.test.js / board-header-layout.test.js): every
// scrollable surface the app owns gets both the Firefox properties
// (scrollbar-width/scrollbar-color) and the Chromium/Edge pseudo-elements
// (::-webkit-scrollbar*), reusing existing palette hexes rather than
// introducing a new color family.

const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');

// Every scrollable container the app owns: the page itself, the
// per-column vertical lists and horizontal board strip, popup/modal scroll
// areas, the gantt/map horizontal scrollers, and the calendar hour grid.
const SCROLL_SELECTORS = [
  'html',
  'main#board',
  '.column-cards',
  '.modal',
  '.detail-body pre',
  '.map-view',
  '.gantt-scroll',
  '.cal-tg-scroll',
];

function escapeSelector(sel) {
  return sel.replace(/[.#]/g, '\\$&');
}

// A selector's rule may sit anywhere in a shared comma-separated group, so
// each match is anchored on the selector followed by either `,` (another
// selector follows) or `{` (it's the last one before the declaration block).
function selectorMatches(selector, property, valueFragment) {
  const escaped = escapeSelector(selector);
  const rule = new RegExp(`${escaped}\\s*[,{][\\s\\S]{0,600}?${property}:\\s*${valueFragment}`);
  return rule.test(css);
}

test('every scrollable surface sets Firefox scrollbar-width/scrollbar-color, thin and reusing an existing border tone', () => {
  for (const sel of SCROLL_SELECTORS) {
    assert.ok(selectorMatches(sel, 'scrollbar-width', 'thin'), `${sel} is in the scrollbar-width: thin group`);
  }
  assert.match(css, /scrollbar-color:\s*var\(--line\)\s+transparent/, 'thumb reuses the existing border tone via var(--line); track is transparent so it blends into whatever surface it sits on');
});

test('every scrollable surface gets the Chromium/Edge ::-webkit-scrollbar treatment (primary target incl. VSCode Simple Browser)', () => {
  for (const sel of SCROLL_SELECTORS) {
    const escaped = escapeSelector(sel);
    assert.match(css, new RegExp(`${escaped}::-webkit-scrollbar\\s*[,{]`), `${sel}::-webkit-scrollbar is styled`);
    assert.match(css, new RegExp(`${escaped}::-webkit-scrollbar-thumb\\s*[,{]`), `${sel}::-webkit-scrollbar-thumb is styled`);
  }
});

test('the webkit scrollbar is slim (narrower than the ~17px OS default) and the thumb brightens on hover without a new hex family', () => {
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*width:\s*8px/, 'width is slim');
  assert.match(css, /::-webkit-scrollbar\s*\{[^}]*height:\s*8px/, 'height is slim (horizontal scrollers: main#board, .gantt-scroll)');
  assert.match(css, /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--line\)/, 'thumb rests at the existing border tone');
  assert.match(css, /::-webkit-scrollbar-thumb:hover\s*\{[^}]*background:\s*var\(--mut\)/, 'thumb hover brightens to the existing muted-text tone — still no new hex');
});

test('the webkit scrollbar track is transparent, not a hardcoded fill (containers sit on different backgrounds: page var(--paper) vs column/modal/map/gantt var(--surface))', () => {
  assert.match(css, /::-webkit-scrollbar-track\s*[,{][\s\S]{0,600}?background:\s*transparent/, 'track blends into whichever surface it is over');
});

// The bug guarded: overflow: auto is silently inert unless
// the box has a height/max-height of its own — a plain block child of body
// (which sets neither) just grows to fit its content, so it never overflows
// itself and its ::-webkit-scrollbar* rules never fire; html scrolls instead.
// .map-view is the one themed selector with no bounded ancestor of its own
// (main#board, .column-cards, .modal, .detail-body pre and the calendar/
// gantt scrollers all get a real height/max-height elsewhere in this file),
// so it needs its own explicit bound for the theming above to ever render.
test('.map-view has its own height bound, so its overflow: auto (and the themed scrollbar rules above) can actually fire instead of silently growing the page', () => {
  assert.match(css, /\.map-view\s*\{[^}]*\b(?:height|max-height):/, '.map-view sets height or max-height on itself, not just overflow: auto');
});

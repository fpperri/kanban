'use strict';
// Pure status → color rules for dynamic columns. No DOM here — same
// dual-environment pattern as column-state.js/priority-badge.js: loaded as a
// plain <script> in the browser (app.js calls these as bare globals) AND
// required directly by node --test.
//
// Every identity is one hue with two lightnesses: the constants named
// without a theme are the values for a DARK ground (the ones the shop's
// status page copies), the LIGHT_* twins are the same hues darkened to read
// on a light ground. app.css carries both as --st-*/--hash-*/--id-* tokens in
// its theme blocks (themeColorTokens below, pinned by status-colors.test.js).
// Any OTHER status — a custom
// column from config.yaml's `statuses` list or an unlisted value on disk —
// gets a deterministic color by hashing its (lowercased, trimmed) name into a
// fixed 8-color palette, so the same name colors the same everywhere,
// forever, with no state to store. Overlap with the built-in hues is fine:
// determinism, not uniqueness, is the contract.

const BUILTIN_STATUS_COLORS = {
  backlog: '#39c5cf', // cyan — the old grey #8b949e read as archived at a glance
  todo: '#58a6ff',
  doing: '#3fb950',
  done: '#a371f7',
};

// Archive is a LOCATION, not a status (ADR 0002) — it gets the one
// neutral near-grey, ceded by backlog so grey now means "archived" and nothing
// else. NOT in BUILTIN_STATUS_COLORS (isBuiltinStatus stays a four-status
// answer), but statusColor maps the literal names anyway: cards are never
// validated, so an unlisted on-disk `status: archive` — or `archived`, the
// kanban/archived/ folder's own name and the likelier hand-typed spelling —
// must mute like the archive column instead of hashing into a loud accent
// ('archived' used to hash to done's exact purple). Orange is off the table
// for any of this — epics claim it.
// Lifted from #6e7681, which measured 3.69:1 as the archive column header on
// the dark surface (the header is text, so it takes the 4.5:1 floor).
const ARCHIVE_COLOR = '#868e9a';

// The epic/wayfinder accent — orange, reserved among the fixed
// colors (no built-in status or archive ever wears it). Same hex as
// STATUS_PALETTE's orange slot on purpose: a
// custom status can still hash there (determinism, not uniqueness, is the
// hash contract). Circles are
// reserved for STATUS alone, so an epic instead paints a faint
// background wash on whatever surface it's on (epicColorSoft() below; each
// surface's `.epic` CSS rule in app.css carries the actual paint). EPIC_COLOR
// also paints the map's epic-membership edges + arrowhead
// (lines, not circles) solid. This constant pins the hex
// via status-colors.test.js so CSS and JS can't drift.
const EPIC_COLOR = '#f0883e';

// GitHub-dark accent scale — visually distinct from each other and legible on
// the app's dark background. No grey slot: grey is ceded to archive, so
// no hashable status may land near it (the palette used to keep backlog's old
// #8b949e — 'review'/'frozen'/'icebox' hashed one shade from the archive grey,
// re-creating the archived-at-a-glance confusion for custom columns).
// Swapping a slot's hex is fair game: the hash contract is determinism per
// name within one code version, never hue stability across versions.
const STATUS_PALETTE = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#d29922', // amber
  '#a371f7', // purple
  '#f778ba', // pink
  '#39c5cf', // cyan
  '#f0883e', // orange
  '#ff7b72', // red — replaced the grey slot
];

// The same identities on a light ground. Each starts from GitHub Primer's
// light scale and is darkened just enough to clear 4.5:1 as text on white,
// on paper and on the chip ground; backlog and done sit a step deeper still,
// so the five statuses stay apart under protanopia and deuteranopia
// (status-colors.test.js simulates both).
const LIGHT_STATUS_COLORS = {
  backlog: '#0c5f65',
  todo: '#0266d7',
  doing: '#117a32',
  done: '#642cba',
};
const LIGHT_ARCHIVE_COLOR = '#626b75';
const LIGHT_EPIC_COLOR = '#b34906';
const LIGHT_STATUS_PALETTE = ['#0266d7', '#117a32', '#906001', '#642cba', '#b93384', '#0c5f65', '#b34906', '#ce202d'];

// Board signals that are not statuses: the high-priority / blocked / overdue
// red, the waiting amber and the review gold.
const SIGNAL_COLORS = {
  dark: { high: '#f85149', waiting: '#d29922', review: '#eac54f' },
  light: { high: '#ce212d', waiting: '#906001', review: '#7d6400' },
};

// Palette slot N paints the token --hash-<letter>. Letters, not digits,
// because the theme tests read token names as --[a-z-]+.
const HASH_SLOTS = 'abcdefgh';

// Every identity as the token app.css declares for it in one theme block.
function themeColorTokens(theme) {
  const light = theme === 'light';
  const builtin = light ? LIGHT_STATUS_COLORS : BUILTIN_STATUS_COLORS;
  const palette = light ? LIGHT_STATUS_PALETTE : STATUS_PALETTE;
  const signal = SIGNAL_COLORS[light ? 'light' : 'dark'];
  const out = {};
  for (const s of Object.keys(BUILTIN_STATUS_COLORS)) out[`st-${s}`] = builtin[s];
  out['st-archive'] = light ? LIGHT_ARCHIVE_COLOR : ARCHIVE_COLOR;
  palette.forEach((hex, i) => { out[`hash-${HASH_SLOTS[i]}`] = hex; });
  out['id-high'] = signal.high;
  out['id-waiting'] = signal.waiting;
  out['id-review'] = signal.review;
  out['id-epic'] = light ? LIGHT_EPIC_COLOR : EPIC_COLOR;
  return out;
}

function normalizeStatus(status) {
  return String(status == null ? '' : status).trim().toLowerCase();
}

function isBuiltinStatus(status) {
  return Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, normalizeStatus(status));
}

// djb2-xor over the normalized name — tiny, dependency-free, stable across
// Node and every browser (no reliance on String hashing or crypto). Exported
// so assignee-colors.js can hash handles into this SAME
// STATUS_PALETTE instead of forking the algorithm — one shared hash+palette
// pool, not two systems that happen to look alike.
function statusHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function statusColor(status) {
  const s = normalizeStatus(status);
  if (s === 'archive' || s === 'archived') return ARCHIVE_COLOR; // mute, never hash — both spellings (see ARCHIVE_COLOR)
  if (Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, s)) return BUILTIN_STATUS_COLORS[s];
  return STATUS_PALETTE[statusHash(s) % STATUS_PALETTE.length];
}

// The CSS class twin of statusColor() — same
// closed set of outcomes (the four built-ins, archive-mute, or one of the 8
// hashed palette slots), but named as a class suffix instead of a hex string.
// statusBadge() and the map SVG's custom-status dot (app.js buildMapSvg) both
// render this instead of writing the hex straight into an inline style
// attribute: a strict `style-src 'self'` CSP (no unsafe-inline) blocks the
// browser from applying HTML-attribute inline styles at all, silently
// leaving every status dot colorless. Because the value space is this same
// small fixed enum either way, a CSS class per outcome (app.css's
// `.status-dot--*` / `.map-status-dot.status-palette-N` rules) carries every
// case statusColor() can produce with zero inline style anywhere.
function statusColorClass(status) {
  const s = normalizeStatus(status);
  if (s === 'archive' || s === 'archived') return 'archive';
  if (Object.prototype.hasOwnProperty.call(BUILTIN_STATUS_COLORS, s)) return s;
  return `palette-${statusHash(s) % STATUS_PALETTE.length}`;
}

// What JavaScript paints with (the inline CSSOM writes for custom columns,
// filter-pill borders, custom gantt bars): a var() reference rather than a
// hex, so the colour follows the active theme the way every CSS rule does.
function statusColorVar(status) {
  const cls = statusColorClass(status);
  if (cls.startsWith('palette-')) return `var(--hash-${HASH_SLOTS[Number(cls.slice('palette-'.length))]})`;
  return `var(--st-${cls})`;
}

// The 12%-alpha wash the gantt bars use as their fill — derived from the same
// hex so the border/fill pair can never disagree.
function statusColorSoft(status) {
  const hex = statusColor(status);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

// Circles are reserved for STATUS alone, so an epic
// instead washes its whole surface in a faint EPIC_COLOR tint — no dot
// glyph. Same 12%-alpha
// convention statusColorSoft above already uses for the gantt bar's
// per-status fill, so the two read as one consistent "soft wash" language.
// Every consuming surface just adds an `epic` class (app.js) — app.css
// carries the actual rgba() per surface (`.card.epic`/`.cal-chip.epic`
// share one rule; `.gantt-bar.epic`/`.map-node.epic rect` are their own
// twins, since the bar's `background` is already spoken for by its
// per-status fill and the map node paints via SVG `fill`, not CSS
// `background`) — this function exists only so CSS and JS can't drift on the
// exact value (pinned by status-colors.test.js). The
// card detail popup is a surface too (`.modal.detail-modal.epic`) — same
// class-toggle-on-open pattern, its own rule since `.modal`'s solid
// background is spoken for like the gantt bar/map node above.
function epicColorSoft() {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(EPIC_COLOR.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0.12)`;
}

// Tiny local HTML-attribute escape, same duplication call priority-badge.js's
// badgeEscape already made rather than requiring assignee-badge.js's
// escapeHtml cross-file for one line of logic — the raw on-disk status lands
// in a title="" attribute below and free text is never trusted there (same
// reasoning as every other card-derived string in app.js).
function statusEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The shared status dot — renders on every card rendering (board
// tiles live+archived, the map's isolated-row tiles, calendar chips, gantt
// gutter rows — see app.js's cardEl/archiveCardEl/calendarChipEl and the
// gantt gutter label). Colored exactly like the map SVG's own status dot
// (buildMapSvg's <circle>).
//
// LOCKED RULE: STATUS DOTS NEVER MUTE. Muting archived dots to ARCHIVE_COLOR
// regardless of the raw status reads reasonable, but archived chains
// dominate any mature board's map forever — a headless measurement of a real
// board found the map rendering 18 nodes, ALL archived-done, ALL grey — so
// muting the dot empties the one
// channel that exists to carry status. Therefore
// the card's `archived` flag never touches this function's color at all;
// statusColor(status) alone decides it, live or archived. The literal on-disk
// statuses 'archive'/'archived' still mute (statusColor's own mapping
// — that genuinely IS their status color), but that's keyed off the RAW
// status string, never off the archived flag. The archived cue lives entirely
// in the tile's dimmed body/grey border, the "(archived)" tooltip, and
// ghost/selection treatments — none of them this function's concern.
// Like the SVG twin (a CSS class per built-in status, custom ones also a
// class — see statusColorClass above), this writes
// a class, never an inline style: a strict CSP has no channel left to break.
// The tooltip names the RAW status, same contract as the SVG dot's own <title>.
function statusBadge(card) {
  const status = card && card.status;
  const cls = statusColorClass(status);
  const label = String(status == null ? '' : status);
  return `<span class="status-dot status-dot--${cls}" title="${statusEscape(label)}"></span>`;
}

// The second shared dot glyph — a
// small ARCHIVE_COLOR grey ball with an "Archived" tooltip, joining
// statusBadge() on every surface that renders an ARCHIVED card (board
// Archive-column tiles, the map's isolated-row archived tiles, the gantt
// Archive-group gutter rows). Live cards NEVER render this — cardEl and
// calendarChipEl never call it, pinned as served-asset ABSENCE tests in
// server.test.js, same discipline as every other locked contract here.
// ARCHIVE_COLOR never varies per-card, so this needs no inline style at all;
// a plain CSS class (.archived-dot, app.css) carries the fixed color. The map
// SVG node's own twin lives in buildMapSvg (app.js): SVG has no <span> (an
// epic is
// a background wash, never a glyph in this sequence). Glyph order,
// applied identically on every surface that carries more than one dot:
// status, archived.
function archivedBadge() {
  return '<span class="archived-dot" title="Archived"></span>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BUILTIN_STATUS_COLORS, STATUS_PALETTE, ARCHIVE_COLOR, EPIC_COLOR, isBuiltinStatus, statusHash, statusColor, statusColorClass, statusColorSoft, epicColorSoft, statusBadge, archivedBadge,
    LIGHT_STATUS_COLORS, LIGHT_STATUS_PALETTE, LIGHT_ARCHIVE_COLOR, LIGHT_EPIC_COLOR, SIGNAL_COLORS, HASH_SLOTS, themeColorTokens, statusColorVar,
  };
} else {
  window.BUILTIN_STATUS_COLORS = BUILTIN_STATUS_COLORS;
  window.STATUS_PALETTE = STATUS_PALETTE;
  window.ARCHIVE_COLOR = ARCHIVE_COLOR;
  window.EPIC_COLOR = EPIC_COLOR;
  window.isBuiltinStatus = isBuiltinStatus;
  window.statusHash = statusHash;
  window.statusColor = statusColor;
  window.statusColorClass = statusColorClass;
  window.statusColorSoft = statusColorSoft;
  window.epicColorSoft = epicColorSoft;
  window.statusBadge = statusBadge;
  window.archivedBadge = archivedBadge;
  window.HASH_SLOTS = HASH_SLOTS;
  window.themeColorTokens = themeColorTokens;
  window.statusColorVar = statusColorVar;
}

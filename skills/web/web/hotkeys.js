'use strict';
// The list of hotkeys the preferences sheet's Hotkeys section shows: every key the page
// answers, what it does, and, for the keys that have one, the state it is in now. This
// file is the one list; the page's own handlers read the keys, and
// hotkeys-coverage.test.js fails when one reads a key that is not here.
//
// An entry has an `id`, the labels it shows (`keys`), the `e.key` values the page's
// handlers read for it (`reads`; a letter is read whatever its case), what it does
// (`what`) and, when it has a state, which one (`state`). The keys that act on a field's
// own list are not here: ArrowUp and ArrowDown move the highlight in the search box's
// suggestions, ArrowLeft and ArrowRight step the Calendar's notes divider while it has focus (it is a
// slider, the way those arrows are its own), the arrows move through the open card menu and its groups
// (menu-nest.js), and Shift is only noted as held. Tab is the browser's.
//
// Pure: the caller passes the state, so Node tests drive it with plain values. Same
// dual-environment export pattern as key-guard.js.
const HOTKEYS = [
  { id: 'search', keys: ['/'], reads: ['/'], what: 'Focus the search box.' },
  { id: 'find', keys: ['Ctrl/Cmd+F'], reads: ['f'], what: 'Focus the search box with # ready for a card number, or select what it holds. Works from inside a text field.' },
  { id: 'escape', keys: ['Esc'], reads: ['Escape'], what: 'Close the menu or popup that is up, then the search panel. With none up, in the search box it clears the box, and elsewhere it steps the selection back: isolate off, then the additions, then the anchor.' },
  { id: 'enter', keys: ['Enter'], reads: ['Enter'], what: 'Open the focused card. In a list of suggestions, take the highlighted one. In the search box, go to the first match; a second Enter opens it when it is the only one.' },
  { id: 'space', keys: ['Space'], reads: [' '], what: 'Select the focused card in the Graph, as a click does.' },
  { id: 'save', keys: ['Ctrl/Cmd+S'], reads: ['s'], what: 'Save the edit or bulk popup that is open.' },
  { id: 'fullscreen', keys: ['Alt+Enter'], reads: ['Enter'], what: 'Toggle fullscreen on the popup that is open.' },
  { id: 'note', keys: ['n'], reads: ['n'], what: 'Add a note on the card whose details are open, else on the hovered or selected card: opens the notes palette, where Enter writes the note and Shift+Enter starts a new line. With no card, on the Calendar it opens on the Calendar\'s own range, or on the day under the pointer; elsewhere on today. Needs a logbook: line in config.yaml.' },
  { id: 'note-row', keys: ['e', 'a', 'd d'], reads: ['e', 'a', 'd'], what: 'On a note in the notes palette: edit it, assign it to another card, or delete it (press d twice).' },
  { id: 'note-tabs', keys: ['Alt+1', 'Alt+2', 'Alt+3'], reads: ['1', '2', '3'], what: 'In the open notes palette: switch to its first, second or third tab, as the tab row shows them (Notes, Group, Scratchpad). Works from the note box too.' },
  { id: 'text-indent', keys: ['Tab', 'Shift+Tab'], reads: ['Tab'], what: 'In a multiline text box (the notes palette\'s note box and a note\'s edit box, the Scratchpad\'s box, the card form\'s description): indent the line, or every selected line, by two spaces, or outdent by up to two. Undo takes either back.' },
  { id: 'text-tab-focus', keys: ['Ctrl+M'], reads: ['m'], what: 'In those boxes: switch Tab between indenting and moving focus, for keyboard-only use. A hint shows while Tab moves focus; it lasts until the page is reloaded.' },
  { id: 'text-format', keys: ['Ctrl+B', 'Ctrl+I', 'Ctrl+U', 'Alt+S', 'Ctrl+E', 'Ctrl+K'], reads: ['b', 'i', 'u', 's', 'e', 'k'], what: 'In those boxes, on the selection: bold, italic, <u>underline</u>, strikethrough, code and a link, each taken off again when the selection already has it. With nothing selected the pair goes in with the cursor between.' },
  { id: 'text-lists', keys: ['Ctrl+Shift+7', 'Ctrl+Shift+8', 'Ctrl+Shift+.'], reads: ['7', '&', '8', '*', '.', '>'], what: 'In those boxes, on each selected line: a numbered list, a bullet list and a quote, taken off again when the lines already have it.' },
  { id: 'text-details', keys: ['Ctrl+Shift+D'], reads: ['d'], what: 'In those boxes: wrap the selected lines in a collapsible section (<details> with a <summary>), with the summary text selected to type over; with the cursor inside a section it made, take the wrapper off and keep the lines.' },
  { id: 'names', keys: ['l'], reads: ['l'], state: 'names', what: 'Step the names the Graph\'s tier fan draws: relevant, all, none.' },
  { id: 'slice', keys: ['[', ']', '{', '}'], reads: ['[', ']', '{', '}'], state: 'slice', what: 'Move the bottom of the run of slices up and down with [ and ], and its top up and down with { and }.' },
  { id: 'slice-keep', keys: ['Menu', 'Shift+F10'], reads: ['ContextMenu', 'F10'], what: 'On a focused slice entry in the search panel, keep only that slice, as a right-click does.' },
  { id: 'pill', keys: ['m', 'Shift+m'], reads: ['m'], state: 'pill', what: 'Turn on the next pill alone: blocked, review, waiting, then the board\'s own. Shift+m goes back, and after the last pill every pill is off.' },
  { id: 'isolate', keys: ['i'], reads: ['i'], state: 'isolate', what: 'Turn isolate on or off: show only the selection, in every view.' },
  { id: 'panel', keys: ['p'], reads: ['p'], state: 'panel', what: 'Switch whether the search panel opens when the search box is focused.' },
  { id: 'hotkeys', keys: ['?'], reads: ['?'], what: 'Open this list.' },
];

// What each state reads like, as `label: value`, from what the caller knows of the page:
// `names` (the tier fan's names option), `pills` (the labels of the pills that are on),
// `slice` (the value of the cut, '' for none), `isolate` and `panelOnFocus` (booleans). A
// value the caller leaves out reads as the page's own default.
const HOTKEY_STATES = {
  names: { label: 'names', value: (ctx) => ctx.names || 'relevant' },
  slice: { label: 'slice', value: (ctx) => ctx.slice || 'all' },
  pill: { label: 'pill', value: (ctx) => ((ctx.pills || []).length ? ctx.pills.join(', ') : 'off') },
  isolate: { label: 'isolate', value: (ctx) => (ctx.isolate ? 'on' : 'off') },
  panel: { label: 'panel on focus', value: (ctx) => (ctx.panelOnFocus === false ? 'off' : 'on') },
};

// The rows the sheet draws, in the list's order: { id, keys, what, state }, with `state`
// the text of the key's state, or null for a key that has none.
function hotkeyRows(ctx) {
  const now = ctx || {};
  return HOTKEYS.map((entry) => {
    const shown = entry.state ? HOTKEY_STATES[entry.state] : null;
    return { id: entry.id, keys: entry.keys, what: entry.what, state: shown ? `${shown.label}: ${shown.value(now)}` : null };
  });
}

// The key that opens the list: `?`, with Shift as most keyboards type it and without it where
// the layout has one. A chord (Ctrl, Cmd, Alt) and a held key are not it. The page reads the
// key guard besides (key-guard.js), so it types nothing: it stays off in a field and behind
// a menu, a dialog, the notifications panel or the preferences sheet.
function hotkeyIsHelp(e) {
  return !!e && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOTKEYS, hotkeyRows, hotkeyIsHelp };
} else {
  window.HOTKEYS = HOTKEYS;
  window.hotkeyRows = hotkeyRows;
  window.hotkeyIsHelp = hotkeyIsHelp;
}

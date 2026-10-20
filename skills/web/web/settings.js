'use strict';
// The gear's sheet apart from the DOM (docs/adr/0017): which layout a width gets, where Esc steps,
// what a switch or a folder field sends to the server, and how the menu words a page's state.
// settings-ui.js draws the pages and talks to the server; the server (settings-store.js) judges
// every value, so nothing here re-checks a folder or a width.
//
// The sheet has two sections. This browser holds the pages kept in localStorage (prefs.js). This
// board holds the pages written to config.yaml, one line at a time. A page is named `browser:<id>`
// or `board:<id>`.
//
// Pure: same dual-environment export pattern as groups.js — loaded as a plain <script> in the
// browser (one global per function) AND required by node --test.

const SETTINGS_IDS = (typeof module !== 'undefined' && module.exports) ? require('./ids') : window.kanbanIds;

const SETTINGS_WIDE_AT = 760;
const SETTINGS_DEFAULT_PAGE = 'browser:prefs';
const SETTINGS_MAX_DIGITS = 15;

// The pages kept in this browser, in menu order.
const SETTINGS_BROWSER_PAGES = [
  { id: 'prefs', title: 'Preferences' },
  { id: 'hotkeys', title: 'Hotkeys' },
];

// The folder a feature gets when it is switched on and has none to go back to.
const SETTINGS_FOLDERS = { logbook: 'logbook', groups: '.groups' };

// Menu and page side by side from this width up, else the menu drills down to a page.
function settingsIsWide(width) {
  return width >= SETTINGS_WIDE_AT;
}

// The page the sheet opens on: the one asked for; else, wide, the one it had or the first; else,
// narrow, none (the menu).
function settingsOpen(asked, current, wide) {
  if (asked) return asked;
  return wide ? current || SETTINGS_DEFAULT_PAGE : null;
}

// The window changed width with the sheet open: a wide sheet is never left without a page.
function settingsResized(page, wide) {
  return wide && !page ? SETTINGS_DEFAULT_PAGE : page;
}

// Esc: a narrow sheet on a page steps back to its menu; any other Esc closes the sheet.
function settingsEscape(page, wide) {
  if (!wide && page) return { open: true, page: null };
  return { open: false, page };
}

function settingsPageState(id, settings, foundGroups) {
  if (id === 'logbook' || id === 'groups') {
    const feature = settings[id];
    if (!feature.on) return 'off';
    if (feature.locked) return 'on · locked';
    return id === 'groups' ? `on · ${foundGroups}` : 'on';
  }
  if (id === 'prefixes') return String(settings.prefixes.length);
  return '';
}

// A feature's switch: off removes the line, on writes the folder it has or its default.
function settingsSwitchBody(key, on, folder) {
  if (key === 'iterations') return { key, value: !!on };
  if (!on) return { key, value: null };
  return { key, value: folder && folder.trim() !== '' ? folder.trim() : SETTINGS_FOLDERS[key] };
}

function settingsFolderBody(key, text) {
  return { key, value: String(text).trim() };
}

// What a typed folder plainly gets wrong, before the server is asked: no folder, the board itself,
// an absolute path or a way out of the board. '' = nothing the page can see; the server judges the
// rest (the characters of a name, and a path that comes back in through a link).
function settingsFolderProblem(text) {
  const t = String(text).trim().replace(/\\/g, '/');
  if (t === '') return 'Type a folder inside the board, or switch it off.';
  const parts = t.split('/');
  if (/^([A-Za-z]:|\/)/.test(t) || parts.includes('..')) {
    return 'A folder is a path inside the board, like .logbook. One outside the board is set by hand in config.yaml.';
  }
  if (parts.every((p) => p === '' || p === '.')) return 'That is the board itself: name a folder inside it.';
  return '';
}

function settingsDigitsBody(text) {
  return { key: 'idDigits', value: String(text).trim() };
}

function settingsDigitsProblem(text) {
  const t = String(text).trim();
  return /^[0-9]+$/.test(t) && Number(t) >= 1 && Number(t) <= SETTINGS_MAX_DIGITS ? '' : `idDigits is a whole number from 1 to ${SETTINGS_MAX_DIGITS}.`;
}

// How a file named with the board's idDigits starts: card 7, zero-padded.
function settingsIdExample(digits) {
  return SETTINGS_IDS.formatId(7, Number.isInteger(digits) ? digits : undefined);
}

// The groups the board found, by type path in order ('' = no type first), each by id.
function settingsGroupsFound(list) {
  const folders = [...new Set(list.map((g) => g.folder))].sort();
  return folders.map((folder) => ({
    folder,
    label: folder === '' ? '(no type)' : folder,
    groups: list.filter((g) => g.folder === folder).sort((a, b) => SETTINGS_IDS.compareIds(a.id, b.id)),
  }));
}

// A `prefixes:` row as the table words it: a card type, or a folder of the groups folder.
function settingsPrefixTarget(row, groupsFolder) {
  if (row.kind === 'type') return `card type ${row.target}`;
  const root = groupsFolder || SETTINGS_FOLDERS.groups;
  return row.folder === '' ? `${root}/ (no type)` : `${root}/${row.folder}/`;
}

const SETTINGS_EXPORTS = {
  settingsIsWide, settingsOpen, settingsResized, settingsEscape, settingsPageState, settingsSwitchBody,
  settingsFolderBody, settingsFolderProblem, settingsDigitsBody, settingsDigitsProblem, settingsIdExample, settingsGroupsFound, settingsPrefixTarget,
  SETTINGS_BROWSER_PAGES, SETTINGS_DEFAULT_PAGE, SETTINGS_FOLDERS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SETTINGS_EXPORTS;
} else {
  Object.assign(window, SETTINGS_EXPORTS);
}

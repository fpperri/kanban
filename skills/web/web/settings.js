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

const SETTINGS_NODE = typeof module !== 'undefined' && module.exports;
const SETTINGS_IDS = SETTINGS_NODE ? require('./ids') : window.kanbanIds;
const SETTINGS_SCOL = SETTINGS_NODE ? require('./status-colors') : window;

const SETTINGS_WIDE_AT = 760;
const SETTINGS_DEFAULT_PAGE = 'browser:prefs';
const SETTINGS_MAX_DIGITS = 15;

// The pages kept in this browser, in menu order.
const SETTINGS_BROWSER_PAGES = [
  { id: 'prefs', title: 'Preferences' },
  { id: 'hotkeys', title: 'Hotkeys' },
];

// The folder a feature gets when it is switched on and has none to go back to.
const SETTINGS_FOLDERS = { logbook: 'logbook', scratchpad: '.scratchpad', groups: '.groups' };

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
  if (id === 'logbook' || id === 'scratchpad' || id === 'groups') {
    const feature = settings[id];
    if (!feature.on) return 'off';
    if (feature.locked) return 'on · locked';
    return id === 'groups' ? `on · ${foundGroups}` : 'on';
  }
  if (id === 'prefixes') return String(settings.prefixes.length);
  if (id === 'types') return settings.typesOn ? String(settings.types.length) : 'off';
  return '';
}

// A feature's switch: off removes the line, on writes the folder it has or its default.
// Every save names the version of config.yaml the page read, so a file changed since is refused.
function settingsWithVersion(body, version) {
  return version === undefined ? body : { ...body, version };
}

function settingsSwitchBody(key, on, folder, version) {
  if (key === 'iterations') return settingsWithVersion({ key, value: !!on }, version);
  if (!on) return settingsWithVersion({ key, value: null }, version);
  return settingsWithVersion({ key, value: folder && folder.trim() !== '' ? folder.trim() : SETTINGS_FOLDERS[key] }, version);
}

function settingsFolderBody(key, text, version) {
  return settingsWithVersion({ key, value: String(text).trim() }, version);
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

function settingsDigitsBody(text, version) {
  return settingsWithVersion({ key: 'idDigits', value: String(text).trim() }, version);
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

// ---------- the file or folder a page reads ----------

// What each page of This board reads, in one table: which of the settings' `paths` it is, and the
// word the path bar puts before it.
const SETTINGS_PAGE_READS = {
  types: { path: 'config', kind: 'File' },
  prefixes: { path: 'config', kind: 'File' },
  counters: { path: 'config', kind: 'File' },
  logbook: { path: 'logbook', kind: 'Folder' },
  scratchpad: { path: 'scratchpad', kind: 'Folder' },
  groups: { path: 'groups', kind: 'Folder' },
};

// { kind, path } the page of This board reads, for its path bar and Copy button; null when the
// page has none or its feature is off.
function settingsPageReads(id, settings) {
  const reads = SETTINGS_PAGE_READS[id];
  const paths = settings && settings.paths;
  if (!reads || !paths || !paths[reads.path]) return null;
  return { kind: reads.kind, path: paths[reads.path] };
}

// The absolute path the page of This board reads, for its copy button; null when the feature is off.
function settingsPagePath(id, settings) {
  const reads = settingsPageReads(id, settings);
  return reads ? reads.path : null;
}

// ---------- the Types page (docs/adr/0018) ----------
//
// Every function here answers the list a change would write and never touches the one it was given.
// A rename or a removal answers the types list only; the hierarchy and the prefixes keep naming the
// old word, and the page shows each leftover as a warning (settingsTypeWarnings).

const SETTINGS_LEFTOVER_WHY = 'changes only the type list';

function settingsTypeKey(name) {
  return String(name == null ? '' : name).trim().toLowerCase();
}

// Where `name` is in a list: the entry spelled exactly so, else the first that differs only in
// capitals. Names that differ only in capitals are kept as the file wrote them, so a row acts on its
// own entry and not on its twin. `nameOf` reads the name of an entry that is not a bare name.
function settingsIndexOf(list, name, nameOf = (x) => x) {
  const exact = list.findIndex((x) => nameOf(x) === name);
  return exact !== -1 ? exact : list.findIndex((x) => settingsTypeKey(nameOf(x)) === settingsTypeKey(name));
}

// The two areas: the hierarchy in its order (a name with no listed type has `type: null`, a warning
// chip) and the rest of the types in their order. Names meet without regard to case.
function settingsTypeAreas(types, hierarchy) {
  const at = hierarchy.map((name) => settingsIndexOf(types, name, (t) => t.name));
  return {
    hierarchy: hierarchy.map((name, i) => ({ name, type: types[at[i]] || null })),
    other: types.filter((_, i) => !at.includes(i)),
  };
}

// How many cards carry the type, whatever the capitals the card wrote. `typeUse` is the settings'
// count of cards by the word as written.
function settingsTypeUseCount(typeUse, name) {
  const key = settingsTypeKey(name);
  let n = 0;
  for (const word of Object.keys(typeUse || {})) if (settingsTypeKey(word) === key) n += typeUse[word];
  return n;
}

// The words cards carry that no listed type has, spellings merged, the most used first.
function settingsFoundOnCards(types, typeUse) {
  const listed = new Set(types.map((t) => settingsTypeKey(t.name)));
  const found = new Map();
  for (const word of Object.keys(typeUse || {})) {
    const key = settingsTypeKey(word);
    if (key === '' || listed.has(key)) continue;
    const at = found.get(key) || { count: 0, best: 0, word };
    at.count += typeUse[word];
    if (typeUse[word] > at.best) { at.best = typeUse[word]; at.word = word; }
    found.set(key, at);
  }
  return [...found.values()].map((f) => ({ word: f.word, count: f.count })).sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

// One row down (+1) or up (-1) in the hierarchy; null at an end or for a name not in it.
function settingsMoveType(hierarchy, name, delta) {
  const at = settingsIndexOf(hierarchy, name);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= hierarchy.length) return null;
  const next = [...hierarchy];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

// A type dropped into an area. Into 'hierarchy' at `index` (counted among the rows as drawn, the
// dragged one included): the new hierarchy, null when it lands where it was. Into 'other': the name
// leaves the hierarchy, null when it was not in it (the order of Other types is the types list's).
function settingsDropType(hierarchy, name, area, index) {
  const at = settingsIndexOf(hierarchy, name);
  if (area === 'other') return at === -1 ? null : hierarchy.filter((_, i) => i !== at);
  const entry = at === -1 ? String(name).trim() : hierarchy[at];
  const to = Math.max(0, Math.min(index, hierarchy.length));
  if (at !== -1 && (to === at || to === at + 1)) return null;
  const rest = hierarchy.filter((_, i) => i !== at);
  rest.splice(at !== -1 && to > at ? to - 1 : to, 0, entry);
  return rest;
}

// Where a drop lands among the Hierarchy rows: how many rows have their midpoint above the pointer.
function settingsDropIndex(mids, y) {
  return mids.filter((m) => m < y).length;
}

function settingsTypeEntry(name, color, icon) {
  const entry = { name };
  if (color) entry.color = color;
  if (icon) entry.icon = icon;
  return entry;
}

function settingsTypesAdd(types, name) {
  return [...types.map((t) => ({ ...t })), { name: String(name).trim() }];
}

function settingsTypesRename(types, from, to) {
  const at = settingsIndexOf(types, from, (t) => t.name);
  return types.map((t, i) => (i === at ? settingsTypeEntry(String(to).trim(), t.color, t.icon) : { ...t }));
}

// Sets a type's color and/or icon; '' clears it.
function settingsTypesPatch(types, name, patch) {
  const at = settingsIndexOf(types, name, (t) => t.name);
  return types.map((t, i) => {
    if (i !== at) return { ...t };
    const color = patch.color !== undefined ? patch.color : t.color;
    const icon = patch.icon !== undefined ? patch.icon : t.icon;
    return settingsTypeEntry(t.name, color, icon);
  });
}

function settingsTypesRemove(types, name) {
  const at = settingsIndexOf(types, name, (t) => t.name);
  return types.filter((_, i) => i !== at).map((t) => ({ ...t }));
}

// A save of one whole block, with the version of config.yaml the page read.
function settingsBlockBody(block, value, version) {
  return { block, value, version };
}

function settingsTypesOnBody(on, version) {
  return { key: 'typesOn', value: !!on, version };
}

// What a typed type name plainly gets wrong, before the server is asked: it must not match another
// listed type, with or without capitals. `self` = the type being renamed. Only what the person just
// typed is checked; a name already in the file is never refused.
function settingsTypeNameProblem(types, text, self) {
  const key = settingsTypeKey(text);
  if (key === '') return 'A card type needs a name.';
  const own = self == null ? -1 : settingsIndexOf(types, self, (t) => t.name);
  if (types.some((t, i) => i !== own && settingsTypeKey(t.name) === key)) {
    return `There is already a card type named ${String(text).trim()}: a name is the same with or without capitals.`;
  }
  return '';
}

const SETTINGS_HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// A color the person types in the hex field. A color already in the file may be a name (docs/adr/0004)
// and is shown and saved as written; this checks only what is typed now.
function settingsColorProblem(text) {
  const t = String(text).trim();
  return t === '' || SETTINGS_HEX_COLOR.test(t) ? '' : 'A color is a hex color like #e3b341, or empty for none.';
}

// The swatches beside the hex field: the colors the starter config gives its types, then the rest of
// the status palette the board uses, each once.
const SETTINGS_STARTER_COLORS = ['#e3b341', '#f0883e', '#a371f7', '#58a6ff', '#3fb950'];
const SETTINGS_TYPE_SWATCHES = [...new Set([...SETTINGS_STARTER_COLORS, ...SETTINGS_SCOL.STATUS_PALETTE.map((c) => c.toLowerCase())])];

// The prefix a card type has in the prefixes: block, '' for none. Read only on the Types page.
function settingsPrefixOf(prefixes, type) {
  const key = settingsTypeKey(type);
  const row = prefixes.find((r) => r.kind === 'type' && settingsTypeKey(r.target) === key);
  return row ? row.prefix : '';
}

function settingsCardsWord(n) {
  return n === 1 ? '1 card still says' : `${n} cards still say`;
}

// Every leftover of the lists on the Types page, each ONE bullet: what, then why.
// `renamed` = the words renamed in this sitting, old -> new.
function settingsTypeWarnings({ types, hierarchy, prefixes, typeUse, renamed }) {
  const listed = new Set(types.map((t) => settingsTypeKey(t.name)));
  const out = [];
  for (const name of hierarchy) {
    if (!listed.has(settingsTypeKey(name))) out.push(`\`${name}\` is still in the hierarchy. Why: renaming or removing a type ${SETTINGS_LEFTOVER_WHY}; ask an AI to update the hierarchy, the prefixes and the cards.`);
  }
  for (const old of Object.keys(renamed || {})) {
    const n = settingsTypeUseCount(typeUse, old);
    if (n > 0 && !listed.has(settingsTypeKey(old))) out.push(`${settingsCardsWord(n)} \`${old}\`. Why: renaming a type ${SETTINGS_LEFTOVER_WHY}; ask an AI to update the cards, the hierarchy and the prefixes.`);
  }
  out.push(...settingsPrefixWarnings(prefixes, types));
  return out;
}

// A prefix that names a card type the list no longer has.
function settingsPrefixWarnings(prefixes, types) {
  const listed = new Set(types.map((t) => settingsTypeKey(t.name)));
  return prefixes.filter((r) => r.kind === 'type' && !listed.has(settingsTypeKey(r.target)))
    .map((r) => `The prefix \`${r.prefix}\` still names \`${r.target}\`, which is not a listed type. Why: removing or renaming a type ${SETTINGS_LEFTOVER_WHY}; ask an AI to update the prefixes.`);
}

// A prefix two lines name for different targets: the board reads the first, and a save of the block
// writes it without the other, so say so before it happens.
function settingsPrefixClashWarnings(clashes) {
  return (clashes || []).map((c) => `The prefix \`${c.prefix}\` is declared twice: \`${c.kept}\` is kept and the line for \`${c.ignored}\` is ignored. Saving this page rewrites the prefixes block without that line. Why: a prefix names one card type or one groups folder, and the board reads the first line.`);
}

const settingsConflictNote = 'config.yaml changed on disk after this page read it, so nothing was saved. Why: a save rewrites a whole list and would overwrite that change; the page read the file again, so make the change again if it still applies.';

// The confirm text for removing a type some cards carry; null when none does.
function settingsRemoveConfirm(name, cards) {
  if (cards <= 0) return null;
  return `${cards} card${cards === 1 ? '' : 's'} say${cards === 1 ? 's' : ''} \`${name}\`. Remove it from the type list? The cards keep their type; nothing else is rewritten.`;
}

// ---------- the Prefixes page ----------

const settingsPrefixNote = 'Changing a prefix changes only the ids given from then on. Why: cards already made keep their ids; ask an AI to migrate the board to rename existing cards.';

// The rows as the block is written: { prefix, target } in order, the target as it stands in the file.
function settingsPrefixList(rows) {
  return rows.map((r) => ({ prefix: r.prefix, target: r.target }));
}

// The edits find their row by the prefix it had when the person edited it; null when no row has it any more.
function settingsPrefixSet(list, from, patch) {
  if (!list.some((r) => r.prefix === from)) return null;
  return list.map((r) => (r.prefix === from ? { ...r, ...patch } : { ...r }));
}

function settingsPrefixAdd(list, prefix, target) {
  return [...list.map((r) => ({ ...r })), { prefix, target }];
}

function settingsPrefixRemove(list, from) {
  if (!list.some((r) => r.prefix === from)) return null;
  return list.filter((r) => r.prefix !== from).map((r) => ({ ...r }));
}

// What a typed prefix row plainly gets wrong; the server judges the letters. `self` = the prefix of the row being edited.
function settingsPrefixProblem(list, prefix, target, self) {
  const p = String(prefix).trim();
  if (p === '') return 'A prefix is the letters an id starts with, like G.';
  if (String(target).trim() === '') return `The prefix ${p} needs a card type or a groups folder.`;
  if (list.some((r) => r.prefix !== self && r.prefix === p)) return `The prefix ${p} is already declared: a prefix names one card type or one groups folder.`;
  return '';
}

function settingsPrefixConfirm(kind, prefix, target) {
  const verb = { change: 'Change', add: 'Add', remove: 'Remove' }[kind];
  return `${verb} the prefix ${prefix} (${target})? Cards already made keep their ids; ask an AI to migrate the board to rename them.`;
}

const SETTINGS_EXPORTS = {
  settingsIsWide, settingsOpen, settingsResized, settingsEscape, settingsPageState, settingsSwitchBody,
  settingsFolderBody, settingsFolderProblem, settingsDigitsBody, settingsDigitsProblem, settingsIdExample, settingsGroupsFound, settingsPrefixTarget,
  settingsPagePath, settingsPageReads, settingsWithVersion, settingsDropIndex, settingsTypeKey, settingsTypeAreas, settingsTypeUseCount, settingsFoundOnCards, settingsMoveType, settingsDropType,
  settingsTypesAdd, settingsTypesRename, settingsTypesPatch, settingsTypesRemove, settingsBlockBody, settingsTypesOnBody,
  settingsTypeNameProblem, settingsColorProblem, settingsPrefixOf, settingsIndexOf, settingsTypeWarnings, settingsPrefixWarnings, settingsPrefixClashWarnings,
  settingsConflictNote, settingsRemoveConfirm, settingsPrefixNote, settingsPrefixList, settingsPrefixSet, settingsPrefixAdd,
  settingsPrefixRemove, settingsPrefixProblem, settingsPrefixConfirm,
  SETTINGS_BROWSER_PAGES, SETTINGS_DEFAULT_PAGE, SETTINGS_FOLDERS, SETTINGS_TYPE_SWATCHES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SETTINGS_EXPORTS;
} else {
  Object.assign(window, SETTINGS_EXPORTS);
}

'use strict';
// The config the gear's This board pages show and write (docs/adr/0017). Reading answers each
// feature's switch and folder, whether the folder is one the page may change, the id width, and
// the prefixes and counters as read-only tables, plus what the Types page needs: the types, the
// hierarchy, whether types are on, how many cards carry each type word, a version of the file and
// the absolute path each page shows with its copy button. Writing replaces, inserts or removes ONE
// top-level line of config.yaml through config-store's writeConfigLine, or rewrites ONE whole
// block (`types:`, `hierarchy:`, `prefixes:`) through writeConfigBlock (docs/adr/0018), so every
// other byte stays (the human's comments, unknown keys, the file's line ending). A write may send
// the `version` it read: when the file has changed since, it is refused (409) and nothing is written.
//
// A folder the server reads and writes may sit outside the board, but only a hand edit of
// config.yaml puts it there: the web accepts a folder inside the board only, saved relative to it,
// and a folder already outside it is locked (read for display, refused for every change). Request
// text never builds a path to a file: it is only ever written as the text of a config line, and
// the stores build every file name themselves from a day and an id.
//
// Changing a folder changes the line and nothing else: the files stay where they were.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config-store');
const cs = require('./card-store');
const yaml = require('./yaml-list');
const { StatusError, posix } = require('./store-common');

// Where a line is inserted when its key is not in the file yet: below the first of these keys the
// file has, else at the top. The keys the gear writes follow the id lines, in the order the config
// documents them.
const ID_LINES = ['idDigits', 'nextId', 'name'];

// The features that take a folder. Adding one is a line here and its reader in config-store.
const FOLDER_KEYS = {
  logbook: { label: 'logbook', after: ID_LINES },
  scratchpad: { label: 'scratchpad', after: ['logbook', ...ID_LINES] },
  groups: { label: 'groups', after: ['scratchpad', 'logbook', ...ID_LINES] },
};

const WRITABLE = ['iterations', 'typesOn', 'idDigits', ...Object.keys(FOLDER_KEYS)];

const BLOCKS = ['types', 'hierarchy', 'prefixes'];

const MAX_ID_DIGITS = 15;

const LOCKED_REASON = 'This folder is outside the board. It was set by hand in config.yaml, and only a hand edit changes it.';

// A folder in config.yaml as the path from the board to it, or null when it leaves the board. The
// board itself is '' (a folder that is not inside it).
function relativeToBoard(dir, value) {
  const text = String(value).trim().replace(/\\/g, '/');
  if (text === '') return null;
  const rel = path.relative(path.resolve(dir), path.resolve(dir, text));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) ? null : posix(rel);
}

// The same path when the folder is strictly inside the board, else null.
function insideBoard(dir, value) {
  const rel = relativeToBoard(dir, value);
  return rel === '' ? null : rel;
}

// The folder a request may write: inside the board, one plain name per segment, and none that would
// need quoting in the file. Returns the text to write, relative to the board.
function checkFolder(dir, value, what) {
  if (typeof value !== 'string') throw new StatusError(`The ${what} folder is text.`, 400);
  if (/[\u0000-\u001f]/.test(value)) throw new StatusError('A folder is one line of plain text.', 400);
  const rel = insideBoard(dir, value);
  if (rel === null) throw new StatusError('A folder from the page sits inside the board: write a path under it, like .logbook. A folder outside is set by hand in config.yaml.', 400);
  for (const part of rel.split('/')) {
    if (!/^[\p{L}\p{N}_.][\p{L}\p{N}_ .()+,@-]*$/u.test(part) || /[. ]$/.test(part)) {
      throw new StatusError(`${part} is not a plain folder name: use letters, digits, spaces and _ . - ( ) + , @.`, 400);
    }
  }
  return rel;
}

function folderState(dir, config, key) {
  const value = config[key];
  const on = value !== '';
  const outside = on && relativeToBoard(dir, value) === null;
  return { on, folder: value, locked: outside, reason: outside ? LOCKED_REASON : '' };
}

// One `prefixes:` entry as the page shows it: a card type, or a folder under the groups folder ('' = the root).
function prefixRows(config) {
  return Object.entries(config.prefixes).map(([prefix, target]) => {
    const folder = cfg.groupFolderOf(config, target);
    return folder === null ? { prefix, kind: 'type', target } : { prefix, kind: 'folder', target, folder };
  });
}

// A version of config.yaml for the conflict check: a hash of the file without the two lines the
// board keeps itself (the id counters move with every card made), so a card made while a page is
// open does not make its save a conflict.
function configVersion(dir) {
  const text = rawKeys(dir).split(/\r?\n/).filter((l) => !/^(?:nextId|counters):/.test(l)).join('\n');
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// How many cards, on the board and archived, carry each `type:` word, as written.
function typeUse(dir, cards) {
  const use = new Map();
  for (const card of cards || [...cs.listActive(dir), ...cs.listArchived(dir)]) {
    if (card.unparseable || !card.type) continue;
    use.set(card.type, (use.get(card.type) || 0) + 1);
  }
  return Object.fromEntries(use);
}

// The folder of a feature as an absolute path, whether or not it exists yet; null when it is off.
function folderPath(dir, config, key) {
  return config[key] === '' ? null : path.resolve(dir, config[key]);
}

// `cards` is the board's cards, active and archived, when the caller has read them already.
function readSettings(dir, cards) {
  const config = cfg.readConfig(dir);
  return {
    logbook: folderState(dir, config, 'logbook'),
    scratchpad: folderState(dir, config, 'scratchpad'),
    groups: folderState(dir, config, 'groups'),
    idDigits: config.idDigits,
    nextId: config.nextId,
    prefixes: prefixRows(config),
    prefixClashes: config.prefixClashes.map((c) => ({ ...c })),
    counters: { ...config.counters },
    typesOn: config.typesOn,
    types: config.types.map((t) => ({ ...t })),
    hierarchy: [...config.hierarchy],
    typeUse: typeUse(dir, cards),
    version: configVersion(dir),
    paths: {
      config: path.resolve(dir, 'config.yaml'),
      logbook: folderPath(dir, config, 'logbook'),
      scratchpad: folderPath(dir, config, 'scratchpad'),
      groups: folderPath(dir, config, 'groups'),
    },
  };
}

function rawKeys(dir) {
  const file = path.join(dir, 'config.yaml');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// The first of `names` that has a line in the file, for writeConfigLine's `after`.
function anchorFor(dir, names) {
  const raw = rawKeys(dir);
  return names.find((n) => new RegExp(`^${n}:`, 'm').test(raw)) || null;
}

function writeLine(dir, key, value) {
  const after = FOLDER_KEYS[key] ? FOLDER_KEYS[key].after : key === 'iterations' ? ['groups', ...FOLDER_KEYS.groups.after] : key === 'typesOn' ? ['iterations', 'groups', ...FOLDER_KEYS.groups.after] : ID_LINES;
  cfg.writeConfigLine(dir, key, value, value === null ? null : anchorFor(dir, after.filter((n) => n !== key)));
}

// --- the three blocks (docs/adr/0018) --------------------------------------------------------

const CONTROL = /[\x00-\x1f\x7f]/;

// A name as it is written in a list entry: bare unless that would not read back as typed (the kanban
// skill's rule for a `type:` word), and a bare entry that opens `word:` would read as a field.
const needsQuotes = (name) => cs.typeValue(name) !== name;
const entryName = (name) => (needsQuotes(name) || /^\w+:/.test(name) ? yaml.quote(name) : name);

// A value from the file is kept as written (docs/adr/0004): a color is any text (a hex, a name), an
// icon any word, and two names that differ only in capitals both stay. Only what would corrupt the
// file is refused: an empty name, and any text that is not one line.
function checkName(value, what) {
  if (typeof value !== 'string') throw new StatusError(`A ${what} is a name.`, 400);
  const name = value.trim();
  if (name === '') throw new StatusError(`A ${what} needs a name.`, 400);
  if (CONTROL.test(name)) throw new StatusError(`A ${what} name is one line of plain text.`, 400);
  return name;
}

function checkText(value, what, name) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new StatusError(`The ${what} of ${name} is text.`, 400);
  if (CONTROL.test(value)) throw new StatusError(`The ${what} of ${name} is one line of plain text.`, 400);
  return value.trim();
}

// The lines of a `types:` block from the page's list: each entry a name, or { name, color?, icon? }.
// An entry with neither a color nor an icon is written bare, as the starter writes `- bug`.
function typesBlock(value) {
  if (!Array.isArray(value)) throw new StatusError('The types are a list of names, each with an optional color and icon.', 400);
  const types = value.map((item) => {
    const entry = typeof item === 'string' ? { name: item } : item;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new StatusError('A card type is a name, or a name with a color and an icon.', 400);
    const name = checkName(entry.name, 'card type');
    return { name, color: checkText(entry.color, 'color', name), icon: checkText(entry.icon, 'icon', name) };
  });
  if (types.length === 0) return null;
  const lines = ['types:'];
  for (const { name, color, icon } of types) {
    if (color === '' && icon === '') {
      lines.push(`  - ${entryName(name)}`);
      continue;
    }
    lines.push(`  - name: ${needsQuotes(name) ? yaml.quote(name) : name}`);
    if (color !== '') lines.push(`    color: ${yaml.quote(color)}`);
    if (icon !== '') lines.push(`    icon: ${/^[\w-]+$/.test(icon) ? icon : yaml.quote(icon)}`);
  }
  return lines;
}

// The `hierarchy:` line from a list of type names: inline like the starter, or a block when a name
// will not sit in a flow list.
function hierarchyBlock(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new StatusError('The hierarchy is a list of card type names, top first.', 400);
  const names = value.map((name) => checkName(name, 'hierarchy entry'));
  if (names.length === 0) return null;
  if (names.every((n) => !needsQuotes(n) && !/[,[\]]/.test(n))) return [`hierarchy: [${names.join(', ')}]`];
  return ['hierarchy:', ...names.map((n) => `  - ${needsQuotes(n) ? yaml.quote(n) : n}`)];
}

// The `prefixes:` block from a map of prefix to target, or a list of { prefix, target } in order. A
// target is a card type or a folder under the groups folder.
function prefixesBlock(dir, value) {
  if (value === undefined || value === null) return null;
  const rows = Array.isArray(value)
    ? value.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? [row.prefix, row.target] : [undefined, undefined]))
    : value && typeof value === 'object' ? Object.entries(value) : null;
  if (rows === null) throw new StatusError('The prefixes are a map from each prefix to a card type or a groups folder.', 400);
  const config = cfg.readConfig(dir);
  const seen = new Set();
  const lines = ['prefixes:'];
  for (const [prefix, raw] of rows) {
    if (typeof prefix !== 'string' || !cfg.isPrefix(prefix)) throw new StatusError(`${JSON.stringify(prefix)} is not a prefix: it is _ and capital letters only, like G or _W.`, 400);
    if (seen.has(prefix)) throw new StatusError(`The prefix ${prefix} is declared twice: a prefix names one card type or one groups folder.`, 400);
    seen.add(prefix);
    if (typeof raw !== 'string' || raw.trim() === '') throw new StatusError(`The prefix ${prefix} needs a card type or a groups folder.`, 400);
    const target = raw.trim();
    if (CONTROL.test(target)) throw new StatusError(`The target of ${prefix} is one line of plain text.`, 400);
    const folder = cfg.groupFolderOf(config, target);
    if (folder !== null && (path.isAbsolute(folder) || /^[A-Za-z]:/.test(folder) || folder.split('/').includes('..'))) {
      throw new StatusError(`The groups folder of ${prefix} sits inside the groups folder: ${target} does not.`, 400);
    }
    lines.push(`  ${prefix}: ${needsQuotes(target) ? yaml.quote(target) : target}`);
  }
  return lines.length === 1 ? null : lines;
}

function writeBlock(dir, name, value) {
  if (!BLOCKS.includes(name)) throw new StatusError(`The gear does not write the block ${JSON.stringify(name)}.`, 400);
  const lines = name === 'types' ? (value === undefined || value === null ? null : typesBlock(value))
    : name === 'hierarchy' ? hierarchyBlock(value)
      : prefixesBlock(dir, value);
  cfg.writeConfigBlock(dir, name, lines);
}

// A save that read the file at `version` and finds it changed since is refused, whatever it writes.
function checkVersion(dir, version) {
  if (version === undefined) return;
  if (typeof version !== 'string') throw new StatusError('The version is the text the settings answered.', 400);
  if (version !== configVersion(dir)) throw new StatusError('config.yaml changed on disk after this page read it, so nothing was saved. The page reads it again.', 409);
}

// One change from the page: { key, value } for a line, { block, value } for a whole block (types,
// hierarchy or prefixes: a list, or a map for prefixes; empty or absent removes it), each with the
// `version` the page read. A folder key takes a path (on, or a new folder) or null (off); iterations
// true or false; typesOn true (removes the line) or false; idDigits a whole number. Returns the
// settings after the write.
function writeSetting(dir, body) {
  const { key, block, value, version } = body && typeof body === 'object' ? body : {};
  checkVersion(dir, version);
  if (block !== undefined) {
    if (key !== undefined) throw new StatusError('A save is one line or one block, not both.', 400);
    writeBlock(dir, block, value);
    return readSettings(dir);
  }
  if (typeof key !== 'string' || !WRITABLE.includes(key)) throw new StatusError(`The gear does not write ${JSON.stringify(key)}.`, 400);
  const before = readSettings(dir);
  if (FOLDER_KEYS[key]) {
    if (before[key].locked) throw new StatusError(`${before[key].reason} (${key}: ${before[key].folder})`, 409);
    if (value === null) {
      writeLine(dir, key, null);
    } else {
      writeLine(dir, key, checkFolder(dir, value, FOLDER_KEYS[key].label));
    }
  } else if (key === 'iterations') {
    if (value !== true && value !== false && value !== null) throw new StatusError('Iterations are on or off.', 400);
    if (value === true && !before.groups.on) throw new StatusError('Turn groups on first: iterations are groups.', 409);
    writeLine(dir, 'iterations', value === true ? 'true' : null);
  } else if (key === 'typesOn') {
    if (value !== true && value !== false) throw new StatusError('Types are on or off.', 400);
    writeLine(dir, 'typesOn', value ? null : 'false');
  } else {
    const n = typeof value === 'string' && /^[0-9]+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n) || n < 1 || n > MAX_ID_DIGITS) throw new StatusError(`idDigits is a whole number from 1 to ${MAX_ID_DIGITS}.`, 400);
    writeLine(dir, 'idDigits', String(n));
  }
  return readSettings(dir);
}

module.exports = { readSettings, writeSetting, insideBoard, FOLDER_KEYS };

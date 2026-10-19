'use strict';
// The config the gear's This board pages show and write (docs/adr/0017). Reading answers each
// feature's switch and folder, whether the folder is one the page may change, the id width, and
// the prefixes and counters as read-only tables. Writing replaces, inserts or removes ONE
// top-level line of config.yaml through config-store's writeConfigLine, so every other byte stays
// (the human's comments, unknown keys, the file's line ending).
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
const cfg = require('./config-store');

class SettingsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'SettingsError';
    this.status = status;
  }
}

// Where a line is inserted when its key is not in the file yet: below the first of these keys the
// file has, else at the top. The keys the gear writes follow the id lines, in the order the config
// documents them.
const ID_LINES = ['idDigits', 'nextId', 'name'];

// The features that take a folder. Adding one is a line here and its reader in config-store.
const FOLDER_KEYS = {
  logbook: { label: 'logbook', after: ID_LINES },
  groups: { label: 'groups', after: ['logbook', ...ID_LINES] },
};

const WRITABLE = ['iterations', 'idDigits', ...Object.keys(FOLDER_KEYS)];

const MAX_ID_DIGITS = 15;

const LOCKED_REASON = 'This folder is outside the board. It was set by hand in config.yaml, and only a hand edit changes it.';

const posix = (p) => p.split(path.sep).join('/');

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
  if (typeof value !== 'string') throw new SettingsError(`The ${what} folder is text.`, 400);
  if (/[\u0000-\u001f]/.test(value)) throw new SettingsError('A folder is one line of plain text.', 400);
  const rel = insideBoard(dir, value);
  if (rel === null) throw new SettingsError('A folder from the page sits inside the board: write a path under it, like .logbook. A folder outside is set by hand in config.yaml.', 400);
  for (const part of rel.split('/')) {
    if (!/^[\p{L}\p{N}_.][\p{L}\p{N}_ .()+,@-]*$/u.test(part) || /[. ]$/.test(part)) {
      throw new SettingsError(`${part} is not a plain folder name: use letters, digits, spaces and _ . - ( ) + , @.`, 400);
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

function readSettings(dir) {
  const config = cfg.readConfig(dir);
  return {
    logbook: folderState(dir, config, 'logbook'),
    groups: folderState(dir, config, 'groups'),
    iterations: config.iterations,
    idDigits: config.idDigits,
    nextId: config.nextId,
    prefixes: prefixRows(config),
    counters: { ...config.counters },
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
  const after = FOLDER_KEYS[key] ? FOLDER_KEYS[key].after : key === 'iterations' ? ['groups', ...FOLDER_KEYS.groups.after] : ID_LINES;
  cfg.writeConfigLine(dir, key, value, value === null ? null : anchorFor(dir, after.filter((n) => n !== key)));
}

// One change from the page: { key, value }. A folder key takes a path (on, or a new folder) or null
// (off); iterations true or false; idDigits a whole number. Returns the settings after the write.
function writeSetting(dir, body) {
  const { key, value } = body && typeof body === 'object' ? body : {};
  if (typeof key !== 'string' || !WRITABLE.includes(key)) throw new SettingsError(`The gear does not write ${JSON.stringify(key)}.`, 400);
  const before = readSettings(dir);
  if (FOLDER_KEYS[key]) {
    if (before[key].locked) throw new SettingsError(`${before[key].reason} (${key}: ${before[key].folder})`, 409);
    if (value === null) {
      writeLine(dir, key, null);
      if (key === 'groups') writeLine(dir, 'iterations', null);
    } else {
      writeLine(dir, key, checkFolder(dir, value, FOLDER_KEYS[key].label));
    }
  } else if (key === 'iterations') {
    if (value !== true && value !== false && value !== null) throw new SettingsError('Iterations are on or off.', 400);
    if (value === true && !before.groups.on) throw new SettingsError('Turn groups on first: iterations are groups.', 409);
    writeLine(dir, 'iterations', value === true ? 'true' : null);
  } else {
    const n = typeof value === 'string' && /^[0-9]+$/.test(value.trim()) ? Number(value) : value;
    if (!Number.isInteger(n) || n < 1 || n > MAX_ID_DIGITS) throw new SettingsError(`idDigits is a whole number from 1 to ${MAX_ID_DIGITS}.`, 400);
    writeLine(dir, 'idDigits', String(n));
  }
  return readSettings(dir);
}

module.exports = { readSettings, writeSetting, insideBoard, SettingsError, FOLDER_KEYS };

'use strict';
// The file behind a Markdown image in a card's body (GET /api/cards/<id>/image?path=). The path is
// the body's own text: percent-decoded once, then resolved against the board folder (where live cards
// sit, so a card archived into archived/ or archived/<package>/ keeps its pictures). The file is sent
// only when, with every link followed, it is a png, jpg, gif or webp inside the folder that holds the
// board folder or inside the card's own scratchpad folder (the `scratchpad:` path with its
// placeholders filled for that card). Any refusal is the same 404 (a missing file, another type, a
// directory, a path outside), so a probe learns nothing about what lies beyond the roots; only an
// escape that does not decode, or no path, is a 400.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const iter = require('./iteration-folders');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const typeOf = (file) => TYPES[path.extname(file).toLowerCase()] || null;

const refuse = () => new StatusError('No such picture.', 404);

const real = (p) => { try { return fs.realpathSync.native(p); } catch (_) { return null; } };

// Whether `file` is `root` or lies under it, compared on a separator boundary (a sibling folder that
// only starts with the root's name is not inside it).
function within(root, file) {
  const a = process.platform === 'win32' ? file.toLowerCase() : file;
  const r = process.platform === 'win32' ? root.toLowerCase() : root;
  return a === r || a.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

// The folders a card's own scratchpad can sit in: every folder the `scratchpad:` path names whose
// `<card>` is this card, or the one folder of a path with no `<card>` (shared by every card).
function scratchpadFolders(dir, id) {
  const value = cfg.readConfig(dir).paths.scratchpad;
  if (!value) return [];
  const forCard = value.split(/[\/]/).includes(iter.CARD);
  return iter.readFolders(dir, value)
    .filter((f) => !forCard || (f.parts.card !== undefined && ids.idKey(f.parts.card.split('.')[0]) === id))
    .map((f) => f.abs);
}

// { file, type } for a card's image path, or a StatusError.
function cardImage(dir, id, rawPath) {
  if (typeof rawPath !== 'string' || rawPath === '') throw new StatusError('An image needs a path.', 400);
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch (_) { throw new StatusError('That path has a bad % escape.', 400); }
  if (decoded.includes('\0')) throw new StatusError('That path is not a file name.', 400);
  if (!typeOf(decoded)) throw refuse();
  const wanted = path.resolve(dir, decoded);
  const pads = scratchpadFolders(dir, id);
  // Checked as written before the file system is asked, so a path outside both roots never reaches it:
  // on Windows a realpath or a stat of a network share opens a connection to that host.
  if (![path.dirname(path.resolve(dir)), ...pads].some((r) => within(r, wanted))) throw refuse();
  const file = real(wanted);
  if (file === null || !typeOf(file)) throw refuse();
  let stat;
  try { stat = fs.statSync(file); } catch (_) { throw refuse(); }
  if (!stat.isFile()) throw refuse();
  const board = real(path.resolve(dir));
  const roots = [board === null ? null : path.dirname(board), ...pads.map(real)].filter((r) => r !== null);
  if (!roots.some((r) => within(r, file))) throw refuse();
  return { file, type: typeOf(file), size: stat.size };
}

module.exports = { cardImage, TYPES };

'use strict';
// The folder browser of the Scratchpad tab: the files in a card's own scratchpad folder (the folder
// `scratchpad:` names with `<card>` in it, the one that holds the card's page), listed one level at a
// time, opened, and, for `.md` and `.txt` files, created, saved, deleted, renamed and moved. Everything
// is scoped to that one folder:
//
//  - A path in a request is relative to it, with `/` between names. It is checked as text first (no
//    `..`, no drive, no share, no backslash, no name Windows cannot hold), then, before any file system
//    call can reach a network share, against the folder as written (card-images.js `within`), then with
//    every link followed against the folder's real place. A link that points out is not listed and
//    answers 404 like a file that is not there.
//  - The page itself (`<id>.scratchpad.md`) is listed first and never written from here: the tab's box
//    saves it (scratchpad-store.js), and only the delete flow deletes it. Any name that ends in
//    `.scratchpad.md` is held as a page, for a file or a folder, so no look-alike is ever made.
//  - A name that Windows reserves (con, prn, aux, nul, com1-9, lpt1-9, before the first dot) is refused
//    on every platform, so a folder moves between machines.
//  - Only a card has a folder here; a group's tab is as it was.
//  - A write names a `.md` or `.txt` file and nothing else; a save or a delete names the `version` it read (a hash
//    of the file as it was, as the todo lists do) and is a 409 when the file has changed since.
//  - A text read or write is capped at the page's own cap (MAX_PAD).
const fs = require('fs');
const path = require('path');
const iter = require('./iteration-folders');
const ids = require('../web/ids');
const sp = require('./scratchpad-store');
const cs = require('./card-store');
const crypto = require('crypto');
const { within, real, TYPES } = require('./card-images');
const { StatusError, versionOf } = require('./store-common');

const MAX_TEXT = sp.MAX_PAD;
const WRITABLE = /\.(md|txt)$/i;
const PAGE_RE = /\.scratchpad\.md$/i;
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const NAME_RE = /^[^<>:"|?*\\/\x00-\x1f]+$/;

const isPageName = (name) => PAGE_RE.test(name);
const isReservedName = (name) => RESERVED_RE.test(name.split('.')[0]);

const gone = () => new StatusError('No such file or folder.', 404);
const bad = (message) => new StatusError(message, 400);

const kindByName = (name) => {
  const ext = path.extname(name).toLowerCase();
  if (TYPES[ext]) return 'image';
  if (ext === '.md') return 'markdown';
  if (ext === '.txt') return 'text';
  return 'file';
};

// Names between `/`, each one a plain name. '' is the folder itself. No name is a page's look-alike (a 403)
// or a reserved device name (a 400); `leafIsFile` lets the last name be a page's, for opening one.
function segmentsOf(rel, leafIsFile) {
  if (rel === undefined || rel === null || rel === '') return [];
  if (typeof rel !== 'string') throw bad('A path is text.');
  const segs = rel.split('/');
  for (const s of segs) {
    if (!NAME_RE.test(s) || s === '.' || s === '..' || /[ .]$/.test(s)) throw bad('That path is not a name inside the card\'s folder.');
    if (isReservedName(s)) throw bad('That name is reserved by Windows.');
  }
  segs.forEach((s, i) => {
    if (isPageName(s) && !(leafIsFile && i === segs.length - 1)) throw new StatusError('A name ending in .scratchpad.md is the scratchpad page\'s.', 403);
  });
  return segs;
}

const relOf = (segs) => segs.join('/');

// { id, root, name, real } for a card or group: the folder of its page and the page's name. A board whose
// path has no `<card>` has no folder of its own to browse.
function cardFolder(dir, target) {
  const place = sp.padPlace(dir, target);
  if (!cs.findCardFile(dir, place.id)) throw new StatusError('Only a card has a folder to browse.', 404);
  const own = iter.segmentsOf(place.value).includes(iter.CARD)
    && place.folder.parts.card !== undefined && ids.idKey(place.folder.parts.card.split('.')[0]) === place.id;
  if (!own) throw new StatusError('The scratchpad is not kept in a folder of the card\'s own: config.yaml\'s scratchpad: path has no <card>.', 404);
  return { id: place.id, root: place.folder.abs, name: place.name };
}

// The folder made if it is not there yet, then its real place.
function realRootOf(root, make) {
  if (make) fs.mkdirSync(root, { recursive: true });
  const r = real(root);
  if (r === null && !make) return null;
  return r;
}

// The real place of an existing path of the folder, or a 404 when it is not there or leads out.
function realInside(rootReal, abs) {
  const r = real(abs);
  if (r === null || !within(rootReal, r)) throw gone();
  return r;
}

function entryOf(rootAbs, segs, stat, rootReal) {
  const name = segs[segs.length - 1];
  const abs = path.join(rootAbs, ...segs);
  const page = !stat.isDirectory() && isPageName(name);
  const out = { name, path: relOf(segs), dir: stat.isDirectory(), size: stat.isDirectory() ? 0 : stat.size, mtime: stat.mtime.toISOString(), abs };
  if (out.dir) return { ...out, kind: 'dir', writable: false };
  return { ...out, kind: kindByName(name), page, writable: !page && WRITABLE.test(name) };
}

function parentOf(segs) {
  return segs.length === 0 ? null : relOf(segs.slice(0, -1));
}

// The folder `rel` of the card's folder: { folder, path, parent, entries }, the page first, then the
// folders, then the files, each by name. A card with no folder yet lists nothing.
function list(dir, target, rel) {
  const { root } = cardFolder(dir, target);
  const segs = segmentsOf(rel);
  const base = { folder: root, path: relOf(segs), parent: parentOf(segs) };
  const rootReal = realRootOf(root, false);
  if (rootReal === null) {
    if (segs.length) throw gone();
    return { ...base, entries: [] };
  }
  const abs = path.join(root, ...segs);
  if (!within(root, abs)) throw gone();
  const here = realInside(rootReal, abs);
  let names;
  try {
    if (!fs.statSync(here).isDirectory()) throw gone();
    names = fs.readdirSync(here);
  } catch (e) { throw e instanceof StatusError ? e : gone(); }
  const entries = [];
  for (const name of names) {
    const file = path.join(abs, name);
    const target2 = real(file);
    if (target2 === null || !within(rootReal, target2)) continue;
    let stat;
    try { stat = fs.statSync(file); } catch (_) { continue; }
    if (!stat.isFile() && !stat.isDirectory()) continue;
    entries.push(entryOf(root, [...segs, name], stat, rootReal));
  }
  const rank = (e) => (e.page ? 0 : e.dir ? 1 : 2);
  entries.sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { ...base, entries };
}

// What a click shows. An image gives its address for the image route; a text file gives its text and
// version; anything binary, or over the cap, gives its name, size and path only.
function open(dir, target, rel) {
  const { root } = cardFolder(dir, target);
  const segs = segmentsOf(rel, true);
  if (segs.length === 0) throw gone();
  const rootReal = realRootOf(root, false);
  if (rootReal === null) throw gone();
  const abs = path.join(root, ...segs);
  const here = realInside(rootReal, abs);
  let stat;
  try { stat = fs.statSync(here); } catch (_) { throw gone(); }
  if (!stat.isFile()) throw gone();
  const entry = { ...entryOf(root, segs, stat, rootReal), base: path.dirname(abs) };
  if (entry.kind === 'image') return { file: entry };
  if (stat.size > MAX_TEXT) return { file: { ...entry, kind: 'other', writable: false, tooLarge: true } };
  const buf = fs.readFileSync(here);
  if (buf.includes(0)) return { file: { ...entry, kind: 'other', writable: false } };
  const raw = buf.toString('utf8');
  return { file: { ...entry, kind: entry.kind === 'markdown' ? 'markdown' : 'text', text: raw.replace(/\r\n/g, '\n'), version: versionOf(raw) } };
}

// A path of a write: its segments, the name checked to be a .md or .txt that is not a page.
function writableSegs(rel) {
  const segs = segmentsOf(rel, true);
  const name = segs[segs.length - 1];
  if (!name || !WRITABLE.test(name) || /^\.(md|txt)$/i.test(name)) throw bad('Only a .md or .txt file can be written here.');
  if (isPageName(name)) throw new StatusError('The scratchpad page is saved by its own box, and only the delete flow takes it.', 403);
  return segs;
}

// The real place of the parent of `segs`, which must be a folder of the card's folder.
function parentReal(rootReal, root, segs) {
  const parent = path.join(root, ...segs.slice(0, -1));
  const r = realInside(rootReal, parent);
  let stat;
  try { stat = fs.statSync(r); } catch (_) { throw gone(); }
  if (!stat.isDirectory()) throw gone();
  return r;
}

const exists = (abs) => { try { fs.lstatSync(abs); return true; } catch (_) { return false; } };

// Whether a move may land on `dest`: when nothing is there, or when what is there is the source itself
// (a case-only rename on a file system that ignores case). Any other file that exists is never replaced.
function mayReplace(source, dest) {
  let d;
  try { d = fs.statSync(dest, { bigint: true }); } catch (_) { return true; }
  try {
    const s = fs.statSync(source, { bigint: true });
    return s.dev === d.dev && s.ino === d.ino && d.ino !== 0n;
  } catch (_) { return false; }
}

// A new file is opened exclusively (writeNew), and a save writes a temp file under a unique name, also opened
// exclusively (writeOver), then renames it into place: a file or a link planted at either name is never followed or replaced.
function writeNew(abs, text) {
  try { fs.writeFileSync(abs, text, { flag: 'wx' }); } catch (e) {
    if (e.code === 'EEXIST') throw new StatusError('A file by that name is already there.', 409);
    throw e;
  }
}

function writeOver(abs, text) {
  const tmp = `${abs}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { flag: 'wx' });
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* never made, or already renamed */ }
    throw e;
  }
}

function checkText(text) {
  if (typeof text !== 'string') throw bad('The file is text.');
  if (text.length > MAX_TEXT) throw new StatusError('That file is too long.', 413);
}

// A new .md or .txt file `{ path, text }`. The card's folder is made if the card has none yet.
function create(dir, target, body) {
  const { path: rel, text } = body && typeof body === 'object' ? body : {};
  const { root } = cardFolder(dir, target);
  const segs = writableSegs(rel);
  checkText(text === undefined ? '' : text);
  iter.checkWritable(sp.padPlace(dir, target).value);
  const rootReal = realRootOf(root, true);
  parentReal(rootReal, root, segs);
  const abs = path.join(root, ...segs);
  writeNew(abs, text === undefined ? '' : text);
  return open(dir, target, relOf(segs));
}

// Save `{ path, text, version }` over a .md or .txt file: the version is of the file as it was read, and
// the file keeps its own line ending.
function save(dir, target, body) {
  const { path: rel, text, version } = body && typeof body === 'object' ? body : {};
  const { root } = cardFolder(dir, target);
  const segs = writableSegs(rel);
  if (typeof version !== 'string') throw bad('A save names the version of the file it read.');
  checkText(text);
  const rootReal = realRootOf(root, false);
  if (rootReal === null) throw gone();
  const abs = path.join(root, ...segs);
  const here = realInside(rootReal, abs);
  let stat;
  try { stat = fs.statSync(here); } catch (_) { throw gone(); }
  if (!stat.isFile()) throw gone();
  const old = fs.readFileSync(here, 'utf8');
  if (versionOf(old) !== version) throw new StatusError('That file changed since it was read.', 409);
  const eol = old.includes('\r\n') ? '\r\n' : '\n';
  const plain = text.replace(/\r\n?/g, '\n');
  writeOver(here, eol === '\n' ? plain : plain.replace(/\n/g, eol));
  return open(dir, target, relOf(segs));
}

// Delete `{ path, version }`: a .md or .txt file, as it was read.
function remove(dir, target, body) {
  const { path: rel, version } = body && typeof body === 'object' ? body : {};
  const { root } = cardFolder(dir, target);
  const segs = writableSegs(rel);
  if (typeof version !== 'string') throw bad('A delete names the version of the file it read.');
  const rootReal = realRootOf(root, false);
  if (rootReal === null) throw gone();
  const here = realInside(rootReal, path.join(root, ...segs));
  let stat;
  try { stat = fs.statSync(here); } catch (_) { throw gone(); }
  if (!stat.isFile()) throw gone();
  if (versionOf(fs.readFileSync(here, 'utf8')) !== version) throw new StatusError('That file changed since it was read.', 409);
  fs.unlinkSync(here);
  return { ok: true };
}

// Rename or move `{ from, to }`: both are paths of .md or .txt files, `to` in a folder that is there.
function move(dir, target, body) {
  const { from, to } = body && typeof body === 'object' ? body : {};
  const { root } = cardFolder(dir, target);
  const a = writableSegs(from);
  const b = writableSegs(to);
  const rootReal = realRootOf(root, false);
  if (rootReal === null) throw gone();
  const source = realInside(rootReal, path.join(root, ...a));
  let stat;
  try { stat = fs.statSync(source); } catch (_) { throw gone(); }
  if (!stat.isFile()) throw gone();
  const parent = parentReal(rootReal, root, b);
  const dest = path.join(parent, b[b.length - 1]);
  if (!mayReplace(source, dest)) throw new StatusError('A file by that name is already there.', 409);
  fs.renameSync(source, dest);
  return open(dir, target, relOf(b));
}

// A new subfolder `{ path }`, one level at a time (its parent must be there).
function makeFolder(dir, target, body) {
  const { path: rel } = body && typeof body === 'object' ? body : {};
  const { root } = cardFolder(dir, target);
  const segs = segmentsOf(rel);
  if (segs.length === 0) throw bad('A folder needs a name.');
  const rootReal = realRootOf(root, true);
  parentReal(rootReal, root, segs);
  const abs = path.join(root, ...segs);
  if (exists(abs)) throw new StatusError('Something by that name is already there.', 409);
  fs.mkdirSync(abs);
  return entryOf(root, segs, fs.statSync(abs), rootReal);
}

module.exports = { list, open, create, save, remove, move, makeFolder, mayReplace, isPageName, isReservedName, MAX_TEXT, PAGE_RE };

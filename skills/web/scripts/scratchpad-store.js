'use strict';
// The scratchpad (docs/adr/0016): a disposable page for one card or group, one Markdown file
// per target in the folder `scratchpad:` names in config.yaml (off without the line). The file
// name is `<id padded to the board's idDigits>.scratchpad.md`, `0007.scratchpad.md` for card #7,
// `I0001.scratchpad.md` for a group; a file is read by the number, so any padding resolves. The
// page may open with frontmatter holding a `refs:` list (notes, files and folders the page
// points at, shown and never written by the web), then the body is free text:
//
//   ---
//   refs:
//     - src/orders.js
//     - 2026.10.16.0007.logbook.md
//   ---
//
//   anything at all
//
// A write replaces the body and nothing else: the frontmatter, the blank line under it and the
// file's line ending stay as they were. The kanban never deletes a page on its own; only the delete
// flow's "Its scratchpad" box does, through deleteTargetFiles.
//
// `scratchpad:` may hold `<iteration>` as a whole path segment (docs/adr/0019, iteration-folders.js):
// a page goes to the folder of the iteration its card or group is a member of (the first to start of
// several), else the one holding the day it is first written, else the segment is dropped; a page
// that exists is read and written where it is, and nothing moves one. Reading covers every folder
// the path can name, and a record then carries `folder`, the path with the segment filled in.
//
// Request text never builds a path: the id is validated and the file name is built from it, or taken
// from the folder's own listing.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const { scalar } = require('./yaml-list');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');
const { writeAtomic } = require('./card-store');
const iter = require('./iteration-folders');
const { localToday } = require('../web/days');

const FILE_RE = /^([^.]+)\.scratchpad\.md$/;
const FRONT_RE = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??---[ \t]*(?:\r?\n|$)/;
const MAX_PAD = 300000; // under the server's request limit even when every new line is escaped

function mustScratchpad(dir) {
  const config = cfg.readConfig(dir);
  if (!config.scratchpad) throw new StatusError('The scratchpad is off: config.yaml has no scratchpad: line.', 404);
  return { value: config.scratchpad, digits: config.idDigits };
}

function checkTarget(target) {
  const key = typeof target === 'string' ? ids.idKey(target.trim()) : null;
  if (key === null) throw new StatusError('That is not an id.', 400);
  return key;
}

function canonicalName(target, digits) {
  return `${ids.formatId(target, digits)}.scratchpad.md`;
}

// Every file of the folder that is a page: { name, target }, by name.
function padFiles(folder) {
  let entries;
  try { entries = fs.readdirSync(folder); } catch (_) { return []; }
  const out = [];
  for (const name of entries.sort()) {
    const m = FILE_RE.exec(name);
    const target = m ? ids.idKey(m[1]) : null;
    if (target !== null) out.push({ name, target });
  }
  return out;
}

// Every page of every folder the path can name: { name, target, folder: { label, abs } }.
function allPadFiles(dir, value) {
  const out = [];
  for (const folder of iter.readFolders(dir, value)) for (const f of padFiles(folder.abs)) out.push({ ...f, folder });
  return out;
}

// Where a target's page is, or would be written: { folder, name, exists }. A page that is there
// stays there (the folder a new page would take, if it is in several); else the canonical name in the
// folder of the iteration its card or group is a member of, else the one holding `today`.
function placeOf(dir, value, digits, target, today) {
  const canon = canonicalName(target, digits);
  const fresh = () => iter.folderOfPad(dir, value, target, today);
  const have = allPadFiles(dir, value).filter((f) => f.target === target);
  const folders = [...new Map(have.map((f) => [f.folder.label, f.folder])).values()];
  let folder;
  if (folders.length === 0) folder = fresh();
  else if (folders.length === 1) [folder] = folders;
  else folder = folders.find((f) => f.label === fresh().label) || folders[0];
  const here = have.filter((f) => f.folder.label === folder.label);
  return { folder, name: here.some((f) => f.name === canon) ? canon : here.length ? here[0].name : canon, exists: here.length > 0 };
}

// The refs of a page's frontmatter lines: a block list under `refs:` or a flow list on its line.
function readRefs(lines) {
  const at = lines.findIndex((l) => /^refs:/.test(l));
  if (at === -1) return [];
  const tail = lines[at].slice(5).trim();
  if (tail[0] === '[') {
    const close = tail.indexOf(']');
    return (close === -1 ? tail.slice(1) : tail.slice(1, close)).split(',').map((r) => scalar(r)).filter((r) => r !== '');
  }
  const refs = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item) {
      const ref = scalar(item[1]);
      if (ref !== '') refs.push(ref);
    } else if (/^[^\s#]/.test(line)) {
      break;
    }
  }
  return refs;
}

// raw text -> { eol, front, gap, refs, body }: the frontmatter block as written ('' when there is
// none), whether a blank line sits under it, the refs, and the body with plain new lines.
function parsePad(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const m = FRONT_RE.exec(raw);
  if (!m) return { eol, front: '', gap: false, refs: [], body: raw.replace(/\r\n/g, '\n') };
  const rest = raw.slice(m[0].length);
  const gap = /^\r?\n/.test(rest);
  const lines = m[0].replace(/\r?\n$/, '').split(/\r?\n/).slice(1, -1);
  return { eol, front: m[0], gap, refs: readRefs(lines), body: (gap ? rest.replace(/^\r?\n/, '') : rest).replace(/\r\n/g, '\n') };
}

// `folderText` is the configured path with the segment filled in, or null for a path without the
// placeholder, whose records carry no folder.
function record(target, name, exists, parsed, folderText) {
  const out = { target, exists, file: name };
  if (folderText !== null) out.folder = folderText;
  return { ...out, refs: parsed.refs, body: parsed.body };
}

// `opts.today` is the day a page not written yet would be first written (the local date by default).
function readPad(dir, target, opts) {
  const { value, digits } = mustScratchpad(dir);
  const key = checkTarget(target);
  const place = placeOf(dir, value, digits, key, (opts && opts.today) || localToday());
  const folderText = iter.filledIn(value, place.folder.label);
  let raw;
  try { raw = fs.readFileSync(path.join(place.folder.abs, place.name), 'utf8'); } catch (_) { return record(key, place.name, false, parsePad(''), folderText); }
  return record(key, place.name, true, parsePad(raw), folderText);
}

// Replace the page's body; the frontmatter, the gap under it and the line ending stay. A page not
// written yet is the body alone. Returns the page as it now reads.
function writePad(dir, target, body, opts) {
  const { value, digits } = mustScratchpad(dir);
  const key = checkTarget(target);
  if (typeof body !== 'string') throw new StatusError('The page is text.', 400);
  if (body.length > MAX_PAD) throw new StatusError('That page is too long.', 413);
  iter.checkWritable(value);
  const place = placeOf(dir, value, digits, key, (opts && opts.today) || localToday());
  const file = path.join(place.folder.abs, place.name);
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch (_) { /* not written yet */ }
  const was = parsePad(old);
  const plain = body.replace(/\r\n?/g, '\n');
  let front = was.front;
  let gap = was.gap;
  if (front === '' && FRONT_RE.test(plain)) { front = `---${was.eol}---${was.eol}`; gap = true; }
  if (front !== '' && !/\n$/.test(front)) front += was.eol;
  const text = front + (gap ? was.eol : '') + (was.eol === '\n' ? plain : plain.replace(/\n/g, was.eol));
  fs.mkdirSync(place.folder.abs, { recursive: true });
  writeAtomic(file, text);
  return readPad(dir, key, opts);
}

// The targets that have a page, in id order, from the file names alone.
function listTargets(dir) {
  const config = cfg.readConfig(dir);
  if (!config.scratchpad) return [];
  return ids.sortIds([...new Set(allPadFiles(dir, config.scratchpad).map((f) => f.target))]);
}

// Delete every page of one target (a card or a group), whatever its padding or folder; how many went. A
// board with no scratchpad has none to delete. Only the delete flow calls this.
function deleteTargetFiles(dir, target) {
  const config = cfg.readConfig(dir);
  const key = typeof target === 'string' || typeof target === 'number' ? ids.idKey(target) : null;
  if (!config.scratchpad || key === null) return 0;
  let gone = 0;
  for (const f of allPadFiles(dir, config.scratchpad)) {
    if (f.target !== key) continue;
    try { fs.unlinkSync(path.join(f.folder.abs, f.name)); gone++; } catch (_) { /* already gone */ }
  }
  return gone;
}

module.exports = { readPad, writePad, listTargets, deleteTargetFiles, canonicalName, MAX_PAD };

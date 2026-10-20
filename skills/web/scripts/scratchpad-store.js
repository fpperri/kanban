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
// flow's "Its scratchpad" box does, through deleteTargetFiles. Request text never builds a path:
// the id is validated and the file name is built from it, or taken from the folder's own listing.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const { scalar } = require('./yaml-list');
const ids = require('../web/ids');

class ScratchpadError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ScratchpadError';
    this.status = status;
  }
}

const FILE_RE = /^([^.]+)\.scratchpad\.md$/;
const FRONT_RE = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)??---[ \t]*(?:\r?\n|$)/;
const MAX_PAD = 1000000;

// The scratchpad folder as an absolute path, or null when the board keeps none. Relative to the
// board; a hand-written absolute path or one that leaves the board is honoured.
function scratchpadDir(dir) {
  const config = cfg.readConfig(dir);
  return config.scratchpad ? path.resolve(dir, config.scratchpad) : null;
}

function mustScratchpad(dir) {
  const config = cfg.readConfig(dir);
  if (!config.scratchpad) throw new ScratchpadError('The scratchpad is off: config.yaml has no scratchpad: line.', 404);
  return { folder: path.resolve(dir, config.scratchpad), digits: config.idDigits };
}

function checkTarget(target) {
  const key = typeof target === 'string' ? ids.idKey(target.trim()) : null;
  if (key === null) throw new ScratchpadError('That is not an id.', 400);
  return key;
}

function canonicalName(target, digits) {
  return `${ids.formatId(target, digits)}.scratchpad.md`;
}

// Every file of the folder that is a page: { name, target }, by name.
function pageFiles(folder) {
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

// The name a target's page has: the canonical one if it is there, else the first that names the
// target, else the canonical name for a page not written yet.
function nameOf(folder, digits, target) {
  const canon = canonicalName(target, digits);
  const have = pageFiles(folder).filter((f) => f.target === target);
  return have.some((f) => f.name === canon) ? canon : have.length ? have[0].name : canon;
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

function record(target, name, exists, parsed) {
  return { target, exists, file: name, refs: parsed.refs, body: parsed.body };
}

function readPad(dir, target) {
  const { folder, digits } = mustScratchpad(dir);
  const key = checkTarget(target);
  const name = nameOf(folder, digits, key);
  let raw;
  try { raw = fs.readFileSync(path.join(folder, name), 'utf8'); } catch (_) { return record(key, name, false, parsePad('')); }
  return record(key, name, true, parsePad(raw));
}

// Replace the page's body; the frontmatter, the gap under it and the line ending stay. A page not
// written yet is the body alone. Returns the page as it now reads.
function writePad(dir, target, body) {
  const { folder, digits } = mustScratchpad(dir);
  const key = checkTarget(target);
  if (typeof body !== 'string') throw new ScratchpadError('The page is text.', 400);
  if (body.length > MAX_PAD) throw new ScratchpadError('That page is too long.', 413);
  const name = nameOf(folder, digits, key);
  const file = path.join(folder, name);
  let old = '';
  try { old = fs.readFileSync(file, 'utf8'); } catch (_) { /* not written yet */ }
  const was = parsePad(old);
  const plain = body.replace(/\r\n?/g, '\n');
  let front = was.front;
  let gap = was.gap;
  if (front === '' && FRONT_RE.test(plain)) { front = `---${was.eol}---${was.eol}`; gap = true; }
  if (front !== '' && !/\n$/.test(front)) front += was.eol;
  const text = front + (gap ? was.eol : '') + (was.eol === '\n' ? plain : plain.replace(/\n/g, was.eol));
  fs.mkdirSync(folder, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return readPad(dir, key);
}

// The targets that have a page, in id order, from the file names alone.
function listTargets(dir) {
  const folder = scratchpadDir(dir);
  if (folder === null) return [];
  return ids.sortIds([...new Set(pageFiles(folder).map((f) => f.target))]);
}

// Delete every page of one target (a card or a group), whatever its padding; how many went. A
// board with no scratchpad has none to delete. Only the delete flow calls this.
function deleteTargetFiles(dir, target) {
  const folder = scratchpadDir(dir);
  const key = typeof target === 'string' || typeof target === 'number' ? ids.idKey(target) : null;
  if (folder === null || key === null) return 0;
  let gone = 0;
  for (const f of pageFiles(folder)) {
    if (f.target !== key) continue;
    try { fs.unlinkSync(path.join(folder, f.name)); gone++; } catch (_) { /* already gone */ }
  }
  return gone;
}

module.exports = { ScratchpadError, scratchpadDir, readPad, writePad, listTargets, deleteTargetFiles, canonicalName, MAX_PAD };

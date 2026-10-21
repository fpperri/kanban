'use strict';
// The todo lists (docs/adr/0021): one Markdown task list per card or group, in the folder `todos:`
// names in config.yaml (off without the line). The file name is `<id padded to the board's
// idDigits>.todo.md`, `0007.todo.md` for card #7, `I0001.todo.md` for a group; a file is read by the
// number, so any padding resolves. `todos:` may name the scratchpad's folder: the two kinds of file
// never share a name, and each store reads only its own.
//
// The file is a GitHub task list a person or an AI edits by hand:
//
//   - [ ] an open item
//   - [x] a done one
//     - [ ] a child, indented two or more spaces or a tab under its parent
//   any other line is kept as written
//
// Reading is tolerant (docs/adr/0004): a line that is not an item is kept and given back as written.
// A write changes the line it is about (a tick is the one character in the brackets, an edit is the
// text after them, an add is a new line, a delete or a move is the item's lines) and keeps every
// other byte, line endings included. An item is named by its line number, which holds because every
// write names the `version` it read (a hash of the file as it was) and is refused (409) when the file
// is not that any more.
//
// `todos:` may hold `<iteration>` as a whole path segment by the rules of docs/adr/0019
// (iteration-folders.js, the same folder rules as a scratchpad page): a list goes to the folder of the
// iteration its card or group is a member of, else the one holding the day it is first written, else
// the segment is dropped; a list that exists stays where it is. A record then carries `folder`, the
// path with the segment filled in.
//
// Request text never builds a path: the id is validated and the file name is built from it, or taken
// from the folder's own listing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config-store');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');
const { writeAtomic } = require('./card-store');
const iter = require('./iteration-folders');
const { localToday } = require('../web/days');

const FILE_RE = /^([^.]+)\.todo\.md$/;
const ITEM_RE = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\]([ \t]+)(.*)$/;
const MAX_FILE = 300000; // under the server's request limit even when every new line is escaped
const MAX_ITEM = 2000;
const CONTROL = /[\u0000-\u001f\u007f]/;

function mustTodos(dir) {
  const config = cfg.readConfig(dir);
  if (!config.todos) throw new StatusError('Todo lists are off: config.yaml has no todos: line.', 404);
  return { value: config.todos, digits: config.idDigits };
}

function checkTarget(target) {
  const key = typeof target === 'string' ? ids.idKey(target.trim()) : null;
  if (key === null) throw new StatusError('That is not an id.', 400);
  return key;
}

function canonicalName(target, digits) {
  return `${ids.formatId(target, digits)}.todo.md`;
}

// Every file of the folder that is a todo list: { name, target }, by name.
function listFiles(folder) {
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

// Every list of every folder the path can name: { name, target, folder: { label, abs } }.
function allFiles(dir, value) {
  const out = [];
  for (const folder of iter.readFolders(dir, value)) for (const f of listFiles(folder.abs)) out.push({ ...f, folder });
  return out;
}

// Where a target's list is, or would be written: { folder, name, exists }. A list that is there stays
// there (the folder a new list would take, if it is in several); else the canonical name in the
// folder of the iteration its card or group is a member of, else the one holding `today`.
function placeOf(dir, value, digits, target, today, all) {
  const canon = canonicalName(target, digits);
  const fresh = () => iter.folderOfPad(dir, value, target, today);
  const have = (all || allFiles(dir, value)).filter((f) => f.target === target);
  const folders = [...new Map(have.map((f) => [f.folder.label, f.folder])).values()];
  let folder;
  if (folders.length === 0) folder = fresh();
  else if (folders.length === 1) [folder] = folders;
  else folder = folders.find((f) => f.label === fresh().label) || folders[0];
  const here = have.filter((f) => f.folder.label === folder.label);
  return { folder, name: here.some((f) => f.name === canon) ? canon : here.length ? here[0].name : canon, exists: here.length > 0 };
}

const versionOf = (raw) => crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

// ---------- the file as lines ----------

// raw text -> [{ text, eol }]: each line without its ending and the ending it had ('' on a last line
// that has none). The empty file has no lines.
function splitLines(raw) {
  const lines = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (let m = re.exec(raw); m && m.index < raw.length; m = re.exec(raw)) {
    lines.push({ text: m[1], eol: m[2] });
    if (m[2] === '') break;
  }
  return lines;
}

const joinLines = (lines) => lines.map((l) => l.text + l.eol).join('');

// The line ending the file mostly uses: its first, else a new line.
function eolOf(lines) {
  const first = lines.find((l) => l.eol !== '');
  return first ? first.eol : '\n';
}

// The width of an indent, a tab counting to the next multiple of four.
function widthOf(indent) {
  let w = 0;
  for (const c of indent) w = c === '\t' ? w + 4 - (w % 4) : w + 1;
  return w;
}

// The lines as the list reads them: for each, blank, item (with indent, width, mark, done, and where
// its text starts), parent (the index of the item it nests under, or null) and group (a plain line
// that does not begin with white space ends a list, so the next items are in another group). An item
// nests under the nearest item above it indented at least two columns less.
function parse(lines) {
  const out = [];
  const stack = [];
  let group = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    const m = ITEM_RE.exec(text);
    if (m) {
      const w = widthOf(m[1]);
      while (stack.length && out[stack[stack.length - 1]].w + 2 > w) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : null;
      out.push({ item: true, blank: false, indent: m[1], w, parent, group, done: m[4] !== ' ', mark: m[1].length + m[2].length + m[3].length + 1, start: text.length - m[6].length, text: m[6].replace(/\s+$/, '') });
      stack.push(i);
    } else {
      const blank = text.trim() === '';
      const w = widthOf(/^[ \t]*/.exec(text)[0]);
      if (!blank && w === 0) { stack.length = 0; group++; }
      out.push({ item: false, blank, w, parent: null, group, text });
    }
  }
  return out;
}

const isDescendant = (rows, j, i) => {
  for (let p = rows[j].parent; p !== null; p = rows[p].parent) if (p === i) return true;
  return false;
};

// The end (exclusive) of an item's block: the item, its descendants and the plain lines indented
// under it, not the blank lines after the last of them.
function blockEnd(rows, i) {
  let end = i + 1;
  for (let j = i + 1; j < rows.length; j++) {
    const r = rows[j];
    if (r.blank) continue;
    if (r.item ? isDescendant(rows, j, i) : r.w > rows[i].w) end = j + 1;
    else break;
  }
  return end;
}

// The item above `i` with the same parent in the same list, or null.
function siblingAbove(rows, i) {
  for (let k = i - 1; k >= 0 && k !== rows[i].parent; k--) {
    if (rows[k].item && rows[k].parent === rows[i].parent && rows[k].group === rows[i].group) return k;
  }
  return null;
}

// The item below `i` with the same parent in the same list, or null: the next item after its block,
// when that is one.
function siblingBelow(rows, i) {
  for (let k = blockEnd(rows, i); k < rows.length; k++) {
    if (!rows[k].item) continue;
    return rows[k].parent === rows[i].parent && rows[k].group === rows[i].group ? k : null;
  }
  return null;
}

// ---------- reading ----------

function folderOf(value, place) {
  return iter.filledIn(value, place.folder.label);
}

function present(target, name, exists, raw, folderText) {
  const rows = parse(splitLines(raw));
  const lines = [];
  const depth = (i) => { let d = 0; for (let p = rows[i].parent; p !== null; p = rows[p].parent) d++; return d; };
  rows.forEach((r, index) => {
    if (r.item) lines.push({ index, item: true, depth: depth(index), done: r.done, text: r.text });
    else if (!r.blank) lines.push({ index, item: false, text: r.text.replace(/\s+$/, '') });
  });
  const out = { target, exists, file: name };
  if (folderText !== null) out.folder = folderText;
  return { ...out, version: versionOf(raw), lines };
}

function readRaw(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

// `opts.today` is the day a list not written yet would be first written (the local date by default).
function readTodos(dir, target, opts) {
  const { value, digits } = mustTodos(dir);
  const key = checkTarget(target);
  const place = placeOf(dir, value, digits, key, (opts && opts.today) || localToday());
  const raw = readRaw(path.join(place.folder.abs, place.name));
  return present(key, place.name, raw !== null, raw === null ? '' : raw, folderOf(value, place));
}

// ---------- writing ----------

// The place, the text now on disk and the lines of a target's list, once the request's version is
// found to be the file's.
function open(dir, target, version, opts) {
  const { value, digits } = mustTodos(dir);
  const key = checkTarget(target);
  if (typeof version !== 'string') throw new StatusError('A change names the version of the list it read.', 400);
  iter.checkWritable(value);
  const place = placeOf(dir, value, digits, key, (opts && opts.today) || localToday());
  const file = path.join(place.folder.abs, place.name);
  const raw = readRaw(file);
  if (versionOf(raw === null ? '' : raw) !== version) {
    throw new StatusError('The list changed on disk after it was read, so nothing was changed. It is read again.', 409);
  }
  const lines = splitLines(raw === null ? '' : raw);
  return { key, file, place, lines, rows: parse(lines) };
}

function save(dir, ctx, lines, opts) {
  const text = joinLines(lines);
  if (text.length > MAX_FILE) throw new StatusError('That list is too long.', 413);
  fs.mkdirSync(ctx.place.folder.abs, { recursive: true });
  writeAtomic(ctx.file, text);
  return readTodos(dir, ctx.key, opts);
}

function checkText(text) {
  if (typeof text !== 'string') throw new StatusError('An item is text.', 400);
  const t = text.trim();
  if (t === '') throw new StatusError('An item needs some text.', 400);
  if (CONTROL.test(t)) throw new StatusError('An item is one line of text.', 400);
  if (t.length > MAX_ITEM) throw new StatusError('That item is too long.', 413);
  return t;
}

function itemAt(ctx, index) {
  if (!Number.isInteger(index)) throw new StatusError('An item is named by its line number.', 400);
  const row = ctx.rows[index];
  if (!row || !row.item) throw new StatusError('There is no item on that line.', 404);
  return row;
}

// Add an item `{ text, parent?, version }`: at the end of the file, or as the last child of the item
// on line `parent`. The new line is `- [ ] text`, its ending the file's own.
function addTodo(dir, target, body, opts) {
  const { text, parent, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  const t = checkText(text);
  const lines = ctx.lines.map((l) => ({ ...l }));
  const eol = eolOf(lines);
  let at = lines.length;
  let indent = '';
  if (parent !== undefined && parent !== null) {
    const p = itemAt(ctx, parent);
    at = blockEnd(ctx.rows, parent);
    indent = p.indent + (p.indent.includes('\t') ? '\t' : '  ');
  }
  const fresh = { text: `${indent}- [ ] ${t}`, eol };
  if (at === lines.length && lines.length && lines[lines.length - 1].eol === '') {
    lines[lines.length - 1].eol = eol;
    fresh.eol = '';
  }
  lines.splice(at, 0, fresh);
  return save(dir, ctx, lines, opts);
}

// Change an item `{ index, done?, text?, version }`: tick or untick it, and/or replace its text.
function setTodo(dir, target, body, opts) {
  const { index, done, text, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  const row = itemAt(ctx, index);
  if (done === undefined && text === undefined) throw new StatusError('Say what to change: done or text.', 400);
  if (done !== undefined && typeof done !== 'boolean') throw new StatusError('Done is true or false.', 400);
  const t = text === undefined ? null : checkText(text);
  const lines = ctx.lines.map((l) => ({ ...l }));
  let line = lines[index].text;
  if (t !== null) line = line.slice(0, row.start) + t;
  if (done !== undefined && done !== row.done) line = `${line.slice(0, row.mark)}${done ? 'x' : ' '}${line.slice(row.mark + 1)}`;
  lines[index].text = line;
  return save(dir, ctx, lines, opts);
}

// Delete an item `{ index, version }` with its block: its children and the plain lines under it.
function deleteTodo(dir, target, body, opts) {
  const { index, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  itemAt(ctx, index);
  const lines = ctx.lines.map((l) => ({ ...l }));
  lines.splice(index, blockEnd(ctx.rows, index) - index);
  return save(dir, ctx, lines, opts);
}

// Swap two blocks, `first` above `second`, leaving the lines between them where they are. A last line
// with no ending that moves up gains one, and the new last line loses its ending, so a file without a
// final line ending stays without one.
function swapBlocks(ctx, first, second) {
  const rows = ctx.rows;
  const lines = ctx.lines.map((l) => ({ ...l }));
  const eol = eolOf(lines);
  const a = [first, blockEnd(rows, first)];
  const b = [second, blockEnd(rows, second)];
  const noFinal = lines.length > 0 && lines[lines.length - 1].eol === '';
  const out = [...lines.slice(0, a[0]), ...lines.slice(b[0], b[1]), ...lines.slice(a[1], b[0]), ...lines.slice(a[0], a[1]), ...lines.slice(b[1])];
  for (const l of out) if (l.eol === '') l.eol = eol;
  if (noFinal && out.length) out[out.length - 1].eol = '';
  return out;
}

// Move an item `{ index, by: -1 | 1, version }` up or down among its siblings, children along. At the
// first or last of them nothing changes.
function moveTodo(dir, target, body, opts) {
  const { index, by, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  itemAt(ctx, index);
  if (by !== -1 && by !== 1) throw new StatusError('An item moves up (-1) or down (1).', 400);
  const other = by === -1 ? siblingAbove(ctx.rows, index) : siblingBelow(ctx.rows, index);
  if (other === null) return readTodos(dir, ctx.key, opts);
  return save(dir, ctx, by === -1 ? swapBlocks(ctx, other, index) : swapBlocks(ctx, index, other), opts);
}

// ---------- the board ----------

// The targets that have a list, in id order, from the file names alone.
function listTargets(dir) {
  const config = cfg.readConfig(dir);
  if (!config.todos) return [];
  return ids.sortIds([...new Set(allFiles(dir, config.todos).map((f) => f.target))]);
}

// { target: { open, total } } for every list that has items; open over all, worked out from the files each time.
function counts(dir, opts) {
  const config = cfg.readConfig(dir);
  if (!config.todos) return {};
  const all = allFiles(dir, config.todos);
  const out = {};
  for (const target of new Set(all.map((f) => f.target))) {
    const place = placeOf(dir, config.todos, config.idDigits, target, (opts && opts.today) || localToday(), all);
    const raw = readRaw(path.join(place.folder.abs, place.name));
    const items = parse(splitLines(raw === null ? '' : raw)).filter((r) => r.item);
    if (items.length) out[target] = { open: items.filter((r) => !r.done).length, total: items.length };
  }
  return out;
}

// Delete every list of one target (a card or a group), whatever its padding or folder; how many went.
// Only the delete flow calls this.
function deleteTargetFiles(dir, target) {
  const config = cfg.readConfig(dir);
  const key = typeof target === 'string' || typeof target === 'number' ? ids.idKey(target) : null;
  if (!config.todos || key === null) return 0;
  let gone = 0;
  for (const f of allFiles(dir, config.todos)) {
    if (f.target !== key) continue;
    try { fs.unlinkSync(path.join(f.folder.abs, f.name)); gone++; } catch (_) { /* already gone */ }
  }
  return gone;
}

module.exports = { readTodos, addTodo, setTodo, deleteTodo, moveTodo, listTargets, counts, deleteTargetFiles, canonicalName, MAX_ITEM, MAX_FILE };

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
// is not that any more. The whole-text write (the tab's Edit) is the one write that replaces every
// line: the file becomes the text it is given, in the file's own line ending, under the same version rule.
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
const ids = require('../web/ids');
const { StatusError, versionOf } = require('./store-common');
const { writeAtomic } = require('./card-store');
const iter = require('./iteration-folders');
const { targetFiles } = require('./target-files');
const { localToday } = require('../web/days');
const cfg = require('./config-store');

const ITEM_RE = /^([ \t]*)([-*+])([ \t]+)\[([ xX])\]([ \t]+)([\s\S]*)$/;
const MAX_FILE = 300000; // under the server's request limit even when every new line is escaped
const MAX_ITEM = 2000;
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const BOM = '\uFEFF';

// The file naming, the folders and the listing are shared with the scratchpad (target-files.js).
const files = targetFiles({ key: 'todos', kind: 'todo', off: 'Todo lists are off: config.yaml has no todos: line.' });
const { checkTarget, canonicalName, placeOf, listTargets, deleteTargetFiles } = files;
const mustTodos = (dir) => { const { value, digits } = files.mustBeOn(dir); return { value, digits }; };

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
  return iter.filledIn(value, place.folder);
}

// A file that starts with a byte order mark reads past it, and a write puts it back.
const withoutBom = (raw) => (raw.startsWith(BOM) ? raw.slice(1) : raw);

// The file as the tab's Edit box shows it: no byte order mark, every line ending a plain new line.
const plainText = (raw) => withoutBom(raw).replace(/\r\n?/g, '\n');

function present(target, name, exists, raw, folderText) {
  const rows = parse(splitLines(withoutBom(raw)));
  const lines = [];
  const depth = (i) => { let d = 0; for (let p = rows[i].parent; p !== null; p = rows[p].parent) d++; return d; };
  rows.forEach((r, index) => {
    if (r.item) lines.push({ index, item: true, depth: depth(index), done: r.done, text: r.text });
    else if (!r.blank) lines.push({ index, item: false, text: r.text.replace(/\s+$/, '') });
  });
  const out = { target, exists, file: name };
  if (folderText !== null) out.folder = folderText;
  return { ...out, version: versionOf(raw), text: plainText(raw), lines };
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
  const text = raw === null ? '' : raw;
  const lines = splitLines(withoutBom(text));
  return { key, file, place, lines, rows: parse(lines), bom: text.startsWith(BOM) ? BOM : '', size: text.length };
}

function save(dir, ctx, lines, opts) {
  const text = ctx.bom + joinLines(lines);
  // A write never makes the file bigger than the limit; one already over it (a hand edit) can still change.
  if (text.length > MAX_FILE && text.length > ctx.size) throw new StatusError('That list is too long.', 413);
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
// The indent of a new child of the item on line `i`: the parent's own, then the step the file already
// takes for its children (the first child's extra indent), else a tab when the parent is tab-indented, else
// two spaces.
function childIndent(rows, i) {
  const p = rows[i];
  for (let j = i + 1; j < rows.length && isDescendant(rows, j, i); j++) {
    if (rows[j].parent === i && rows[j].indent.startsWith(p.indent) && rows[j].indent.length > p.indent.length) return rows[j].indent;
  }
  return p.indent + (p.indent.includes('\t') ? '\t' : '  ');
}

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
    indent = childIndent(ctx.rows, parent);
  }
  const fresh = { text: `${indent}- [ ] ${t}`, eol };
  if (at === lines.length && lines.length && lines[lines.length - 1].eol === '') {
    lines[lines.length - 1].eol = eol;
    fresh.eol = '';
  }
  lines.splice(at, 0, fresh);
  return { ...save(dir, ctx, lines, opts), at };
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
// first or last of them nothing changes. The answer carries `at`, the line the moved item is on now.
function moveTodo(dir, target, body, opts) {
  const { index, by, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  itemAt(ctx, index);
  if (by !== -1 && by !== 1) throw new StatusError('An item moves up (-1) or down (1).', 400);
  const other = by === -1 ? siblingAbove(ctx.rows, index) : siblingBelow(ctx.rows, index);
  if (other === null) return { ...readTodos(dir, ctx.key, opts), at: index };
  const rows = ctx.rows;
  const at = by === -1 ? other : index + blockEnd(rows, other) - blockEnd(rows, index);
  return { ...save(dir, ctx, by === -1 ? swapBlocks(ctx, other, index) : swapBlocks(ctx, index, other), opts), at };
}

// A block moved to a new place with a new indent: every line that starts with the item's old indent has it
// replaced by the new one, so its children keep their step under it. A last line with no ending that moves
// gains one, and the new last line loses its ending, so a file without a final line ending stays without one.
function reindented(ctx, from, to, at, oldIndent, newIndent) {
  const lines = ctx.lines.map((l) => ({ ...l }));
  const eol = eolOf(lines);
  const noFinal = lines.length > 0 && lines[lines.length - 1].eol === '';
  const block = lines.slice(from, to).map((l) => (l.text.startsWith(oldIndent) ? { ...l, text: newIndent + l.text.slice(oldIndent.length) } : l));
  const rest = [...lines.slice(0, from), ...lines.slice(to)];
  const out = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  for (const l of out) if (l.eol === '') l.eol = eol;
  if (noFinal && out.length) out[out.length - 1].eol = '';
  return out;
}

// Indent an item `{ index, version }`: it becomes the last child of the sibling above it, its own children
// along. With no sibling above, nothing changes. The answer carries `at`, the line the item is on now.
function indentTodo(dir, target, body, opts) {
  const { index, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  const row = itemAt(ctx, index);
  const above = siblingAbove(ctx.rows, index);
  if (above === null) return { ...readTodos(dir, ctx.key, opts), at: index };
  const end = blockEnd(ctx.rows, index);
  const into = blockEnd(ctx.rows, above); // where the sibling's block ends, before the item
  const at = into;
  const out = reindented(ctx, index, end, into, row.indent, childIndent(ctx.rows, above));
  return { ...save(dir, ctx, out, opts), at };
}

// Outdent an item `{ index, version }`: it moves to just after its parent's block, one level up, its own
// children along; the siblings after it stay under the old parent. At the top level nothing changes.
function outdentTodo(dir, target, body, opts) {
  const { index, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  const row = itemAt(ctx, index);
  const parent = row.parent;
  if (parent === null) return { ...readTodos(dir, ctx.key, opts), at: index };
  const end = blockEnd(ctx.rows, index);
  const after = blockEnd(ctx.rows, parent);
  const at = after - (end - index);
  const out = reindented(ctx, index, end, at, row.indent, ctx.rows[parent].indent);
  return { ...save(dir, ctx, out, opts), at };
}

// Write the whole file `{ text, version }`, as the tab's Edit box gives it: the file then holds exactly
// that text, every line ending the file's own (its first, else a new line) and a byte order mark kept. A
// list not written yet is made in its folder. Unlike an item write, a text over the limit is refused even
// when the file is already over it.
function writeTodos(dir, target, body, opts) {
  const { text, version } = body && typeof body === 'object' ? body : {};
  const ctx = open(dir, target, version, opts);
  if (typeof text !== 'string') throw new StatusError('The list is text.', 400);
  const out = ctx.bom + text.replace(/\r\n?|\n/g, eolOf(ctx.lines));
  if (out.length > MAX_FILE) throw new StatusError('That list is too long.', 413);
  fs.mkdirSync(ctx.place.folder.abs, { recursive: true });
  writeAtomic(ctx.file, out);
  return readTodos(dir, ctx.key, opts);
}

// ---------- the board ----------

// The start of a file, at most MAX_FILE characters of it: what the counts read on every board read.
function readCapped(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(MAX_FILE);
    const n = fs.readSync(fd, buf, 0, MAX_FILE, 0);
    return buf.toString('utf8', 0, n);
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// { target: { open, total } } for every list that has items; open over all, worked out from the files each
// time, reading no more than MAX_FILE of each.
function counts(dir, opts) {
  const config = cfg.readConfig(dir);
  if (!config.paths.todos) return {};
  const all = files.allFiles(dir, config.paths.todos);
  const out = {};
  for (const target of new Set(all.map((f) => f.target))) {
    const place = placeOf(dir, config.paths.todos, config.idDigits, target, (opts && opts.today) || localToday(), all);
    const items = parse(splitLines(withoutBom(readCapped(path.join(place.folder.abs, place.name))))).filter((r) => r.item);
    if (items.length) out[target] = { open: items.filter((r) => !r.done).length, total: items.length };
  }
  return out;
}

module.exports = { readTodos, addTodo, setTodo, deleteTodo, moveTodo, indentTodo, outdentTodo, writeTodos, listTargets, counts, deleteTargetFiles, canonicalName, MAX_ITEM, MAX_FILE };

'use strict';
// The logbook (docs/adr/0016): the board's notes, one Markdown file per target per
// day in the folder `logbook:` names in config.yaml (off without the line). The file
// name is the identity and nothing else carries it: `2026.10.16.logbook.md` for a
// note about nothing, `2026.10.16.0007.logbook.md` for card #7 (the id padded to the
// board's idDigits; a file is read by the number, so any padding resolves),
// `2026.10.16.W0234.logbook.md` for a group. The notes are the frontmatter's
// `entries:` list:
//
//   ---
//   entries:
//     - at: "09:10"       # optional; absent = untimed; always quoted
//       by: "@human"      # an assignee handle
//       note: two enum renames left
//   ---
//   free markdown, kept as written
//
// The frontmatter reader of card-store reads one `key: value` per line and cannot hold
// this list, so the day file has its own tolerant reader. A write changes only the
// entries it must: every other line of the file (other frontmatter keys, comments, keys
// an entry carries that the web does not know, the body below) is written back as it was,
// and an entry nobody touched keeps its own lines. Entries are kept in time order,
// untimed last. A write is read-modify-write of the one file, tmp-and-rename like every
// store; because an agent may append to the same file, the file's mtime and size are
// compared again just before the rename and a change means: re-read, reapply, retry once,
// then a conflict (HTTP 409). A file nothing is left in is removed.
//
// `logbook:` may hold `<iteration>` as a whole path segment (docs/adr/0019, iteration-folders.js):
// a note for a day and target that already have a day file in any folder joins that file; else it is
// written to the folder of the iteration it is aimed at or whose dates hold its day. A note is read
// from every folder the path can name, and edited, deleted and assigned where it is: assigning keeps
// it in its folder unless the new target is an iteration, whose folder it then goes to. A note's
// `file` reads `<iteration folder>/<day file>`, and just the day file for the folder with the
// segment dropped.
//
// Request text never builds a path: the day and the id are validated and the file
// name is built from them, or taken from the folder's own listing.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const ids = require('../web/ids');
const { validDay } = require('../web/days');
const { StatusError } = require('./store-common');
const { writeAtomic } = require('./card-store');
const iter = require('./iteration-folders');

const FILE_RE = /^(\d{4})\.(\d{2})\.(\d{2})\.(?:([^.]+)\.)?logbook\.md$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_AUTHOR = '@human';
const MAX_NOTE = 20000;

// ---------- the folder and the names ----------

function mustLogbook(dir) {
  const config = cfg.readConfig(dir);
  if (!config.paths.logbook) throw new StatusError('The logbook is off: config.yaml has no logbook: line.', 404);
  return { value: config.paths.logbook, digits: config.idDigits };
}

function checkDay(day) {
  if (!validDay(day)) throw new StatusError('A day reads YYYY-MM-DD.', 400);
  return String(day);
}

// A target is a card or group id as a whole string, or '' for nothing.
function checkTarget(target) {
  if (target === undefined || target === null || target === '') return '';
  const key = typeof target === 'string' ? ids.idKey(target.trim()) : null;
  if (key === null) throw new StatusError('That is not an id.', 400);
  return key;
}

function checkTime(at) {
  if (at === undefined || at === null || at === '') return null;
  if (typeof at !== 'string' || !TIME_RE.test(at.trim())) throw new StatusError('A time reads HH:MM, e.g. 09:10.', 400);
  return at.trim();
}

function checkText(note) {
  const text = typeof note === 'string' ? note.replace(/\r\n?/g, '\n').trim() : '';
  if (text === '') throw new StatusError('A note needs text.', 400);
  if (text.length > MAX_NOTE) throw new StatusError('That note is too long.', 400);
  return text;
}

// An author is kept as written, as one trimmed line; the entry writer quotes it, so no text
// can break the YAML. A blank one is the human, like an absent one.
function checkAuthor(by) {
  if (by === undefined || by === null) return DEFAULT_AUTHOR;
  if (typeof by !== 'string') throw new StatusError('An author is text.', 400);
  return by.replace(/\s*[\r\n]+\s*/g, ' ').trim() || DEFAULT_AUTHOR;
}

function canonicalName(day, target, digits) {
  return `${day.replace(/-/g, '.')}${target === '' ? '' : `.${ids.formatId(target, digits)}`}.logbook.md`;
}

// Every file of the folder that is a day file: { name, day, target }, by name.
function dayFiles(folder) {
  let entries;
  try { entries = fs.readdirSync(folder); } catch (_) { return []; }
  const out = [];
  for (const name of entries.sort()) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const day = `${m[1]}-${m[2]}-${m[3]}`;
    if (!validDay(day)) continue;
    const target = m[4] === undefined ? '' : ids.idKey(m[4]);
    if (target === null) continue;
    out.push({ name, day, target });
  }
  return out;
}

// The ref a day file carries as a note's `file`: the folder's label and the file's name.
function refOf(label, name) {
  return label === '' ? name : `${label}/${name}`;
}

// Every day file of every folder the path can name: { name, day, target, label, ref, file }, where
// ref is the name a note's `file` carries and file is the absolute path.
function allDayFiles(dir, value) {
  const out = [];
  for (const folder of iter.readFolders(dir, value)) {
    for (const f of dayFiles(folder.abs)) {
      out.push({ ...f, label: folder.label, parts: folder.parts, ref: refOf(folder.label, f.name), file: path.join(folder.abs, f.name) });
    }
  }
  return out;
}

// The file to write for a day and a target in a folder: the one that is there (the canonical name
// first), else the canonical name.
function fileToWrite(folder, digits, day, target) {
  const canon = canonicalName(day, target, digits);
  const have = dayFiles(folder).filter((f) => f.day === day && f.target === target);
  const name = have.some((f) => f.name === canon) ? canon : have.length ? have[0].name : canon;
  return path.join(folder, name);
}

// Where a note for a day and a target is written, { folder, file }: the day file that already exists
// in any folder the path can name (the one in `prefer`'s folder if several), else `fallback`'s folder.
function homeOf(dir, value, digits, day, target, prefer, fallback) {
  const have = allDayFiles(dir, value).filter((f) => f.day === day && f.target === target);
  if (!have.length) return { folder: fallback, file: fileToWrite(fallback.abs, digits, day, target) };
  const chosen = have.find((f) => f.label === prefer.label) || have[0];
  const folder = { label: chosen.label, abs: path.dirname(chosen.file) };
  return { folder, file: fileToWrite(folder.abs, digits, day, target) };
}

// ---------- scalars ----------

function closingQuote(s, q) {
  for (let i = 1; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') { i++; continue; }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") { i++; continue; }
      return i;
    }
  }
  return -1;
}

function unescapeDouble(s) {
  const named = { n: '\n', t: '\t', r: '\r', 0: '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ' };
  return s.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|(.))/g, (m, x, u, c) => {
    if (x || u) return String.fromCharCode(parseInt(x || u, 16));
    return Object.prototype.hasOwnProperty.call(named, c) ? named[c] : m;
  });
}

// An inline value as text. `comment`: a plain value ends at a ` #` (at and by); the note
// keeps one, since `fixed #12` is what a person means.
function decodeInline(inline, comment) {
  const s = inline.trim();
  if (s[0] === '"' || s[0] === "'") {
    const end = closingQuote(s, s[0]);
    const body = end === -1 ? s.slice(1) : s.slice(1, end);
    return s[0] === '"' ? unescapeDouble(body) : body.replace(/''/g, "'");
  }
  if (!comment) return s;
  if (s[0] === '#') return '';
  const hash = s.search(/\s#/);
  return hash === -1 ? s : s.slice(0, hash).trim();
}

function doubleQuote(text) {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
    .replace(/[\u0000-\u001f\u007f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  return `"${escaped}"`;
}

function plainSafe(t) {
  return t !== '' && t === t.trim()
    && !/[\u0000-\u001f\u007f]/.test(t)
    && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(t)
    && !/: | #|:$/.test(t)
    && !/^(~|null|true|false|yes|no|on|off)$/i.test(t)
    && !/^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t);
}

// The lines of `note: ...` for a note's text, at the key's own indent.
function noteLines(text, keyIndent) {
  if (text.includes('\n') && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text) && !/^\s/.test(text)) {
    return [`${keyIndent}note: |-`, ...text.split('\n').map((l) => (l === '' ? '' : `${keyIndent}  ${l}`))];
  }
  return [`${keyIndent}note: ${plainSafe(text) ? text : doubleQuote(text)}`];
}

// ---------- the day file ----------

function normaliseTime(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const t = `${m[1].padStart(2, '0')}:${m[2]}`;
  return TIME_RE.test(t) ? t : null;
}

// The text a block scalar's lines hold.
function blockText(style, lines) {
  const body = lines.filter((l, i) => !(l.trim() === '' && i === lines.length - 1));
  const first = body.find((l) => l.trim() !== '');
  const indent = first ? first.length - first.trimStart().length : 0;
  const cut = body.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(indent, l.length - l.trimStart().length))));
  if (style[0] === '|') return cut.join('\n').replace(/\n+$/, '');
  let out = '';
  for (const l of cut) out += l === '' ? '\n' : out === '' || out.endsWith('\n') ? l : ` ${l}`;
  return out.replace(/\n+$/, '');
}

const KEY_LINE = /^( *)([\w-]+):(?:\s+(.*)|\s*)$/;

// One entry from its lines (the dash line first).
function parseEntry(lines) {
  const dash = /^(\s*)-(\s*)(.*)$/.exec(lines[0]);
  const indent = dash[1].length;
  const entry = { raw: lines, dirty: false, chunks: [], at: null, by: '', note: '' };
  let keyCol = dash[3] === '' ? -1 : indent + 1 + dash[2].length;
  const sources = [];
  if (dash[3] !== '') sources.push(' '.repeat(keyCol) + dash[3]);
  for (const l of lines.slice(1)) sources.push(l);
  let cur = null;
  for (const l of sources) {
    const m = KEY_LINE.exec(l);
    if (m && keyCol === -1 && m[1].length > indent) keyCol = m[1].length;
    if (m && m[1].length === keyCol) {
      cur = { key: m[2], first: l.slice(keyCol), inline: m[3] === undefined ? '' : m[3], cont: [] };
      entry.chunks.push(cur);
    } else if (cur) {
      cur.cont.push(l);
    }
  }
  entry.keyCol = keyCol === -1 ? indent + 2 : keyCol;
  entry.indent = indent;
  for (const c of entry.chunks) {
    const block = /^([|>])[-+]?\d*\s*(#.*)?$/.exec(c.inline.trim());
    const folded = c.cont.filter((l) => l.trim() !== '').map((l) => l.trim());
    const value = block ? blockText(block[1], c.cont) : [decodeInline(c.inline, c.key !== 'note'), ...folded].filter((p) => p !== '').join(' ');
    if (c.key === 'at') entry.at = normaliseTime(value);
    else if (c.key === 'by') entry.by = value;
    else if (c.key === 'note') entry.note = value;
  }
  return entry;
}

function isItem(line, indent) {
  const m = /^(\s*)-(\s|$)/.exec(line);
  return !!m && (indent === null || m[1].length === indent);
}

// raw text -> { eol, head, headerLine, lead, entries, rest, closeAt }. The file is
// head, the `entries:` line, lead (lines before the first entry), the entries, then rest
// (what follows the list: other frontmatter keys, the closing ---, the body).
function parseDayFile(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const model = { eol, head: ['---'], headerLine: null, lead: [], entries: [], rest: [], closeAt: -1 };
  let close = -1;
  if (lines[0].trimEnd() === '---') {
    for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === '---') { close = i; break; }
  }
  if (close === -1) {
    model.rest = ['---', ...lines];
    model.closeAt = 0;
    return model;
  }
  const front = lines.slice(1, close);
  const at = front.findIndex((l) => /^entries:\s*(\[\s*\])?\s*(#.*)?$/.test(l));
  if (at === -1) {
    model.head = lines.slice(0, close);
    model.rest = lines.slice(close);
    model.closeAt = 0;
    return model;
  }
  model.head = ['---', ...front.slice(0, at)];
  model.headerLine = front[at];
  let end = at + 1;
  while (end < front.length && !/^[^\s#-]/.test(front[end])) end++;
  while (end > at + 1 && (front[end - 1].trim() === '' || /^#/.test(front[end - 1]))) end--;
  const block = front.slice(at + 1, end);
  model.rest = [...front.slice(end), ...lines.slice(close)];
  model.closeAt = front.length - end;
  const first = block.findIndex((l) => isItem(l, null));
  if (first === -1) {
    model.lead = block;
    return model;
  }
  model.lead = block.slice(0, first);
  const indent = /^(\s*)/.exec(block[first])[1].length;
  let start = first;
  for (let i = first + 1; i <= block.length; i++) {
    if (i === block.length || isItem(block[i], indent)) {
      model.entries.push(parseEntry(block.slice(start, i)));
      start = i;
    }
  }
  return model;
}

function timeKey(e) { return e.at || '99:99'; }

function inOrder(entries) {
  return entries.slice().sort((a, b) => (timeKey(a) < timeKey(b) ? -1 : timeKey(a) > timeKey(b) ? 1 : 0));
}

// An entry written out from what it holds. Keys the web does not know ride along as they
// were; at, by and note are written afresh, the time first.
function renderEntry(e, indent, keyCol) {
  const pad = ' '.repeat(keyCol);
  const chunks = e.chunks.map((c) => ({ key: c.key, lines: [pad + c.first, ...c.cont] }));
  const put = (key, lines) => {
    const i = chunks.findIndex((c) => c.key === key);
    if (i !== -1) chunks[i] = { key, lines };
    else chunks.push({ key, lines });
  };
  chunks.splice(0, chunks.length, ...chunks.filter((c) => c.key !== 'at'));
  if (e.at) chunks.unshift({ key: 'at', lines: [`${pad}at: "${e.at}"`] });
  if (e.by) put('by', [`${pad}by: ${doubleQuote(e.by)}`]);
  put('note', noteLines(e.note, pad));
  const out = [];
  chunks.forEach((c, i) => {
    if (i === 0) out.push(`${' '.repeat(indent)}- ${c.lines[0].slice(keyCol)}`, ...c.lines.slice(1));
    else out.push(...c.lines);
  });
  return out;
}

function renderDayFile(model) {
  const seen = model.entries.find((e) => e.indent !== undefined);
  const indent = seen ? seen.indent : 2;
  const keyCol = seen ? seen.keyCol : indent + 2;
  const body = [];
  for (const e of inOrder(model.entries)) {
    if (!e.dirty && e.raw) body.push(...e.raw);
    else body.push(...renderEntry(e, e.indent === undefined ? indent : e.indent, e.keyCol === undefined ? keyCol : e.keyCol));
  }
  let header = model.headerLine;
  if (header === null || (model.entries.length && !/^entries:\s*(#.*)?$/.test(header))) header = 'entries:';
  return [...model.head, header, ...model.lead, ...body, ...model.rest].join(model.eol);
}

// Whether the file still says anything once its entries are gone.
function hasOtherContent(model) {
  return model.head.slice(1).some((l) => l.trim() !== '') || model.rest.some((l, i) => i !== model.closeAt && l.trim() !== '');
}

function newEntry(at, by, note, chunks = []) {
  return { raw: null, dirty: true, chunks, at, by, note };
}

function record(e, day, target, file, index) {
  return { day, target, index, at: e.at, by: e.by, note: e.note, file };
}

// ---------- reading ----------

function listNotes(dir) {
  const config = cfg.readConfig(dir);
  if (!config.paths.logbook) return [];
  const out = [];
  for (const f of allDayFiles(dir, config.paths.logbook)) {
    let raw;
    try { raw = fs.readFileSync(f.file, 'utf8'); } catch (_) { continue; }
    parseDayFile(raw).entries.forEach((e, index) => out.push(record(e, f.day, f.target, f.ref, index)));
  }
  return out;
}

// ---------- writing ----------

function stamp(file) {
  try {
    const s = fs.statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch (_) {
    return null;
  }
}

// Read the file, let `apply` change the model, write it back. A file that changed since
// the read is read again and `apply` runs again, once; then it is a conflict.
function withFile(file, hooks, apply) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = stamp(file);
    const model = parseDayFile(before === null ? '' : fs.readFileSync(file, 'utf8'));
    const result = apply(model);
    if (hooks && hooks.afterRead) hooks.afterRead(file, attempt);
    if (stamp(file) !== before) continue;
    if (model.entries.length || hasOtherContent(model)) {
      const text = renderDayFile(model);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeAtomic(file, text);
    } else if (before !== null) {
      fs.unlinkSync(file);
    }
    return result;
  }
  throw new StatusError(`${path.basename(file)} kept changing while it was written; nothing was lost, try again.`, 409);
}

const same = (a, b) => (a.at || null) === (b.at || null) && (a.by || '') === (b.by || '') && a.note === b.note;

// The entry a ref means: the one at its index when it still reads as the note the caller
// saw, else the same note wherever it moved to; none left is a conflict.
function locate(model, ref) {
  const at = model.entries[ref.index];
  const seen = ref.expect;
  if (!seen) {
    if (!at) throw new StatusError('That note is gone.', 409);
    return at;
  }
  if (at && same(at, seen)) return at;
  const found = model.entries.find((e) => same(e, seen));
  if (!found) throw new StatusError('That note has changed or is gone; reload and try again.', 409);
  return found;
}

// The file a ref points at: the day file of its day and target, the one it names when
// several do (the same day and id under two paddings, or the same day in two folders).
function fileOfRef(dir, ref) {
  const { value } = mustLogbook(dir);
  const day = checkDay(ref && ref.day);
  const target = checkTarget(ref && ref.target);
  const have = allDayFiles(dir, value).filter((f) => f.day === day && f.target === target);
  if (!have.length) throw new StatusError('That note is gone.', 409);
  const chosen = have.find((f) => f.ref === ref.file) || have[0];
  return { file: chosen.file, ref: chosen.ref, label: chosen.label, parts: chosen.parts, day, target };
}

function indexOf(model, entry) {
  return inOrder(model.entries).indexOf(entry);
}

function addNote(dir, input, hooks) {
  const { value, digits } = mustLogbook(dir);
  const day = checkDay(input.day);
  const target = checkTarget(input.target);
  const at = checkTime(input.at);
  const by = checkAuthor(input.by);
  const note = checkText(input.note);
  iter.checkWritable(value);
  const ruled = iter.folderOfNote(dir, value, target, day);
  const { folder, file } = homeOf(dir, value, digits, day, target, ruled, ruled);
  return withFile(file, hooks, (model) => {
    const entry = newEntry(at, by, note);
    model.entries.push(entry);
    return record(entry, day, target, refOf(folder.label, path.basename(file)), indexOf(model, entry));
  });
}

function editNote(dir, ref, patch, hooks) {
  const where = fileOfRef(dir, ref);
  const at = patch.at === undefined ? undefined : checkTime(patch.at);
  const note = patch.note === undefined ? undefined : checkText(patch.note);
  return withFile(where.file, hooks, (model) => {
    const entry = locate(model, ref);
    if (at !== undefined) entry.at = at;
    if (note !== undefined) entry.note = note;
    entry.dirty = true;
    return record(entry, where.day, where.target, where.ref, indexOf(model, entry));
  });
}

function deleteNote(dir, ref, hooks) {
  const where = fileOfRef(dir, ref);
  return withFile(where.file, hooks, (model) => {
    model.entries.splice(model.entries.indexOf(locate(model, ref)), 1);
    return { ok: true };
  });
}

// Assign: the one note moves to the other target's file for the same day. Nothing moves a file
// between iteration folders (docs/adr/0019), so the note stays in the folder it is in; if a day file
// for the new target and day already exists in some folder it joins that one. The exception is a new
// target that is an iteration itself: the note then goes to that iteration's folder. It is added
// there before it leaves the first file, so a failure between the two leaves it twice, never lost.
function assignNote(dir, ref, to, hooks) {
  const where = fileOfRef(dir, ref);
  const target = checkTarget(to);
  if (target === where.target) throw new StatusError('The note is already there.', 400);
  const { value, digits } = mustLogbook(dir);
  const found = locate(parseDayFile(fs.readFileSync(where.file, 'utf8')), ref);
  const seen = { at: found.at, by: found.by, note: found.note };
  iter.checkWritable(value);
  const here = { label: where.label, abs: path.dirname(where.file), parts: where.parts, segs: [] };
  const aimed = iter.folderOfIterationTarget(dir, value, target);
  const stay = iter.folderOfAssigned(dir, value, here, target);
  const { folder, file: dest } = aimed ? { folder: aimed, file: fileToWrite(aimed.abs, digits, where.day, target) } : homeOf(dir, value, digits, where.day, target, stay, stay);
  const made = withFile(dest, hooks, (model) => {
    const entry = newEntry(found.at, found.by, found.note, found.chunks.filter((c) => !['at', 'by', 'note'].includes(c.key)));
    model.entries.push(entry);
    return record(entry, where.day, target, refOf(folder.label, path.basename(dest)), indexOf(model, entry));
  });
  withFile(where.file, hooks, (model) => {
    model.entries.splice(model.entries.indexOf(locate(model, { ...ref, expect: seen })), 1);
  });
  return made;
}

// Delete every day file of one target (a card or a group), whatever its padding or folder; how many went.
// A board with no logbook has none to delete.
function deleteTargetFiles(dir, target) {
  const config = cfg.readConfig(dir);
  const key = ids.idKey(target);
  if (!config.paths.logbook || key === null) return 0;
  let gone = 0;
  for (const f of allDayFiles(dir, config.paths.logbook)) {
    if (f.target !== key) continue;
    try { fs.unlinkSync(f.file); gone++; } catch (_) { /* already gone */ }
  }
  return gone;
}

module.exports = { listNotes, addNote, editNote, deleteNote, assignNote, canonicalName, deleteTargetFiles };

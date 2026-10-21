'use strict';
// The `<iteration>` placeholder of the `logbook:` and `scratchpad:` paths (docs/adr/0019). A path
// segment that is exactly `<iteration>` stands for the folder of one iteration, named as the
// iteration's group file is named without `.md` (`0005.sprint-496`). Anything else, an unknown
// `<sprint>` included, is an ordinary folder name (docs/adr/0004). A path without the placeholder
// is one folder and none of this applies.
//
// The path splits at the placeholder into a head (the folder that holds the iteration folders) and
// a tail (what sits under each). A folder is matched to its iteration by the id at the front of its
// name, so a renamed group keeps its folder. A write picks its folder from the rules below; a read
// covers every folder the path can name: each folder under the head that starts with an id, and the
// folder with the segment dropped. Request text never builds a path: a folder is taken from the
// head's own listing or built from a group file's name.
const fs = require('fs');
const path = require('path');
const gs = require('./group-store');
const ids = require('../web/ids');
const { groupRunning } = require('../web/groups');

const PLACEHOLDER = '<iteration>';
const ITERATION_FOLDER = 'iteration';

// The pieces of a configured path: { head, tail } as segments, or null when no segment is the placeholder.
function split(value) {
  const parts = String(value).split(/[\\/]/);
  const at = parts.indexOf(PLACEHOLDER);
  return at === -1 ? null : { head: parts.slice(0, at), tail: parts.slice(at + 1) };
}

const hasPlaceholder = (value) => split(value) !== null;

const joinParts = (parts) => parts.join('/');

// The board's iterations: { id, name, start, end } where name is the group file's name without `.md`.
function iterations(dir) {
  const read = gs.readGroups(dir);
  if (!read) return [];
  return read.list
    .filter((g) => g.folder === ITERATION_FOLDER)
    .map((g) => ({ id: g.id, name: path.posix.basename(g.file).replace(/\.md$/, ''), start: g.start_date, end: g.end_date, cards: g.cards, group: g }));
}

// The one that started first; an undated one after every dated one; ties by id.
function startedFirst(list) {
  return list.slice().sort((a, b) => {
    if ((a.start === '') !== (b.start === '')) return a.start === '' ? 1 : -1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : ids.compareIds(a.id, b.id);
  })[0] || null;
}

// The iteration whose dates hold the day (both days included); two hold it: the one that started first.
function holding(list, day) {
  return startedFirst(list.filter((i) => groupRunning(i.group, day)));
}

// The id at the front of a folder's name (`0005.sprint-496` -> `5`), or null.
function idOfFolder(name) {
  return ids.idKey(name.split('.')[0]);
}

function folderNames(headAbs) {
  let entries;
  try { entries = fs.readdirSync(headAbs, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// What a configured path is for a board: its parts, the absolute head, and the absolute folders.
function parts(dir, value) {
  const s = split(value);
  if (s === null) return null;
  return { head: s.head, tail: s.tail, headAbs: path.resolve(dir, joinParts(s.head) || '.') };
}

const underTail = (p, abs) => path.join(abs, ...p.tail);

// Every folder the path can name, [{ label, abs }]: label is the iteration folder's name, '' for the
// folder with the segment dropped and for a path without the placeholder. The dropped one comes last.
function readFolders(dir, value) {
  const p = parts(dir, value);
  if (p === null) return [{ label: '', abs: path.resolve(dir, value) }];
  const out = folderNames(p.headAbs).filter((name) => idOfFolder(name) !== null).map((name) => ({ label: name, abs: underTail(p, path.join(p.headAbs, name)) }));
  out.push({ label: '', abs: underTail(p, p.headAbs) });
  return out;
}

// The name of an iteration's folder: one that exists and starts with its id (the one named as the
// group file is named if there are several), else the group file's name.
function nameFor(dir, value, iteration) {
  const p = parts(dir, value);
  const match = folderNames(p.headAbs).filter((name) => idOfFolder(name) === iteration.id);
  return match.includes(iteration.name) ? iteration.name : match[0] || iteration.name;
}

// The folder a write goes to, { label, abs }, once the iteration it belongs to is known (null = none).
function folderFor(dir, value, iteration) {
  const p = parts(dir, value);
  if (p === null) return { label: '', abs: path.resolve(dir, value) };
  if (iteration === null) return { label: '', abs: underTail(p, p.headAbs) };
  const name = nameFor(dir, value, iteration);
  return { label: name, abs: underTail(p, path.join(p.headAbs, name)) };
}

// The configured path with the segment filled in as written (for a page to show), not resolved.
function shown(value, label) {
  const s = split(value);
  return s === null ? String(value) : joinParts([...s.head, ...(label === '' ? [] : [label]), ...s.tail]);
}

// A date as the creator's local YYYY-MM-DD.
function localDay(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// A note's iteration: the one it is aimed at, else the one whose dates hold its day.
function iterationOfNote(dir, target, day) {
  const list = iterations(dir);
  return list.find((i) => i.id === target) || holding(list, day);
}

// A scratchpad's iteration: the one its card or group is in (the first to start of several), the
// iteration itself for its own page, else the one holding `today`.
function iterationOfPad(dir, target, today) {
  const list = iterations(dir);
  return list.find((i) => i.id === target) || startedFirst(list.filter((i) => i.cards.includes(target))) || holding(list, today);
}

module.exports = { PLACEHOLDER, hasPlaceholder, readFolders, folderFor, shown, localDay, iterationOfNote, iterationOfPad };

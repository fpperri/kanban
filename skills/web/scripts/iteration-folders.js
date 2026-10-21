'use strict';
// The `<iteration>` placeholder of the `logbook:` and `scratchpad:` paths (docs/adr/0019). A path
// segment that is exactly `<iteration>` stands for the folder of one iteration, named as the
// iteration's group file is named without `.md` (`0005.sprint-496`). Any other segment, an unknown
// `<sprint>` included, is read as an ordinary folder name (docs/adr/0004) and refused for a write
// (checkWritable), since Windows cannot make it. A path without the placeholder is one folder and
// none of this applies.
//
// The path splits at the placeholder into a head (the folder that holds the iteration folders) and
// a tail (what sits under each). A folder is matched to its iteration by the id at the front of its
// name, so a renamed group keeps its folder. A read covers every folder the path can name: each
// folder under the head that starts with an id (a past iteration's, or any other such name, such as
// `2026.q4`), and the folder with the segment dropped. A write's folder is picked by the
// folderOf* functions; whether a day file or a page already exists is the stores' to decide first.
// Request text never builds a path: a folder is taken from the head's own listing or built from a
// group file's name.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const gs = require('./group-store');
const { StatusError } = require('./store-common');
const ids = require('../web/ids');
const { groupRunning } = require('../web/groups');
const { iterationGroups } = require('../web/iterations');

const PLACEHOLDER = '<iteration>';

// A configured path as segments around its placeholder: { head, tail }, or null when no segment is it.
function splitAtPlaceholder(value) {
  const segments = String(value).split(/[\\/]/);
  const at = segments.indexOf(PLACEHOLDER);
  return at === -1 ? null : { head: segments.slice(0, at), tail: segments.slice(at + 1) };
}

const hasPlaceholder = (value) => splitAtPlaceholder(value) !== null;

// A configured path that holds the placeholder, for a board: { head, tail, headAbs } where headAbs is
// the absolute folder that holds the iteration folders; null when it holds none.
function placeholderPath(dir, value) {
  const split = splitAtPlaceholder(value);
  return split === null ? null : { ...split, headAbs: path.resolve(dir, split.head.join('/') || '.') };
}

const underTail = (p, abs) => path.join(abs, ...p.tail);

// The id at the front of a folder's name (`0005.sprint-496` -> `5`), or null.
function idOfFolder(name) {
  return ids.idKey(name.split('.')[0]);
}

// The folder name an iteration's group file gives: the file's name without `.md`. A file whose name
// does not start with its id (the file name is only a label) gets the id put in front, so the folder
// can be matched to it again.
function folderNameOfGroup(group, digits) {
  const base = path.posix.basename(group.file).replace(/\.md$/, '');
  return idOfFolder(base) === group.id ? base : `${ids.formatId(group.id, digits)}.${base}`;
}

// The board's iterations: { id, name, start, cards, group } where name is the folder name its group
// file gives.
function iterations(dir) {
  const read = gs.readGroups(dir);
  if (!read) return [];
  const digits = cfg.readConfig(dir).idDigits;
  return iterationGroups(read.list)
    .map((g) => ({ id: g.id, name: folderNameOfGroup(g, digits), start: g.start_date, cards: g.cards, group: g }));
}

// The one that started first; an undated one after every dated one; ties by id.
function startedFirst(list) {
  return list.slice().sort((a, b) => {
    if ((a.start === '') !== (b.start === '')) return a.start === '' ? 1 : -1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : ids.compareIds(a.id, b.id);
  })[0] || null;
}

// The iteration whose dates hold the day (both days included); of two, the one that started first.
// Not web/iterations.js's iterationRunning, which opens the dropdown on the newest because it shows
// what is current: a day two iterations share is filed with the first, and stays there (ADR 0019).
function firstStartedHolding(list, day) {
  return startedFirst(list.filter((i) => groupRunning(i.group, day)));
}

function folderNames(headAbs) {
  let entries;
  try { entries = fs.readdirSync(headAbs, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Every folder the path can name, [{ label, abs }]: label is the iteration folder's name, '' for the
// folder with the segment dropped and for a path without the placeholder. The dropped one comes last.
function readFolders(dir, value) {
  const p = placeholderPath(dir, value);
  if (p === null) return [{ label: '', abs: path.resolve(dir, value) }];
  const out = folderNames(p.headAbs).filter((name) => idOfFolder(name) !== null).map((name) => ({ label: name, abs: underTail(p, path.join(p.headAbs, name)) }));
  out.push({ label: '', abs: underTail(p, p.headAbs) });
  return out;
}

// The name of an iteration's folder: one that exists and starts with its id (the one named as the
// group file is named if there are several), else the name its group file gives.
function iterationFolderName(p, iteration) {
  const match = folderNames(p.headAbs).filter((name) => idOfFolder(name) === iteration.id);
  return match.includes(iteration.name) ? iteration.name : match[0] || iteration.name;
}

// The folder of an iteration (null = none: the segment dropped), { label, abs }, for a path that holds the placeholder.
function folderOfIteration(dir, p, iteration) {
  if (iteration === null) return { label: '', abs: underTail(p, p.headAbs) };
  const label = iterationFolderName(p, iteration);
  return { label, abs: underTail(p, path.join(p.headAbs, label)) };
}

// The folder a write goes to, { label, abs }: `pick` names its iteration and is asked only when the
// path holds the placeholder (so a path without it reads no groups).
function folderWhere(dir, value, pick) {
  const p = placeholderPath(dir, value);
  return p === null ? { label: '', abs: path.resolve(dir, value) } : folderOfIteration(dir, p, pick());
}

// The folder of a note for a target on a day: the iteration it is aimed at, else the one holding the day.
function folderOfNote(dir, value, target, day) {
  return folderWhere(dir, value, () => {
    const list = iterations(dir);
    return list.find((i) => i.id === target) || firstStartedHolding(list, day);
  });
}

// The folder of a scratchpad for a target first written on `today`: the iteration its card or group is
// a member of (the first to start of several), the iteration itself for its own page, else the one
// holding `today`.
function folderOfPad(dir, value, target, today) {
  return folderWhere(dir, value, () => {
    const list = iterations(dir);
    return list.find((i) => i.id === target) || startedFirst(list.filter((i) => i.cards.includes(target))) || firstStartedHolding(list, today);
  });
}

// The folder of the iteration the day falls in, else the segment dropped.
function folderOfDay(dir, value, day) {
  return folderWhere(dir, value, () => firstStartedHolding(iterations(dir), day));
}

// The folder of the target when the target is itself an iteration, else null (also for a path that
// holds no placeholder).
function folderOfIterationTarget(dir, value, target) {
  const p = placeholderPath(dir, value);
  const found = p === null ? null : iterations(dir).find((i) => i.id === target);
  return found ? folderOfIteration(dir, p, found) : null;
}

// The configured path with the segment filled in by a folder's label ('' drops it), as written and not
// resolved, for a page to show; null for a path that holds no placeholder.
function filledIn(value, label) {
  const split = splitAtPlaceholder(value);
  return split === null ? null : [...split.head, ...(label === '' ? [] : [label]), ...split.tail].join('/');
}

// A write refuses a folder name that holds < or >, which Windows does not allow: the one placeholder
// is `<iteration>`. A read of such a path stays tolerant.
function checkWritable(value) {
  const odd = String(value).split(/[\\/]/).some((segment) => segment !== PLACEHOLDER && /[<>]/.test(segment));
  if (odd) throw new StatusError('A folder name here holds < or >, which Windows does not allow, and only <iteration> is a placeholder.', 400);
}

module.exports = { PLACEHOLDER, hasPlaceholder, readFolders, folderOfNote, folderOfPad, folderOfDay, folderOfIterationTarget, filledIn, checkWritable };

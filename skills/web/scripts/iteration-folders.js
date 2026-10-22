'use strict';
// The `<iteration>` and `<card>` placeholders of the `logbook:`, `scratchpad:` and `todos:` paths
// (docs/adr/0019, docs/adr/0022). A path segment that is exactly `<iteration>` stands for the folder
// of one iteration, named as the iteration's group file is named without `.md` (`0005.sprint-496`); a
// segment that is exactly `<card>` stands for the folder of one target, named as its card file is named
// without `.card.md` (`0007.fix-login`) or its group file without `.md` (`I0002.zephyr-2`). The
// variables and `<repo>` are filled in before this (path-vars.js). Any other segment, an unknown
// `<sprint>` included, is read as an ordinary folder name (docs/adr/0004) and refused for a write
// (checkWritable), since Windows cannot make it. A path without a placeholder is one folder and none of
// this applies.
//
// A folder is matched to its iteration or its target by the id at the front of its name, so a renamed
// group or card keeps its folder, and an existing folder whose id matches is used before a new name is
// built. A read covers every folder the path can name: under each placeholder, each folder that starts
// with an id (a past iteration's, a card's, or any other such name, such as `2026.q4`), and the segment
// dropped. A note about nothing has no card, so its `<card>` is dropped, as `<iteration>` is when no
// iteration applies. A write's folder is picked by the folderOf* functions; whether a day file or a page
// already exists is the stores' to decide first. Request text never builds a path: a folder is taken
// from its parent's own listing or built from a card's or group's file name.
//
// A folder is { label, abs, segs, parts }: label the names filled in for the placeholders ('/'-joined,
// '' when none), abs the absolute folder, segs the path's segments with the placeholders filled in, and
// parts the name filled in for each placeholder (`iteration`, `card`) that was.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const gs = require('./group-store');
const cs = require('./card-store');
const { StatusError } = require('./store-common');
const ids = require('../web/ids');
const { groupRunning } = require('../web/groups');
const { iterationGroups } = require('../web/iterations');

const PLACEHOLDER = '<iteration>';
const CARD = '<card>';
const KIND = Object.assign(Object.create(null), { [PLACEHOLDER]: 'iteration', [CARD]: 'card' });

const segmentsOf = (value) => String(value).split(/[\\/]/);

const hasPlaceholder = (value) => segmentsOf(value).some((s) => s in KIND);

const hasIteration = (value) => segmentsOf(value).includes(PLACEHOLDER);

// The absolute folder the segments name, relative ones against the board.
function absOf(dir, segs) {
  const text = segs.join('/');
  return path.resolve(dir, /^[A-Za-z]:$/.test(text) ? `${text}/` : text || '.');
}

// The id at the front of a folder's name (`0005.sprint-496` -> `5`), or null.
function idOfFolder(name) {
  return ids.idKey(name.split('.')[0]);
}

// The folder name a file name gives: the name itself. A file whose name does not start with its id
// (the file name is only a label) gets the id put in front, so the folder can be matched to it again.
function folderNameOf(base, id, digits) {
  return idOfFolder(base) === id ? base : `${ids.formatId(id, digits)}.${base}`;
}

// The board's iterations: { id, name, start, cards, group } where name is the folder name its group
// file gives.
function iterations(dir) {
  const read = gs.readGroups(dir);
  if (!read) return [];
  const digits = cfg.readConfig(dir).idDigits;
  return iterationGroups(read.list)
    .map((g) => ({ id: g.id, name: folderNameOf(path.posix.basename(g.file).replace(/\.md$/, ''), g.id, digits), start: g.start_date, cards: g.cards, group: g }));
}

// The folder name of a card or group target: its file name without the extension, else its padded id
// when the board has no such file.
function targetFolderName(dir, target) {
  const digits = cfg.readConfig(dir).idDigits;
  const file = cs.findCardFile(dir, target);
  if (file) return folderNameOf(path.basename(file).replace(/\.card\.md$/, ''), target, digits);
  const read = gs.readGroups(dir);
  const group = read && read.list.find((g) => g.id === target);
  return group ? folderNameOf(path.posix.basename(group.file).replace(/\.md$/, ''), target, digits) : ids.formatId(target, digits);
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

function folderNames(parentAbs) {
  let entries;
  try { entries = fs.readdirSync(parentAbs, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Every folder the path can name: label is the names filled in ('' for the folder with every segment
// dropped and for a path without a placeholder). Under a placeholder the named folders come first, the
// dropped one last.
function readFolders(dir, value) {
  if (!hasPlaceholder(value)) return [{ label: '', abs: path.resolve(dir, value), segs: [], parts: {} }];
  const all = segmentsOf(value);
  const out = [];
  const walk = (i, segs, names, parts) => {
    if (i === all.length) { out.push({ label: names.join('/'), abs: absOf(dir, segs), segs, parts }); return; }
    const kind = KIND[all[i]];
    if (kind === undefined) { walk(i + 1, [...segs, all[i]], names, parts); return; }
    for (const name of folderNames(absOf(dir, segs)).filter((n) => idOfFolder(n) !== null)) {
      walk(i + 1, [...segs, name], [...names, name], { ...parts, [kind]: name });
    }
    walk(i + 1, segs, names, parts);
  };
  walk(0, [], [], {});
  return out;
}

// The name of a folder under `parentAbs` for an id: one that exists and starts with the id (the one
// named as `wanted` if there are several), else `wanted`.
function nameUnder(parentAbs, id, wanted) {
  const match = folderNames(parentAbs).filter((name) => idOfFolder(name) === id);
  return match.includes(wanted) ? wanted : match[0] || wanted;
}

// The folder a write goes to. `choice.iteration` is asked for only when the path holds `<iteration>`
// and answers an iteration ({ id, name }), a folder name to keep, or null (the segment dropped);
// `choice.card` is the target id, '' for a note about nothing (the segment dropped).
function build(dir, value, choice) {
  const segs = [];
  const names = [];
  const parts = {};
  let iteration;
  let cardName;
  for (const seg of segmentsOf(value)) {
    const kind = KIND[seg];
    if (kind === undefined) { segs.push(seg); continue; }
    const here = absOf(dir, segs);
    let name = null;
    if (kind === 'iteration') {
      if (iteration === undefined) iteration = choice.iteration();
      if (typeof iteration === 'string') name = iteration;
      else if (iteration !== null) name = nameUnder(here, iteration.id, iteration.name);
    } else if (choice.card !== '') {
      if (cardName === undefined) cardName = targetFolderName(dir, choice.card);
      name = nameUnder(here, choice.card, cardName);
    }
    if (name !== null) { segs.push(name); names.push(name); parts[kind] = name; }
  }
  return { label: names.join('/'), abs: absOf(dir, segs), segs, parts };
}

// The folder of a write for a path without a placeholder.
const plain = (dir, value) => ({ label: '', abs: path.resolve(dir, value), segs: [], parts: {} });

function folderWhere(dir, value, card, pick) {
  return hasPlaceholder(value) ? build(dir, value, { iteration: pick, card }) : plain(dir, value);
}

// The folder of a note for a target on a day: the iteration it is aimed at, else the one holding the day.
function folderOfNote(dir, value, target, day) {
  return folderWhere(dir, value, target, () => {
    const list = iterations(dir);
    return list.find((i) => i.id === target) || firstStartedHolding(list, day);
  });
}

// The folder of a scratchpad for a target first written on `today`: the iteration its card or group is
// a member of (the first to start of several), the iteration itself for its own page, else the one
// holding `today`.
function folderOfPad(dir, value, target, today) {
  return folderWhere(dir, value, target, () => {
    const list = iterations(dir);
    return list.find((i) => i.id === target) || startedFirst(list.filter((i) => i.cards.includes(target))) || firstStartedHolding(list, today);
  });
}

// The folder of the iteration the day falls in, else the segment dropped; no card.
function folderOfDay(dir, value, day) {
  return folderWhere(dir, value, '', () => firstStartedHolding(iterations(dir), day));
}

// The folder of the target when the target is itself an iteration, else null (also for a path that
// holds no `<iteration>`).
function folderOfIterationTarget(dir, value, target) {
  if (!hasIteration(value)) return null;
  const found = iterations(dir).find((i) => i.id === target);
  return found ? build(dir, value, { iteration: () => found, card: target }) : null;
}

// The folder a note assigned to `target` goes to when it stays in the iteration folder it is in
// (`here`, a folder as readFolders gives it): its `<card>` becomes the new target's. For a path with no
// placeholder that is `here` itself.
function folderOfAssigned(dir, value, here, target) {
  if (!hasPlaceholder(value)) return here;
  return build(dir, value, { iteration: () => (here.parts.iteration === undefined ? null : here.parts.iteration), card: target });
}

// The configured path with the placeholders filled in by a folder's names ('' drops one), as written
// and not resolved, for a page to show; null for a path that holds no placeholder.
function filledIn(value, folder) {
  return hasPlaceholder(value) ? folder.segs.join('/') : null;
}

// A write refuses a folder name that holds < or >, which Windows does not allow: the placeholders are
// `<iteration>` and `<card>`. A read of such a path stays tolerant.
function checkWritable(value) {
  const odd = segmentsOf(value).some((segment) => !(segment in KIND) && /[<>]/.test(segment));
  if (odd) throw new StatusError('A folder name here holds < or >, which Windows does not allow, and only <iteration> and <card> are placeholders.', 400);
}

module.exports = { PLACEHOLDER, CARD, hasPlaceholder, readFolders, folderOfNote, folderOfPad, folderOfDay, folderOfIterationTarget, folderOfAssigned, filledIn, checkWritable };

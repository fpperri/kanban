'use strict';
// apply-tray <board-dir> <tray-file | -> [--json]
//
// Applies a tray to a board. The tray is a list of records, each one save the page recorded:
//   { id, at, device, change: { method, path, body }, temp?, before?, refused? }
// `temp` is the temporary id (n1) the page gave the card or group the save made; later saves may name it.
// given as a file (or `-` for stdin) holding a JSON array, one record per line, or a change payload
// (a header line, then the records as JSON). Steps:
//   1. a record whose id is in the board's hidden `.applied-ids` file is skipped, so a retry or a
//      double paste changes nothing;
//   2. every other record is dry-run through route() over an in-memory copy of the board, in tray
//      order; one the board's rules refuse is set aside with the reason the desk gives. A save that made a
//      card or group with a temporary id maps it to the real id the board allocated, and each later save
//      is run with the real id where it named the temporary one; one that names a temporary id nothing
//      before it made is set aside;
//   3. the passing records are replayed through route() over the real board, in tray order, mapped the
//      same way, and each id is appended to `.applied-ids` as it lands;
//   4. a report says what was applied, what was refused and why, what was skipped, and which real id each
//      temporary id became.
// Nothing is written to the board unless the dry run finished. Exit 0 whatever was refused; 2 when the
// tray cannot be read or the dry run cannot be made.
const fs = require('fs');
const path = require('path');
const { makeRoute } = require('./route');
const { makeMemoryRoute } = require('./memory-route');
const { readConfig } = require('./config-store');
const { findRepo } = require('./path-vars');
const oldPayload = require('./old-payload');
const tempIds = require('./temp-ids');

const APPLIED_FILE = '.applied-ids';
const WEB = path.join(__dirname, '..');
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The source text of route.js and every file it requires on the way, as the module loader takes it
// ('scripts/route.js', 'web/ids.js').
function routeSources(entry = 'scripts/route.js') {
  const sources = {};
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop();
    if (Object.prototype.hasOwnProperty.call(sources, file)) continue;
    const text = fs.readFileSync(path.join(WEB, file), 'utf8');
    sources[file] = text;
    for (const m of text.matchAll(/require\('(\.[^']*)'\)/g)) {
      const base = path.posix.join(path.posix.dirname(file), m[1]);
      pending.push(base.endsWith('.js') ? base : `${base}.js`);
    }
  }
  return sources;
}

// Tray records from text: a JSON array, one JSON record per line, or a payload whose first line is a
// header. A fence around the records is dropped. An item that is an op of the old Snapshot page's
// payload (`{op: 'move', ...}`) becomes the record that op means (old-payload.js).
function parseTray(text) {
  const base = oldPayload.baseOf(text);
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => !/^\s*```/.test(l));
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (lines.length && !/^\s*[[{]/.test(lines[0])) lines.shift();
  const body = lines.join('\n').trim();
  if (body === '') return [];
  try {
    const whole = JSON.parse(body);
    return oldPayload.fromOps(Array.isArray(whole) ? whole : [whole], { base });
  } catch (_) {
    const items = lines.filter((l) => l.trim() !== '').map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`the tray is not JSON at line ${i + 1}: ${e.message}`);
      }
    });
    return oldPayload.fromOps(items, { base });
  }
}

// Why a record cannot be tried at all, or null.
function malformed(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not a tray record';
  if (typeof r.notRead === 'string') return r.notRead;
  if (typeof r.id !== 'string' || r.id === '') return 'the record has no id';
  const c = r.change;
  if (!c || typeof c !== 'object') return 'the record has no change';
  if (typeof c.method !== 'string' || !WRITES.has(c.method.toUpperCase())) return `only saves are applied, not ${c.method}`;
  if (typeof c.path !== 'string' || !c.path.startsWith('/api/')) return 'the change names no /api route';
  return null;
}

const forward = (p) => String(p).replace(/\\/g, '/');
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

// The memory file system is POSIX: a Windows drive letter becomes the first folder.
function toVirtual(p) {
  const f = forward(path.resolve(p));
  return /^[A-Za-z]:/.test(f) ? `/${f[0]}${f.slice(2)}` : f;
}

// The folders a save may touch: the board folder and, when a path in config.yaml leads outside it,
// that folder (the part before the first <iteration> or <card>).
function boardRoots(dir) {
  const config = readConfig(dir);
  const roots = [path.resolve(dir)];
  const extra = [];
  for (const key of ['logbook', 'scratchpad', 'todos']) {
    const filled = config.paths[key];
    if (!filled) continue;
    const parts = forward(filled).split('/');
    const cut = parts.findIndex((s) => s === '<iteration>' || s === '<card>');
    extra.push(path.resolve(dir, (cut < 0 ? parts : parts.slice(0, cut)).join('/') || '.'));
  }
  if (config.groups) extra.push(path.resolve(dir, config.groups));
  for (const e of extra) {
    if (!roots.some((r) => inside(e, r)) && fs.existsSync(e)) roots.push(e);
  }
  return roots;
}

function copyInto(files, folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) copyInto(files, full);
    else if (entry.isFile()) files[toVirtual(full)] = fs.readFileSync(full);
  }
}

// route() over a copy of the board held in memory.
function memoryCopy(dir) {
  const files = {};
  for (const root of boardRoots(dir)) copyInto(files, root);
  const repo = findRepo(dir);
  if (repo) files[`${toVirtual(repo)}/.git/HEAD`] = '';
  return makeMemoryRoute(routeSources(), { files, dir: toVirtual(dir) }).route;
}

const readApplied = (dir) => {
  const file = path.join(dir, APPLIED_FILE);
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
};

const reasonOf = (res) => (res.body && res.body.error) || `refused with status ${res.status}`;

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const listOf = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The real ids of the cards and groups made so far, by the device that made them: { device: { n1: '30' } }.
// Two devices that each made a card before seeing the other's record both took n1; a save names the one
// its own device made, else the one the only other device made, and is refused when it cannot tell. Which
// device's card it means is read from every create of the id in the tray before it (`makers`, a
// tempIds.makersOf), not from the creates that passed, so a device whose create did not pass never has its
// later saves land on the card another device made under the same id.

const CARD_EDIT = /^\/api\/cards\/([^/?]+)$/;
const valueOf = (card, key) => (card[key] === undefined ? null : card[key]);
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const poisonKey = (p, field) => `${String(p).split('?')[0].replace(/^(\/api\/cards\/)0+(?=\d)/, '$1')}\u0000${field}`;

// The fields a card edit named a before value for, with the card path they sit on, or null for any other record.
function editedFields(record) {
  const c = record.change;
  if (!record.before || typeof record.before !== 'object' || String(c.method).toUpperCase() !== 'PATCH' || !CARD_EDIT.test(String(c.path).split('?')[0])) return null;
  return Object.keys(record.before);
}

// Why a card edit cannot be tried on top of the board as it now stands, or null: it changes a field after
// an edit of that field that was refused and made on top of it (`poisoned`; its before value is what the
// refused edit set, so an edit redone on a refreshed page is not), or a field of a card that
// the board holds no longer has the value the page had for it. `path` is the edit's path with the real ids
// in it, `known` the temporary ids made so far. A card made in this tray has no desk to collide with.
function staleness(route, record, path, known, poisoned) {
  const fields = editedFields(record);
  if (!fields) return null;
  for (const field of fields) {
    const on = (poisoned.get(poisonKey(path, field)) || []).find((p) => same(p.value, record.before[field]));
    if (on) return `it depends on ${on.by}, which was refused`;
  }
  if (tempIds.namesIn({ method: 'PATCH', path: record.change.path, body: {} }).length) return null;
  const { change: held, missing } = tempIds.rewrite({ method: 'PATCH', path: '/', body: record.before }, known);
  if (missing.length) return null;
  const read = route('GET', '/api/board', {});
  if (!read || read.status !== 200) return null;
  const key = CARD_EDIT.exec(path.split('?')[0])[1].replace(/^0+(?=\d)/, '');
  const card = read.body.active.concat(read.body.archived).find((c) => String(c.id) === key);
  if (!card) return null;
  const changed = fields.filter((f) => JSON.stringify(valueOf(card, f)) !== JSON.stringify(held.body[f] === undefined ? null : held.body[f]));
  return changed.length ? `${listOf(changed)} changed at the desk since` : null;
}

// Run one record through `route`, with the real ids of `made` put where it names a temporary id, and note
// the id it made. { res } when it ran, { refusal } when it did not or the board refused it. `guard`, when
// given ({ poisoned }), holds a card edit to the value the page had for each field it changed.
function run(route, record, made, makers, guard = null) {
  const device = String(record.device === undefined ? '' : record.device);
  const known = {};
  const missing = [];
  for (const temp of tempIds.namesIn(record.change)) {
    const who = tempIds.whoMade(makers, record, temp);
    const all = (makers.get(temp) || []).map(String);
    if (who === null && all.length > 1) return { refusal: `it names ${temp}, which ${listOf(all.sort())} each made, so it does not say which card it means` };
    if (who === null) { missing.push(temp); continue; }
    const owner = String(who);
    if (!(made[owner] && has(made[owner], temp))) return { refusal: `it names ${temp}, which ${owner} made in a save not applied in this run` };
    known[temp] = made[owner][temp];
  }
  if (missing.length) return { refusal: `it names ${missing.join(', ')}, which no save applied before it made` };
  if (record.temp && made[device] && has(made[device], record.temp)) return { refusal: `it makes ${record.temp} again, which an earlier save from the same device made` };
  const { change } = tempIds.rewrite(record.change, known);
  if (guard) {
    const why = staleness(route, record, change.path, known, guard.poisoned);
    if (why !== null) return { refusal: why, path: change.path };
  }
  const method = change.method.toUpperCase();
  const res = route(method, change.path, change.body || {});
  if (res.status >= 400) return { refusal: reasonOf(res), path: change.path };
  const id = record.temp ? tempIds.createdId(method, change.path, res.body) : null;
  if (id !== null) made[device] = { ...made[device], [record.temp]: id };
  return { res };
}

// The report's map of temporary ids to real ones: { n1: '30' }, and, for an id two devices took,
// { 'n1 (desk)': '30', 'n1 (phone)': '31' }.
function tempReport(made) {
  const out = {};
  for (const [device, map] of Object.entries(made)) {
    for (const [temp, id] of Object.entries(map)) {
      const shared = Object.values(made).filter((m) => has(m, temp)).length > 1;
      out[shared ? `${temp} (${device})` : temp] = id;
    }
  }
  return out;
}

function applyTray({ dir, records }) {
  const applied = readApplied(dir);
  const report = { applied: [], refused: [], skipped: [], temp: {} };
  const made = {};
  const todo = [];
  const seen = new Set();
  for (const r of records) {
    const bad = malformed(r);
    if (bad) {
      report.refused.push({ id: r && typeof r.id === 'string' ? r.id : null, reason: bad });
    } else if (applied.has(r.id) || seen.has(r.id)) {
      report.skipped.push(r.id);
    } else {
      seen.add(r.id);
      todo.push(r);
    }
  }

  // Who made each temporary id, among the records before each one, whatever became of their saves.
  const makersBefore = new Map();
  const seenBefore = [];
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    makersBefore.set(r, tempIds.makersOf(seenBefore));
    seenBefore.push(r);
  }

  const rehearsal = memoryCopy(dir);
  const rehearsed = {};
  const passing = [];
  const poisoned = new Map(); // a card path and a field an edit that was refused changed, to the edits' ids and the value each set
  for (const r of todo) {
    const { refusal, path: at } = run(rehearsal, r, rehearsed, makersBefore.get(r), { poisoned });
    if (refusal === undefined) {
      passing.push(r);
      continue;
    }
    report.refused.push({ id: r.id, reason: refusal });
    for (const field of editedFields(r) || []) {
      const key = poisonKey(at === undefined ? r.change.path : at, field);
      poisoned.set(key, (poisoned.get(key) || []).concat({ by: r.id, value: (r.change.body || {})[field] }));
    }
  }

  const real = makeRoute(dir);
  for (const r of passing) {
    const { refusal } = run(real, r, made, makersBefore.get(r));
    if (refusal !== undefined) {
      report.refused.push({ id: r.id, reason: refusal });
      continue;
    }
    fs.appendFileSync(path.join(dir, APPLIED_FILE), `${r.id}\n`);
    report.applied.push({ id: r.id, method: r.change.method.toUpperCase(), path: r.change.path });
  }
  report.temp = tempReport(made);
  return report;
}

function formatReport(report) {
  const out = [`applied ${report.applied.length}, refused ${report.refused.length}, already applied ${report.skipped.length}`];
  for (const a of report.applied) out.push(`  applied ${a.id}: ${a.method} ${a.path}`);
  for (const r of report.refused) out.push(`  refused ${r.id === null ? '(no id)' : r.id}: ${r.reason}`);
  for (const id of report.skipped) out.push(`  already applied ${id}`);
  for (const [temp, real] of Object.entries(report.temp)) out.push(`  ${temp} is now #${real}`);
  return out.join('\n');
}

function main(argv) {
  const args = argv.filter((a) => a !== '--json');
  if (args.length !== 2) {
    console.error('usage: apply-tray <board-dir> <tray-file | -> [--json]');
    return 2;
  }
  const [dir, trayFile] = args;
  if (!fs.existsSync(dir)) {
    console.error(`no board folder at ${dir}`);
    return 2;
  }
  let report;
  try {
    const text = trayFile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(trayFile, 'utf8');
    report = applyTray({ dir, records: parseTray(text) });
  } catch (err) {
    console.error(`apply-tray: ${err.message}`);
    return 2;
  }
  console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { applyTray, parseTray, formatReport, APPLIED_FILE };

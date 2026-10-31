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

// Run one record through `route`, with the real ids of `made` (temporary to real) put where it names a
// temporary id, and note the id it made. { res } when it ran, { refusal } when it did not or the board
// refused it.
function run(route, record, made) {
  const { change, missing } = tempIds.rewrite(record.change, made);
  if (missing.length) return { refusal: `it names ${missing.join(', ')}, which no save applied before it made` };
  const method = change.method.toUpperCase();
  const res = route(method, change.path, change.body || {});
  if (res.status >= 400) return { refusal: reasonOf(res) };
  const id = record.temp ? tempIds.createdId(method, change.path, res.body) : null;
  if (id !== null) made[record.temp] = id;
  return { res };
}

function applyTray({ dir, records }) {
  const applied = readApplied(dir);
  const report = { applied: [], refused: [], skipped: [], temp: {} };
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

  const rehearsal = memoryCopy(dir);
  const rehearsed = {};
  const passing = [];
  for (const r of todo) {
    const { refusal } = run(rehearsal, r, rehearsed);
    if (refusal !== undefined) report.refused.push({ id: r.id, reason: refusal });
    else passing.push(r);
  }

  const real = makeRoute(dir);
  for (const r of passing) {
    const { refusal } = run(real, r, report.temp);
    if (refusal !== undefined) {
      report.refused.push({ id: r.id, reason: refusal });
      continue;
    }
    fs.appendFileSync(path.join(dir, APPLIED_FILE), `${r.id}\n`);
    report.applied.push({ id: r.id, method: r.change.method.toUpperCase(), path: r.change.path });
  }
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

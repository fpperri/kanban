'use strict';
// config.yaml: board-level configuration — currently four concerns:
//
//   name: webapp          # BOARD NAME — the token that opens a card mention
//                         # (`webapp#28 Card title`) and titles every surface.
//                         # Human-declared, never derived here; absent, the
//                         # caller falls back to card-store's projectName().
//                         # Must precede `assignees:` — those entries carry
//                         # their own INDENTED `name:`, and only a top-level
//                         # (unindented) key is the board name.
//   port: 7781            # PINS the web app's serving port (server.js's CLI
//                         # entry reads this once at startup). Same
//                         # top-level-only rule as `name:` — an INDENTED
//                         # `port:` inside an assignee entry is not it.
//                         # Precedence: CLI arg > this key > default 7777
//                         # with auto-increment. A busy PINNED port is a
//                         # startup error, never a silent increment. Must be
//                         # a whole number in 1-65535; anything else parses
//                         # to `port: null` plus `portInvalid: <raw text>`,
//                         # so the one consumer can WARN instead of drifting.
//   nextId: 28            # monotonic id counter — ids stay unique even when
//                         # the max card is deleted or two writers race a scan
//   assignees:            # who can own cards; feeds the form's combobox
//     - handle: "@alex"
//       name: "Alex"
//       kind: human       # suggested: human | ai-hitl | ai-afk (free string)
//       description: "…"
//       color: "#a371f7"  # OPTIONAL reserved color; absent = hashed
//
// Same tolerant hand-rolled parsing discipline as notifications-store: skip
// what doesn't parse, never fatal. The registry suggests, it never validates.
// notifications.md stays separate on purpose — high-churn agent appends vs.
// stable human-edited config.
const fs = require('fs');
const path = require('path');
const { unquote, quote, scalar } = require('./yaml-list');

const FILE = 'config.yaml';

// Inline flow list (`[High, Normal, Low]   # comment`) → array of scalars.
// Tolerant like everything else here: no closing bracket = take what's there,
// blank entries are skipped, quotes/comments handled per scalar().
function parseFlowList(raw) {
  const s = String(raw).trim();
  if (s[0] !== '[') return [];
  const close = s.indexOf(']');
  const inner = close === -1 ? s.slice(1) : s.slice(1, close);
  return inner.split(',').map((item) => scalar(item)).filter((v) => v !== '');
}

// priorities/tags — suggest, never validate. statuses — the official COLUMN
// list (ordered = column order; absent = built-in four).
// It drives the board's layout but still never validates a card's on-disk
// value: an unlisted status renders in the first column until promoted.
const LIST_KEYS = ['priorities', 'tags', 'statuses'];

function parseConfig(text) {
  const config = { name: '', nextId: null, port: null, portInvalid: null, assignees: [], priorities: [], tags: [], statuses: [] };
  let section = null; // 'assignees' | one of LIST_KEYS | null
  let cur = null;
  const flush = () => {
    if (cur) {
      const handle = scalar(cur.handle !== undefined ? cur.handle : '');
      if (handle !== '') {
        config.assignees.push({
          handle,
          name: scalar(cur.name !== undefined ? cur.name : ''),
          kind: scalar(cur.kind !== undefined ? cur.kind : ''),
          description: scalar(cur.description !== undefined ? cur.description : ''),
          // OPTIONAL reserved color, same suggest-never-validate
          // contract as every other field here — an empty string means
          // "no reservation", not an invalid one; the color picks a hashed
          // fallback in that case (assignee-colors.js), never this store's job.
          color: scalar(cur.color !== undefined ? cur.color : ''),
        });
      }
      cur = null;
    }
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const top = line.match(/^(\w+):\s*(.*)$/); // no leading whitespace = top-level key
    if (top) {
      flush();
      if (top[1] === 'name') {
        // Board name. Only reachable for an UNINDENTED `name:` — an
        // assignee's own `name:` is indented and handled by the section
        // branch below, so the two never collide whatever the file's order.
        config.name = scalar(top[2]);
        section = null;
      } else if (top[1] === 'nextId') {
        const n = Number(scalar(top[2]));
        config.nextId = Number.isInteger(n) && n > 0 ? n : null;
        section = null;
      } else if (top[1] === 'port') {
        // Pinned serving port (web skill, kanban.proj #254). Same
        // top-level-only rule as `name:` — an assignee's own indented
        // fields never reach this branch. Tolerant like every other key
        // here: a value that isn't a bindable port is ignored, not fatal.
        // The 65535 bound is load-bearing, not cosmetic: `srv.listen()`
        // throws ERR_SOCKET_BAD_PORT for anything outside 1-65535, so an
        // out-of-range pin would crash the server with a raw stack instead
        // of the clear message this key promises.
        // `portInvalid` carries the offending raw text (null = nothing
        // wrong) so the one consumer — server.js's resolvePort — can tell
        // "no pin at all" from "a pin I could not use" and warn about the
        // second instead of silently falling back to 7777, which is the
        // exact bookmark drift this key exists to prevent.
        const raw = scalar(top[2]);
        const n = Number(raw);
        const ok = Number.isInteger(n) && n >= 1 && n <= 65535;
        config.port = ok ? n : null;
        config.portInvalid = ok ? null : raw;
        section = null;
      } else if (top[1] === 'assignees') {
        section = 'assignees';
      } else if (LIST_KEYS.includes(top[1])) {
        if (top[2].trim() !== '') {
          config[top[1]] = parseFlowList(top[2]); // inline flow form
          section = null;
        } else {
          section = top[1]; // block form — items on the following lines
        }
      } else {
        section = null; // unknown top-level key — ignored, ends any section
      }
      continue;
    }
    if (LIST_KEYS.includes(section)) {
      const item = line.match(/^\s+-\s*(.*)$/);
      if (item) {
        const v = scalar(item[1]);
        if (v !== '') config[section].push(v);
      }
      continue;
    }
    if (section === 'assignees') {
      const start = line.match(/^\s+-\s+(\w+):\s*(.*)$/);
      const field = line.match(/^\s+(\w+):\s*(.*)$/);
      if (start) { flush(); cur = {}; cur[start[1]] = start[2]; }
      else if (field && cur) { cur[field[1]] = field[2]; }
    }
  }
  flush();
  return config;
}

// Note: no callers today (writeConfig is the only one, itself unused) — the
// board's writes go through advanceCounter's surgical replace, which preserves
// comments and unknown keys. Kept round-trippable with parseConfig all the
// same; `name` leads because it must sit above `assignees:` (see the header).
function serializeConfig(config) {
  let out = '';
  if (config.name) out += `name: ${config.name}\n`;
  if (config.port !== null && config.port !== undefined) out += `port: ${config.port}\n`;
  if (config.nextId !== null && config.nextId !== undefined) out += `nextId: ${config.nextId}\n`;
  if (config.assignees && config.assignees.length) {
    out += 'assignees:\n';
    for (const a of config.assignees) {
      out += `  - handle: ${quote(a.handle)}\n    name: ${quote(a.name)}\n    kind: ${quote(a.kind)}\n    description: ${quote(a.description)}\n    color: ${quote(a.color || '')}\n`;
    }
  }
  return out;
}

function configFile(dir) {
  return path.join(dir, FILE);
}

function readConfig(dir) {
  const file = configFile(dir);
  if (!fs.existsSync(file)) return { name: '', nextId: null, port: null, portInvalid: null, assignees: [], priorities: [], tags: [], statuses: [] };
  return parseConfig(fs.readFileSync(file, 'utf8'));
}

function writeConfig(dir, config) {
  // tmp+rename per ADR 0002's write discipline, same as the other stores.
  const file = configFile(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeConfig(config));
  fs.renameSync(tmp, file);
  return config;
}

function readAssignees(dir) {
  return readConfig(dir).assignees;
}

// Surgical counter advance: config.yaml is human-edited, so the write must
// preserve comments and unknown keys byte-for-byte — only the nextId line is
// replaced (or inserted at the top when absent). Same content-preservation
// discipline as card-store's unmanaged-frontmatter rule; tmp+rename as ever.
function advanceCounter(dir, newNext) {
  const file = configFile(dir);
  const raw = fs.readFileSync(file, 'utf8');
  const out = /^nextId:.*$/m.test(raw)
    ? raw.replace(/^nextId:.*$/m, `nextId: ${newNext}`)
    : `nextId: ${newNext}\n${raw}`;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
}

// Allocate the next card id. `fromScan` is the caller's scan-based candidate
// (max existing id + 1). The counter is opt-in: without a config.yaml the
// board keeps its scan-only behavior and no file is conjured up. With one, the
// id is max(counter, fromScan) — a stale/lagging counter self-heals instead
// of ever re-issuing a taken id — and the advanced counter is persisted.
function allocateId(dir, fromScan) {
  if (!fs.existsSync(configFile(dir))) return fromScan;
  const id = Math.max(readConfig(dir).nextId || 0, fromScan);
  advanceCounter(dir, id + 1);
  return id;
}

module.exports = { parseConfig, serializeConfig, readConfig, writeConfig, readAssignees, allocateId };

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
//   types:                # card types: a suggested vocabulary, never validated
//     - name: objective   # a card's `type:` may be any text; this list gives
//       color: "#a371f7"  # known names an OPTIONAL chip colour (absent = neutral)
//     - story             # bare entry = name only; `types: [a, b]` also works
//       icon: star        # OPTIONAL: lowercased, kept as written when unknown
//   hierarchy: [goal, epic]  # the types that are the levels of the plan, top first;
//                         # orders drawing and slicing, enforces nothing
//   pills:                # the board's own one-click search queries, block form only
//     - next: 'tags:"next-up"'  # a label and its query, or a query alone (its own label)
//
// Every one of the three is human text: read tolerantly, blank and malformed
// entries skipped, never fatal. A type's `icon` is answered only when set.
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

// A list key whose value is blank or only a comment (`types:   # note`) starts
// a block list; the snapshot's readers open it the same way.
function opensBlock(tail) {
  const t = String(tail).trim();
  return t === '' || t[0] === '#';
}

// The six outline glyphs a type's `icon:` may name. The reader keeps any name it
// is given (the page draws an unknown one as no icon), so this list is for the
// consumers that draw and for the tests that pin the contract.
const ICON_NAMES = Object.freeze(['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']);

// A type's `icon:` text → its name: lowercased, a trailing comment stripped,
// and '' (no icon) for a blank value or one that is only a comment.
function iconName(raw) {
  const t = raw === undefined ? '' : String(raw).trim();
  return t[0] === '#' ? '' : scalar(t).toLowerCase();
}

// One `pills:` entry (the text after its dash) → { label, query }, or null when
// the entry is blank, only a comment, or has an empty label or an empty query.
// An entry is a query on its own (quoted or bare; the label is then the query
// text) or a one-key map from a label to a query. As in YAML a map key ends at
// the first colon followed by a space or the end of the entry, so `next: x` is
// the label next with the query x, `tags: grill` is the label tags with the
// query grill, while `tags:*` and `assignee:@human` have no such colon and stay
// whole queries; a query that must end in a colon is quoted (`"blocked:"`).
// Anything after the first pair on its own line is another key, which the
// caller ignores.
function splitPillEntry(text) {
  const t = String(text).trim();
  if (t === '' || t[0] === '#') return null;
  let label = null;
  let value = t;
  const close = (t[0] === '"' || t[0] === "'") ? closingQuote(t) : -1;
  if (close !== -1) {
    const after = t.slice(close + 1);
    const sep = /^\s*:(?:\s|$)/.exec(after);
    if (sep) { label = unquote(t.slice(0, close + 1)); value = after.slice(sep[0].length); }
  } else {
    const colon = t.search(/:(?:\s|$)/);
    const comment = t.search(/\s#/);
    if (colon !== -1 && (comment === -1 || colon < comment)) { label = t.slice(0, colon).trim(); value = t.slice(colon + 1); }
  }
  const query = value.trim()[0] === '#' ? '' : scalar(value);
  if (query === '') return null;
  if (label === null) label = query;
  return label === '' ? null : { label, query };
}

// Index of the quote that closes the quoted text opening `s`, or -1.
function closingQuote(s) {
  for (let i = 1; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === s[0]) return i;
  }
  return -1;
}

// priorities/tags — suggest, never validate. statuses — the official COLUMN
// list (ordered = column order; absent = built-in four).
// It drives the board's layout but still never validates a card's on-disk
// value: an unlisted status renders in the first column until promoted.
const LIST_KEYS = ['priorities', 'tags', 'statuses', 'hierarchy'];

function parseConfig(text) {
  const config = { name: '', nextId: null, port: null, portInvalid: null, assignees: [], priorities: [], tags: [], statuses: [], hierarchy: [], types: [], pills: [] };
  let section = null; // 'assignees' | 'types' | one of LIST_KEYS | null
  let cur = null;
  let curType = null;
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
    if (curType) {
      const name = scalar(curType.name !== undefined ? curType.name : '');
      if (name !== '') {
        const entry = { name, color: scalar(curType.color !== undefined ? curType.color : '') };
        const icon = iconName(curType.icon);
        if (icon !== '') entry.icon = icon;
        config.types.push(entry);
      }
      curType = null;
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
      } else if (top[1] === 'types') {
        if (!opensBlock(top[2])) {
          config.types = parseFlowList(top[2]).map((name) => ({ name, color: '' }));
          section = null;
        } else {
          section = 'types';
        }
      } else if (top[1] === 'pills') {
        section = opensBlock(top[2]) ? 'pills' : null; // block form only; a scalar or inline value answers none
      } else if (LIST_KEYS.includes(top[1])) {
        if (!opensBlock(top[2])) {
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
    if (section === 'pills') {
      const item = line.match(/^\s+-\s*(.*)$/);
      const pill = item && splitPillEntry(item[1]);
      if (pill) config.pills.push(pill);
      continue;
    }
    if (LIST_KEYS.includes(section)) {
      const item = line.match(/^\s+-\s*(.*)$/);
      if (item) {
        // A hierarchy entry that is only a comment is blank, as in YAML.
        const v = section === 'hierarchy' && item[1].trim()[0] === '#' ? '' : scalar(item[1]);
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
    if (section === 'types') {
      const start = line.match(/^\s+-\s+(\w+):\s*(.*)$/);
      const bare = line.match(/^\s+-\s*(.*)$/);
      const field = line.match(/^\s+(\w+):\s*(.*)$/);
      if (start) { flush(); curType = {}; curType[start[1]] = start[2]; }
      else if (bare) {
        flush();
        const name = scalar(bare[1]);
        if (name !== '') config.types.push({ name, color: '' });
      } else if (field && curType) { curType[field[1]] = field[2]; }
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
  return parseConfig(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
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

module.exports = { parseConfig, serializeConfig, readConfig, writeConfig, readAssignees, allocateId, splitPillEntry, ICON_NAMES };

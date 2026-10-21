'use strict';
// config.yaml: board-level configuration — currently five concerns:
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
//   idDigits: 4           # the width an id's number is padded to in a file name
//                         # (default 4); readers parse the number, so changing it
//                         # orphans no file. A whole number from 1 to 15.
//   prefixes:             # a prefix for a card type, fixed when the card is made:
//     G: goal             #   a new goal is #G1, #G2 ... A value that names a groups
//     W: workflow/        #   folder is a folder, not a type: a path (with a `/`), or the
//     _: .groups          #   groups: folder itself (the root). Block form only.
//                         #   A prefix is declared once: a second declaration that names
//                         #   something else is skipped and listed in `prefixClashes`.
//   counters: { G: 3 }    # one line, one counter per prefix; the next id of a prefix
//                         # is max(its counter, its highest id + 1), like nextId
//   logbook: logbook      # the folder of the board's notes (docs/adr/0016), relative to
//                         # the board, or absolute when written by hand; absent = no
//                         # logbook and nothing of it shows
//   scratchpad: .scratchpad  # the folder of the cards' and groups' scratchpads
//                         # (docs/adr/0016), the same way; absent = no scratchpads
//   todos: .scratchpad    # the folder of the cards' and groups' todo lists (docs/adr/0021),
//                         # the same way; absent = no todo lists. It may name the scratchpad's
//                         # folder: the two kinds of file never share a name.
//                         # Each may hold `<iteration>` as a whole segment, the folder of
//                         # an iteration (docs/adr/0019, iteration-folders.js); read as text
//   groups: .groups       # the folder of the board's groups (docs/adr/0015), the same
//                         # way; absent = no groups and nothing of them shows
//   typesOn: false        # Types off: the web and the snapshot ignore `types:`, the
//                         # hierarchy and the chips, colors, icons and tiers they give;
//                         # absent = on. Display only; the lists and the cards stay as written.
//   iterations: true      # the header's iteration dropdown over the groups in the
//                         # iteration/ folder (docs/adr/0015); needs groups:, absent = off
//   assignees:           # who can own cards; feeds the form's combobox
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
const ids = require('../web/ids');

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

// Inline flow map (`{ G: 4, O: 6 }   # comment`) → array of [key, value] scalar pairs.
// As tolerant as the flow list: no closing brace = take what is there, an item
// without a colon is skipped.
function parseFlowMap(raw) {
  const s = String(raw).trim();
  if (s[0] !== '{') return [];
  const close = s.indexOf('}');
  const inner = close === -1 ? s.slice(1) : s.slice(1, close);
  return inner.split(',').map((item) => {
    const colon = item.indexOf(':');
    return colon === -1 ? null : [scalar(item.slice(0, colon)), scalar(item.slice(colon + 1))];
  }).filter((pair) => pair !== null);
}

// A prefix is what an id carries before its number, as the id module reads it; a
// board's prefix is never empty (a plain id has none). A counter is a whole number
// from 1 up that an id can hold.
function isPrefix(text) {
  return text !== '' && ids.parseId({ prefix: text, number: 1 }) !== null;
}

function counterValue(text) {
  const n = /^[0-9]+$/.test(text) ? Number(text) : 0;
  return n >= 1 && ids.parseId(n) !== null ? n : null;
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
// hierarchy — the types that are the levels of the plan, top first. A block entry that is
// only a comment (`- # note`) is skipped there, as YAML reads it; in the other lists a value
// that starts with # stays as written, as it always has, since a tag or a status label is free
// text and a hierarchy entry names a type.
const LIST_KEYS = ['priorities', 'tags', 'statuses', 'hierarchy'];

const DEFAULT_ID_DIGITS = 4;

function parseConfig(text) {
  const config = { name: '', nextId: null, idDigits: DEFAULT_ID_DIGITS, logbook: '', scratchpad: '', todos: '', groups: '', iterations: false, typesOn: true, prefixes: {}, prefixClashes: [], counters: {}, port: null, portInvalid: null, assignees: [], priorities: [], tags: [], statuses: [], hierarchy: [], types: [], pills: [] };
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
      } else if (top[1] === 'idDigits') {
        const n = Number(scalar(top[2]));
        config.idDigits = Number.isInteger(n) && n >= 1 && n <= 15 ? n : DEFAULT_ID_DIGITS;
        section = null;
      } else if (top[1] === 'logbook') {
        config.logbook = scalar(top[2]);
        section = null;
      } else if (top[1] === 'scratchpad') {
        config.scratchpad = top[2].trim()[0] === '#' ? '' : scalar(top[2]);
        section = null;
      } else if (top[1] === 'todos') {
        config.todos = top[2].trim()[0] === '#' ? '' : scalar(top[2]);
        section = null;
      } else if (top[1] === 'groups') {
        config.groups = top[2].trim()[0] === '#' ? '' : scalar(top[2]);
        section = null;
      } else if (top[1] === 'iterations') {
        config.iterations = scalar(top[2]) === 'true';
        section = null;
      } else if (top[1] === 'typesOn') {
        config.typesOn = scalar(top[2]) !== 'false';
        section = null;
      } else if (top[1] === 'counters') {
        for (const [prefix, text] of parseFlowMap(top[2])) {
          const n = counterValue(text);
          if (isPrefix(prefix) && n !== null && !(prefix in config.counters)) config.counters[prefix] = n;
        }
        section = null;
      } else if (top[1] === 'prefixes') {
        section = opensBlock(top[2]) ? 'prefixes' : null; // block form only; a scalar or inline value answers none
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
    if (section === 'prefixes') {
      const entry = line.match(/^\s+("[^"]*"|'[^']*'|[^\s:]+)\s*:(?:\s+(.*))?$/);
      const prefix = entry && scalar(entry[1]);
      const target = entry && entry[2] !== undefined && entry[2].trim()[0] !== '#' ? scalar(entry[2]) : '';
      if (prefix && isPrefix(prefix) && target !== '') {
        // A prefix is one declaration: for a card type or for a groups folder, never both. The first
        // stands and a later one that names something else is skipped and reported (`prefixClashes`),
        // so the id counter of a prefix is never read from two places.
        if (!(prefix in config.prefixes)) config.prefixes[prefix] = target;
        else if (config.prefixes[prefix] !== target) config.prefixClashes.push({ prefix, kept: config.prefixes[prefix], ignored: target });
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

// The surgical config write (ADR 0017): config.yaml is human-edited, so a write
// preserves comments and unknown keys byte-for-byte — only one top-level line is
// replaced, inserted or (value null) removed. `key` is a plain word, so an
// indented key of an assignee entry is never the line. A key that opens a block
// (nothing after its colon) takes the indented lines under it with it. An
// inserted line goes below the `after` key's line when that exists, else at the
// top, in the file's own line ending. Same content-preservation discipline as
// card-store's unmanaged-frontmatter rule; tmp+rename as ever.
function writeConfigLine(dir, key, value, after = null) {
  if (!/^\w+$/.test(key)) throw new Error(`config key must be a plain word: ${key}`);
  if (value !== null && /[\r\n]/.test(String(value))) throw new Error(`config value must be one line: ${key}`);
  const file = configFile(dir);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lineEnd = (header) => {
    let end = header.index + header[0].length;
    const tail = header[0].slice(header[0].indexOf(':') + 1).trim();
    if (tail === '' || tail[0] === '#') {
      const block = /^(?:\r?\n[ \t][^\r\n]*)+/.exec(raw.slice(end));
      if (block) end += block[0].length;
    }
    return end;
  };
  const find = (name) => new RegExp(`^${name}:[^\\r\\n]*`, 'm').exec(raw);
  const header = find(key);
  let out;
  if (header && value !== null) {
    out = raw.slice(0, header.index) + `${key}: ${value}` + raw.slice(lineEnd(header));
  } else if (header) {
    let stop = lineEnd(header);
    if (raw.startsWith('\r\n', stop)) stop += 2;
    else if (raw[stop] === '\n') stop += 1;
    out = raw.slice(0, header.index) + raw.slice(stop);
  } else if (value === null) {
    return;
  } else {
    const anchor = after && find(after);
    out = anchor
      ? raw.slice(0, lineEnd(anchor)) + `${eol}${key}: ${value}` + raw.slice(lineEnd(anchor))
      : `${key}: ${value}${eol}${raw}`;
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
}

// The top-level keys in the order the config documents them, and the one table of where a key goes
// when the file does not have it yet: below the nearest key before it in this order that the file
// has, else at the top. keyBefore answers that key: the gear hands it to writeConfigLine as `after`,
// and writeConfigBlock uses it itself.
const KEY_ORDER = ['name', 'port', 'nextId', 'idDigits', 'prefixes', 'counters', 'logbook', 'scratchpad', 'todos', 'groups', 'iterations', 'typesOn', 'assignees', 'types', 'hierarchy', 'pills'];
// The keys whose whole block the web rewrites (docs/adr/0018).
const BLOCK_KEYS = ['types', 'hierarchy', 'prefixes'];

function keyBefore(raw, key) {
  const at = KEY_ORDER.indexOf(key);
  return KEY_ORDER.slice(0, at === -1 ? 0 : at).reverse().find((name) => new RegExp(`^${name}:`, 'm').test(raw)) || null;
}

// Where the block under the top-level key matched by `header` ends: after its last indented line.
// Blank lines and unindented comments inside it are part of it, but those after its last indented
// line belong to what follows (a comment above the next key), so the end stops before them.
function blockEnd(raw, header) {
  let end = header.index + header[0].length;
  const tail = header[0].slice(header[0].indexOf(':') + 1).trim();
  if (tail !== '' && tail[0] !== '#') return end;
  let pos = end;
  while (pos < raw.length) {
    const start = raw.startsWith('\r\n', pos) ? pos + 2 : pos + 1;
    let stop = raw.indexOf('\n', start);
    if (stop === -1) stop = raw.length;
    const line = raw.slice(start, stop).replace(/\r$/, '');
    if (/^\w+:/.test(line)) break;
    if (/^[ \t]/.test(line) && line.trim() !== '') end = start + line.length;
    pos = stop;
  }
  return end;
}

// Rewrites ONE whole top-level block (`types:`, `hierarchy:` or `prefixes:`, docs/adr/0018) with
// `lines` (the block's text, one string per line, no line ending) or, with null, removes it.
// Everything outside the block keeps its bytes and the file's line ending; comments inside the
// old block go with it. The block is found from its key to its last indented line, so a comment
// or blank line that sits above the next key stays. Same tmp+rename discipline as writeConfigLine.
function writeConfigBlock(dir, key, lines) {
  if (!BLOCK_KEYS.includes(key)) throw new Error(`config block must be one of ${BLOCK_KEYS.join(', ')}: ${key}`);
  const file = configFile(dir);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const find = (name) => (name === null ? null : new RegExp(`^${name}:[^\\r\\n]*`, 'm').exec(raw));
  const header = find(key);
  const text = lines === null ? null : lines.join(eol);
  let out;
  if (header && text !== null) {
    out = raw.slice(0, header.index) + text + raw.slice(blockEnd(raw, header));
  } else if (header) {
    let stop = blockEnd(raw, header);
    if (raw.startsWith('\r\n', stop)) stop += 2;
    else if (raw[stop] === '\n') stop += 1;
    out = raw.slice(0, header.index) + raw.slice(stop);
  } else if (text === null) {
    return;
  } else {
    const before = find(keyBefore(raw, key));
    if (before) {
      const end = blockEnd(raw, before);
      out = raw.slice(0, end) + eol + text + raw.slice(end);
    } else {
      out = raw === '' ? text + eol : text + eol + raw;
    }
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
}

function renderCounters(counters) {
  return `{ ${Object.entries(counters).map(([prefix, n]) => `${prefix}: ${n}`).join(', ')} }`;
}

// Allocate the next card id of a prefix ('' = the plain numbers). `fromScan`
// is the caller's scan-based candidate (max existing number of that prefix +
// 1). The counter is opt-in: without a config.yaml the board keeps its
// scan-only behavior and no file is conjured up. With one, the id's number is
// max(counter, fromScan) — a stale/lagging counter self-heals instead of ever
// re-issuing a taken id — and the advanced counter is persisted: `nextId` for
// plain numbers, the prefix's entry of the one `counters:` line for a prefix.
function allocateId(dir, fromScan, prefix = '') {
  if (!fs.existsSync(configFile(dir))) return fromScan;
  const config = readConfig(dir);
  if (prefix === '') {
    const id = Math.max(config.nextId || 0, fromScan);
    writeConfigLine(dir, 'nextId', String(id + 1));
    return id;
  }
  const id = Math.max(config.counters[prefix] || 0, fromScan);
  writeConfigLine(dir, 'counters', renderCounters({ ...config.counters, [prefix]: id + 1 }), 'nextId');
  return id;
}

const slashed = (path) => String(path).trim().replace(/\\/g, '/');
const bare = (path) => slashed(path).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');

// The groups folder a `prefixes:` value names, as the path under the groups folder
// ('' = the root, a group with no type), or null when the value names none and is a
// card type. A value names one when it is the `groups:` folder itself (`.groups`,
// which has no slash), a path under it (`.groups/iteration`), or any other path with a
// slash (`workflow/`), which reads relative to the groups folder. Matched exactly.
function groupFolderOf(config, value) {
  const text = slashed(value);
  if (text === '') return null;
  const root = config && config.groups ? bare(config.groups) : '';
  const path = bare(text);
  if (root !== '' && path === root) return '';
  if (root !== '' && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return text.includes('/') ? path : null;
}

// The prefix a card type declares in `prefixes:`, '' when it declares none. A
// type is compared without regard to case, as the hierarchy's tiers are; a value
// that names a groups folder is a folder and never a type.
function prefixForType(config, type) {
  const want = String(type || '').trim().toLowerCase();
  if (want === '') return '';
  for (const [prefix, target] of Object.entries(config.prefixes || {})) {
    if (groupFolderOf(config, target) === null && target.toLowerCase() === want) return prefix;
  }
  return '';
}

// The prefix a group takes from the folder it sits in ('' = the root, 'iteration',
// 'workflow/dynamic'): the one `prefixes:` maps to exactly that folder, else `_`.
function prefixForGroupFolder(config, folder) {
  const want = bare(folder || '');
  for (const [prefix, target] of Object.entries(config.prefixes || {})) {
    if (groupFolderOf(config, target) === want) return prefix;
  }
  return '_';
}

module.exports = { parseConfig, serializeConfig, readConfig, writeConfig, readAssignees, allocateId, writeConfigLine, writeConfigBlock, keyBefore, KEY_ORDER, BLOCK_KEYS, isPrefix, prefixForType, groupFolderOf, prefixForGroupFolder, splitPillEntry, ICON_NAMES };

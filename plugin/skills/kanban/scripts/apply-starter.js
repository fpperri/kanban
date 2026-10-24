#!/usr/bin/env node
'use strict';
// apply-starter <board-dir>... [--dry-run]
//
// Brings a board's config.yaml up to the starter (../starter-config.yaml) by
// adding only what the board lacks, and nothing else:
//   - no config.yaml: it is created from the starter, as it is;
//   - types: a missing block is added whole, missing types are added at the end
//     of an existing block; a type the board has (compared without regard to
//     case) gets the starter's color or icon only when its entry has none, and a
//     bare entry (`- epic`) becomes a block entry; a value it has is never changed;
//   - hierarchy: added only when the board has none; a different one is reported;
//   - prefixes: a missing block is added whole, missing entries are added at the
//     end of an existing block; an entry the board has is never changed, and a
//     prefix that means something else here is reported;
//   - the kit (logbook, scratchpad, todos, groups, iterations): each key with no
//     top-level line on the board is added, as the starter writes it, at the end
//     of the file; a line the board has is never changed, and a commented-out
//     line is not the key;
//   - vars: a kit line that is added brings each starter variable it names
//     (`<kanban>`) that the board lacks, in a `vars:` block added whole before
//     the kit lines or at the end of the board's own; a variable the board has
//     keeps its value.
// Every other byte stays, and so does the file's line ending. --dry-run prints
// the lines it would add and writes nothing.
const fs = require('fs');
const path = require('path');
const { parseConfig, groupFolderOf } = require('../../web/scripts/config-store');
const { scalar } = require('../../web/scripts/yaml-list');

const STARTER_FILE = path.join(__dirname, '..', 'starter-config.yaml');
const KIT_KEYS = ['logbook', 'scratchpad', 'todos', 'groups', 'iterations'];
const TOP_KEY = /^(\w+):\s*(.*)$/;

const bareTail = (tail) => { const t = tail.trim(); return t === '' || t[0] === '#'; };
const joinList = (list) => list.join(', ');

function splitLines(raw) {
  const lines = [];
  let start = 0;
  for (;;) {
    let end = start;
    while (end < raw.length && raw[end] !== '\r' && raw[end] !== '\n') end++;
    lines.push({ text: raw.slice(start, end), start, end });
    if (end >= raw.length) break;
    start = end + (raw[end] === '\r' && raw[end + 1] === '\n' ? 2 : 1);
  }
  return lines;
}

function findHeader(lines, key) {
  for (let i = 0; i < lines.length; i++) {
    const top = TOP_KEY.exec(lines[i].text);
    if (top && top[1] === key) return { index: i, tail: top[2] };
  }
  return null;
}

function blockOf(lines, header) {
  let last = header.index;
  let unindented = false;
  for (let j = header.index + 1; j < lines.length; j++) {
    const t = lines[j].text;
    if (t.trim() === '') continue;
    if (/^[ \t]/.test(t)) { last = j; continue; }
    if (j === header.index + 1 && /^-(\s|$)/.test(t)) unindented = true;
    break;
  }
  const first = lines.slice(header.index + 1, last + 1).find((l) => /^[ \t]+\S/.test(l.text));
  return { last, unindented, indent: first ? /^[ \t]+/.exec(first.text)[0] : '  ' };
}

// The entries of a block-form `types:` list: where each sits, its name, and which of
// color and icon it already has. A key that is present counts as had, even when blank.
function typeEntries(lines, header, block) {
  const entries = [];
  let cur = null;
  for (let j = header.index + 1; j <= block.last; j++) {
    const text = lines[j].text;
    if (text.trim() === '') continue;
    const dash = /^([ \t]*)-(?:[ \t]+(.*))?$/.exec(text);
    if (dash) {
      const rest = dash[2] === undefined ? '' : dash[2];
      const lead = text.length - rest.length;
      cur = { first: j, last: j, rest, lead, fields: {}, fieldIndent: null, bare: null };
      entries.push(cur);
      const field = /^(\w+):\s*(.*)$/.exec(rest);
      if (field) cur.fields[field[1]] = field[2];
      else if (rest.trim() !== '' && rest.trim()[0] !== '#') cur.bare = rest;
    } else if (cur) {
      cur.last = j;
      const field = /^([ \t]+)(\w+):\s*(.*)$/.exec(text);
      if (field) {
        cur.fields[field[2]] = field[3];
        if (cur.fieldIndent === null) cur.fieldIndent = field[1];
      }
    }
  }
  for (const e of entries) {
    const name = e.bare !== null ? scalar(e.bare) : scalar(e.fields.name === undefined ? '' : e.fields.name);
    e.name = name;
  }
  return entries.filter((e) => e.name !== '');
}

function typeLines(type, indent) {
  if (!type.color && !type.icon) return [`${indent}- ${type.name}`];
  const lines = [`${indent}- name: ${type.name}`];
  if (type.color) lines.push(`${indent}  color: "${type.color}"`);
  if (type.icon) lines.push(`${indent}  icon: ${type.icon}`);
  return lines;
}

const sameTarget = (config, a, b) => {
  const fa = groupFolderOf(config, a);
  const fb = groupFolderOf(config, b);
  if (fa !== null || fb !== null) return fa === fb;
  return a.toLowerCase() === b.toLowerCase();
};

// The starter's group prefixes name folders under `.groups`; a board that keeps
// its groups elsewhere gets the same folders under its own.
function targetFor(config, target) {
  if (!config.groups) return target;
  const root = config.groups.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root === '.groups') return target;
  if (target === '.groups') return root;
  return target.startsWith('.groups/') ? `${root}${target.slice('.groups'.length)}` : target;
}

// text -> { out, additions: [[label, lines]], notes: [text] } for one config.yaml.
function merge(raw, utf8, starterText) {
  const starter = parseConfig(starterText);
  const config = parseConfig(utf8);
  const lines = splitLines(raw);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const inserts = []; // { at, text }
  const additions = [];
  const notes = [];

  const appended = [];
  const appendBlock = (blockLines) => { appended.push(...blockLines); };
  const insertAfter = (lineIndex, blockLines) => {
    inserts.push({ at: lines[lineIndex].end, text: eol + blockLines.join(eol), seq: inserts.length });
  };
  const starterLines = (key) => {
    const src = splitLines(starterText);
    const h = findHeader(src, key);
    const b = blockOf(src, h);
    return src.slice(h.index, b.last + 1).map((l) => l.text);
  };

  const typesHeader = findHeader(lines, 'types');
  const starterType = (name) => starter.types.find((t) => t.name.toLowerCase() === String(name).toLowerCase());
  const missingTypes = starter.types.filter((t) => !config.types.some((c) => c.name.toLowerCase() === t.name.toLowerCase()));

  if (typesHeader && bareTail(typesHeader.tail)) {
    const block = blockOf(lines, typesHeader);
    if (!block.unindented) {
      const gaps = [];
      const gapLines = [];
      for (const e of typeEntries(lines, typesHeader, block)) {
        const st = starterType(e.name);
        if (!st) continue;
        const wants = [];
        if (st.color && !('color' in e.fields)) wants.push(['color', `"${st.color}"`]);
        if (st.icon && !('icon' in e.fields)) wants.push(['icon', st.icon]);
        if (!wants.length) continue;
        gaps.push(`${e.name}: ${wants.map(([k]) => k).join(' and ')}`);
        const text = lines[e.first].text;
        if (e.bare !== null && e.last === e.first) {
          const pad = ' '.repeat(e.lead);
          const added = [`${text.slice(0, e.lead)}name: ${e.rest}`, ...wants.map(([k, v]) => `${pad}${k}: ${v}`)];
          inserts.push({ at: lines[e.first].start, end: lines[e.first].end, text: added.join(eol), seq: inserts.length });
          gapLines.push(...added);
        } else if (e.bare === null) {
          const pad = e.fieldIndent !== null ? e.fieldIndent : ' '.repeat(e.lead);
          const added = wants.map(([k, v]) => `${pad}${k}: ${v}`);
          inserts.push({ at: lines[e.last].end, text: eol + added.join(eol), seq: inserts.length });
          gapLines.push(...added);
        }
      }
      if (gaps.length) additions.push(['colours and icons', gaps, gapLines]);
    }
  } else if (typesHeader) {
    const gapped = config.types.filter((c) => {
      const st = starterType(c.name);
      return st && ((st.color && !c.color) || (st.icon && !c.icon));
    });
    if (gapped.length) notes.push(`types is an inline list; colours and icons not added (${joinList(gapped.map((c) => c.name))})`);
  }

  if (missingTypes.length) {
    if (!typesHeader) {
      const block = starterLines('types');
      appendBlock(block);
      additions.push(['types', missingTypes.map((t) => t.name), block]);
    } else if (!bareTail(typesHeader.tail)) {
      notes.push(`types is an inline list; left alone (missing: ${joinList(missingTypes.map((t) => t.name))})`);
    } else {
      const block = blockOf(lines, typesHeader);
      if (block.unindented) {
        notes.push(`types has an unindented list; left alone (missing: ${joinList(missingTypes.map((t) => t.name))})`);
      } else {
        const added = missingTypes.flatMap((t) => typeLines(t, block.indent));
        insertAfter(block.last, added);
        additions.push(['types', missingTypes.map((t) => t.name), added]);
      }
    }
  }

  const hierarchyHeader = findHeader(lines, 'hierarchy');
  if (!hierarchyHeader) {
    const src = splitLines(starterText);
    const line = src[findHeader(src, 'hierarchy').index].text;
    appendBlock([line]);
    additions.push(['hierarchy', [], [line]]);
  } else if (config.hierarchy.map((h) => h.toLowerCase()).join('\n') !== starter.hierarchy.join('\n')) {
    notes.push(`hierarchy differs: the board has [${joinList(config.hierarchy)}], the starter has [${joinList(starter.hierarchy)}]; left alone`);
  }

  const wanted = [];
  for (const [prefix, target] of Object.entries(starter.prefixes)) {
    const want = targetFor(config, target);
    if (prefix in config.prefixes) {
      if (!sameTarget(config, config.prefixes[prefix], want)) {
        notes.push(`prefix ${prefix} is "${config.prefixes[prefix]}" on the board and "${want}" in the starter; left alone`);
      }
      continue;
    }
    const other = Object.entries(config.prefixes).find(([, t]) => sameTarget(config, t, want));
    if (other) {
      notes.push(`"${want}" already has the prefix ${other[0]} on the board; the starter's ${prefix} is not added`);
      continue;
    }
    wanted.push([prefix, want]);
  }
  const prefixesHeader = findHeader(lines, 'prefixes');
  if (wanted.length) {
    const names = wanted.map(([p]) => p);
    if (!prefixesHeader) {
      const block = ['prefixes:', ...wanted.map(([p, t]) => `  ${p}: ${t}`)];
      appendBlock(block);
      additions.push(['prefixes', names, block]);
    } else if (!bareTail(prefixesHeader.tail)) {
      notes.push(`prefixes is inline; left alone (missing: ${joinList(names)})`);
    } else {
      const block = blockOf(lines, prefixesHeader);
      if (block.unindented) {
        notes.push(`prefixes has an unindented list; left alone (missing: ${joinList(names)})`);
      } else {
        const added = wanted.map(([p, t]) => `${block.indent}${p}: ${t}`);
        insertAfter(block.last, added);
        additions.push(['prefixes', names, added]);
      }
    }
  }

  // A kit line that is added brings the starter's variables it names (`<kanban>`) that the board lacks.
  const src = splitLines(starterText);
  const varLines = new Map();
  const varsHeader = findHeader(src, 'vars');
  if (varsHeader) {
    for (let j = varsHeader.index + 1; j <= blockOf(src, varsHeader).last; j++) {
      const entry = /^[ \t]+([A-Za-z0-9_-]+):/.exec(src[j].text);
      if (entry) varLines.set(entry[1], src[j].text.trim());
    }
  }
  const wantedVars = [];
  for (const key of KIT_KEYS) {
    if (findHeader(lines, key)) continue;
    const line = src[findHeader(src, key).index].text;
    for (const [, word] of line.matchAll(/(?:^|[\s\\/])<([A-Za-z0-9_-]+)>(?=[\\/]|\s|$)/g)) {
      if (varLines.has(word) && !Object.hasOwn(config.vars, word) && !wantedVars.includes(word)) wantedVars.push(word);
    }
  }
  if (wantedVars.length) {
    const header = findHeader(lines, 'vars');
    if (!header) {
      const added = ['vars:', ...wantedVars.map((v) => `  ${varLines.get(v)}`)];
      appendBlock(added);
      additions.push(['vars', wantedVars, added]);
    } else {
      const block = blockOf(lines, header);
      if (block.unindented || !bareTail(header.tail)) {
        notes.push(`vars is not a block of name: value lines; left alone (missing: ${joinList(wantedVars)})`);
      } else {
        const added = wantedVars.map((v) => `${block.indent}${varLines.get(v)}`);
        insertAfter(block.last, added);
        additions.push(['vars', wantedVars, added]);
      }
    }
  }

  for (const key of KIT_KEYS) {
    if (findHeader(lines, key)) continue;
    const line = src[findHeader(src, key).index].text;
    appendBlock([line]);
    additions.push([key, [], [line]]);
  }

  if (appended.length) {
    const endsClean = raw === '' || /[\r\n]$/.test(raw);
    inserts.push({ at: raw.length, text: endsClean ? appended.join(eol) + eol : eol + appended.join(eol), seq: inserts.length });
  }
  let out = raw;
  const byPosition = [...inserts].sort((a, b) => b.at - a.at || b.seq - a.seq);
  for (const ins of byPosition) out = out.slice(0, ins.at) + ins.text + out.slice(ins.end === undefined ? ins.at : ins.end);
  return { out, additions, notes };
}

function describe(additions) {
  return additions.map(([key, names]) => (names.length ? `${key} (${joinList(names)})` : key)).join(', ');
}

function applyTo(dir, dryRun, starterText) {
  const result = { summary: '', added: [], notes: [], error: false };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    result.summary = `${dir}: not a directory`;
    result.error = true;
    return result;
  }
  const file = path.join(dir, 'config.yaml');
  if (!fs.existsSync(file)) {
    result.summary = `${dir}: ${dryRun ? 'would create' : 'created'} config.yaml from the starter`;
    result.added = starterText.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    if (!dryRun) {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, starterText);
      fs.renameSync(tmp, file);
    }
    return result;
  }
  const buf = fs.readFileSync(file);
  const { out, additions, notes } = merge(buf.toString('latin1'), buf.toString('utf8'), starterText);
  result.notes = notes;
  if (!additions.length) {
    result.summary = `${dir}: nothing to add`;
    return result;
  }
  result.summary = `${dir}: ${dryRun ? 'would add' : 'added'} ${describe(additions)}`;
  result.added = additions.flatMap(([, , added]) => added);
  if (!dryRun) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(out, 'latin1'));
    fs.renameSync(tmp, file);
  }
  return result;
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const dirs = argv.filter((a) => a !== '--dry-run');
  if (dirs.length === 0 || dirs.some((d) => d.startsWith('--'))) {
    process.stderr.write('usage: apply-starter.js <board-dir>... [--dry-run]\n');
    return 2;
  }
  const starterText = fs.readFileSync(STARTER_FILE, 'utf8');
  let failed = false;
  for (const dir of dirs) {
    const r = applyTo(dir, dryRun, starterText);
    failed = failed || r.error;
    process.stdout.write(`${r.summary}\n`);
    if (dryRun) for (const line of r.added) process.stdout.write(`+ ${line}\n`);
    for (const note of r.notes) process.stdout.write(`  note: ${note}\n`);
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { merge, applyTo };

'use strict';
// notifications.md: a YAML list in the board dir that agents append to and the
// app reads/mutates. Hand-rolled subset parser on purpose — the repo carries no
// dependencies, and the writer contract (documented in the app SKILL.md) is a
// flat, single-line-per-field entry (the level field is optional):
//
//   - id: 1
//     at: 2026-07-08T23:40:00
//     from: "workflow:#13-finalizer"
//     level: info
//     message: "Card #13 closed."
//     read: false
//
// Tolerance rule: an entry without a numeric id or a non-empty message is
// skipped, never fatal. `level` is one of debug|info|warning|error; absent or
// unknown reads as info (back-compat).
//
// Archive-not-delete: nothing is ever deleted. Any entry that
// leaves the live file — a per-row delete, clear-all, or a malformed block
// that a rewrite would silently drop — is first APPENDED verbatim (its raw
// block text) to <dir>/archived/notifications.md, creating the dir/file if
// absent. read-flips (markRead) stay in-place edits of the live file.
const fs = require('fs');
const path = require('path');
const { parseBlocks, unquote, quote } = require('./yaml-list');

const FILE = 'notifications.md';
const ARCHIVE_DIR = 'archived';
const LEVELS = ['debug', 'info', 'warning', 'error'];

function normalizeLevel(raw) {
  return LEVELS.includes(raw) ? raw : 'info';
}

function toEntry(e) {
  const id = Number(unquote(e.id !== undefined ? e.id : ''));
  const message = unquote(e.message !== undefined ? e.message : '');
  if (!Number.isInteger(id) || id <= 0 || message === '') return null; // malformed
  return {
    id,
    at: unquote(e.at !== undefined ? e.at : ''),
    from: unquote(e.from !== undefined ? e.from : ''),
    level: normalizeLevel(unquote(e.level !== undefined ? e.level : '')),
    message,
    read: unquote(e.read !== undefined ? e.read : '') === 'true',
  };
}

function parseNotifications(text) {
  const valid = [];
  for (const e of parseBlocks(text)) {
    const entry = toEntry(e);
    if (entry) valid.push(entry);
  }
  return valid;
}

// The raw text of each `- key: value` block, in file order, boundaries
// matching parseBlocks' (a new block starts only on a `- key:` line, so the
// zip in classify() below is index-aligned by construction). Trailing blank
// lines are trimmed to one terminator so archived appends stay tidy.
function splitRawBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^-\s+\w+:/.test(line)) {
      if (cur) blocks.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b) => {
    while (b.length && b[b.length - 1].trim() === '') b.pop();
    return b.join('\n') + '\n';
  });
}

// Partition the live file into parsed valid entries (paired with their raw
// block text) and the raw text of malformed blocks a rewrite would drop.
function classify(text) {
  const raws = splitRawBlocks(text);
  const parsed = parseBlocks(text);
  const valid = [];
  const malformed = [];
  parsed.forEach((e, i) => {
    const entry = toEntry(e);
    if (entry) valid.push({ entry, raw: raws[i] });
    else malformed.push(raws[i]);
  });
  return { valid, malformed };
}

function serializeNotifications(list) {
  // level serializes bare (normalized to the closed debug|info|warning|error
  // set, so it never needs quoting), in the writer contract's field order.
  return list
    .map((n) => `- id: ${n.id}\n  at: ${quote(n.at)}\n  from: ${quote(n.from)}\n  level: ${normalizeLevel(n.level)}\n  message: ${quote(n.message)}\n  read: ${n.read ? 'true' : 'false'}\n`)
    .join('');
}

function notifFile(dir) {
  return path.join(dir, FILE);
}

function archiveFile(dir) {
  return path.join(dir, ARCHIVE_DIR, FILE);
}

// Append raw entry text to <dir>/archived/notifications.md — the
// clear-equals-archive rule. No-op on empty text so boards that never drop
// anything never conjure up the file.
function archiveRawText(dir, text) {
  if (!text) return;
  const file = archiveFile(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
}

function readNotifications(dir) {
  const file = notifFile(dir);
  if (!fs.existsSync(file)) return [];
  return parseNotifications(fs.readFileSync(file, 'utf8'));
}

function writeNotifications(dir, list) {
  // tmp+rename, matching card-store's writeAtomic — ADR 0002's write discipline:
  // a crash mid-write must not truncate notifications.md.
  const file = notifFile(dir);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serializeNotifications(list));
  fs.renameSync(tmp, file);
  return list;
}

function markRead(dir, ids) {
  const file = notifFile(dir);
  if (!fs.existsSync(file)) return []; // nothing to persist, don't create the file
  const { valid, malformed } = classify(fs.readFileSync(file, 'utf8'));
  // The rewrite below would otherwise silently drop malformed blocks — they
  // get archived instead of vanishing.
  archiveRawText(dir, malformed.join(''));
  const wanted = ids ? new Set(ids.map(Number)) : null;
  return writeNotifications(dir, valid.map(({ entry }) =>
    (wanted === null || wanted.has(entry.id) ? { ...entry, read: true } : entry)));
}

function removeNotification(dir, id) {
  const file = notifFile(dir);
  if (!fs.existsSync(file)) return [];
  const { valid, malformed } = classify(fs.readFileSync(file, 'utf8'));
  const removed = valid.filter(({ entry }) => entry.id === Number(id));
  archiveRawText(dir, malformed.join('') + removed.map(({ raw }) => raw).join(''));
  return writeNotifications(dir, valid.filter(({ entry }) => entry.id !== Number(id)).map(({ entry }) => entry));
}

function clearNotifications(dir) {
  const file = notifFile(dir);
  if (!fs.existsSync(file)) return [];
  // Everything moves — valid and malformed alike, verbatim, in file order.
  archiveRawText(dir, splitRawBlocks(fs.readFileSync(file, 'utf8')).join(''));
  return writeNotifications(dir, []);
}

module.exports = {
  parseNotifications, serializeNotifications, readNotifications,
  markRead, removeNotification, clearNotifications,
};

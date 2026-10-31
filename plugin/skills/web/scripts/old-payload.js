'use strict';
// The old Snapshot page's change payload as tray records. Dated 2026-10-31: this goes one release after
// the switch to kanban:artifact, with its call in apply-tray.js and its test; until then a change queued
// on an old page is applied like any tray.
//
// The old page records ops, not saves:
//   Apply kanban changes (N ops, base <ISO>):
//   [{"op":"move","id":"7","to":"done"}, {"op":"edit","id":"7",...}, {"op":"create",...},
//    {"op":"archive","id":"7"}, {"op":"delete","id":"7"}]
// Each op becomes the server save it means, a tray record `{ id, at, device, change }`, and goes through
// the same dry run and replay as a record the new page made. An op the web's routes cannot say (a
// front-matter key no save writes) becomes `{ id, notRead }`, which apply-tray reports as refused.
const crypto = require('crypto');
const ids = require('../web/ids');

const ID_RE = new RegExp(`^${ids.ID_SOURCE}$`);
const HEADER_RE = /^\s*Apply kanban changes\b[^\n]*?\bbase\s+(\S+?)\s*\)/;
const LIST_KEYS = new Set(['tags', 'waiting_for']);
// The front-matter keys a card save writes, by the field name the save takes.
const SAVED_KEYS = new Set(['tags', 'waiting_for', 'blocked', 'review', 'prompt', 'type', 'parent', 'rank',
  'start_date', 'end_date', 'due_date', 'priority', 'assignee', 'status']);
const IGNORED_KEYS = new Set(['id', 'updated']);

const isOp = (item) => item && typeof item === 'object' && !Array.isArray(item) && typeof item.op === 'string' && !('change' in item);

// A raw front-matter value as the card save takes it: one pair of quotes off, a flow list as an array.
function unquote(s) {
  const t = String(s).trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function flowList(s) {
  const t = String(s).trim();
  const inner = t.startsWith('[') && t.endsWith(']') ? t.slice(1, -1) : t;
  return inner.split(',').map(unquote).filter((x) => x !== '');
}

// The fields of a save from an op's raw `fm` assignments, or { reason } for a key no save writes.
function fmFields(fm) {
  const fields = {};
  if (fm === undefined || fm === null) return { fields };
  if (typeof fm !== 'object' || Array.isArray(fm)) return { reason: 'fm is not an object of front-matter assignments' };
  for (const [key, raw] of Object.entries(fm)) {
    if (IGNORED_KEYS.has(key)) continue;
    if (!SAVED_KEYS.has(key)) return { reason: `the front-matter key ${key} has no save in the web's routes` };
    fields[key] = LIST_KEYS.has(key) ? flowList(raw) : unquote(raw);
  }
  return { fields };
}

const cardPath = (id) => `/api/cards/${id}`;

// One op as { change } or { notRead }.
function translate(op) {
  const needId = () => {
    if (op.id === undefined || op.id === null || !ID_RE.test(String(op.id).trim())) return null;
    return String(op.id).trim();
  };
  switch (op.op) {
    case 'move': {
      const id = needId();
      if (id === null) return { notRead: 'the move names no card id' };
      if (typeof op.to !== 'string' || op.to.trim() === '') return { notRead: 'the move names no column' };
      return { change: { method: 'PATCH', path: cardPath(id), body: { status: op.to.trim() } } };
    }
    case 'edit': {
      const id = needId();
      if (id === null) return { notRead: 'the edit names no card id' };
      const { fields, reason } = fmFields(op.fm);
      if (reason) return { notRead: reason };
      const body = {};
      for (const key of ['title', 'priority', 'assignee', 'body']) if (op[key] !== undefined) body[key] = op[key];
      return { change: { method: 'PATCH', path: cardPath(id), body: { ...fields, ...body } } };
    }
    case 'create': {
      if (typeof op.title !== 'string') return { notRead: 'the create has no title' };
      const { fields, reason } = fmFields(op.fm);
      if (reason) return { notRead: reason };
      delete fields.status;
      const body = { ...fields, title: op.title };
      for (const key of ['status', 'priority', 'assignee', 'body']) if (op[key] !== undefined && op[key] !== null && op[key] !== '') body[key] = op[key];
      return { change: { method: 'POST', path: '/api/cards', body } };
    }
    case 'archive': {
      const id = needId();
      if (id === null) return { notRead: 'the archive names no card id' };
      return { change: { method: 'POST', path: `${cardPath(id)}/archive`, body: {} } };
    }
    case 'delete': {
      const id = needId();
      if (id === null) return { notRead: 'the delete names no card id' };
      return { change: { method: 'DELETE', path: cardPath(id), body: {} } };
    }
    default:
      return { notRead: `${op.op} is not an op of the old Snapshot page` };
  }
}

// The base stamp of a payload's header line, or null. A code fence around the payload is skipped, as
// parseTray drops it.
function baseOf(text) {
  const first = String(text).replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim() !== '' && !/^\s*```/.test(l));
  const m = HEADER_RE.exec(first || '');
  return m ? m[1] : null;
}

// A payload carries no ids, so a record's is made from the page's base stamp, the op's place in the
// payload and the op itself: the same payload pasted twice reads as the same records.
function recordId(base, index, op) {
  const digest = crypto.createHash('sha256').update(JSON.stringify([base, index, op])).digest('hex').slice(0, 12);
  return `old-${digest}`;
}

// Tray records for a list of parsed items. An item that is not an old op passes through as it is.
function fromOps(items, { base = null } = {}) {
  return items.map((item, index) => {
    if (!isOp(item)) return item;
    const id = recordId(base, index, item);
    const t = translate(item);
    if (t.notRead) return { id, notRead: t.notRead };
    return { id, at: base || '', device: 'snapshot', change: t.change };
  });
}

module.exports = { fromOps, baseOf, isOp };

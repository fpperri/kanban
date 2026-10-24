'use strict';
// Shared scalar/quoting helpers plus a tolerant block parser for the board's
// flat YAML-ish data files. Consumers: notifications-store uses parseBlocks +
// unquote/quote for notifications.md's top-level `- key: value` list;
// config-store uses unquote/quote/scalar for config.yaml (its sectioned
// structure needs its own line loop, so it deliberately does NOT reuse
// parseBlocks).

function unquote(raw) {
  const s = String(raw).trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

function quote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// YAML-style trailing comments on a scalar: `28   # counter` → `28`, while a
// `#` inside a quoted value survives. For a quoted value, anything after the
// closing quote is dropped; for a bare value, strip from the first ` #`.
function scalar(raw) {
  const s = String(raw).trim();
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '\\') { i++; continue; }
      if (s[i] === q) return unquote(s.slice(0, i + 1));
    }
    return unquote(s); // unterminated quote — fall through to plain unquote
  }
  const hash = s.search(/\s#/);
  return hash === -1 ? s : s.slice(0, hash).trim();
}

// Returns raw entries: array of { key: rawStringValue } maps. Validation and
// unquoting of individual fields is each store's job.
function parseBlocks(text) {
  const entries = [];
  let cur = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const startMatch = rawLine.match(/^-\s+(\w+):\s*(.*)$/);
    const fieldMatch = rawLine.match(/^\s+(\w+):\s*(.*)$/);
    if (startMatch) {
      if (cur) entries.push(cur);
      cur = {};
      cur[startMatch[1]] = startMatch[2];
    } else if (fieldMatch && cur) {
      cur[fieldMatch[1]] = fieldMatch[2];
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

module.exports = { parseBlocks, unquote, quote, scalar };

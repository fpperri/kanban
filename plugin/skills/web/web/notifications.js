'use strict';
// Pure notification helpers. No DOM access — loaded as a plain
// <script> before app.js in the browser AND required directly by node --test,
// same dual-environment pattern as refresh-policy.js / column-state.js.

const PROSE = (typeof module !== 'undefined' && module.exports)
  ? require('./prose')
  : window;

// Newest first: by `at` descending (ISO strings compare lexicographically),
// ties broken by id descending so freshly-appended entries with a duplicated
// timestamp still lead.
function sortNotificationsDesc(list) {
  return [...list].sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1;
    return b.id - a.id;
  });
}

function unreadCount(list) {
  return list.filter((n) => !n.read).length;
}

// Unread entries not yet toasted this session — the toast-once guard.
function unseenUnread(list, seenIds) {
  return list.filter((n) => !n.read && !seenIds.has(n.id));
}

// Message shape: the text before the FIRST "; more: " is the TLDR
// (renderers bold it); the rest is detail. No separator = the whole message
// is TLDR. `more` excludes the separator itself — renderers that want the
// message verbatim slice the original by tldr.length instead.
const TLDR_SEPARATOR = '; more: ';
function splitTldr(message) {
  const s = String(message == null ? '' : message);
  const idx = s.indexOf(TLDR_SEPARATOR);
  if (idx === -1) return { tldr: s, more: '' };
  return { tldr: s.slice(0, idx), more: s.slice(idx + TLDR_SEPARATOR.length) };
}

// What the tray renders: the TLDR on its own line and the detail beneath it.
// The contract puts the TLDR before the first '; more: '. A message written
// without it falls back to its first sentence, so one missing separator no
// longer bolds a whole message; a 'more:' label left at the start of the
// detail is dropped, because the tray draws its own.
function splitNotification(message) {
  const s = String(message == null ? '' : message);
  const idx = s.indexOf(TLDR_SEPARATOR);
  if (idx !== -1) return { tldr: s.slice(0, idx), more: s.slice(idx + TLDR_SEPARATOR.length) };
  const end = PROSE.firstSentenceEnd(s);
  if (end === -1) return { tldr: s, more: '' };
  return { tldr: s.slice(0, end), more: s.slice(end).trim().replace(/^more:\s*/i, '') };
}

// Levels: debug | info | warning | error; absent or unknown reads
// as info (back-compat with pre-level entries).
const NOTIFICATION_LEVELS = ['debug', 'info', 'warning', 'error'];
function notificationLevel(entry) {
  const level = entry && entry.level;
  return NOTIFICATION_LEVELS.includes(level) ? level : 'info';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sortNotificationsDesc, unreadCount, unseenUnread, splitTldr, splitNotification, notificationLevel, NOTIFICATION_LEVELS };
} else {
  window.sortNotificationsDesc = sortNotificationsDesc;
  window.unreadCount = unreadCount;
  window.unseenUnread = unseenUnread;
  window.splitTldr = splitTldr;
  window.splitNotification = splitNotification;
  window.notificationLevel = notificationLevel;
  window.NOTIFICATION_LEVELS = NOTIFICATION_LEVELS;
}

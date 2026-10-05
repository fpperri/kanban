'use strict';
// Waiting vs blocked/review predicates (review is ADR
// 0009) — the ONE place both `doing`-gate semantics AND the
// two sticker fields live, shared by the store AND the UI. Pure and
// dual-environment, same pattern as calendar-model.js: required directly by
// scripts/card-store.js and node --test, loaded as a plain <script> in the
// browser (app.js / dependency-graph.js read these as bare globals).
//
// Vocabulary (GLOSSARY.md glossary):
// - WAITING is derived, never stored: a card is waiting while any id in its
//   `waiting_for` list names a card that is not `done`. A dangling id (no
//   matching card) is non-blocking. A dependency is sequencing, not an
//   impediment.
// - BLOCKED and REVIEW are sticker fields, siblings that overlay any status:
//   `blocked: <reason>` ("stuck until you act") and `review: <text>`
//   ("finished, approve me" — ADR 0009). Both share ONE presence predicate:
//   the trimmed value contains >= 1 alphanumeric character, with the YAML
//   boolean special-case: `false`/`no` -> not present; `true` -> present,
//   text unspecified. Tolerant any-case reads, same stance as the epic
//   flag's reader. Unlike `blocked`, `review` does NOT gate `doing` entry.

// The shared sticker-presence predicate. Takes the RAW field value (string
// from frontmatter/JSON, or a real boolean from an API body) — never a card.
function isStickerValue(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const t = String(value).trim();
  const low = t.toLowerCase();
  if (low === 'false' || low === 'no') return false;
  return /[a-z0-9]/i.test(t);
}

// The human-readable text behind a valid sticker: the trimmed value, with
// the bare boolean `true` (text unspecified) mapping to ''. An invalid /
// clear value has no text at all.
function stickerText(value) {
  if (!isStickerValue(value)) return '';
  if (value === true) return '';
  const t = String(value).trim();
  return t.toLowerCase() === 'true' ? '' : t;
}

function isBlockedValue(value) { return isStickerValue(value); }
function blockedReason(value) { return stickerText(value); }

// The refusal/tooltip label: "blocked: <reason>", or the bare
// "blocked" when the reason is unspecified. One writer so every surface
// (server 422 message, board pill tooltip, map pill tooltip, toasts) names
// the sticker identically.
function blockedLabel(value) {
  const reason = blockedReason(value);
  return reason ? `blocked: ${reason}` : 'blocked';
}

// ADR 0009: review shares blocked's exact predicate/text machinery — only
// the label prefix differs.
function isReviewValue(value) { return isStickerValue(value); }
function reviewReason(value) { return stickerText(value); }
function reviewLabel(value) {
  const reason = reviewReason(value);
  return reason ? `review: ${reason}` : 'review';
}

// The waiting predicate's working half: the cards a `waiting_for` list is
// still waiting ON — every listed id whose card exists and is not `done`,
// in list order. Dangling ids drop out (non-blocking by contract). `byId` is
// the caller's full active+archived lookup (waiting is
// location-independent). Returns the card objects so callers can
// format "#3 (todo)" refusals and unresolved-only tooltips.
function unresolvedWaits(waitingFor, byId) {
  return (waitingFor || [])
    .map((id) => byId.get(typeof id === 'number' ? id : Number(id)))
    .filter((c) => c && c.status !== 'done');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isBlockedValue, blockedReason, blockedLabel,
    isReviewValue, reviewReason, reviewLabel,
    unresolvedWaits,
  };
} else {
  window.isBlockedValue = isBlockedValue;
  window.blockedReason = blockedReason;
  window.blockedLabel = blockedLabel;
  window.isReviewValue = isReviewValue;
  window.reviewReason = reviewReason;
  window.reviewLabel = reviewLabel;
  window.unresolvedWaits = unresolvedWaits;
}

'use strict';
// Pure module for ids (docs/adr/0014): the one place that parses, compares and
// formats an id and owns the mention pattern. An id is a prefix (an optional `_`
// and uppercase letters) and a number, `656`, `G3`, `_12`; the whole pair is the
// identity, so `#7` and `#G7` are two things. Same dual-environment pattern as
// prose.js/nesting.js: loaded as a plain <script> in the browser (one global,
// window.kanbanIds) AND required directly by node --test. The snapshot's Python
// copy is skills/snapshot/scripts/ids.py; both run skills/web/test/ids-cases.json.
//
// Anything a caller holds as an id goes in as a string (`'G3'`, `'0003'`), a
// plain number (`7`) or a parsed `{ prefix, number }`; whatever is not an id
// comes back null. Numbers stop at 15 digits so JS and Python read the same value.

const idsModule = (() => {
  const MAX_NUMBER = 999999999999999;
  const DEFAULT_DIGITS = 4;
  const ID_RE = /^(_?[A-Z]*)([0-9]{1,15})$/;

  // `board#G3`, `#G3`: the board token (when there is one) is the run of name
  // characters just before the `#`; the id is `#`, a prefix, digits and a word
  // boundary, so `#a371f7`, `#371f7` and `# Heading` are not mentions. ASCII only.
  // Groups: 1 board, 2 prefix, 3 digits.
  const MENTION_SOURCE = '(?<![A-Za-z0-9_#])(?:([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)(?=#))?#(_?[A-Z]*)([0-9]{1,15})\\b';
  const WHOLE_MENTION_RE = new RegExp(`^${MENTION_SOURCE}$`);

  function parseId(value) {
    if (typeof value === 'string') {
      const m = ID_RE.exec(value);
      return m ? { prefix: m[1], number: Number(m[2]) } : null;
    }
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value <= MAX_NUMBER ? { prefix: '', number: value } : null;
    }
    if (value && typeof value === 'object') {
      const { prefix, number } = value;
      const ok = typeof prefix === 'string' && /^_?[A-Z]*$/.test(prefix)
        && Number.isInteger(number) && number >= 0 && number <= MAX_NUMBER;
      return ok ? { prefix, number } : null;
    }
    return null;
  }

  function idKey(value) {
    const id = parseId(value);
    return id ? `${id.prefix}${id.number}` : null;
  }

  // Prefix first (plain ids before prefixed ones, then by character), then number.
  // What is not an id sorts after every id, by its text.
  function compareIds(a, b) {
    const x = parseId(a);
    const y = parseId(b);
    if (x && y) {
      if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1;
      return x.number === y.number ? 0 : x.number < y.number ? -1 : 1;
    }
    if (x) return -1;
    if (y) return 1;
    const s = String(a);
    const t = String(b);
    return s === t ? 0 : s < t ? -1 : 1;
  }

  function sortIds(list) {
    return list.slice().sort(compareIds);
  }

  // The id as a file name holds it: the number padded to the board's idDigits,
  // never cut when it is wider.
  function formatId(value, digits) {
    const id = parseId(value);
    if (!id) return null;
    const width = Number.isInteger(digits) && digits >= 0 ? digits : DEFAULT_DIGITS;
    return `${id.prefix}${String(id.number).padStart(width, '0')}`;
  }

  function mentionFrom(m, start) {
    return { match: m[0], board: m[1] === undefined ? null : m[1], prefix: m[2], number: Number(m[3]), start, end: start + m[0].length };
  }

  function parseMention(text) {
    const m = WHOLE_MENTION_RE.exec(String(text));
    return m ? mentionFrom(m, 0) : null;
  }

  function findMentions(text) {
    const re = new RegExp(MENTION_SOURCE, 'g');
    const found = [];
    let m;
    while ((m = re.exec(String(text))) !== null) found.push(mentionFrom(m, m.index));
    return found;
  }

  return { parseId, idKey, compareIds, sortIds, formatId, parseMention, findMentions, MENTION_SOURCE };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = idsModule;
} else {
  window.kanbanIds = idsModule;
}

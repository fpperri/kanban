'use strict';
// The colours of the Markdown boxes (the card form's description and the Scratchpad's Edit box), apart
// from the DOM: given the text, the spans to colour, as { from, to, kind } sorted and never overlapping,
// the text between them being plain. markdown-edit-ui.js paints them; the colours are the --md-edit-*
// tokens in app.css, one per kind.
//
// Kinds: heading (a whole `#` line, the marks inside it keeping their own kind), bold, italic, strike,
// code (inline code and a fenced block, one span from the opening line to the closing one), link
// (`[text](address)`, an image, a bare address), marker (a list bullet, a number or a task box, a
// quote `>`, a rule, a table's pipes and its delimiter row), tag (`<u>`, `<details>`, `<summary>`,
// opening and closing) and mention (a code span naming a card, `board#12 title`, and a bare `#12`,
// `board#12` or `#G3`).
//
// It reads the text the way markdown.js renders it, a line at a time, and decides nothing the renderer
// would not: a mark that never closes, a `**` with a space inside its edge, a table with no delimiter
// row or a fence whose line holds a backtick is plain. Only colours follow from it; a width never does.
//
// The text is the person's and can be large, so each scan for a closing mark remembers where one failed
// (an opener after that point fails too), and only the first INLINE_CAP characters of a line are read
// for marks: the rest of a longer line keeps its block colour and nothing else. A text past MAX_CHARS
// has no spans at all.
//
// Pure: Node tests drive it with plain strings. Same dual-environment export pattern as markdown.js.

const markdownEditModule = (() => {
  const EDIT_NODE = typeof module !== 'undefined' && module.exports;
  const editIds = () => (EDIT_NODE ? require('./ids') : window.kanbanIds);
  const editMention = (code) => (EDIT_NODE ? require('./prose').cardMention : window.cardMention)(code);

  const KINDS = ['heading', 'bold', 'italic', 'strike', 'code', 'link', 'marker', 'tag', 'mention'];
  const MAX_CHARS = 400000;
  const INLINE_CAP = 4000;

  const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
  const HEADING_RE = /^ {0,3}#{1,6}(?=[ \t]|$)/;
  const HR_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*\r?$/;
  const ITEM_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t])/;
  const TASK_RE = /^[ \t]*\[[ xX]\](?=[ \t]|$)/;
  const DELIM_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*\r?$/;
  const SPECIAL_RE = /[\\`*_~[<#:]/g;
  const TAG_RE = /<\/?(?:u|details|summary)(?:[ \t][^<>\n]{0,200})?>/iy;
  const ADDRESS_RE = /[^\s<>]+/y;
  const BOARD_CHAR_RE = /[A-Za-z0-9_.-]/;
  const ALNUM_RE = /[A-Za-z0-9]/;
  const WORD_RE = /\w/;
  const BOARD_MAX = 40;

  let mentionRe = null;
  const mentionRegex = () => {
    if (!mentionRe) mentionRe = new RegExp(editIds().MENTION_SOURCE, 'y');
    return mentionRe;
  };

  const isSpace = (ch) => ch === undefined || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

  // indexOf that remembers a failed search: an opener after the point where one failed fails too.
  function findFrom(s, needle, from, dead) {
    if (dead[needle] !== undefined && from >= dead[needle]) return -1;
    const at = s.indexOf(needle, from);
    if (at === -1) dead[needle] = from;
    return at;
  }

  // The next run of exactly `run` backticks at or after `from`.
  function findBacktickRun(s, from, run, dead) {
    const key = '`' + run;
    if (dead[key] !== undefined && from >= dead[key]) return -1;
    let k = from;
    for (;;) {
      const at = s.indexOf('`', k);
      if (at === -1) break;
      let len = 1;
      while (s[at + len] === '`') len++;
      if (len === run) return at;
      k = at + len;
    }
    dead[key] = from;
    return -1;
  }

  // The run that closes an emphasis opened by a run of `run` marks: one mark for an italic, two or more
  // for a bold or a strike; after non-space, and for `_` not inside a word.
  function findEmphasisClose(s, from, ch, run, dead) {
    const key = ch + (run >= 2 ? 2 : 1);
    if (dead[key] !== undefined && from >= dead[key]) return null;
    let k = from;
    for (;;) {
      const at = s.indexOf(ch, k);
      if (at === -1) break;
      let len = 1;
      while (s[at + len] === ch) len++;
      const sized = run >= 2 ? len >= 2 : len === 1;
      if (sized && at > from && !isSpace(s[at - 1]) && (ch !== '_' || !ALNUM_RE.test(s[at + len] || ' '))) return { at, len };
      k = at + len;
    }
    dead[key] = from;
    return null;
  }

  function spansOf(text) {
    const out = [];
    const push = (from, to, kind) => { if (to > from) out.push({ from, to, kind }); };
    const lastEnd = () => (out.length ? out[out.length - 1].to : 0);

    // The marks inside one stretch of a line, `base` being where the stretch starts in the text.
    function inline(s, base) {
      const dead = Object.create(null);
      let badClose = -1;
      let i = 0;
      const n = s.length;
      while (i < n) {
        SPECIAL_RE.lastIndex = i;
        const hit = SPECIAL_RE.exec(s);
        if (!hit) break;
        i = hit.index;
        const ch = s[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '`') {
          let run = 1;
          while (s[i + run] === '`') run++;
          const close = findBacktickRun(s, i + run, run, dead);
          if (close === -1) { i += run; continue; }
          const inner = s.slice(i + run, close).trim();
          push(base + i, base + close + run, editMention(inner) ? 'mention' : 'code');
          i = close + run;
          continue;
        }
        if (ch === '*' || ch === '_') {
          let run = 1;
          while (s[i + run] === ch) run++;
          const startsWord = ch === '_' && i > 0 && ALNUM_RE.test(s[i - 1]);
          if (startsWord || isSpace(s[i + run])) { i += run; continue; }
          const close = findEmphasisClose(s, i + run, ch, run, dead);
          if (!close) { i += run; continue; }
          push(base + i, base + close.at + close.len, run >= 2 ? 'bold' : 'italic');
          i = close.at + close.len;
          continue;
        }
        if (ch === '~') {
          let run = 1;
          while (s[i + run] === '~') run++;
          if (run < 2 || isSpace(s[i + run])) { i += run; continue; }
          const close = findEmphasisClose(s, i + run, '~', 2, dead);
          if (!close) { i += run; continue; }
          push(base + i, base + close.at + close.len, 'strike');
          i = close.at + close.len;
          continue;
        }
        if (ch === '[') {
          if (i < badClose) { i++; continue; }
          const bracket = findFrom(s, ']', i + 1, dead);
          if (bracket === -1) { i++; continue; }
          if (s[bracket + 1] !== '(') { badClose = bracket; i++; continue; }
          const paren = findFrom(s, ')', bracket + 2, dead);
          if (paren === -1) { i++; continue; }
          const from = s[i - 1] === '!' && base + i - 1 >= lastEnd() ? i - 1 : i;
          push(base + from, base + paren + 1, 'link');
          i = paren + 1;
          continue;
        }
        if (ch === '<') {
          TAG_RE.lastIndex = i;
          const tag = TAG_RE.exec(s);
          if (tag) { push(base + i, base + i + tag[0].length, 'tag'); i += tag[0].length; } else i++;
          continue;
        }
        if (ch === ':') {
          const scheme = s.endsWith('https', i) ? 5 : s.endsWith('http', i) ? 4 : 0;
          const start = i - scheme;
          if (!scheme || s[i + 1] !== '/' || s[i + 2] !== '/' || (start > 0 && WORD_RE.test(s[start - 1])) || base + start < lastEnd()) { i++; continue; }
          ADDRESS_RE.lastIndex = i + 3;
          const rest = ADDRESS_RE.exec(s);
          if (!rest) { i++; continue; }
          let end = i + 3 + rest[0].length;
          for (;;) {
            const last = s[end - 1];
            const open = s.slice(start, end).includes('(');
            if (end > i + 3 && ('.,;:!?\'"*_~'.includes(last) || (last === ')' && !open))) end--; else break;
          }
          if (end <= i + 3) { i++; continue; }
          push(base + start, base + end, 'link');
          i = end;
          continue;
        }
        // '#': a card mention, with the board in front of it when there is one
        let first = i;
        const floor = Math.max(0, i - BOARD_MAX, lastEnd() - base);
        while (first > floor && BOARD_CHAR_RE.test(s[first - 1])) first--;
        while (first < i && !ALNUM_RE.test(s[first])) first++;
        const re = mentionRegex();
        let found = null;
        for (const at of first === i ? [i] : [first, i]) {
          re.lastIndex = at;
          const m = re.exec(s);
          if (m && m.index === at) { found = m; break; }
        }
        if (!found) { i++; continue; }
        push(base + found.index, base + found.index + found[0].length, 'mention');
        i = found.index + found[0].length;
      }
    }

    const inlineRange = (from, to) => {
      if (to > from) inline(text.slice(from, Math.min(to, from + INLINE_CAP)), from);
    };

    // Plain stretches of [from, to) between the spans out[startIdx..] take `kind`.
    function fillGaps(startIdx, from, to, kind) {
      const inner = out.splice(startIdx);
      let at = from;
      for (const s of inner) {
        push(at, s.from, kind);
        out.push(s);
        at = s.to;
      }
      push(at, to, kind);
    }

    const trimmed = (from, to) => {
      let a = from;
      let b = to;
      while (a < b && isSpace(text[a])) a++;
      while (b > a && isSpace(text[b - 1])) b--;
      return [a, b];
    };

    function tableRow(from, to) {
      const row = text.slice(from, Math.min(to, from + INLINE_CAP));
      let cell = 0;
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '\\') { i++; continue; }
        if (row[i] !== '|') continue;
        inlineRange(from + cell, from + i);
        push(from + i, from + i + 1, 'marker');
        cell = i + 1;
      }
      inlineRange(from + cell, from + row.length);
    }

    const len = text.length;
    let fence = null;
    let table = false;
    let pos = 0;
    while (pos < len) {
      let end = text.indexOf('\n', pos);
      if (end === -1) end = len;
      const head = text.slice(pos, Math.min(end, pos + INLINE_CAP));
      const next = end + 1;

      if (fence) {
        fence.last = end;
        const close = FENCE_RE.exec(head);
        if (close && close[1][0] === fence.mark && close[1].length >= fence.run && head.slice(close[0].length).trim() === '') {
          push(fence.from, end, 'code');
          fence = null;
        }
        pos = next;
        continue;
      }

      const open = FENCE_RE.exec(head);
      const tick = open && open[1][0] === '`' ? text.indexOf('`', pos + open[0].length) : -1; // a backtick fence's own line holds no other backtick
      if (open && (tick === -1 || tick >= end)) {
        fence = { mark: open[1][0], run: open[1].length, from: pos, last: end };
        table = false;
        pos = next;
        continue;
      }

      if (table) {
        if (head.trim() !== '' && head.includes('|') && !HEADING_RE.test(head)) {
          tableRow(pos, end);
          pos = next;
          continue;
        }
        table = false;
      }
      if (head.includes('|') && next < len && !HEADING_RE.test(head) && !HR_RE.test(head)) {
        let nextEnd = text.indexOf('\n', next);
        if (nextEnd === -1) nextEnd = len;
        const under = text.slice(next, Math.min(nextEnd, next + INLINE_CAP));
        if (under.includes('|') && DELIM_RE.test(under)) {
          tableRow(pos, end);
          const [a, b] = trimmed(next, nextEnd);
          push(a, b, 'marker');
          table = true;
          pos = nextEnd + 1;
          continue;
        }
      }

      let at = pos;
      for (let depth = 0; depth < 40; depth++) {
        let q = at;
        while (q < end && (text[q] === ' ' || text[q] === '\t')) q++;
        if (text[q] !== '>' || q >= end) break;
        push(q, q + 1, 'marker');
        at = q + 1;
        if (text[at] === ' ') at++;
      }
      const body = at === pos ? head : text.slice(at, Math.min(end, at + INLINE_CAP));

      if (HEADING_RE.test(body)) {
        const startIdx = out.length;
        inlineRange(at, end);
        fillGaps(startIdx, at, end, 'heading');
      } else if (HR_RE.test(body)) {
        const [a, b] = trimmed(at, end);
        push(a, b, 'marker');
      } else {
        let from = at;
        const item = ITEM_RE.exec(body);
        if (item) {
          const [a] = trimmed(at, at + item[0].length);
          push(a, at + item[0].length, 'marker');
          from = at + item[0].length;
          const task = TASK_RE.exec(text.slice(from, Math.min(end, from + 16)));
          if (task) {
            const [t] = trimmed(from, from + task[0].length);
            push(t, from + task[0].length, 'marker');
            from += task[0].length;
          }
        }
        inlineRange(from, end);
      }
      pos = next;
    }
    if (fence) push(fence.from, fence.last, 'code');
    return out;
  }

  function markdownEditSpans(text) {
    if (typeof text !== 'string' || text === '' || text.length > MAX_CHARS) return [];
    return spansOf(text);
  }

  return { markdownEditSpans, MARKDOWN_EDIT_KINDS: KINDS, MARKDOWN_EDIT_MAX_CHARS: MAX_CHARS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = markdownEditModule;
} else {
  window.markdownEditSpans = markdownEditModule.markdownEditSpans;
  window.MARKDOWN_EDIT_KINDS = markdownEditModule.MARKDOWN_EDIT_KINDS;
  window.MARKDOWN_EDIT_MAX_CHARS = markdownEditModule.MARKDOWN_EDIT_MAX_CHARS;
}

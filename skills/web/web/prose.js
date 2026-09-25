'use strict';
// Pure helpers for the prose the board renders: card mentions, sentence and
// clause boundaries, and the two inline marks a notification may carry. No DOM
// here — loaded as a plain <script> before notifications.js and app.js, and
// required directly by node --test.

// A card mention is one code span opening with `board#id` (CONTEXT.md, Card
// mention); the board token never holds whitespace or '#'.
const MENTION_RE = /^([^\s#`]+)#(\d+)(?:\s|$)/;

function cardMention(codeText) {
  const m = MENTION_RE.exec(String(codeText == null ? '' : codeText));
  return m ? { board: m[1], id: Number(m[2]) } : null;
}

const ABBREVIATION_RE = /^(e\.g|i\.e|vs|etc|cf)$/i;

// Index just past the first sentence: the first '.', '?' or '!' followed by a
// space, outside code spans, double quotes and parentheses, where the word
// before it is neither a lone character nor a common abbreviation. -1 if none.
function firstSentenceEnd(text) {
  const s = String(text == null ? '' : text);
  let code = false, quote = false, depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const ch = s[i];
    if (ch === '`') { code = !code; continue; }
    if (code) continue;
    if (ch === '"') { quote = !quote; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (quote || depth || !'.?!'.includes(ch) || s[i + 1] !== ' ') continue;
    const word = (/(\S+)$/.exec(s.slice(0, i)) || ['', ''])[1];
    if (word.length <= 1 || ABBREVIATION_RE.test(word)) continue;
    return i + 1;
  }
  return -1;
}

// Breaks run-on detail into its clauses at every '; ' outside code spans,
// double quotes and parentheses. Each clause keeps its ';', so the text a
// reader sees is still the text that was written.
function splitClauses(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let code = false, quote = false, depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '`') { code = !code; continue; }
    if (code) continue;
    if (ch === '"') { quote = !quote; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (ch === ';' && s[i + 1] === ' ' && !quote && depth === 0) {
      out.push(s.slice(start, i + 1).trim());
      start = i + 2;
      i++;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

// `code` spans and **bold**, as tokens for a caller that builds DOM nodes with
// textContent. Nothing else is recognised.
function inlineTokens(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    out.push(m[1] != null ? { t: 'code', v: m[1] } : { t: 'strong', v: m[2] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MENTION_RE, cardMention, firstSentenceEnd, splitClauses, inlineTokens };
} else {
  window.cardMention = cardMention;
  window.firstSentenceEnd = firstSentenceEnd;
  window.splitClauses = splitClauses;
  window.inlineTokens = inlineTokens;
}

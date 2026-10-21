'use strict';
// The keys of the page's multiline text boxes (the notes palette's note box and a note's edit box, the
// Scratchpad's box, the card form's description), apart from the DOM: given the text, the selection and
// the key, the edit to make. text-edit-ui.js applies it.
//
// Tab indents by two spaces (the lines a selection spans, or the cursor's place) and Shift+Tab takes up
// to two off; Ctrl+B, Ctrl+I, Ctrl+U, Alt+S and Ctrl+E wrap the selection in **, *, <u>, ~~ and ` and
// unwrap it when it already is; Ctrl+K makes it a link; Ctrl+Shift+7, Ctrl+Shift+8 and Ctrl+Shift+. put
// a number, a bullet or a quote on each selected line, or take it off. They follow VS Code with Markdown
// All in One and GitHub's editor. Cmd does what Ctrl does.
//
// An edit is { from, to, insert, start, end }: replace [from, to) of the text with `insert`, then select
// [start, end] of the result. It is always one replacement, so the page can make it with the browser's
// own editing command and Undo takes it back in one step. An edit whose insert is what it replaces is a
// key the box handled that changed nothing (Shift+Tab on a line with no indent): the browser must still
// not move focus. null is a key that is not the box's.
//
// Pure: Node tests drive it with plain strings. Same dual-environment export pattern as notes.js.

const TEXT_EDIT_INDENT = '  ';
const TEXT_EDIT_LISTS = {
  ol: { has: /^\d+\. /, strip: /^(?:\d+\. |[-*+] )/ },
  ul: { has: /^[-*+] /, strip: /^(?:\d+\. |[-*+] )/ },
  quote: { has: /^> ?/, strip: null },
};

// The lines a selection spans, as [from, to) of the text: from the start of the first to the end of the
// last, and not the last when the selection ends at its very start.
function textEditLines(text, start, end) {
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const from = start === 0 ? 0 : text.lastIndexOf('\n', start - 1) + 1;
  const to = text.indexOf('\n', last);
  return { from, to: to === -1 ? text.length : to };
}

function textEditTab(text, start, end, outdent) {
  if (!outdent && !text.slice(start, end).includes('\n')) {
    return { from: start, to: end, insert: TEXT_EDIT_INDENT, start: start + TEXT_EDIT_INDENT.length, end: start + TEXT_EDIT_INDENT.length };
  }
  const { from, to } = textEditLines(text, start, end);
  let first = 0;
  let total = 0;
  const lines = text.slice(from, to).split('\n').map((line, i) => {
    let delta = 0;
    let out = line;
    if (!outdent) {
      if (line !== '') { out = TEXT_EDIT_INDENT + line; delta = TEXT_EDIT_INDENT.length; }
    } else {
      const indent = /^(?: {1,2}|\t)/.exec(line);
      if (indent) { out = line.slice(indent[0].length); delta = -indent[0].length; }
    }
    if (i === 0) first = delta;
    total += delta;
    return out;
  });
  const newStart = Math.max(from, start + first);
  return { from, to, insert: lines.join('\n'), start: newStart, end: Math.max(newStart, end + total) };
}

const textEditStars = (s, at, step) => {
  let n = 0;
  while (s[at + step * n] === '*') n++;
  return n;
};

// Wrap [start, end) in `open` and `close`, or unwrap it when it is wrapped: by the markers inside the
// selection, or just outside it. With nothing selected the pair goes in with the cursor between, and
// a cursor already between an empty pair takes it away. For the star markers, an odd run of stars is
// italic and a run of two or more is bold, so italic on bold adds one star and takes none away.
function textEditWrap(text, start, end, open, close) {
  const sel = text.slice(start, end);
  const stars = open === '*' || open === '**';
  const want = open.length;
  const insideStars = () => Math.min(textEditStars(sel, 0, 1), textEditStars(sel, sel.length - 1, -1));
  const outsideStars = () => Math.min(textEditStars(text, start - 1, -1), textEditStars(text, end, 1));
  const marked = (k) => (want === 2 ? k >= 2 : k % 2 === 1);
  let inside;
  let outside;
  if (stars) {
    inside = sel.length > 0 && marked(insideStars());
    outside = marked(outsideStars());
  } else {
    inside = sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close);
    outside = text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close && start >= open.length;
  }
  if (inside) {
    const inner = sel.slice(open.length, sel.length - close.length);
    return { from: start, to: end, insert: inner, start, end: start + inner.length };
  }
  if (outside) {
    const from = start - open.length;
    return { from, to: end + close.length, insert: sel, start: from, end: from + sel.length };
  }
  return { from: start, to: end, insert: open + sel + close, start: start + open.length, end: start + open.length + sel.length };
}

function textEditLink(text, start, end) {
  const sel = text.slice(start, end);
  const insert = `[${sel}](url)`;
  if (sel === '') return { from: start, to: end, insert, start: start + 1, end: start + 1 };
  const url = start + sel.length + 3;
  return { from: start, to: end, insert, start: url, end: url + 3 };
}

// A number, a bullet or a quote on each line the selection spans, or off them when each already has it.
// Blank lines are left alone and do not count in the numbering.
function textEditPrefix(text, start, end, kind) {
  const { from, to } = textEditLines(text, start, end);
  const lines = text.slice(from, to).split('\n');
  const rule = TEXT_EDIT_LISTS[kind];
  const filled = lines.filter((l) => l.trim() !== '');
  const off = filled.length > 0 && filled.every((l) => rule.has.test(l));
  let n = 0;
  const out = lines.map((line) => {
    if (line.trim() === '') return line;
    if (off) return line.replace(rule.has, '');
    const bare = rule.strip ? line.replace(rule.strip, '') : line;
    n += 1;
    return (kind === 'ol' ? `${n}. ` : kind === 'ul' ? '- ' : '> ') + bare;
  });
  const insert = out.join('\n');
  return { from, to, insert, start: from, end: from + insert.length };
}

// The edit a key makes in the box, or null when the key is not the box's. `e` is the key event's
// { key, code, shiftKey, ctrlKey, altKey, metaKey }.
function textEditKey(text, start, end, e) {
  if (!e || typeof e.key !== 'string') return null;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Tab') return mod || e.altKey ? null : textEditTab(text, start, end, e.shiftKey);
  if (mod && !e.altKey && !e.shiftKey) {
    if (e.key.toLowerCase() === 'b') return textEditWrap(text, start, end, '**', '**');
    if (e.key.toLowerCase() === 'i') return textEditWrap(text, start, end, '*', '*');
    if (e.key.toLowerCase() === 'u') return textEditWrap(text, start, end, '<u>', '</u>');
    if (e.key.toLowerCase() === 'e') return textEditWrap(text, start, end, '`', '`');
    if (e.key.toLowerCase() === 'k') return textEditLink(text, start, end);
    return null;
  }
  if (mod && !e.altKey && e.shiftKey) {
    if (e.key === '7' || e.key === '&' || e.code === 'Digit7') return textEditPrefix(text, start, end, 'ol');
    if (e.key === '8' || e.key === '*' || e.code === 'Digit8') return textEditPrefix(text, start, end, 'ul');
    if (e.key === '.' || e.key === '>' || e.code === 'Period') return textEditPrefix(text, start, end, 'quote');
    return null;
  }
  if (e.altKey && !mod && !e.shiftKey && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) return textEditWrap(text, start, end, '~~', '~~');
  return null;
}

const TEXT_EDIT_EXPORTS = { textEditKey };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TEXT_EDIT_EXPORTS;
} else {
  Object.assign(window, TEXT_EDIT_EXPORTS);
}

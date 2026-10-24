'use strict';
// The keys of the page's multiline text boxes (the notes palette's note box and a note's edit box, the
// Scratchpad's box, the Todos tab's Edit box, the card form's description), apart from the DOM: given the text, the selection and
// the key, the edit to make. text-edit-ui.js applies it.
//
// Tab indents by two spaces (the lines a selection spans, or the cursor's place) and Shift+Tab takes up
// to two off; Ctrl+B, Ctrl+I, Ctrl+U, Alt+S and Ctrl+E wrap the selection in **, *, <u>, ~~ and ` and
// unwrap it when it already is; Ctrl+K makes it a link; Ctrl+Shift+7, Ctrl+Shift+8 and Ctrl+Shift+. put
// a number, a bullet or a quote on each selected line, or take it off; Ctrl+Shift+D wraps the selected
// lines in a collapsible <details> section, with its summary text selected to be typed over, and takes a
// section it made off again. They follow VS Code with Markdown All in One and GitHub's editor. Cmd does
// what Ctrl does.
//
// An edit is { from, to, insert, start, end }: replace [from, to) of the text with `insert`, then select
// [start, end] of the result. It is always one replacement, so the page can make it with the browser's
// own editing command and Undo takes it back in one step. An edit whose insert is what it replaces is a
// key the box handled that changed nothing (Shift+Tab on a line with no indent): the browser must still
// not move focus. null is a key that is not the box's.
//
// Pure: Node tests drive it with plain strings. Same dual-environment export pattern as notes.js.

const TEXT_EDIT_INDENT = '  ';
const TEXT_EDIT_LIST_MARK = /^(?:\d+\. |[-*+] )/; // the marker of either kind of list, taken off before the other is put on
const TEXT_EDIT_LISTS = {
  ol: { has: /^\d+\. /, strip: TEXT_EDIT_LIST_MARK },
  ul: { has: /^[-*+] /, strip: TEXT_EDIT_LIST_MARK },
  quote: { has: /^> ?/, strip: null },
};

// Every key the box reads besides Tab, by the lower-cased `key`: with which modifiers (`ctrl` is Ctrl or
// Cmd) and what it does. Where the modifier changes the character (Alt+S on a Mac, Shift+7) the key is
// found by its place on the keyboard too (TEXT_EDIT_CODES). The keys of a list kind are the kinds of
// TEXT_EDIT_LISTS.
const TEXT_EDIT_MARKDOWN_KEYS = {
  'b': { mods: 'ctrl', wrap: ['**', '**'] },
  'i': { mods: 'ctrl', wrap: ['*', '*'] },
  'u': { mods: 'ctrl', wrap: ['<u>', '</u>'] },
  'e': { mods: 'ctrl', wrap: ['`', '`'] },
  's': { mods: 'alt', wrap: ['~~', '~~'] },
  'k': { mods: 'ctrl', link: true },
  'd': { mods: 'ctrl+shift', details: true },
  '7': { mods: 'ctrl+shift', list: 'ol' },
  '&': { mods: 'ctrl+shift', list: 'ol' },
  '8': { mods: 'ctrl+shift', list: 'ul' },
  '*': { mods: 'ctrl+shift', list: 'ul' },
  '.': { mods: 'ctrl+shift', list: 'quote' },
  '>': { mods: 'ctrl+shift', list: 'quote' },
};
const TEXT_EDIT_CODES = { KeyS: 's', Digit7: '7', Digit8: '8', Period: '.' };

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

const TEXT_EDIT_SUMMARY = '[...]';
const TEXT_EDIT_DETAILS_HEAD = `<details>\n<summary>${TEXT_EDIT_SUMMARY}</summary>\n\n`;

// The section the key made around the cursor or the selection, if there is one: the line numbers of its
// <details> and </details>. It has the shape the key writes, a <summary> line and a blank line after the
// opening tag and a blank line before the closing one, with at least a line between.
function textEditSectionAround(lines, first, last) {
  let open = -1;
  for (let k = first; k >= 0; k--) {
    if (lines[k] === '</details>' && k !== first) return null;
    if (lines[k] === '<details>') { open = k; break; }
  }
  if (open === -1) return null;
  let close = -1;
  for (let k = last; k < lines.length; k++) {
    if (lines[k] === '<details>' && k !== open) return null;
    if (lines[k] === '</details>') { close = k; break; }
  }
  if (close === -1) return null;
  const shaped = /^<summary>.*<\/summary>$/.test(lines[open + 1] || '') && lines[open + 2] === '' && lines[close - 1] === '' && close - 1 > open + 2;
  return shaped ? { open, close } : null;
}

function textEditDetails(text, start, end) {
  const lines = text.split('\n');
  const offsets = [];
  let at = 0;
  for (const line of lines) { offsets.push(at); at += line.length + 1; }
  const lineOf = (pos) => { let k = 0; while (k + 1 < offsets.length && offsets[k + 1] <= pos) k++; return k; };
  const span = textEditLines(text, start, end);
  const first = lineOf(span.from);
  const last = lineOf(span.to);
  const section = textEditSectionAround(lines, first, last);
  if (section) {
    const from = offsets[section.open];
    const to = offsets[section.close] + lines[section.close].length;
    const body = lines.slice(section.open + 3, section.close - 1).join('\n');
    return { from, to, insert: body, start: from, end: from + body.length };
  }
  const selected = start < end;
  const body = selected ? text.slice(span.from, span.to) : '';
  const from = selected ? span.from : start;
  const to = selected ? span.to : end;
  const before = !selected && from > 0 && text[from - 1] !== '\n' ? '\n' : '';
  const after = !selected && to < text.length && text[to] !== '\n' ? '\n' : '';
  const insert = `${before}${TEXT_EDIT_DETAILS_HEAD}${body}\n\n</details>${after}`;
  const summary = from + before.length + '<details>\n<summary>'.length;
  return { from, to, insert, start: summary, end: summary + TEXT_EDIT_SUMMARY.length };
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
  const own = (k) => Object.prototype.hasOwnProperty.call(TEXT_EDIT_MARKDOWN_KEYS, k);
  const key = own(e.key.toLowerCase()) ? e.key.toLowerCase() : TEXT_EDIT_CODES[e.code];
  if (!key || !own(key)) return null;
  const entry = TEXT_EDIT_MARKDOWN_KEYS[key];
  const held = { ctrl: mod && !e.altKey && !e.shiftKey, alt: e.altKey && !mod && !e.shiftKey, 'ctrl+shift': mod && !e.altKey && e.shiftKey };
  if (!held[entry.mods]) return null;
  if (entry.wrap) return textEditWrap(text, start, end, entry.wrap[0], entry.wrap[1]);
  if (entry.link) return textEditLink(text, start, end);
  if (entry.details) return textEditDetails(text, start, end);
  return textEditPrefix(text, start, end, entry.list);
}

const TEXT_EDIT_EXPORTS = { textEditKey, TEXT_EDIT_LISTS, TEXT_EDIT_MARKDOWN_KEYS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TEXT_EDIT_EXPORTS;
} else {
  Object.assign(window, TEXT_EDIT_EXPORTS);
}

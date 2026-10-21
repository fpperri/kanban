'use strict';
// The one Markdown renderer: card bodies, notes and scratchpad previews all draw through it, and
// the snapshot embeds this same file and builds DOM nodes from its parse. Hand-rolled, no
// dependency. Headings, ordered and unordered lists (nested, mixed, with `- [x]` task items and
// lazy continuation lines), block quotes, fenced code (``` or ~~~, any longer run, a language
// label and a Copy button when typed), pipe tables, rules, bold, italic, strike, inline code, links
// and bare https addresses, hard line breaks. No DOM here: loaded as a plain <script> and required
// directly by node --test.
//
// Two steps. parseMarkdown(text) reads the RAW text into a tree of blocks whose text-bearing
// parts carry inline tokens; mdToHtml(text, { board }) draws that tree as an HTML string. The
// renderer escapes every piece of text and every attribute value as it writes them, and nothing
// else reaches the string: the body never holds a live tag. A link keeps its address only for a
// safe scheme, alignment and the code block's chrome ride classes (the CSP has no unsafe-inline
// for styles), and the language of a fence is cut to a safe alphabet before it is written.

const MD_NODE = typeof module !== 'undefined' && module.exports;
const mdEscape = (s) => (MD_NODE ? require('./assignee-badge').escapeHtml : window.escapeHtml)(s);
const mdMention = (s) => (MD_NODE ? require('./prose').cardMention : window.cardMention)(s);

// A delimiter row is pipe-separated cells of dashes, each optionally colon-anchored
// on either end for alignment. This is the whole test for "is the line above a
// table header".
const TABLE_DELIM_RE = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$|^\s*\|\s*:?-{3,}:?\s*\|\s*$/;

// Split one pipe row into trimmed cells: drop the optional outer pipes, split on
// pipes the author did not escape, then unescape the ones they did.
function splitRow(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

// The language of a fence: the first word of its info string, cut to letters, digits and the few
// marks a language name carries (c#, c++, objective-c, a.b_c). Empty when nothing is left.
function codeLang(info) {
  const word = String(info == null ? '' : info).trim().split(/\s+/)[0] || '';
  return word.replace(/[^A-Za-z0-9_+#.-]/g, '');
}

const SAFE_HREF_RE = /^(https?:|mailto:|#|\/)/i;
const safeHref = (url) => (SAFE_HREF_RE.test(url.trim()) ? url : '#');

const isAlnum = (c) => c !== undefined && /[A-Za-z0-9]/.test(c);
const isSpace = (c) => c === undefined || /\s/.test(c);

// The index just past the backtick run that closes a span opened by a run of n, or -1.
function codeSpanEnd(s, from, n) {
  let j = from;
  while (j < s.length) {
    if (s[j] !== '`') { j++; continue; }
    let r = 0;
    while (s[j + r] === '`') r++;
    if (r === n) return j + r;
    j += r;
  }
  return -1;
}

// Where the mark opened by a run of k `ch` at i closes, as the index of the closing run, or -1.
// Code spans are skipped; runs of another length inside are nested marks and are skipped whole.
function emphasisClose(s, i, k, ch) {
  let j = i + k;
  while (j < s.length) {
    if (s[j] === '`') {
      let r = 0;
      while (s[j + r] === '`') r++;
      const end = codeSpanEnd(s, j + r, r);
      j = end === -1 ? j + r : end;
      continue;
    }
    if (s[j] === ch) {
      let r = 0;
      while (s[j + r] === ch) r++;
      const after = s[j + r];
      if (r === k && !isSpace(s[j - 1]) && !(ch === '_' && isAlnum(after))) return j;
      j += r;
      continue;
    }
    j++;
  }
  return -1;
}

// The index of the `</u>` that closes an underline opened before `from`, on the same line, or -1.
// A code span in between is skipped, so a `</u>` shown as code does not close it.
function underlineClose(s, from) {
  let j = from;
  while (j < s.length && s[j] !== '\n') {
    if (s[j] === '`') {
      let r = 0;
      while (s[j + r] === '`') r++;
      const end = codeSpanEnd(s, j + r, r);
      j = end === -1 ? j + r : end;
    } else if (s.startsWith('</u>', j)) return j;
    else j++;
  }
  return -1;
}

const AUTOLINK_RE = /^https?:\/\/[^\s<>`]+/i;

// A bare address minus the punctuation a sentence puts after it; a closing bracket stays only
// when the address opened it.
function trimAddress(url) {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,:;!?'"*_~\]]/.test(last)) u = u.slice(0, -1);
    else if (last === ')' && u.split('(').length < u.split(')').length) u = u.slice(0, -1);
    else return u;
  }
}

// Inline marks over raw text, left to right: a mark opens only where its closing partner exists, so
// an unmatched marker is plain text. Tokens: text, code, strong, em, del, u, link (kids), br.
// Underline is the one tag let through: `<u>` and `</u>` exactly, as a pair on one line.
// `noLinks` is set inside link text, where another link cannot sit.
function parseInline(text, ctx) {
  const s = String(text == null ? '' : text);
  const noLinks = !!(ctx && ctx.noLinks);
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      const hard = /( {2,}|\\)$/.exec(buf);
      if (hard) { buf = buf.slice(0, hard.index); flush(); out.push({ t: 'br' }); }
      else buf = buf.replace(/ +$/, '') + ' ';
      i++;
      continue;
    }
    if (c === '`') {
      let n = 0;
      while (s[i + n] === '`') n++;
      const end = codeSpanEnd(s, i + n, n);
      if (end === -1) { buf += s.slice(i, i + n); i += n; continue; }
      let code = s.slice(i + n, end - n).replace(/\n/g, ' ');
      if (n > 1 && code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      flush();
      out.push({ t: 'code', v: code });
      i = end;
      continue;
    }
    if (c === '<' && s.startsWith('<u>', i)) {
      const close = underlineClose(s, i + 3);
      if (close > i + 3) {
        flush();
        out.push({ t: 'u', kids: parseInline(s.slice(i + 3, close), ctx) });
        i = close + 4;
        continue;
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      let k = 0;
      while (s[i + k] === c) k++;
      const valid = c === '~' ? k === 2 : k <= 3;
      const opens = valid && !isSpace(s[i + k]) && !(c === '_' && (isAlnum(s[i - 1]) || s[i - 1] === '_'));
      const close = opens ? emphasisClose(s, i, k, c) : -1;
      if (close === -1) { buf += s.slice(i, i + k); i += k; continue; }
      const kids = parseInline(s.slice(i + k, close), ctx);
      flush();
      if (c === '~') out.push({ t: 'del', kids });
      else if (k === 1) out.push({ t: 'em', kids });
      else if (k === 2) out.push({ t: 'strong', kids });
      else out.push({ t: 'em', kids: [{ t: 'strong', kids }] });
      i = close + k;
      continue;
    }
    if (c === '[' && !noLinks) {
      let bc = i + 1;
      while (bc < s.length && s[bc] !== ']') {
        if (s[bc] === '`') {
          let r = 0;
          while (s[bc + r] === '`') r++;
          const end = codeSpanEnd(s, bc + r, r);
          bc = end === -1 ? bc + r : end;
        } else bc++;
      }
      if (s[bc] === ']' && s[bc + 1] === '(') {
        const pc = s.indexOf(')', bc + 2);
        const url = pc === -1 ? '' : s.slice(bc + 2, pc);
        if (url && !/[`\n]/.test(url)) {
          flush();
          out.push({ t: 'link', href: safeHref(url), kids: parseInline(s.slice(i + 1, bc), { noLinks: true }) });
          i = pc + 1;
          continue;
        }
      }
    }
    if (c === 'h' && !noLinks && !isAlnum(s[i - 1])) {
      const m = AUTOLINK_RE.exec(s.slice(i));
      const url = m ? trimAddress(m[0]) : '';
      if (url.length > url.indexOf('//') + 2) {
        flush();
        out.push({ t: 'link', href: url, kids: [{ t: 'text', v: url }] });
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const FENCE_OPEN_RE = /^\s*(?:(`{3,})([^`]*)|(~{3,})(.*))$/;
const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK_RE = /^\[( |x|X)\]\s+(.*)$/;

// Block structure over raw lines: a flat list of blocks, each
//   { t: 'h', level, inline } { t: 'p', inline } { t: 'hr' } { t: 'pre', code, lang }
//   { t: 'quote', blocks } { t: 'table', head, aligns, rows }
//   { t: 'list', ordered, start, items: [{ task, inline, children: [list blocks] }] }
// A list nests by the indent width that opened each level; a blank line ends it.
function parseBlocks(lines) {
  const blocks = [];
  let para = [];
  let stack = []; // open list levels, deepest last: { indent, ordered, list }
  const flushPara = () => {
    if (para.length) { blocks.push({ t: 'p', inline: parseInline(para.join('\n')) }); para = []; }
  };
  const closeList = () => { stack = []; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE_OPEN_RE.exec(line);
    if (fence) {
      flushPara();
      closeList();
      const run = fence[1] || fence[3];
      const closeRe = new RegExp(`^\\s*${run[0]}{${run.length},}\\s*$`);
      const code = [];
      i++;
      let closed = false;
      for (; i < lines.length; i++) {
        if (closeRe.test(lines[i])) { closed = true; break; }
        code.push(lines[i]);
      }
      if (closed || code.length) blocks.push({ t: 'pre', code: code.join('\n'), lang: codeLang(fence[2] !== undefined ? fence[2] : fence[4]) });
      continue;
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flushPara(); closeList(); blocks.push({ t: 'hr' }); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); blocks.push({ t: 'h', level: h[1].length, inline: parseInline(h[2]) }); continue; }

    if (/^\s*>/.test(line)) {
      flushPara();
      closeList();
      const inner = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) inner.push(lines[i].replace(/^\s*> ?/, ''));
      i--;
      blocks.push({ t: 'quote', blocks: parseBlocks(inner) });
      continue;
    }

    // A table is a header row, a delimiter row, then body rows, all pipe-delimited. The delimiter
    // row is what makes it a table: without one underneath, a line of pipes stays ordinary prose,
    // so a sentence that happens to contain a `|` is never swallowed.
    if (line.trim().startsWith('|') && TABLE_DELIM_RE.test(lines[i + 1] || '')) {
      flushPara();
      closeList();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':'), r = c.endsWith(':');
        return r && l ? 'center' : r ? 'right' : l ? 'left' : '';
      });
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        // GFM: a ragged row is padded or truncated to the header's width rather
        // than skewing every column after it.
        while (cells.length < head.length) cells.push('');
        cells.length = head.length;
        rows.push(cells.map((c) => parseInline(c)));
        i++;
      }
      i--; // the loop's own i++ consumes the line that ended the table
      blocks.push({ t: 'table', head: head.map((c) => parseInline(c)), aligns, rows });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const number = !bullet && ORDERED_RE.exec(line);
    // Only a 1 starts a list in the middle of a paragraph, so "in\n2026. a year" stays prose.
    if (bullet || (number && (!para.length || number[2] === '1'))) {
      flushPara();
      const m = bullet || number;
      const ordered = !bullet;
      const indent = m[1].length;
      while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
      if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].ordered !== ordered) stack.pop();
      let frame = stack[stack.length - 1];
      if (!frame || frame.indent !== indent) {
        const list = { t: 'list', ordered, start: ordered ? Number(m[2]) : null, items: [] };
        if (frame) {
          const parent = frame.list.items[frame.list.items.length - 1];
          (parent.children = parent.children || []).push(list);
        } else blocks.push(list);
        frame = { indent, ordered, list };
        stack.push(frame);
      }
      const task = TASK_RE.exec(m[3]);
      frame.list.items.push({ task: task ? (task[1] === ' ' ? 'open' : 'done') : null, text: task ? task[2] : m[3] });
      continue;
    }

    if (line.trim() === '') { flushPara(); closeList(); continue; }

    if (stack.length) {
      // A wrapped non-marker line while a list is open is a continuation of the last
      // item, not a new paragraph: it joins in place rather than closing the list.
      const items = stack[stack.length - 1].list.items;
      items[items.length - 1].text += '\n' + line.replace(/^\s+/, '');
      continue;
    }
    para.push(line);
  }
  flushPara();
  finishItems(blocks);
  return blocks;
}

// Items gathered their text raw so a continuation line could join it; this reads each one's marks.
function finishItems(blocks) {
  for (const b of blocks) {
    if (b.t !== 'list') continue;
    for (const it of b.items) {
      it.inline = parseInline(it.text);
      delete it.text;
      if (it.children) finishItems(it.children);
    }
  }
}

function parseMarkdown(md) {
  return parseBlocks(String(md == null ? '' : md).split('\n').map((l) => l.replace(/\r$/, '')));
}

// --- the HTML string -------------------------------------------------------------------

// A code span holding a card mention renders as a chip; one on this board carries its id so a click
// opens it.
function codeHtml(v, board) {
  const m = mdMention(v);
  const text = mdEscape(v);
  if (!m) return `<code>${text}</code>`;
  return m.board === board
    ? `<code class="mention same" data-card-id="${mdEscape(m.id)}" tabindex="0" role="link">${text}</code>`
    : `<code class="mention">${text}</code>`;
}

function inlineHtml(tokens, board) {
  return tokens.map((t) => {
    if (t.t === 'text') return mdEscape(t.v);
    if (t.t === 'code') return codeHtml(t.v, board);
    if (t.t === 'br') return '<br>';
    const inner = inlineHtml(t.kids, board);
    if (t.t === 'strong') return `<strong>${inner}</strong>`;
    if (t.t === 'em') return `<em>${inner}</em>`;
    if (t.t === 'del') return `<del>${inner}</del>`;
    if (t.t === 'u') return `<u>${inner}</u>`;
    return `<a href="${mdEscape(t.href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
  }).join('');
}

function preHtml(b) {
  if (!b.lang) return `<pre><code>${mdEscape(b.code)}</code></pre>`;
  const lang = mdEscape(b.lang);
  return `<div class="md-code"><div class="md-code-bar"><span class="md-code-lang">${lang}</span>`
    + `<button type="button" class="md-code-copy" aria-label="Copy ${lang} code">Copy</button></div>`
    + `<pre data-lang="${lang}"><code>${mdEscape(b.code)}</code></pre></div>`;
}

function listHtml(list, board) {
  const tag = list.ordered ? 'ol' : 'ul';
  const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : '';
  const items = list.items.map((it) => {
    const nested = (it.children || []).map((c) => listHtml(c, board)).join('');
    const text = inlineHtml(it.inline, board);
    if (!it.task) return `<li>${text}${nested}</li>`;
    const done = it.task === 'done';
    return `<li class="task ${it.task}"><span class="tick">${done ? '&#9745;' : '&#9744;'}</span> ${text}${nested}</li>`;
  }).join('');
  return `<${tag}${start}>${items}</${tag}>`;
}

function tableHtml(b, board) {
  // Alignment rides a class, never an inline style attribute: the app's CSP
  // carries no unsafe-inline for styles, so such an attribute would be dropped
  // by the browser and the column would silently ignore its colons.
  const cell = (tag, tokens, n) => {
    const a = b.aligns[n] ? ` class="ta-${b.aligns[n]}"` : '';
    return `<${tag}${a}>${inlineHtml(tokens, board)}</${tag}>`;
  };
  const header = `<tr>${b.head.map((c, n) => cell('th', c, n)).join('')}</tr>`;
  const body = b.rows.map((r) => `<tr>${r.map((c, n) => cell('td', c, n)).join('')}</tr>`).join('');
  // Wrapped in its own scroller: a wide table scrolls inside the popup
  // instead of making the whole popup scroll sideways.
  return `<div class="md-table"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
}

function blocksHtml(blocks, board) {
  return blocks.map((b) => {
    if (b.t === 'h') return `<h${b.level}>${inlineHtml(b.inline, board)}</h${b.level}>`;
    if (b.t === 'p') return `<p>${inlineHtml(b.inline, board)}</p>`;
    if (b.t === 'hr') return '<hr>';
    if (b.t === 'pre') return preHtml(b);
    if (b.t === 'quote') return `<blockquote>${blocksHtml(b.blocks, board)}</blockquote>`;
    if (b.t === 'list') return listHtml(b, board);
    return tableHtml(b, board);
  }).join('');
}

// opts.board is the board's own name: a mention of a card on it opens the card.
function mdToHtml(md, opts) {
  return blocksHtml(parseMarkdown(md), opts && opts.board);
}

const markdownModule = { parseMarkdown, parseInline, mdToHtml, codeLang, splitRow, TABLE_DELIM_RE };

if (MD_NODE) {
  module.exports = markdownModule;
} else {
  window.kanbanMarkdown = markdownModule;
  window.mdToHtml = mdToHtml;
}

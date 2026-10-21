'use strict';
// The one Markdown renderer: card bodies and scratchpad previews draw through it (the notes list
// will), and the snapshot embeds this same file and builds DOM nodes from its parse. Hand-rolled, no
// dependency. Headings, ordered and unordered lists (nested, mixed, loose, with `- [x]` task items
// and lazy continuation lines), block quotes, fenced code (``` or ~~~, any longer run, a language
// label and a Copy button when typed), pipe tables, rules, collapsible <details> sections, bold,
// italic, strike, underline, inline code, links and bare https addresses, hard line breaks. No DOM
// here: loaded as a plain <script> and required directly by node --test.
//
// Two steps. parseMarkdown(text) reads the RAW text into a tree of blocks whose text-bearing
// parts carry inline tokens; mdToHtml(text, { board }) draws that tree as an HTML string. The
// renderer escapes every piece of text and every attribute value as it writes them, and nothing
// else reaches the string: the body never holds a live tag. A link keeps its address only for a
// safe scheme, alignment and the code block's chrome ride classes (the CSP has no unsafe-inline
// for styles), and the language of a fence is cut to a safe alphabet before it is written.
//
// A body is untrusted and can be large, so nothing here may take longer than a pass or two over it
// or recurse without end. Each scan for a closing mark remembers where one failed, since an opener
// after that point fails too; quotes, sections and inline marks nest only so deep, the rest staying
// text.

const markdownModule = (() => {
  const MD_NODE = typeof module !== 'undefined' && module.exports;
  const mdEscape = (s) => (MD_NODE ? require('./assignee-badge').escapeHtml : window.escapeHtml)(s);
  const mdMention = (s) => (MD_NODE ? require('./prose').cardMention : window.cardMention)(s);

  const MAX_BLOCK_DEPTH = 12;
  const MAX_INLINE_DEPTH = 16;

  // A delimiter row is pipe-separated cells of one or more dashes, each optionally colon-anchored
  // on either end for alignment, and holds a pipe. This is the whole test for "is the line above a
  // table header".
  const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const isTableDelimiter = (line) => line.includes('|') && TABLE_DELIM_RE.test(line);

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

  // What the scans over one string have learnt: a scan that fails for an opener at `from` fails for
  // every later opener of its kind, so the earliest failure is all that is kept.
  const newScan = () => ({ code: new Map(), em: new Map(), bracketFail: Infinity, bracketHit: null, parenFail: Infinity, link: null, uFrom: Infinity, uTo: -1 });
  const failedAt = (map, key, from) => { const f = map.get(key); if (f === undefined || from < f) map.set(key, from); };

  // The index just past the backtick run that closes a span opened by a run of n, or -1.
  function codeSpanEnd(s, from, n, scan) {
    const f = scan.code.get(n);
    if (f !== undefined && from >= f) return -1;
    let j = from;
    while (j < s.length) {
      if (s[j] !== '`') { j++; continue; }
      let r = 0;
      while (s[j + r] === '`') r++;
      if (r === n) return j + r;
      j += r;
    }
    failedAt(scan.code, n, from);
    return -1;
  }

  // The index past the backtick run at j when it is a code span, else past the run itself.
  function skipCode(s, j, scan) {
    let r = 0;
    while (s[j + r] === '`') r++;
    const end = codeSpanEnd(s, j + r, r, scan);
    return end === -1 ? j + r : end;
  }

  // Where the mark opened by a run of k `ch` at i closes, as the index of the closing run, or -1.
  // Code spans are skipped; runs of another length inside are nested marks and are skipped whole.
  function emphasisClose(s, i, k, ch, scan) {
    const key = ch + k;
    const f = scan.em.get(key);
    if (f !== undefined && i >= f) return -1;
    let j = i + k;
    while (j < s.length) {
      if (s[j] === '`') { j = skipCode(s, j, scan); continue; }
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
    failedAt(scan.em, key, i);
    return -1;
  }

  // The index of the `</u>` that closes an underline opened before `from`, on the same line, or -1.
  // A code span in between is skipped, so a `</u>` shown as code does not close it.
  function underlineClose(s, from, scan) {
    if (from >= scan.uFrom && from < scan.uTo) return -1;
    let j = from;
    while (j < s.length && s[j] !== '\n') {
      if (s[j] === '`') j = skipCode(s, j, scan);
      else if (s.startsWith('</u>', j)) return j;
      else j++;
    }
    scan.uFrom = from;
    scan.uTo = j;
    return -1;
  }

  // The `]` that closes the bracket opened at i, skipping code spans, or -1.
  function bracketClose(s, i, scan) {
    if (i >= scan.bracketFail) return -1;
    const hit = scan.bracketHit;
    if (hit && i > hit.from && i < hit.bc) return hit.bc;
    let bc = i + 1;
    while (bc < s.length && s[bc] !== ']') bc = s[bc] === '`' ? skipCode(s, bc, scan) : bc + 1;
    if (s[bc] !== ']') { scan.bracketFail = Math.min(scan.bracketFail, i); return -1; }
    scan.bracketHit = { from: i, bc };
    return bc;
  }

  // The address of a `[text](address)` whose text closes at bc, or null when it is not one.
  function linkAddress(s, bc, scan) {
    if (scan.link && scan.link.bc === bc) return scan.link.address;
    let address = null;
    if (s[bc + 1] === '(' && bc + 2 < scan.parenFail) {
      const pc = s.indexOf(')', bc + 2);
      if (pc === -1) scan.parenFail = Math.min(scan.parenFail, bc + 2);
      else {
        const url = s.slice(bc + 2, pc);
        if (url && !/[`\n]/.test(url)) address = { url, end: pc + 1 };
      }
    }
    scan.link = { bc, address };
    return address;
  }

  const AUTOLINK_RE = /https?:\/\/[^\s<>`]+/iy;

  // A bare address minus the punctuation a sentence puts after it; a closing bracket stays only
  // when the address opened it.
  function trimAddress(url) {
    let end = url.length;
    let open = 0;
    let close = 0;
    for (let n = 0; n < end; n++) { if (url[n] === '(') open++; else if (url[n] === ')') close++; }
    while (end > 0) {
      const last = url[end - 1];
      if (/[.,:;!?'"*_~\]]/.test(last)) end--;
      else if (last === ')' && open < close) { end--; close--; }
      else break;
    }
    return url.slice(0, end);
  }

  // Inline marks over raw text, left to right: a mark opens only where its closing partner exists, so
  // an unmatched marker is plain text. Tokens: text, code, strong, em, del, u, link (kids), br.
  // Underline is the one tag let through: `<u>` and `</u>` exactly, as a pair on one line.
  // ctx.noLinks is set inside link text, where another link cannot sit; ctx.depth counts the marks
  // nested so far, and past MAX_INLINE_DEPTH what is left is plain text.
  function parseInline(text, ctx) {
    const s = String(text == null ? '' : text);
    const depth = (ctx && ctx.depth) || 0;
    if (depth >= MAX_INLINE_DEPTH) return s ? [{ t: 'text', v: s }] : [];
    const noLinks = !!(ctx && ctx.noLinks);
    const inner = { noLinks, depth: depth + 1 };
    const scan = newScan();
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\n') {
        let end = buf.length;
        while (end > 0 && buf[end - 1] === ' ') end--;
        if (buf[buf.length - 1] === '\\') { buf = buf.slice(0, -1); flush(); out.push({ t: 'br' }); }
        else if (buf.length - end >= 2) { buf = buf.slice(0, end); flush(); out.push({ t: 'br' }); }
        else buf = buf.slice(0, end) + ' ';
        i++;
        continue;
      }
      if (c === '`') {
        let n = 0;
        while (s[i + n] === '`') n++;
        const end = codeSpanEnd(s, i + n, n, scan);
        if (end === -1) { buf += s.slice(i, i + n); i += n; continue; }
        let code = s.slice(i + n, end - n).replace(/\n/g, ' ');
        if (n > 1 && code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        flush();
        out.push({ t: 'code', v: code });
        i = end;
        continue;
      }
      if (c === '<' && s.startsWith('<u>', i)) {
        const close = underlineClose(s, i + 3, scan);
        if (close > i + 3) {
          flush();
          out.push({ t: 'u', kids: parseInline(s.slice(i + 3, close), inner) });
          i = close + 4;
          continue;
        }
      }
      if (c === '*' || c === '_' || c === '~') {
        let k = 0;
        while (s[i + k] === c) k++;
        const valid = c === '~' ? k === 2 : k <= 3;
        const opens = valid && !isSpace(s[i + k]) && !(c === '_' && (isAlnum(s[i - 1]) || s[i - 1] === '_'));
        const close = opens ? emphasisClose(s, i, k, c, scan) : -1;
        if (close === -1) { buf += s.slice(i, i + k); i += k; continue; }
        const kids = parseInline(s.slice(i + k, close), inner);
        flush();
        if (c === '~') out.push({ t: 'del', kids });
        else if (k === 1) out.push({ t: 'em', kids });
        else if (k === 2) out.push({ t: 'strong', kids });
        else out.push({ t: 'em', kids: [{ t: 'strong', kids }] });
        i = close + k;
        continue;
      }
      if (c === '[' && !noLinks) {
        const bc = bracketClose(s, i, scan);
        const address = bc === -1 ? null : linkAddress(s, bc, scan);
        if (address) {
          flush();
          out.push({ t: 'link', href: safeHref(address.url), kids: parseInline(s.slice(i + 1, bc), { noLinks: true, depth: depth + 1 }) });
          i = address.end;
          continue;
        }
      }
      if (c === 'h' && !noLinks && !isAlnum(s[i - 1])) {
        AUTOLINK_RE.lastIndex = i;
        const m = AUTOLINK_RE.exec(s);
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
  const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
  const HEADING_RE = /^(#{1,6})\s+(.*)$/;
  const DETAILS_OPEN_RE = /^\s*<details( open)?>\s*$/;
  const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/;
  const SUMMARY_RE = /^\s*<summary>(.*)<\/summary>\s*$/;

  // The pattern that closes the fence a FENCE_OPEN_RE match opened: a run of the same mark at least as long.
  const closers = new Map();
  function fenceCloser(fence) {
    const run = fence[1] || fence[3];
    const key = run[0] + run.length;
    if (!closers.has(key)) closers.set(key, new RegExp(`^\\s*${run[0]}{${run.length},}\\s*$`));
    return closers.get(key);
  }

  // Which line closes the section opened at each <details> line, as a map, in one pass: a </details>
  // closes the nearest section still open, fenced code is skipped (a </details> there is only text),
  // and an opener nothing closes is left out.
  function detailsMatches(lines) {
    const match = new Map();
    const open = [];
    for (let j = 0; j < lines.length; j++) {
      const fence = FENCE_OPEN_RE.exec(lines[j]);
      if (fence) {
        const closer = fenceCloser(fence);
        j++;
        while (j < lines.length && !closer.test(lines[j])) j++;
      } else if (DETAILS_OPEN_RE.test(lines[j])) open.push(j);
      else if (DETAILS_CLOSE_RE.test(lines[j]) && open.length) match.set(open.pop(), j);
    }
    return match;
  }

  const startsBlock = (line) => FENCE_OPEN_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line) || BULLET_RE.test(line)
    || ORDERED_RE.test(line) || DETAILS_OPEN_RE.test(line) || DETAILS_CLOSE_RE.test(line);

  // Whether a quoted line, as the quote sees it, is the kind a following unquoted line can lazily continue.
  const continuesParagraph = (line) => line.trim() !== '' && !HR_RE.test(line) && !HEADING_RE.test(line) && !FENCE_OPEN_RE.test(line)
    && !DETAILS_OPEN_RE.test(line) && !DETAILS_CLOSE_RE.test(line) && !isTableDelimiter(line);

  // Block structure over raw lines: a flat list of blocks, each
  //   { t: 'h', level, inline } { t: 'p', inline } { t: 'hr' } { t: 'pre', code, lang }
  //   { t: 'quote', blocks } { t: 'details', open, summary, blocks } { t: 'table', head, aligns, rows }
  //   { t: 'list', ordered, start, loose, items: [{ task, inline, children: [list blocks] }] }
  // A list nests by the indent width that opened each level; a blank line ends it unless an item of
  // the same list follows, which makes the list loose.
  function parseBlocks(lines, depth) {
    const blocks = [];
    let para = [];
    let stack = []; // open list levels, deepest last: { indent, ordered, list }
    let blankBefore = false;
    let sections = null;
    const flushPara = () => {
      if (para.length) { blocks.push({ t: 'p', inline: parseInline(para.join('\n')) }); para = []; }
    };
    const closeList = () => { stack = []; blankBefore = false; };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const fence = FENCE_OPEN_RE.exec(line);
      if (fence) {
        flushPara();
        closeList();
        const closer = fenceCloser(fence);
        const code = [];
        i++;
        let closed = false;
        for (; i < lines.length; i++) {
          if (closer.test(lines[i])) { closed = true; break; }
          code.push(lines[i]);
        }
        if (closed || code.length) blocks.push({ t: 'pre', code: code.join('\n'), lang: codeLang(fence[2] !== undefined ? fence[2] : fence[4]) });
        continue;
      }

      const section = depth < MAX_BLOCK_DEPTH ? DETAILS_OPEN_RE.exec(line) : null;
      if (section) {
        sections = sections || detailsMatches(lines);
        const sectionEnd = sections.has(i) ? sections.get(i) : -1;
        if (sectionEnd !== -1) {
          flushPara();
          closeList();
          const inner = lines.slice(i + 1, sectionEnd);
          const first = inner.findIndex((l) => l.trim() !== '');
          const title = first === -1 ? null : SUMMARY_RE.exec(inner[first]);
          if (title) inner.splice(0, first + 1);
          const heading = title && title[1].trim() ? parseInline(title[1].trim()) : [{ t: 'text', v: '[...]' }];
          blocks.push({ t: 'details', open: !!section[1], summary: heading, blocks: parseBlocks(inner, depth + 1) });
          i = sectionEnd;
          continue;
        }
      }

      if (HR_RE.test(line)) { flushPara(); closeList(); blocks.push({ t: 'hr' }); continue; }

      const h = HEADING_RE.exec(line);
      if (h) { flushPara(); closeList(); blocks.push({ t: 'h', level: h[1].length, inline: parseInline(h[2]) }); continue; }

      if (depth < MAX_BLOCK_DEPTH && /^\s*>/.test(line)) {
        flushPara();
        closeList();
        const inner = [];
        let openFence = null;
        const take = (text) => {
          if (openFence) { if (openFence.test(text)) openFence = null; } else {
            const f = FENCE_OPEN_RE.exec(text);
            if (f) openFence = fenceCloser(f);
          }
          inner.push(text);
        };
        for (; i < lines.length && /^\s*>/.test(lines[i]); i++) take(lines[i].replace(/^\s*> ?/, ''));
        // A line with no > after a paragraph line of the quote continues that paragraph.
        while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i]) && !openFence && continuesParagraph(inner[inner.length - 1])) take(lines[i++]);
        i--;
        blocks.push({ t: 'quote', blocks: parseBlocks(inner, depth + 1) });
        continue;
      }

      // A table is a header row, a delimiter row, then body rows, all pipe-delimited. The delimiter
      // row is what makes it a table: without one underneath, a line of pipes stays ordinary prose,
      // so a sentence that happens to contain a `|` is never swallowed.
      if (line.trim().startsWith('|') && isTableDelimiter(lines[i + 1] || '')) {
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
          const list = { t: 'list', ordered, start: ordered ? Number(m[2]) : null, loose: false, items: [] };
          if (frame) {
            const parent = frame.list.items[frame.list.items.length - 1];
            (parent.children = parent.children || []).push(list);
          } else blocks.push(list);
          frame = { indent, ordered, list };
          stack.push(frame);
        } else if (blankBefore) frame.list.loose = true;
        blankBefore = false;
        const task = TASK_RE.exec(m[3]);
        frame.list.items.push({ task: task ? (task[1] === ' ' ? 'open' : 'done') : null, text: task ? task[2] : m[3] });
        continue;
      }

      if (line.trim() === '') {
        flushPara();
        if (stack.length) {
          // The blank run, then what follows it: an item of this list keeps the list open (loose).
          let j = i + 1;
          while (j < lines.length && lines[j].trim() === '') j++;
          const next = j < lines.length && !HR_RE.test(lines[j]) ? (BULLET_RE.exec(lines[j]) || ORDERED_RE.exec(lines[j])) : null;
          if (next && next[1].length >= stack[0].indent) { blankBefore = true; i = j - 1; continue; }
        }
        closeList();
        continue;
      }

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
    return parseBlocks(String(md == null ? '' : md).split('\n').map((l) => l.replace(/\r$/, '')), 0);
  }

  // --- the HTML string -------------------------------------------------------------------

  // What a node of a kind the renderer does not know draws as: its text, escaped, or nothing.
  function unknownHtml(node) {
    const text = typeof node.v === 'string' ? node.v : typeof node.text === 'string' ? node.text : '';
    return mdEscape(text);
  }

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

  const wrapped = (tag) => (t, board) => `<${tag}>${inlineHtml(t.kids, board)}</${tag}>`;
  const INLINE_HTML = new Map([
    ['text', (t) => mdEscape(t.v)],
    ['code', (t, board) => codeHtml(t.v, board)],
    ['br', () => '<br>'],
    ['strong', wrapped('strong')],
    ['em', wrapped('em')],
    ['del', wrapped('del')],
    ['u', wrapped('u')],
    ['link', (t, board) => `<a href="${mdEscape(t.href)}" target="_blank" rel="noopener noreferrer">${inlineHtml(t.kids, board)}</a>`],
  ]);

  function inlineHtml(tokens, board) {
    return tokens.map((t) => (INLINE_HTML.has(t.t) ? INLINE_HTML.get(t.t)(t, board) : unknownHtml(t))).join('');
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
      if (!it.task) return `<li>${list.loose ? `<p>${text}</p>` : text}${nested}</li>`;
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

  const BLOCK_HTML = new Map([
    ['h', (b, board) => `<h${b.level}>${inlineHtml(b.inline, board)}</h${b.level}>`],
    ['p', (b, board) => `<p>${inlineHtml(b.inline, board)}</p>`],
    ['hr', () => '<hr>'],
    ['pre', (b) => preHtml(b)],
    ['quote', (b, board) => `<blockquote>${renderBlocks(b.blocks, board)}</blockquote>`],
    ['details', (b, board) => `<details${b.open ? ' open' : ''}><summary>${inlineHtml(b.summary, board)}</summary>${renderBlocks(b.blocks, board)}</details>`],
    ['list', (b, board) => listHtml(b, board)],
    ['table', (b, board) => tableHtml(b, board)],
  ]);

  function renderBlocks(blocks, board) {
    return blocks.map((b) => (BLOCK_HTML.has(b.t) ? BLOCK_HTML.get(b.t)(b, board) : unknownHtml(b))).join('');
  }

  // opts.board is the board's own name: a mention of a card on it opens the card.
  function mdToHtml(md, opts) {
    return renderBlocks(parseMarkdown(md), opts && opts.board);
  }

  return { parseMarkdown, parseInline, mdToHtml, renderBlocks, codeLang, splitRow, isTableDelimiter };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = markdownModule;
} else {
  window.kanbanMarkdown = markdownModule;
  window.mdToHtml = markdownModule.mdToHtml;
}

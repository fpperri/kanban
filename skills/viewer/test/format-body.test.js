const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// --- Minimal inline formatting for card bodies --------------------------------
// **bold** -> <strong>, `code` -> <code>. Nothing else (no headings, lists,
// links, or nesting inside a matched span); unmatched/unclosed markers render
// literally. The viewer has no separate viewer/*.js file to require() (all its
// JS lives inline in build_editor.py's TEMPLATE string) and no pre-existing
// test suite, so this file starts one, using the same extract-then-assert
// technique skills/web/test/notifications.test.js already uses for app.js's
// non-require-able DOM code: read the .py source as text and pull the
// function bodies out by brace-balanced scanning. Neither new function uses
// any character Python string-escapes (no backslashes), so the raw .py bytes
// ARE valid JS for this slice — extracting straight from source, not a
// generated HTML build, keeps the suite fast and dependency-free. fmtBodySegs
// is pure, so it gets real behavioral unit tests via `new Function`; bodyNode
// touches the DOM, so it gets the same source-level innerHTML-ban pin
// notifications.test.js uses for renderNotifList.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in build_editor.py`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i);
}

const fmtBodySegsSrc = extractFunction('fmtBodySegs');
const bodyNodeSrc = extractFunction('bodyNode');
const fmtBodySegs = new Function(`return (${fmtBodySegsSrc});`)();

test('fmtBodySegs: plain text with no markers is a single text segment', () => {
  assert.deepStrictEqual(fmtBodySegs('hello world'), [{ t: 'text', v: 'hello world' }]);
});

test('fmtBodySegs: empty string yields no segments', () => {
  assert.deepStrictEqual(fmtBodySegs(''), []);
});

test('fmtBodySegs: **bold** becomes a bold segment, markers stripped', () => {
  assert.deepStrictEqual(fmtBodySegs('**bold**'), [{ t: 'bold', v: 'bold' }]);
});

test('fmtBodySegs: `code` becomes a code segment, markers stripped', () => {
  assert.deepStrictEqual(fmtBodySegs('`code`'), [{ t: 'code', v: 'code' }]);
});

test('fmtBodySegs: a narrative-shaped bullet mixes a bold lead-in, plain text, and backticked identifiers', () => {
  assert.deepStrictEqual(
    fmtBodySegs('**Fixed the bug.** Root cause was `card-store.js` mishandling `waiting_for`.'),
    [
      { t: 'bold', v: 'Fixed the bug.' },
      { t: 'text', v: ' Root cause was ' },
      { t: 'code', v: 'card-store.js' },
      { t: 'text', v: ' mishandling ' },
      { t: 'code', v: 'waiting_for' },
      { t: 'text', v: '.' },
    ],
  );
});

test('fmtBodySegs: an unclosed ** renders literally, stars included', () => {
  assert.deepStrictEqual(fmtBodySegs('half **bold with no close'),
    [{ t: 'text', v: 'half **bold with no close' }]);
});

test('fmtBodySegs: an unclosed backtick renders literally, backtick included', () => {
  assert.deepStrictEqual(fmtBodySegs('started `a code span that never closes'),
    [{ t: 'text', v: 'started `a code span that never closes' }]);
});

test('fmtBodySegs: markers do not nest — a backtick inside a bold span stays literal text, not a code span', () => {
  assert.deepStrictEqual(fmtBodySegs('**`literal`**'), [{ t: 'bold', v: '`literal`' }]);
});

test('fmtBodySegs: markers do not nest the other way either — ** inside a code span stays literal text', () => {
  assert.deepStrictEqual(fmtBodySegs('`**literal**`'), [{ t: 'code', v: '**literal**' }]);
});

test('fmtBodySegs: adjacent marked spans with no gap between them both format', () => {
  assert.deepStrictEqual(fmtBodySegs('**a****b**'), [{ t: 'bold', v: 'a' }, { t: 'bold', v: 'b' }]);
});

test('fmtBodySegs: a triple-star run (***bold***) is not a valid 2-star marker — the extra stars fall through as literal text flanking a clean bold span, not glued inside it', () => {
  assert.deepStrictEqual(fmtBodySegs('***bold***'), [
    { t: 'text', v: '*' },
    { t: 'bold', v: 'bold' },
    { t: 'text', v: '*' },
  ]);
});

test('fmtBodySegs: a triple-backtick-adjacent run of stars only on the closing side still leaves the trailing star literal', () => {
  assert.deepStrictEqual(fmtBodySegs('**bold***'), [
    { t: 'bold', v: 'bold' },
    { t: 'text', v: '*' },
  ]);
});

test('fmtBodySegs: a lone unmatched backtick after a closed code span rejoins the trailing text', () => {
  assert.deepStrictEqual(fmtBodySegs('`a` and `b'),
    [{ t: 'code', v: 'a' }, { t: 'text', v: ' and `b' }]);
});

test('fmtBodySegs: newlines inside plain text survive untouched (line structure stays pre-wrap plain text)', () => {
  assert.deepStrictEqual(fmtBodySegs('line one\nline two'), [{ t: 'text', v: 'line one\nline two' }]);
});

// --- render-path guard: card bodies must be built via textContent, never innerHTML ---

test('bodyNode builds the card-body div out of el()/textContent nodes for every segment type, never innerHTML', () => {
  assert.match(bodyNodeSrc, /el\("div","bodytxt"\)/);
  assert.match(bodyNodeSrc, /el\("strong"/);
  assert.match(bodyNodeSrc, /el\("code"/);
  assert.match(bodyNodeSrc, /createTextNode/);
  assert.ok(!bodyNodeSrc.includes('innerHTML'), 'card body text must never be string-built HTML');
});

test('the card-sheet render path calls bodyNode(c.body) instead of dumping raw text straight into the bodytxt div', () => {
  assert.match(src, /d\.appendChild\(bodyNode\(c\.body\)\)/);
});

test('the .bodytxt code CSS rule is monospace and theme-consistent with the rest of the viewer', () => {
  assert.match(src, /\.bodytxt code\{[^}]*font-family:[^}]*monospace[^}]*\}/);
});

// --- responsive layout: two width tiers + a capability query -----------------
// Tier 1 (560-899px) only bumps #scroll's max-width — the base (unreached
// below 560px) rule keeps phone widths pixel-identical. Tier 2 (>=900px)
// turns the board into a side-by-side column strip and centers modals.
// hnav hides on a (hover:hover) and (pointer:fine) CAPABILITY query, not a
// width breakpoint, so touch devices keep it regardless of screen size.

function extractStyleBlock() {
  const start = src.indexOf('<style>');
  const end = src.indexOf('</style>');
  assert.ok(start !== -1 && end !== -1, '<style> block not found');
  return src.slice(start + '<style>'.length, end);
}

function extractMediaBlocks(css) {
  const blocks = [];
  let idx = 0;
  while ((idx = css.indexOf('@media', idx)) !== -1) {
    const braceStart = css.indexOf('{', idx);
    let depth = 0, i = braceStart;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    blocks.push(css.slice(idx, i));
    idx = i;
  }
  return blocks;
}

const css = extractStyleBlock();
const mediaBlocks = extractMediaBlocks(css);
const nonMediaCss = mediaBlocks.reduce((acc, b) => acc.split(b).join(''), css);

test('the base (unconditional) #scroll rule keeps max-width:560px — phone widths below the first breakpoint stay pixel-identical', () => {
  assert.match(nonMediaCss, /#scroll\{[^}]*max-width:560px[^}]*\}/);
});

test('tier 1 (min-width:560px): #scroll max-width grows to ~720px, nothing else changes', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:560px\)/.test(b));
  assert.ok(block, 'no @media(min-width:560px) block found');
  assert.match(block, /#scroll\{max-width:720px\}/);
  // Single, narrowly-scoped rule — this tier touches #scroll only.
  assert.strictEqual((block.match(/\{/g) || []).length, 2, 'tier 1 should only style #scroll');
});

test('tier 2 (min-width:900px): #scroll drops its width cap so the board can use the real viewport', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.ok(block, 'no @media(min-width:900px) block found');
  assert.match(block, /#scroll\{[^}]*max-width:none[^}]*\}/);
  assert.ok(!/#scroll\{[^}]*max-width:(?!none)\d/.test(block), '#scroll must not carry a pixel width cap at tier 2');
});

test('tier 2: board becomes a flex column strip, each column FILLS the freed width (flex:1 1 0) with a ~260px floor, and overflow-x:auto stays only as a fallback', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.ok(block, 'no @media(min-width:900px) block found');
  assert.match(block, /#board\{[^}]*display:flex[^}]*overflow-x:auto[^}]*\}/);
  assert.match(block, /\.boardcol\{[^}]*min-width:260px[^}]*flex:1 1 0[^}]*\}/);
});

test('status-pill row lives in its own #boardpills container, never as a flex item inside the #board strip', () => {
  assert.ok(src.includes('<div id="boardpills"></div>'), 'boardpills container missing from markup');
  assert.match(src, /\$\("boardpills"\)\.replaceChildren\(statusPills\(\)\)/);
  assert.ok(!/board\.appendChild\(statusPills\(\)\)/.test(src), 'pills must not be appended into #board');
});

test('wide screens default live sections open (Archive stays collapsed), evaluated once at load', () => {
  assert.match(src, /if\(matchMedia\("\(min-width:900px\)"\)\.matches\)COLS\.forEach\(c=>colOpen\[c\]=true\)/);
});

test('tier 2: a collapsed section narrows into a strip instead of holding the full min-width', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /\.boardcol\.collapsed\{[^}]*\}/);
});

test('tier 2: modals center with a ~640px cap instead of sheeting up from the bottom', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /#modal\{[^}]*align-items:center[^}]*\}/);
  assert.match(block, /#modalscroll\{[^}]*max-width:640px[^}]*\}/);
});

test('tier 2: the calendar view gets its own readable, centered cap — its 7-column grid would otherwise stretch edge to edge on an uncapped #scroll', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /#calview\{[^}]*max-width:900px[^}]*margin:0 auto[^}]*\}/);
});

test('tier 2: the pending-changes tray gets a readable cap — no fixed/floating overlay, the tray stays an ordinary flow block at every width', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.match(block, /\.pend\{[^}]*max-width:640px[^}]*\}/);
});

test('the tray never floats — no #pend selector and no position:fixed on .pend anywhere in the stylesheet (a rejected fixed-overlay tray was reverted)', () => {
  assert.ok(!/#pend\{/.test(css), '#pend must not be styled anywhere — the tray is .pend-scoped only, in normal flow');
  assert.ok(!/\.pend\{[^}]*position:fixed/.test(css), '.pend must not be position:fixed at any tier');
});

test('the base (unconditional) .pend rule is present and unstyled by width, phone stays an ordinary flow block', () => {
  assert.match(nonMediaCss, /\.pend\{[^}]*\}/);
});

// --- sticky thin header (all widths) + prominent "N pending" pill -----------
// Rework: the floating tray is gone; instead .hdr sticks to the top of
// #scroll at every width and compacts once scrolled, and #pill gets an
// unmissable accent fill so queued-but-unapplied changes are never missed.

test('.hdr is sticky at the TOP of #scroll (not gated behind any width media query) with a solid background and a z-index below #modal\'s backdrop', () => {
  assert.match(nonMediaCss, /\.hdr\{[^}]*position:sticky[^}]*\}/);
  assert.match(nonMediaCss, /\.hdr\{[^}]*top:0[^}]*\}/);
  const hdrBg = /\.hdr\{[^}]*background:(var\([^)]+\))/.exec(nonMediaCss);
  assert.ok(hdrBg, '.hdr must declare a solid background so board content cannot bleed through while stuck');
  mediaBlocks.forEach(block => {
    assert.ok(!block.includes('.hdr{'), '.hdr must not be re-declared inside any @media block — it is sticky at every width');
  });
  const modalZ = /#modal\{[^}]*z-index:(\d+)/.exec(nonMediaCss) || /#modal\{[^}]*z-index:(\d+)/.exec(css);
  const hdrZ = /\.hdr\{[^}]*z-index:(\d+)/.exec(nonMediaCss);
  assert.ok(modalZ, '#modal must declare a z-index');
  assert.ok(hdrZ, '.hdr must declare a z-index');
  assert.ok(Number(hdrZ[1]) < Number(modalZ[1]), '.hdr z-index must be below #modal\'s backdrop z-index');
});

test('.hdr.thin compacts vertical padding and shrinks the title once scrolled', () => {
  assert.match(nonMediaCss, /\.hdr\.thin\{[^}]*padding:[^}]*\}/);
  assert.match(nonMediaCss, /\.hdr\.thin b\{[^}]*font-size:1[0-4]px[^}]*\}/);
});

test('a scroll listener on #scroll (sc) toggles .hdr.thin only when crossing the threshold — cheap, no per-tick layout thrash', () => {
  assert.match(src, /const thin=sc\.scrollTop>\d+;/);
  assert.match(src, /if\(thin!==hdrThin\)\{hdrThin=thin;\$\("hdr"\)\.classList\.toggle\("thin",thin\)\}/);
  assert.ok(src.includes('id="hdr"'), '.hdr needs an id for the toggle listener to target it');
});

test('only the .hdr line is sticky — #searchrow and #viewtabs are not', () => {
  assert.ok(!/#searchrow\{[^}]*position:sticky/.test(css), '#searchrow must scroll away normally');
  assert.ok(!/\.viewtabs\{[^}]*position:sticky/.test(css), '.viewtabs must scroll away normally');
});

test('#pill ("N pending") is an unmissable solid accent fill with bold contrasting text, not just colored text', () => {
  assert.match(nonMediaCss, /\.pill\{[^}]*background:var\(--accent\)[^}]*\}/);
  assert.match(nonMediaCss, /\.pill\{[^}]*color:#fff[^}]*\}/);
  assert.match(nonMediaCss, /\.pill\{[^}]*font-weight:700[^}]*\}/);
});

test('#pill collapses to nothing when empty (no ops queued) instead of showing a stray colored blob', () => {
  assert.match(nonMediaCss, /\.pill:empty\{[^}]*\}/);
  assert.match(src, /\$\("pill"\)\.textContent=ops\.length\?ops\.length\+" pending":""/);
});

test('#pill stays tappable — jumps to the tray on click, same gate as before (kanban.proj #252: it also copies the payload, see pill-copy.test.js)', () => {
  assert.match(src, /\$\("pill"\)\.addEventListener\("click",\(\)=>\{if\(!ops\.length\)return;/);
  assert.match(src, /\$\("pill"\)\.addEventListener\("click",[\s\S]*?sc\.scrollTo\(\{top:sc\.scrollHeight,behavior:"smooth"\}\)/);
});

test('tier 2: the map and gantt SVG canvases are NOT capped — they size themselves from data inside their own overflow-x:auto scroller, so widening #scroll never stretches them', () => {
  const block = mediaBlocks.find(b => /^@media\(min-width:900px\)/.test(b));
  assert.ok(!/#mapview\{|#ganttview\{|\.map-scroll\{|\.map-canvas\{/.test(block),
    'map/gantt containers should be untouched at tier 2 — nothing to cap');
});

test('hnav hides on a (hover:hover) and (pointer:fine) capability query, not a width breakpoint', () => {
  const block = mediaBlocks.find(b => /^@media\(hover:hover\)/.test(b));
  assert.ok(block, 'no @media(hover:hover) block found');
  assert.match(block, /and\s*\(pointer:fine\)/);
  assert.match(block, /\.hnav\{display:none\}/);
  assert.ok(!/min-width|max-width/.test(block), 'hnav must hide on pointer/hover capability, never on viewport width');
});

test('the scroll-button stack CSS (#scrollbtns and its buttons) is never nested inside any @media block, at any width', () => {
  assert.match(nonMediaCss, /#scrollbtns\{/, '#scrollbtns should have unconditional CSS');
  assert.match(nonMediaCss, /#scrollbtns button\{/, '#scrollbtns button should have unconditional CSS');
  mediaBlocks.forEach(block => {
    assert.ok(!block.includes('scrollbtns'), '#scrollbtns must not appear inside a @media block');
  });
  // Every individual button id in the stack (#sup/#sdn/#stop/#sbot/#snew/
  // #sarch/#sdel/#mclose/#smore) is styled generically via "#scrollbtns
  // button" and shown/hidden by JS (syncStack), not by per-id CSS — so the
  // stronger, simpler invariant is just that none of them is ever
  // referenced from inside a @media block either.
  ['#sup', '#sdn', '#stop', '#sbot', '#snew', '#sarch', '#sdel', '#mclose', '#smore'].forEach(sel => {
    mediaBlocks.forEach(block => {
      assert.ok(!block.includes(sel), `${sel} must not appear inside a @media block`);
    });
  });
});

test("render() wraps each board section (header + cards) in a .boardcol container at every width, so tier 2's CSS can column-ize it without touching the DOM shape below 900px", () => {
  const matches = src.match(/el\("div","boardcol"/g) || [];
  assert.strictEqual(matches.length, 2, 'expected one .boardcol wrapper for status columns and one for the archive section');
  assert.match(src, /el\("div","colcards"\)/);
});

// --- right-click card menu: desktop-only capability gate ---------------------
// (hover:hover) and (pointer:fine) — same gate hnav hides on above — checked
// per-event off a live MediaQueryList, so a coarse-pointer device's listener
// is a true no-op: no preventDefault, no menu, native long-press untouched.

test('the fineMQ capability gate uses the same (hover: hover) and (pointer: fine) media query as hnav', () => {
  assert.match(src, /const fineMQ=window\.matchMedia\("\(hover: hover\) and \(pointer: fine\)"\);/);
});

test('the contextmenu listener checks fineMQ.matches FIRST, before resolving a card or calling preventDefault — a coarse-pointer device never runs any of that', () => {
  const start = src.indexOf('document.body.addEventListener("contextmenu"');
  assert.ok(start !== -1, 'no contextmenu listener found');
  const end = src.indexOf('});', start);
  const body = src.slice(start, end);
  const gateIdx = body.indexOf('if(!fineMQ.matches)return;');
  const preventIdx = body.indexOf('e.preventDefault()');
  assert.ok(gateIdx !== -1, 'contextmenu listener must check fineMQ.matches');
  assert.ok(preventIdx !== -1, 'contextmenu listener must call preventDefault for a resolved live card');
  assert.ok(gateIdx < preventIdx, 'the fineMQ gate must run before preventDefault, not after');
});

test('preventDefault is called only inside pointer-gated listeners (contextmenu, dragstart, dragover, drop) — no unconditional interception exists anywhere', () => {
  const matches = [...src.matchAll(/\.preventDefault\(\)/g)];
  assert.strictEqual(matches.length, 4, 'expected exactly four preventDefault() calls: the contextmenu gate, and dragstart/dragover/drop for pointer drag (kanban.proj #241)');
  const spans = [
    ['document.body.addEventListener("contextmenu"', 'openCtxMenu(c.id,e.clientX,e.clientY)});'],
    ['document.body.addEventListener("dragstart"', 'e.dataTransfer.effectAllowed="move"});'],
    ['document.body.addEventListener("dragover"', 'col.classList.add("drag-over")}});'],
    ['document.body.addEventListener("drop"', 'pillEd=null;render()});'],
  ];
  const ranges = spans.map(([startMarker, endMarker]) => {
    const start = src.indexOf(startMarker);
    assert.ok(start !== -1, `listener not found: ${startMarker}`);
    const end = src.indexOf(endMarker, start);
    assert.ok(end !== -1, `listener end not found: ${endMarker}`);
    return [start, end + endMarker.length];
  });
  matches.forEach((m) => {
    const inSomeRange = ranges.some(([s, e]) => m.index >= s && m.index < e);
    assert.ok(inSomeRange, `preventDefault() at offset ${m.index} is outside all known gated listeners`);
  });
});

test('the contextmenu listener resolves the target to a live (non-archived) board card before doing anything — archived cards and non-card targets fall through untouched', () => {
  const start = src.indexOf('document.body.addEventListener("contextmenu"');
  const end = src.indexOf('});', start);
  const body = src.slice(start, end);
  assert.match(body, /e\.target\.closest\("#board \[data-card\]"\)/, 'must scope to live board card tiles under #board, not the detail sheet');
  assert.match(body, /if\(!c\|\|c\.arch\)/, 'archived cards (and unresolved targets) must be excluded — v1 leaves them to the native menu');
});

test('the menu is built with el()/textContent only, never string-built HTML, and positions itself solely via CSSOM (style.left/top)', () => {
  const start = src.indexOf('function openCtxMenu(');
  const end = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, end);
  assert.match(body, /el\("div","ctxmenu"\)/);
  assert.match(body, /el\("button","ctxitem",label\)/);
  assert.ok(!body.includes('innerHTML'), 'the context menu must never be string-built HTML');
  assert.match(body, /m\.style\.left=/);
  assert.match(body, /m\.style\.top=/);
});

test('Delete arms red on the first click ("Delete?" + .armed) and only fires the delete op on a second click on the same still-open menu — mirrors the stack\'s delArm two-tap pattern', () => {
  const start = src.indexOf('function openCtxMenu(');
  const end = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, end);
  assert.match(body, /if\(!armed\)\{armed=true;delBtn\.textContent="Delete\?";delBtn\.classList\.add\("armed"\);return\}/);
  assert.match(body, /closeCtxMenu\(\);ctxDelete\(id\)/);
});

test('Open/Archive/Delete queue through the SAME queue() ops machinery the detail sheet uses — no parallel write path', () => {
  assert.match(src, /function ctxArchive\(id\)\{const c=find\(id\);if\(!c\|\|c\.arch\)return;queue\(\{op:"archive",id:id\}\);/);
  assert.match(src, /function ctxDelete\(id\)\{queue\(\{op:"delete",id:id\}\);/);
});

test('the menu offers one "Move to <Status>" row per status EXCEPT the card\'s own — same COLS/cname source and same exclusion the detail sheet\'s status pill editor uses', () => {
  assert.match(src, /COLS\.filter\(x=>x!==c\.s\)\.forEach\(x=>item\("Move to "\+cname\(x\),\(\)=>\{closeCtxMenu\(\);ctxMove\(id,x\)\}\)\);/);
  assert.match(src, /COLS\.filter\(x=>x!==c\.s\)\.forEach\(x=>slot\.appendChild\(btn\(cname\(x\),"move",\{to:x\}\)\)\)/, 'the detail sheet pill editor must still use the identical filter — two move surfaces, one status list');
});

test('Move rides queue() like every other menu action, so the doing entry gate is inherited, never re-implemented in the menu', () => {
  assert.match(src, /function ctxMove\(id,to\)\{queue\(\{op:"move",id:id,to:to\}\);delArm=null;pillEd=null;render\(\)\}/);
  // The gate lives in queue() alone: a move to doing on an unresolved/blocked
  // card sets note and returns before any op is pushed.
  assert.match(src, /if\(o\.to==="doing"\)\{const un=unresolved\(c\),br=blkReason\(c\);/);
  const menuBody = src.slice(src.indexOf('function openCtxMenu('), src.indexOf('document.body.addEventListener("contextmenu"'));
  assert.ok(!/unresolved\(|blkReason\(/.test(menuBody), 'openCtxMenu must not carry its own copy of the doing gate');
});

test('Move rows sit above a separator, keeping Archive/Delete visually grouped away from the routine actions', () => {
  assert.match(src, /ctxMove\(id,x\)\}\)\);\s*m\.appendChild\(el\("div","ctxsep"\)\);\s*item\("Archive"/);
  assert.match(src, /\.ctxsep\{[^}]*height:1px/, 'the separator needs a rule in the stylesheet');
});

test('the menu\'s "Dependency tree"/"Dependency path" items and the detail sheet\'s own buttons call the SAME graphFocus() helper — one tree:/path: implementation, not two', () => {
  assert.match(src, /function graphFocus\(gk,id\)\{/);
  assert.match(src, /if\(act==="graphfocus"\)\{graphFocus\(t\.dataset\.gk,id\);return\}/);
  assert.match(src, /item\("Dependency tree",\(\)=>\{closeCtxMenu\(\);graphFocus\("tree",id\)\}\)/);
  assert.match(src, /item\("Dependency path",\(\)=>\{closeCtxMenu\(\);graphFocus\("path",id\)\}\)/);
});

test('the menu closes on click-away, Esc, scroll, and view switch', () => {
  assert.match(src, /if\(ctxMenuEl&&!e\.target\.closest\("#ctxmenu"\)\)closeCtxMenu\(\);/, 'click elsewhere (delegated body click listener) must close the menu');
  assert.match(src, /if\(e\.key==="Escape"\)\{if\(ctxMenuEl\)\{closeCtxMenu\(\);return\}/, 'Esc must close the menu (and take priority over closing the card sheet)');
  assert.match(src, /sc\.addEventListener\("scroll",\(\)=>\{if\(ctxMenuEl\)closeCtxMenu\(\)\},\{passive:true\}\);/, 'scrolling #scroll must close the menu');
  assert.match(src, /function switchView\(v\)\{\s*if\(activeView===v\)return;\s*if\(ctxMenuEl\)closeCtxMenu\(\);/, 'switching views must close the menu');
});

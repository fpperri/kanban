const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, paletteDocument } = require('./helpers/palette-page');

// The coloured copy behind the Markdown boxes, in the real page (helpers/palette-page.js): the
// Scratchpad's Edit box and the card form's description are wrapped, the copy is redrawn from the
// textarea's value at most once a frame, its scroll follows, and the switch turns it on and off. The
// spans are markdown-edit.js's (markdown-edit.test.js); how the copy sits behind the textarea is the
// stylesheet's and the browser runner's markdown-edit scenario.
//
// The page's frames are driven by hand here: requestAnimationFrame queues, flush() runs the queue. The
// page's one ResizeObserver is a stand-in whose callback a test calls and whose observed boxes it counts.

const stylesOf = (el) => el.walk().filter((e) => e.tag === 'span' && e.classes.some((c) => c.startsWith('md-edit-')));
const drawn = (back) => stylesOf(back).map((e) => [e.classes[0].replace('md-edit-', ''), e.textContent]);
const plainText = (el) => el.walk().filter((e) => e.tag === '#text' || (e.tag === 'span' && e.classes.some((c) => c.startsWith('md-edit-')))).map((e) => e.textContent).join('');

const COMPUTED = {
  boxSizing: 'border-box', fontFamily: 'ui-monospace', fontSize: '15px', fontWeight: '400', fontStyle: 'normal', fontVariant: 'normal', fontKerning: 'auto', lineHeight: '21.75px',
  letterSpacing: 'normal', wordSpacing: '0px', textAlign: 'start', textTransform: 'none', textIndent: '0px', tabSize: '8', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal',
  paddingTop: '6px', paddingRight: '8px', paddingBottom: '6px', paddingLeft: '8px',
  borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
};

function drive(p) {
  const queue = [];
  const ro = { observed: new Set(), callback: null, made: 0 };
  const styleReads = { n: 0 };
  Object.assign(p.page.ctx, {
    requestAnimationFrame: (fn) => { queue.push(fn); return queue.length; },
    ResizeObserver: class {
      constructor(cb) { ro.callback = cb; ro.made += 1; }
      observe(el) { ro.observed.add(el); }
      unobserve(el) { ro.observed.delete(el); }
    },
    getComputedStyle: () => { styleReads.n += 1; return COMPUTED; },
  });
  const flush = () => { for (const fn of queue.splice(0)) fn(); };
  return { queue, ro, styleReads, flush, resized: (box) => ro.callback([{ target: box }]) };
}

async function openPad(extra = {}) {
  const p = await openPalette({ scratchpad: { folder: 'scratch', targets: [] }, ...extra });
  const d = drive(p);
  const panel = p.page.run("scratchPanel('7')");
  const box = panel.querySelector('.sp-text');
  const wrap = panel.querySelector('.md-edit');
  return { p, d, panel, box, wrap, back: wrap.querySelector('.md-edit-back') };
}

const typed = (box, text, d) => { box.value = text; box.fire('input', { type: 'input' }); d.flush(); };

test('the Scratchpad\'s box sits in a wrapper beside a hidden copy, and is the only thing in the panel that holds text', async () => {
  const { panel, box, wrap, back } = await openPad();
  assert.ok(wrap, 'a wrapper');
  assert.deepStrictEqual(wrap.children.map((c) => c.tag), ['textarea', 'pre']);
  assert.strictEqual(wrap.children[0].uid, box.uid, 'the textarea is the wrapper\'s first child');
  assert.strictEqual(back.getAttribute('aria-hidden'), 'true', 'the copy is hidden from assistive technology');
  assert.ok(wrap.classes.includes('on'), 'on by default');
  assert.ok(panel.children.some((c) => c.uid === wrap.uid), 'the wrapper is in the panel where the box was');
  assert.ok(!panel.children.some((c) => c.uid === box.uid), 'and the box is not in it twice');
  assert.strictEqual(box.dataset.mdEdit, '1');
});

test('a box attached twice is wrapped once', async () => {
  const { p, box, wrap } = await openPad();
  const again = p.page.ctx.mdEditAttach(box);
  assert.strictEqual(again.uid, wrap.uid);
});

test('typing redraws the copy from the textarea: each kind in its own element, the plain text between, nothing lost', async () => {
  const { d, box, back } = await openPad();
  typed(box, '# Plan\n- [ ] a **b** and `c` #12\n', d);
  assert.deepStrictEqual(drawn(back), [['heading', '# Plan'], ['marker', '-'], ['marker', '[ ]'], ['bold', '**b**'], ['code', '`c`'], ['mention', '#12']]);
  assert.strictEqual(plainText(back), '# Plan\n- [ ] a **b** and `c` #12\n ', 'every character, and a space after the last newline so its empty line is drawn');
  typed(box, 'plain words', d);
  assert.deepStrictEqual(drawn(back), []);
  assert.strictEqual(plainText(back), 'plain words');
});

test('a sixth-level heading is drawn as its own kind, as the preview keeps it apart', async () => {
  const { d, box, back } = await openPad();
  typed(box, '## Two\n###### Six', d);
  assert.deepStrictEqual(drawn(back), [['heading', '## Two'], ['heading-six', '###### Six']]);
});

test('code that sets the value redraws the copy with no input event: a page loaded into the box, a card opened into the form', async () => {
  const { d, box, back } = await openPad();
  box.value = 'a ~~gone~~';
  d.flush();
  assert.deepStrictEqual(drawn(back), [['strike', '~~gone~~']]);
  box.value = '';
  d.flush();
  assert.deepStrictEqual(drawn(back), []);
  assert.strictEqual(box.value, '', 'the value reads back as set');
});

test('an edit made with the editing command or by the text-edit keys redraws it too', async () => {
  const { p, d, box, back } = await openPad();
  const press = () => box.fire('keydown', { key: 'b', code: '', shiftKey: false, ctrlKey: true, altKey: false, metaKey: false, isComposing: false, currentTarget: box, target: box, preventDefault() {}, stopPropagation() {} });
  box.value = 'word';
  box.setSelectionRange(0, 4);
  box.focus();
  press();
  d.flush();
  assert.strictEqual(box.value, '**word**');
  assert.deepStrictEqual(drawn(back), [['bold', '**word**']]);
  p.extras.refuseExecCommand = true;
  box.setSelectionRange(0, 8);
  press();
  d.flush();
  assert.strictEqual(box.value, 'word');
  assert.deepStrictEqual(drawn(back), []);
});

// --- a frame at most ---------------------------------------------------------------------------

test('any number of inputs and set values in one frame ask for one frame, and one redraw of the last text', async () => {
  const { d, box, back } = await openPad();
  let draws = 0;
  const replace = back.replaceChildren;
  back.replaceChildren = (...a) => { draws += 1; return replace(...a); };
  box.value = 'a';
  box.fire('input', { type: 'input' });
  box.value = '**b**';
  box.fire('input', { type: 'input' });
  box.value = '*c*';
  box.fire('input', { type: 'input' });
  assert.strictEqual(d.queue.length, 1, 'one frame is asked for');
  assert.strictEqual(draws, 0, 'nothing is drawn before it');
  d.flush();
  assert.strictEqual(draws, 1);
  assert.deepStrictEqual(drawn(back), [['italic', '*c*']]);
  d.flush();
  assert.strictEqual(draws, 1, 'and an empty frame draws nothing');
});

test('typing does not read the textarea\'s computed style: the copy takes it on attach and on a resize only', async () => {
  const { d, box } = await openPad();
  const before = d.styleReads.n;
  typed(box, 'one', d);
  typed(box, 'one two', d);
  box.value = 'three';
  d.flush();
  assert.strictEqual(d.styleReads.n, before);
  d.resized(box);
  assert.strictEqual(d.styleReads.n, before + 1, 'a resize reads it once');
});

test('a resize redraws in the frame that saw it and takes the frame an input asked for with it, so one frame draws once', async () => {
  const { d, box, back } = await openPad();
  let draws = 0;
  const replace = back.replaceChildren;
  back.replaceChildren = (...a) => { draws += 1; return replace(...a); };
  box.value = '**b**';
  box.fire('input', { type: 'input' });
  assert.strictEqual(draws, 0);
  d.resized(box);
  assert.strictEqual(draws, 1, 'the observer is called in the frame, so it draws at once');
  assert.deepStrictEqual(drawn(back), [['bold', '**b**']]);
  d.flush();
  assert.strictEqual(draws, 1, 'and the frame the input asked for has nothing left to do');
});

test('a frame asked for before the switch went off draws nothing', async () => {
  const { p, d, box, back } = await openPad();
  box.value = '**b**';
  box.fire('input', { type: 'input' });
  p.page.ctx.mdEditSetOn(false);
  d.flush();
  assert.strictEqual(plainText(back), '');
});

test('one redraw of a 100 KB text is a blink: the spans and the nodes for them', async () => {
  const { d, box, back } = await openPad();
  const unit = '# Heading one\n\nA paragraph with **bold**, *italic*, `code`, [a link](https://x.test/a) and a mention `webapp#12 Title` plus #34.\n\n- item one\n- [ ] item two ~~gone~~\n\n> quote\n\n';
  const text = unit.repeat(Math.ceil(100000 / unit.length)).slice(0, 100000);
  box.value = text;
  const t0 = process.hrtime.bigint();
  d.flush();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(stylesOf(back).length > 2000, 'it is drawn');
  assert.ok(ms < 1500, `one redraw took ${ms.toFixed(0)} ms`);
});

// --- the copy's metrics --------------------------------------------------------------------------

test('the copy takes the textarea\'s font, padding, border and wrapping, and gives up the width of a scrollbar on its right', async () => {
  const { d, box, back } = await openPad();
  box.getBoundingClientRect = () => ({ width: 300, height: 100 });
  box.clientWidth = 283;
  d.resized(box);
  for (const [k, v] of Object.entries(COMPUTED)) if (k !== 'paddingRight') assert.strictEqual(back.style[k], v, k);
  for (const k of ['fontVariant', 'fontKerning', 'textAlign', 'tabSize', 'letterSpacing']) assert.ok(back.style[k] !== undefined, `${k} is copied`);
  assert.strictEqual(back.style.paddingRight, '23px', '8px of padding and a 15px bar: 300 wide, 283 inside, 2px of border');
  box.clientWidth = 298;
  typed(box, 'x', d);
  assert.strictEqual(back.style.paddingRight, '8px', 'no bar, no extra padding');
});

test('the bar is measured from the box\'s rect, so a fraction of a pixel left by rounding is not a bar and a real one keeps its fraction', async () => {
  const { d, box, back } = await openPad();
  d.resized(box);
  box.getBoundingClientRect = () => ({ width: 300.4, height: 100 });
  box.clientWidth = 298;
  typed(box, 'x', d);
  assert.strictEqual(back.style.paddingRight, '8px', '300.4 wide, 298 inside, 2px of border: 0.4px is rounding');
  box.getBoundingClientRect = () => ({ width: 312.6, height: 100 });
  box.clientWidth = 298;
  typed(box, 'xx', d);
  assert.ok(Math.abs(parseFloat(back.style.paddingRight) - 20.6) < 0.001, back.style.paddingRight + ' for a 12.6px bar at a fractional zoom');
});

test('the copy scrolls with the textarea', async () => {
  const { d, box, back } = await openPad();
  typed(box, 'x', d);
  box.scrollTop = 140;
  box.fire('scroll', {});
  assert.strictEqual(back.scrollTop, 140);
  typed(box, 'much longer\ntext', d);
  assert.strictEqual(back.scrollTop, 140, 'a redraw keeps the place');
});

// --- the switch --------------------------------------------------------------------------------

test('the switch: off, the wrapper loses its colouring class and the copy is emptied and not redrawn; on, it is drawn again from the box', async () => {
  const { p, d, box, wrap, back } = await openPad();
  typed(box, '**b**', d);
  assert.deepStrictEqual(drawn(back), [['bold', '**b**']]);
  p.page.ctx.mdEditSetOn(false);
  assert.ok(!wrap.classes.includes('on'));
  assert.strictEqual(plainText(back), '');
  typed(box, '*i*', d);
  assert.strictEqual(plainText(back), '', 'nothing is drawn while it is off');
  assert.strictEqual(box.value, '*i*', 'the text is never touched');
  p.page.ctx.mdEditSetOn(true);
  assert.ok(wrap.classes.includes('on'));
  assert.deepStrictEqual(drawn(back), [['italic', '*i*']]);
});

test('a box attached while the switch is off starts plain, and takes the colours when it is turned on', async () => {
  const { p, d } = await openPad();
  p.page.ctx.mdEditSetOn(false);
  const panel = p.page.run("scratchPanel('9')");
  const wrap = panel.querySelector('.md-edit');
  const box = panel.querySelector('.sp-text');
  assert.ok(!wrap.classes.includes('on'));
  typed(box, '**b**', d);
  assert.strictEqual(plainText(wrap.querySelector('.md-edit-back')), '');
  p.page.ctx.mdEditSetOn(true);
  assert.ok(wrap.classes.includes('on'));
  assert.deepStrictEqual(drawn(wrap.querySelector('.md-edit-back')), [['bold', '**b**']]);
});

test('the choice this browser kept is applied when the page starts, whatever the board', async () => {
  const off = await openPad({ stored: { 'kanban.md-colour': 'false' } });
  assert.ok(!off.wrap.classes.includes('on'));
  const on = await openPad({ stored: { 'kanban.kanban.prefs': JSON.stringify({ archivedDone: false }) } });
  assert.ok(on.wrap.classes.includes('on'));
  const board = await openPad({ stored: { 'kanban.md-colour': 'false', 'kanban.lab.prefs': '{}' } });
  assert.ok(!board.wrap.classes.includes('on'), 'the same on any board');
});

test('a board load does not redraw the boxes: a poll that names the same board is cheap', async () => {
  const { p, d, box, back } = await openPad();
  typed(box, '**b**', d);
  const before = back.children[0];
  p.page.run("applyProjectName('kanban')");
  p.page.ctx.mdEditSetOn(true);
  d.flush();
  assert.strictEqual(back.children[0], before);
});

test('the card form\'s description is attached when the page starts, and is coloured as set', async () => {
  const doc = paletteDocument({ document: null });
  const body = doc.createElement('textarea');
  const p = await openPalette({ elements: { '#f-body': body } });
  const d = drive(p);
  assert.strictEqual(body.dataset.mdEdit, '1');
  body.value = '## Notes';
  d.flush();
  const back = p.page.run('mdEditEntries').values().next().value.back;
  assert.deepStrictEqual(drawn(back), [['heading', '## Notes']]);
});

test('Preview hides the box with the hidden attribute it always used, which is what the :has rule in the stylesheet hides the wrapper by', async () => {
  const { panel, box } = await openPad();
  const preview = panel.querySelectorAll('.sp-mode')[1];
  preview.disabled = false;
  preview.fire('click');
  assert.strictEqual(box.hidden, true);
});

// --- one observer, no leak ---------------------------------------------------------------------

test('one ResizeObserver serves every box', async () => {
  const { p, d } = await openPad();
  p.page.run("scratchPanel('8')");
  p.page.run("scratchPanel('9')");
  assert.strictEqual(d.ro.made, 1);
});

test('opening the Scratchpad tab ten times leaves one observed box: a panel the palette dropped is let go', async () => {
  const { p, d, wrap } = await openPad();
  let last = wrap;
  for (let i = 0; i < 10; i++) {
    last.isConnected = false;
    last = p.page.run("scratchPanel('7')").querySelector('.md-edit');
  }
  assert.strictEqual(d.ro.observed.size, 1);
  assert.strictEqual(p.page.run('mdEditEntries.size'), 1);
  assert.strictEqual([...d.ro.observed][0].uid, last.querySelector('.sp-text').uid, 'and it is the one on show');
});

test('a resize of a box that was let go does nothing', async () => {
  const { p, d, box, wrap } = await openPad();
  wrap.isConnected = false;
  p.page.run("scratchPanel('7')");
  const reads = d.styleReads.n;
  d.resized(box);
  assert.strictEqual(d.styleReads.n, reads);
});

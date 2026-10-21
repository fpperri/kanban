const { test } = require('node:test');
const assert = require('node:assert');
const { openPalette, paletteDocument } = require('./helpers/palette-page');

// The coloured copy behind the Markdown boxes, in the real page (helpers/palette-page.js): the
// Scratchpad's Edit box and the card form's description are wrapped, the copy is redrawn from the
// textarea's value on every input and whenever code sets the value, its scroll follows, and the
// switch turns it on and off. The spans are markdown-edit.js's (markdown-edit.test.js); how the copy
// sits behind the textarea is the stylesheet's and the browser runner's markdown-edit scenario.

const stylesOf = (el) => el.walk().filter((e) => e.tag === 'span' && e.classes.some((c) => c.startsWith('md-edit-')));
const drawn = (back) => stylesOf(back).map((e) => [e.classes[0].replace('md-edit-', ''), e.textContent]);
const plainText = (el) => el.walk().filter((e) => e.tag === '#text' || (e.tag === 'span' && e.classes.some((c) => c.startsWith('md-edit-')))).map((e) => e.textContent).join('');

async function openPad(extra = {}) {
  const p = await openPalette({ scratchpad: { folder: 'scratch', targets: [] }, ...extra });
  const panel = p.page.run("scratchPanel('7')");
  const box = panel.querySelector('.sp-text');
  const wrap = panel.querySelector('.md-edit');
  return { p, panel, box, wrap, back: wrap.querySelector('.md-edit-back') };
}

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
  assert.strictEqual(p.page.run('mdEditEntries.size') >= 1, true);
});

test('typing redraws the copy from the textarea: each kind in its own element, the plain text between, nothing lost', async () => {
  const { box, back } = await openPad();
  box.value = '# Plan\n- [ ] a **b** and `c` #12\n';
  box.fire('input', { type: 'input' });
  assert.deepStrictEqual(drawn(back), [['heading', '# Plan'], ['marker', '-'], ['marker', '[ ]'], ['bold', '**b**'], ['code', '`c`'], ['mention', '#12']]);
  assert.strictEqual(plainText(back), '# Plan\n- [ ] a **b** and `c` #12\n ', 'every character, and a space after the last newline so its empty line is drawn');
  box.value = 'plain words';
  box.fire('input', { type: 'input' });
  assert.deepStrictEqual(drawn(back), []);
  assert.strictEqual(plainText(back), 'plain words');
});

test('code that sets the value redraws the copy with no input event: a page loaded into the box, a card opened into the form', async () => {
  const { box, back } = await openPad();
  box.value = 'a ~~gone~~';
  assert.deepStrictEqual(drawn(back), [['strike', '~~gone~~']]);
  box.value = '';
  assert.deepStrictEqual(drawn(back), []);
  assert.strictEqual(box.value, '', 'the value reads back as set');
});

test('an edit made with the editing command or by the text-edit keys redraws it too', async () => {
  const { p, box, back } = await openPad();
  box.value = 'word';
  box.setSelectionRange(0, 4);
  box.focus();
  box.fire('keydown', { key: 'b', code: '', shiftKey: false, ctrlKey: true, altKey: false, metaKey: false, isComposing: false, currentTarget: box, target: box, preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(box.value, '**word**');
  assert.deepStrictEqual(drawn(back), [['bold', '**word**']]);
  p.extras.refuseExecCommand = true;
  box.setSelectionRange(0, 8);
  box.fire('keydown', { key: 'b', code: '', shiftKey: false, ctrlKey: true, altKey: false, metaKey: false, isComposing: false, currentTarget: box, target: box, preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(box.value, 'word');
  assert.deepStrictEqual(drawn(back), []);
});

test('the copy takes the textarea\'s font, padding, border and wrapping, and gives up the width of a scrollbar on its right', async () => {
  const { p, box, back } = await openPad();
  const cs = {
    boxSizing: 'border-box', fontFamily: 'ui-monospace', fontSize: '15px', fontWeight: '400', fontStyle: 'normal', lineHeight: '21.75px', letterSpacing: 'normal', wordSpacing: '0px',
    textTransform: 'none', textIndent: '0px', tabSize: '8', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal',
    paddingTop: '6px', paddingRight: '8px', paddingBottom: '6px', paddingLeft: '8px',
    borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px',
  };
  p.page.ctx.getComputedStyle = () => cs;
  box.offsetWidth = 300;
  box.clientWidth = 283;
  box.value = 'x';
  for (const [k, v] of Object.entries(cs)) if (k !== 'paddingRight') assert.strictEqual(back.style[k], v, k);
  assert.strictEqual(back.style.paddingRight, '23px', '8px of padding and a 15px bar: 300 wide, 283 inside, 2px of border');
  box.offsetWidth = 300;
  box.clientWidth = 298;
  box.fire('input', { type: 'input' });
  assert.strictEqual(back.style.paddingRight, '8px', 'no bar, no extra padding');
});

test('the copy scrolls with the textarea', async () => {
  const { box, back } = await openPad();
  box.value = 'x';
  box.scrollTop = 140;
  box.fire('scroll', {});
  assert.strictEqual(back.scrollTop, 140);
  box.value = 'much longer\ntext';
  box.fire('input', { type: 'input' });
  assert.strictEqual(back.scrollTop, 140, 'a redraw keeps the place');
});

test('the switch: off, the wrapper loses its colouring class and the copy is emptied and not redrawn; on, it is drawn again from the box', async () => {
  const { p, box, wrap, back } = await openPad();
  box.value = '**b**';
  assert.deepStrictEqual(drawn(back), [['bold', '**b**']]);
  p.page.ctx.mdEditSetOn(false);
  assert.ok(!wrap.classes.includes('on'));
  assert.deepStrictEqual(drawn(back), []);
  assert.strictEqual(plainText(back), '');
  box.value = '*i*';
  box.fire('input', { type: 'input' });
  assert.strictEqual(plainText(back), '', 'nothing is drawn while it is off');
  assert.strictEqual(box.value, '*i*', 'the text is never touched');
  p.page.ctx.mdEditSetOn(true);
  assert.ok(wrap.classes.includes('on'));
  assert.deepStrictEqual(drawn(back), [['italic', '*i*']]);
});

test('a box attached while the switch is off starts plain, and takes the colours when it is turned on', async () => {
  const { p } = await openPad();
  p.page.ctx.mdEditSetOn(false);
  const panel = p.page.run("scratchPanel('9')");
  const wrap = panel.querySelector('.md-edit');
  const box = panel.querySelector('.sp-text');
  assert.ok(!wrap.classes.includes('on'));
  box.value = '**b**';
  assert.strictEqual(plainText(wrap.querySelector('.md-edit-back')), '');
  p.page.ctx.mdEditSetOn(true);
  assert.ok(wrap.classes.includes('on'));
  assert.deepStrictEqual(drawn(wrap.querySelector('.md-edit-back')), [['bold', '**b**']]);
});

test('the choice the browser kept for the board is applied when the board loads', async () => {
  const off = await openPad({ stored: { 'kanban.kanban.prefs': JSON.stringify({ mdColour: false }) } });
  assert.ok(!off.wrap.classes.includes('on'));
  assert.strictEqual(off.p.page.run('loadPrefsState().mdColour'), false);
  const on = await openPad({ stored: { 'kanban.kanban.prefs': JSON.stringify({ archivedDone: false }) } });
  assert.ok(on.wrap.classes.includes('on'));
});

test('a switch that is already in the state asked for redraws nothing: a poll that names the same board is cheap', async () => {
  const { p, box, back } = await openPad();
  box.value = '**b**';
  const before = back.children[0];
  p.page.ctx.mdEditSetOn(true);
  assert.strictEqual(back.children[0], before);
});

test('the card form\'s description is attached when the page starts, and is coloured as set', async () => {
  const doc = paletteDocument({ document: null });
  const body = doc.createElement('textarea');
  const p = await openPalette({ elements: { '#f-body': body } });
  assert.strictEqual(body.dataset.mdEdit, '1');
  body.value = '## Notes';
  const back = p.page.run("mdEditEntries").values().next().value.back;
  assert.deepStrictEqual(drawn(back), [['heading', '## Notes']]);
});

test('Preview hides the box with the hidden attribute it always used, which is what the :has rule in the stylesheet hides the wrapper by', async () => {
  const { panel, box } = await openPad();
  const preview = panel.querySelectorAll('.sp-mode')[1];
  preview.disabled = false;
  preview.fire('click');
  assert.strictEqual(box.hidden, true);
});

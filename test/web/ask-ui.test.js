const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage } = require('./helpers/page-vm');
const { askElements, askDriver } = require('./helpers/ask-page');
const { blankNonCode } = require('./helpers/global-scope');
const { askSegments } = require('../../plugin/skills/web/web/ask-ui');

// The speedbump asks in the page (ask-ui.js), not through the browser's confirm(): the claude.ai viewer
// answers a native dialog with "no", so Archive, the drop that asks, Discard unsaved changes and the rest
// did nothing on the Board artifact. One ask returns a promise of yes or no; Esc, Cancel, the close button
// and the backdrop answer no. The page runs in a vm (helpers/page-vm.js) with the ask's five elements as
// stand-ins (helpers/ask-page.js); the call sites' own tests, and the browser scenarios, hold each message
// at its moment.

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('app.html');

async function open() {
  const elements = askElements();
  const page = await loadPage({ board: { projectName: 'kanban', statuses: ['todo'], priorities: [], assignees: [], tags: [], types: [], notifications: [], active: [], archived: [] }, elements }).start();
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return { page, elements, ask: askDriver(page, elements) };
}

// What the page awaits: the promise's answer, once it has one.
function watch(page, message, options) {
  const seen = { answer: undefined };
  page.ctx.__message = message;
  page.ctx.__options = options;
  page.run('askInPage(__message, __options)').then((a) => { seen.answer = a; });
  return seen;
}

test('no confirm( is left in the web\'s page code', () => {
  const found = [];
  for (const f of fs.readdirSync(WEB).filter((n) => n.endsWith('.js')).sort()) {
    blankNonCode(read(f)).split('\n').forEach((line, i) => { if (/(^|[^\w$])confirm\s*\(/.test(line)) found.push(`${f}:${i + 1}`); });
  }
  assert.deepStrictEqual(found, [], 'a native confirm() is answered with no in the claude.ai viewer; ask in the page with askInPage');
});

test('the ask opens with the message as text, Cancel focused, and the confirm button named for the act', async () => {
  const { page, elements, ask } = await open();
  let focused = 0;
  elements['#ask-no'].focus = () => { focused++; };
  assert.strictEqual(ask.open(), false, 'it starts closed');
  watch(page, 'Archive 2 card(s)? (moves their files to archived/)', { yes: 'Archive' });
  assert.strictEqual(ask.open(), true);
  assert.strictEqual(ask.text(), 'Archive 2 card(s)? (moves their files to archived/)');
  assert.strictEqual(ask.yesLabel(), 'Archive');
  assert.strictEqual(focused, 1, 'Cancel takes the focus, so Enter says no');
});

test('yes answers true and closes the ask', async () => {
  const { page, ask } = await open();
  const seen = watch(page, 'Discard unsaved changes to this card?');
  await ask.yes();
  assert.strictEqual(seen.answer, true);
  assert.strictEqual(ask.open(), false);
});

test('Cancel, the close button, a click on the backdrop and Esc each answer no and close the ask', async () => {
  for (const way of ['no', 'close', 'backdrop', 'esc']) {
    const { page, ask } = await open();
    const seen = watch(page, 'Clear all 3 notification(s)? They move to archived/notifications.md.');
    assert.strictEqual(ask.open(), true, way);
    await ask[way]();
    assert.strictEqual(seen.answer, false, way);
    assert.strictEqual(ask.open(), false, way);
  }
});

test('a click inside the dialog, not on the backdrop, answers nothing', async () => {
  const { page, elements, ask } = await open();
  const seen = watch(page, 'Discard unsaved changes to this card?');
  elements['#ask'].fire('click', { target: { id: 'ask-text' } });
  await page.settle();
  assert.strictEqual(seen.answer, undefined);
  assert.strictEqual(ask.open(), true);
});

test('Esc stops at the ask: the page\'s own Esc handling behind it never runs, and nothing is answered twice', async () => {
  const { page, ask } = await open();
  let behind = 0;
  page.documentListeners.keydown.push(() => { behind++; });
  const seen = watch(page, 'Discard unsaved changes to this card?');
  const e = await ask.esc();
  assert.strictEqual(seen.answer, false);
  assert.strictEqual(e.stopped, true, 'the key goes no further');
  assert.strictEqual(e.defaultPrevented, true);
  assert.strictEqual(behind, 0, 'no document listener saw it');
  await ask.esc();
  assert.ok(behind >= 1, 'with the ask closed, Esc reaches the page again');
});

test('a held Esc is one press: the repeats the open ask sees answer nothing and go no further', async () => {
  const { page, ask } = await open();
  let behind = 0;
  page.documentListeners.keydown.push(() => { behind++; });
  const seen = watch(page, 'Discard unsaved changes to this card?');
  const e = await ask.esc({ repeat: true });
  assert.strictEqual(seen.answer, undefined, 'the ask the first press opened is still up');
  assert.strictEqual(ask.open(), true);
  assert.strictEqual(e.stopped, true);
  assert.strictEqual(behind, 0);
});

test('a key other than Esc is left alone while the ask is up', async () => {
  const { page, ask } = await open();
  let behind = 0;
  page.documentListeners.keydown.push(() => { behind++; });
  const seen = watch(page, 'Discard unsaved changes to this card?');
  const e = await ask.press('a');
  assert.strictEqual(e.stopped, false);
  assert.strictEqual(behind, 1);
  assert.strictEqual(seen.answer, undefined);
  assert.strictEqual(ask.open(), true);
});

test('a second ask while one is up answers no at once and leaves the first one up', async () => {
  const { page, ask } = await open();
  const first = watch(page, 'Discard unsaved changes to this card?');
  const second = watch(page, 'Archive 2 card(s)? (moves their files to archived/)');
  await page.settle();
  assert.strictEqual(second.answer, false, 'two asks never stack, and the later one never goes ahead');
  assert.strictEqual(first.answer, undefined);
  assert.strictEqual(ask.text(), 'Discard unsaved changes to this card?', 'the message on show is still the first');
  await ask.yes();
  assert.strictEqual(first.answer, true);
});

test('after an answer the next ask opens afresh with its own message and label', async () => {
  const { page, ask } = await open();
  watch(page, 'one', { yes: 'Archive' });
  await ask.no();
  const again = watch(page, 'two');
  assert.strictEqual(ask.open(), true);
  assert.strictEqual(ask.text(), 'two');
  assert.strictEqual(ask.yesLabel(), 'OK', 'the label does not carry over');
  await ask.yes();
  assert.strictEqual(again.answer, true);
});

test('the focus goes back to where it was when the ask closes', async () => {
  const { page, ask } = await open();
  let back = 0;
  page.ctx.document.activeElement = { focus: () => { back++; } };
  watch(page, 'Discard unsaved changes to this card?');
  await ask.no();
  assert.strictEqual(back, 1);
});

test('askSegments: a span in backticks is code, the rest is text, and a backtick that closes nothing stays as typed', () => {
  assert.deepStrictEqual(askSegments('plain'), [{ text: 'plain', code: false }]);
  assert.deepStrictEqual(askSegments('2 cards say `bug`. Remove it?'), [
    { text: '2 cards say ', code: false }, { text: 'bug', code: true }, { text: '. Remove it?', code: false },
  ]);
  assert.deepStrictEqual(askSegments('`a` and `b`'), [
    { text: 'a', code: true }, { text: ' and ', code: false }, { text: 'b', code: true },
  ]);
  assert.deepStrictEqual(askSegments('one ` alone'), [{ text: 'one ` alone', code: false }]);
  assert.deepStrictEqual(askSegments('empty `` pair'), [{ text: 'empty `` pair', code: false }]);
  assert.deepStrictEqual(askSegments(''), []);
});

test('markup: the ask is the last dialog in the page, so it stacks above every other popup, and starts closed', () => {
  const body = html.slice(html.indexOf('</header>'));
  const ids = [...body.matchAll(/<div id="([^"]+)"[^>]*class="[^"]*\bmodal-backdrop\b/g)].map((m) => m[1]);
  assert.strictEqual(ids[ids.length - 1], 'ask', 'last of the modal backdrops in document order');
  const tag = html.match(/<div id="ask"[^>]*>/)[0];
  assert.match(tag, /\bhidden\b/);
  assert.match(tag, /data-keeps-selection/, 'a click on it never reads as a click away');
  const dialog = html.slice(html.indexOf('<div id="ask"'), html.indexOf('<script src="/board-source.js">'));
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.doesNotMatch(dialog, /\sstyle=/, 'the strict CSP allows no style attribute');
  for (const id of ['ask-text', 'ask-yes', 'ask-no', 'ask-close']) assert.ok(dialog.includes(`id="${id}"`), id);
  assert.ok(dialog.indexOf('id="ask-no"') < dialog.indexOf('id="ask-yes"'), 'Cancel comes before the confirm button');
});

test('ask-ui.js loads from one script tag, before app.js', () => {
  const tags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.strictEqual(tags.filter((t) => t === '/ask-ui.js').length, 1);
  assert.ok(tags.indexOf('/ask-ui.js') < tags.indexOf('/app.js'));
});

test('the confirm button is red and the ask stacks above the notes palette and the other popups, with rules in the stylesheet', () => {
  const css = read('app.css');
  assert.match(css, /\.ask-yes\s*\{[^}]*var\(--crit\)/, 'the confirm button wears the danger colour');
  const z = css.match(/\.ask-backdrop\s*\{[^}]*z-index:\s*(\d+)/);
  assert.ok(z && Number(z[1]) > 31, 'above .notes-palette.np-over-detail, the highest popup layer an ask can come from');
  assert.ok(Number(z[1]) < 60, 'under the card menu');
});

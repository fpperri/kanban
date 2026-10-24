const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The phone header's More menu (more-menu.js): under 760 px the header's top row is the board name, New
// card, the view buttons, the bell and a More button, and the menu holds what the desktop header shows
// beside them. The items model is pure; the menu itself is static markup that the module shows and
// hides; the rules of the row are one block in app.css.

const webDir = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const read = (f) => fs.readFileSync(path.join(webDir, f), 'utf8');
const html = read('app.html');
const css = read('app.css');
const { moreMenuItems } = require('../../plugin/skills/web/web/more-menu');

test('the items model always lists Preferences, Refresh and Copy board path', () => {
  assert.deepStrictEqual(moreMenuItems({ home: false, iterations: false }), ['prefs', 'refresh', 'copy']);
  assert.deepStrictEqual(moreMenuItems({}), ['prefs', 'refresh', 'copy']);
  assert.deepStrictEqual(moreMenuItems(), ['prefs', 'refresh', 'copy']);
});

test('the home link is listed only when the board has a home URL, the iteration picker only when it has iterations', () => {
  assert.deepStrictEqual(moreMenuItems({ home: true, iterations: false }), ['prefs', 'refresh', 'copy', 'home']);
  assert.deepStrictEqual(moreMenuItems({ home: false, iterations: true }), ['prefs', 'refresh', 'copy', 'iteration']);
  assert.deepStrictEqual(moreMenuItems({ home: true, iterations: true }), ['prefs', 'refresh', 'copy', 'home', 'iteration']);
});

test('more-menu.js loads from one script tag, right after settings-ui.js', () => {
  const tags = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.strictEqual(tags.filter((t) => t === '/more-menu.js').length, 1);
  assert.strictEqual(tags.indexOf('/more-menu.js'), tags.indexOf('/settings-ui.js') + 1);
});

const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));

test('markup: the More button and its menu sit in the header after .actions, and no node carries a style attribute', () => {
  assert.ok(header.indexOf('class="actions"') < header.indexOf('id="more-btn"'));
  assert.ok(header.indexOf('id="more-btn"') < header.indexOf('id="more-menu"'));
  const btn = header.match(/<button[^>]*id="more-btn"[^>]*>/)[0];
  assert.match(btn, /aria-label="More"/);
  assert.match(btn, /aria-haspopup="menu"/);
  assert.match(btn, /aria-expanded="false"/);
  assert.match(btn, /aria-controls="more-menu"/);
  assert.match(btn, /data-keeps-selection/);
  assert.match(header.match(/<div[^>]*id="more-menu"[^>]*>/)[0], /\bhidden\b/, 'the menu starts closed');
  assert.doesNotMatch(header, /\sstyle=/);
  for (const id of ['more-prefs', 'more-refresh', 'more-copy', 'more-home', 'more-iter-select']) assert.ok(header.includes(`id="${id}"`), id);
});

test('markup: New card and the bell are the existing buttons, and the icon-only look keeps their accessible names', () => {
  assert.match(header, /<button id="new-btn"[^>]*>[\s\S]*?<span class="btn-label">New card<\/span>/);
  assert.match(header, /id="notif-btn"[^>]*aria-label="Notifications"/);
  const block = phoneBlock();
  assert.doesNotMatch(block, /\.btn-label\s*\{[^}]*display:\s*none/, 'display: none would drop the name; the label is visually hidden instead');
  assert.match(block, /\.btn-label\s*\{[^}]*clip/);
});

function phoneBlock() {
  const start = css.indexOf('/* Phone header');
  assert.ok(start > 0, 'a comment names the phone header block');
  const open = css.indexOf('@media (max-width: 759.98px) {', start);
  assert.ok(open > start && open - start < 800, 'the block is one phone media query');
  let depth = 0;
  for (let i = css.indexOf('{', open); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open, i + 1);
  }
  throw new Error('unterminated block');
}

test('source: the phone header rules are one 760 px block after the .iter-select rules and before the search block', () => {
  const block = phoneBlock();
  const at = css.indexOf(block);
  assert.ok(css.indexOf('.iter-select.narrowed') < at);
  assert.ok(at < css.indexOf('.search-bar { position: relative'));
  assert.strictEqual(css.split('/* Phone header').length, 2, 'one block');
  assert.match(block, /text-overflow:\s*ellipsis/);
  for (const sel of ['#refresh-btn', '#prefs-btn', '#board-copy-btn', '.home-link', '.iter-select']) {
    assert.match(block, new RegExp(`${sel.replace(/[.#]/g, '\\$&')}[^{]*\\{[^}]*display:\\s*none`), `${sel} is hidden`);
  }
  assert.doesNotMatch(block, /#stale-indicator[^{]*\{[^}]*display:\s*none/, 'the stale cue stays');
  assert.doesNotMatch(block, /\.search-bar\s*\{/, 'the search bar is hidden until the search button opens it (search-button.test.js), not given a row here');
  assert.match(block, /\.more-btn\s*\{[^}]*display:\s*inline-flex/);
  assert.match(block, /\.more-menu:not\(\.hidden\)\s*\{[^}]*display:\s*flex/);
});

test('source: above the phone line the More button and its menu are not displayed, and no new width number appears', () => {
  assert.match(css, /\.more-btn,\s*\.more-menu\s*\{[^}]*display:\s*none/);
  assert.ok(css.indexOf('.more-btn, .more-menu {') < css.indexOf('/* Phone header'));
  assert.doesNotMatch(css, /@media[^{]*\(\s*(?:min|max)-width:\s*(?!759\.98px|760px)[^)]*\)[^{]*\{[^}]*\.more-/);
});

// --- the menu on the page, in the real page scope ------------------------------------------------------

function menuPage({ homeHidden = true, iterationsHidden = true } = {}) {
  const calls = [];
  const el = (name) => { const c = control(); c.clicks = 0; c.addEventListener('click', () => {}); c.click = () => { c.clicks++; calls.push(name); }; return c; };
  const els = {};
  for (const id of ['more-btn', 'more-menu', 'more-prefs', 'more-refresh', 'more-copy', 'more-home', 'more-iter', 'prefs-btn', 'refresh-btn', 'board-copy-btn']) els[`#${id}`] = el(id);
  const selects = { '#iter-select': control(), '#more-iter-select': control() };
  for (const [k, s] of Object.entries(selects)) { els[k] = s; s.options = []; s.replaceChildren = (...o) => { s.options = o; }; s.dispatchEvent = (e) => s.fire(e.type); }
  els['#iter-select'].fixture = [{ value: '', textContent: 'All cards' }, { value: 'I2', textContent: 'zephyr-2' }];
  els['#home-link'] = control();
  els['#home-link'].href = 'http://127.0.0.1:7791/';
  els['#more-menu'].classList.add('hidden');
  els['#more-btn'].attrs = {};
  els['#more-btn'].setAttribute = (k, v) => { els['#more-btn'].attrs[k] = v; };
  const page = loadPage({ board: { projectName: 'p', statuses: ['todo'], priorities: ['Normal'], assignees: [], tags: [], types: [], notifications: [], active: [], archived: [] }, elements: els, documentExtras: { createElement: (tag) => (tag === 'option' ? {} : harmless(`<${tag}>`)) } });
  page.show = () => {
    els['#iter-select'].hidden = iterationsHidden;
    els['#iter-select'].options = els['#iter-select'].fixture;
    els['#iter-select'].value = 'I2';
    els['#home-link'].classList[homeHidden ? 'add' : 'remove']('hidden');
  };
  page.els = els;
  page.calls = calls;
  page.menuOpen = () => !els['#more-menu'].classList.contains('hidden');
  page.clickAt = (inside) => page.fireDocument('click', { target: { closest: (sel) => (inside && sel.includes('#more') ? {} : null) } });
  return page;
}

async function started(opts) {
  const page = menuPage(opts);
  await page.start();
  page.show();
  assert.deepStrictEqual(page.failures.map((e) => e.message), []);
  return page;
}

test('the More button opens the menu and shows exactly the items the desktop header shows', async () => {
  const page = await started({ homeHidden: false, iterationsHidden: false });
  page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
  assert.strictEqual(page.menuOpen(), true);
  const shown = (id) => !page.els[`#${id}`].classList.contains('hidden');
  assert.deepStrictEqual(['more-prefs', 'more-refresh', 'more-copy', 'more-home', 'more-iter'].map(shown), [true, true, true, true, true]);
  assert.strictEqual(page.els['#more-home'].href, 'http://127.0.0.1:7791/');
});

test('a board with no home URL and no iterations gets only Preferences, Refresh and Copy board path', async () => {
  const page = await started();
  page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
  const shown = (id) => !page.els[`#${id}`].classList.contains('hidden');
  assert.deepStrictEqual(['more-prefs', 'more-refresh', 'more-copy', 'more-home', 'more-iter'].map(shown), [true, true, true, false, false]);
});

test('the menu closes on an outside tap, but not on a tap inside it', async () => {
  const page = await started();
  page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
  page.clickAt(true);
  assert.strictEqual(page.menuOpen(), true);
  page.clickAt(false);
  assert.strictEqual(page.menuOpen(), false);
});

test('the menu closes on Escape, before anything else Escape does', async () => {
  const page = await started();
  page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
  assert.strictEqual(page.els['#more-btn'].attrs['aria-expanded'], 'true');
  const e = page.fireDocument('keydown', { key: 'Escape', preventDefault() { this.prevented = true; } });
  assert.strictEqual(page.menuOpen(), false);
  assert.strictEqual(e.prevented, true);
  assert.strictEqual(page.els['#more-btn'].attrs['aria-expanded'], 'false');
});

test('each item closes the menu and acts through the existing handler: the gear, Refresh and the copy button', async () => {
  for (const [item, target] of [['more-prefs', 'prefs-btn'], ['more-refresh', 'refresh-btn'], ['more-copy', 'board-copy-btn']]) {
    const page = await started();
    page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
    page.els[`#${item}`].fire('click', { target: page.els[`#${item}`] });
    assert.strictEqual(page.menuOpen(), false, item);
    assert.deepStrictEqual(page.calls, [target], item);
  }
});

test('the iteration item changes the iteration as #iter-select does, and closes the menu', async () => {
  const page = await started({ iterationsHidden: false });
  page.els['#more-btn'].fire('click', { target: page.els['#more-btn'] });
  const mine = page.els['#more-iter-select'];
  assert.deepStrictEqual(mine.options.map((o) => o.value), ['', 'I2'], 'it lists the same options');
  assert.strictEqual(mine.value, 'I2', 'and stands on the same pick');
  let changed = 0;
  page.els['#iter-select'].addEventListener('change', () => { changed++; });
  mine.value = '';
  mine.fire('change', { target: mine });
  assert.strictEqual(page.els['#iter-select'].value, '');
  assert.strictEqual(changed, 1);
  assert.strictEqual(page.menuOpen(), false);
});

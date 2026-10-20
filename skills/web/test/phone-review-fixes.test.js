const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPage, control } = require('./helpers/page-vm');
const { PHONE_WIDTH_QUERY } = require('../web/phone-width');

// Fixes from the final review of the phone layout. Each test drives the page's own seam
// (helpers/page-vm.js) or reads the stylesheet, and fails on the code it replaces.

const WEB = path.join(__dirname, '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'app.css'), 'utf8').replace(/\r\n/g, '\n');
const BOARD = { projectName: 'k', statuses: ['backlog', 'todo', 'doing', 'done'], priorities: [], assignees: [], tags: [], types: [], active: [], archived: [] };
const phoneMedia = (phone) => (q) => ({ matches: q === PHONE_WIDTH_QUERY && phone, addEventListener() {} });

test('paintViewButtons presses only the header\'s view buttons and the view bar\'s, never the Preferences sheet\'s click choices', async () => {
  const btn = (view, zone) => {
    const b = control();
    const attrs = {};
    b.dataset = { view };
    b.zone = zone;
    b.setAttribute = (k, v) => { attrs[k] = v; };
    b.getAttribute = (k) => (k in attrs ? attrs[k] : null);
    b.attrs = attrs;
    return b;
  };
  const header = btn('board', 'header'); header.dataset.viewToggle = '';
  const bar = btn('board', 'bar');
  const prefs = btn('board', 'prefs');
  const all = [header, bar, prefs];
  const querySelectorAll = (sel) => {
    const parts = sel.split(',').map((s) => s.trim());
    return all.filter((b) => parts.some((p) => (p === '[data-view]') || (p === '[data-view-toggle]' && b.zone === 'header') || (p === '#view-bar [data-view]' && b.zone === 'bar') || (p === '.actions [data-view]' && b.zone === 'header')));
  };
  const page = await loadPage({ board: BOARD, documentExtras: { querySelectorAll } }).start();
  prefs.attrs['aria-pressed'] = 'true';
  page.run("paintViewButtons('calendar')");
  assert.strictEqual(prefs.attrs['aria-pressed'], 'true', 'the sheet\'s own state is the sheet\'s to paint');
  assert.strictEqual(header.attrs['aria-pressed'], 'false');
  assert.strictEqual(bar.attrs['aria-pressed'], 'false');
});

test('setView on the view already showing changes nothing: no redraw, no jump of the Calendar or the Gantt', async () => {
  const page = await loadPage({ board: BOARD, stored: { 'kanban.k.view.mode': 'calendar' } }).start();
  page.run('globalThis.__n = { render: 0, move: 0 }; renderBoard = () => { __n.render++; }; moveViewToNearestMatch = () => { __n.move++; };');
  page.run("setView('calendar')");
  assert.deepStrictEqual(JSON.parse(page.run('JSON.stringify(__n)')), { render: 0, move: 0 });
  page.run("setView('gantt')");
  assert.deepStrictEqual(JSON.parse(page.run('JSON.stringify(__n)')), { render: 1, move: 1 }, 'another view still draws');
});

test('toggleView goes through setView: the current view\'s header button returns to the Board', async () => {
  const page = await loadPage({ board: BOARD, stored: { 'kanban.k.view.mode': 'map' } }).start();
  page.run('renderBoard = () => {}; moveViewToNearestMatch = () => {};');
  page.run("toggleView('map')");
  assert.strictEqual(page.run('loadViewMode()'), 'board');
  page.run("toggleView('graph')");
  assert.strictEqual(page.run('loadViewMode()'), 'graph');
  page.run("toggleView('calendar')");
  assert.strictEqual(page.run('loadViewMode()'), 'calendar', 'pressing another view\'s button jumps straight there');
});

test('a status pill ignores a click and a right-click while a card, a Gantt bar or a Calendar chip is being dragged', async () => {
  const page = await loadPage({ board: BOARD }).start();
  page.run('globalThis.__g = 0; applyStatusGesture = () => { __g++; };');
  const pill = { dataset: { col: 'todo' } };
  const e = () => ({ target: { closest: () => pill }, preventDefault() {} });
  for (const flag of ['isDragging', 'ganttDrag', 'calTimeDrag']) {
    page.run(`${flag} = {}`);
    page.ctx.__e = e();
    page.run('onStatusPillClick(__e); onStatusPillContextMenu(__e)');
    assert.strictEqual(page.run('__g'), 0, flag);
    page.run(`${flag} = ${flag === 'isDragging' ? 'false' : 'null'}`);
  }
  page.ctx.__e = e();
  page.run('onStatusPillClick(__e); onStatusPillContextMenu(__e)');
  assert.strictEqual(page.run('__g'), 2, 'with no drag both gestures reach the view');
});

test('New card on a phone presets the status tab only when the Board is the view showing', async () => {
  const run = async (view) => {
    const newBtn = control();
    const page = loadPage({ board: BOARD, stored: { 'kanban.k.view.mode': view, 'kanban.k.columns.phone': 'done' }, elements: { '#new-btn': newBtn } });
    page.ctx.matchMedia = phoneMedia(true);
    await page.start();
    page.run('globalThis.__opened = []; openModal = (...a) => { __opened.push(a); };');
    newBtn.fire('click', {});
    return JSON.parse(page.run('JSON.stringify(__opened)'));
  };
  assert.deepStrictEqual(await run('board'), [[null, 'done']]);
  assert.deepStrictEqual(await run('calendar'), [[null, null]], 'no tab is on screen in the Calendar');
});

test('the Map\'s first tree heading, inside the .map-trees wrapper, takes the first-heading rule', () => {
  assert.match(css, /\.map-section-header \+ \.map-trees > \.map-graph-heading:first-child/);
  assert.doesNotMatch(css, /\.map-section-header \+ \.map-graph-heading/);
});

test('the full-screen edit form and the detail modal fall back to 100vh and use 100dvh where it is known', () => {
  for (const sel of ['#card-form', '.detail-modal']) {
    const line = css.split('\n').find((l) => l.trim().startsWith(`${sel} { position: fixed; inset: 0;`));
    assert.ok(line, sel);
    assert.match(line, /height: 100vh; height: 100dvh;/, sel);
  }
});

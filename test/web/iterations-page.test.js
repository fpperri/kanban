const { test } = require('node:test');
const assert = require('node:assert');
const { loadPage, control, harmless } = require('./helpers/page-vm');

// The real page, run in a vm (helpers/page-vm.js): the iteration dropdown in the header. With
// iterations on it opens on the running iteration, a pick cuts what every view draws on top of the
// search box without writing it, "New iteration..." opens the group form with the next draft, and the
// choice is kept in this browser. The rules are pinned in iterations.test.js.

const card = (id, over = {}) => ({
  id, title: `Card ${id}`, body: '', status: 'todo', priority: 'Normal', waiting_for: [], blocked: null,
  review: null, tags: [], assignee: null, type: null, start_date: '2026-10-14', end_date: '2026-10-15', due_date: null,
  parent: null, rank: null, file: `/board/${id}.card.md`, archived: false, ...over,
});

const group = (id, name, folder, start, end, cards) => ({ id, name, folder, start_date: start, end_date: end, auto_join: true, cards, extra: {}, file: `.groups/${folder}/${id}.md` });

function boardWith({ iterations = true, groups = true } = {}) {
  return {
    projectName: 'plan',
    statuses: ['backlog', 'todo', 'doing', 'done'],
    priorities: ['High', 'Normal', 'Low'],
    assignees: [], tags: [], types: [], notifications: [],
    active: ['3', '7', '15', '2', '5'].map((id) => card(id)),
    archived: [card('9', { archived: true })],
    iterations,
    groups: groups ? {
      folder: '.groups', folders: ['', 'iteration', 'workflow'], prefixes: { iteration: 'I' }, skipped: [],
      list: [
        group('I1', 'zephyr-1', 'iteration', '2026-09-28', '2026-10-09', ['2', '5', '9']),
        group('I2', 'zephyr-2', 'iteration', '2026-10-12', '2026-10-23', ['3', '7', '15']),
        group('W1', 'orders-cutover', 'workflow', '2026-10-12', '2026-10-23', ['2']),
      ],
    } : null,
  };
}

function selectBox() {
  const sel = control();
  sel.options = [];
  sel.replaceChildren = (...options) => { sel.options = options; };
  return sel;
}

async function pageOn({ today = '2026-10-15', stored = {}, board = boardWith() } = {}) {
  const sel = selectBox();
  const page = loadPage({ board, stored, elements: { '#iter-select': sel }, documentExtras: { createElement: (tag) => (tag === 'option' ? {} : harmless(`<${tag}>`)) } });
  page.ctx.localTodayStr = () => today;
  await page.start();
  page.sel = sel;
  page.stored = stored;
  assert.deepStrictEqual(page.failures.map((e) => e.message), [], 'the page starts without an error');
  return page;
}

const sorted = (set) => [...set].sort();
const optionTexts = (page) => page.sel.options.map((o) => `${o.value}|${o.textContent}`);

test('with iterations on the dropdown lists All cards, the iterations newest first with their dates, and New iteration', async () => {
  const page = await pageOn();
  assert.deepStrictEqual(optionTexts(page), [
    '|All cards',
    'I2|#I2 zephyr-2 · 2026-10-12 to 2026-10-23 · running',
    'I1|#I1 zephyr-1 · 2026-09-28 to 2026-10-09',
    '__new|New iteration…',
  ]);
  assert.strictEqual(page.sel.hidden, false);
});

test('it opens on the running iteration, or on All cards when none runs', async () => {
  const running = await pageOn({ today: '2026-10-15' });
  assert.strictEqual(running.sel.value, 'I2');
  assert.deepStrictEqual(sorted(running.run('iterationCutIds()')), ['15', '3', '7']);
  const idle = await pageOn({ today: '2026-11-30' });
  assert.strictEqual(idle.sel.value, '');
  assert.strictEqual(idle.run('iterationCutIds()'), null);
});

test('without iterations: true, or without groups, there is no dropdown and no cut', async () => {
  const off = await pageOn({ board: boardWith({ iterations: false }) });
  assert.strictEqual(off.sel.hidden, true);
  assert.strictEqual(off.run('iterationCutIds()'), null);
  const noGroups = await pageOn({ board: boardWith({ groups: false }) });
  assert.strictEqual(noGroups.sel.hidden, true);
  assert.strictEqual(noGroups.run('iterationCutIds()'), null);
});

test('the pick narrows the cards the Board, the Calendar, the Gantt, the Map and the Graph draw', async () => {
  const page = await pageOn();
  for (const mode of ['board', 'map', 'calendar', 'gantt', 'graph']) {
    page.run(`viewMode = '${mode}'`);
    assert.deepStrictEqual(sorted(page.run('viewCardIds(true)')), ['15', '3', '7'], mode);
    assert.deepStrictEqual(sorted(page.run('viewCardIds(false)')), ['15', '3', '7'], `${mode} before the box`);
  }
  assert.deepStrictEqual(sorted(page.run('calendarViewInput().searchIds')), ['15', '3', '7']);
  assert.deepStrictEqual(sorted(page.run('ganttViewInput().searchIds')), ['15', '3', '7']);
  assert.deepStrictEqual(sorted(page.run('currentGraphQueryEffect().visibleIds')), ['15', '3', '7']);
});

test('the cut sits on top of the search box: both must say yes, and the box is never written', async () => {
  const page = await pageOn();
  page.input.typed('card 7');
  const writes = page.input.writes.length;
  assert.deepStrictEqual(sorted(page.run('calendarViewInput().searchIds')), ['7']);
  page.input.typed('card 2');
  assert.deepStrictEqual(sorted(page.run('calendarViewInput().searchIds')), [], 'card 2 matches the box but sits outside the iteration');
  page.run(`viewMode = 'board'`);
  assert.deepStrictEqual(sorted(page.run('viewCardIds(true)')), []);
  assert.strictEqual(page.input.writes.length, writes, 'picking and cutting never write the box');
});

test('picking All cards or another iteration repaints the views, keeps the pick in this browser and writes nothing to the box', async () => {
  const page = await pageOn();
  page.sel.value = '';
  page.sel.fire('change');
  assert.strictEqual(page.run('iterationCutIds()'), null);
  assert.strictEqual(page.stored['kanban.plan.iteration'], '{"pick":"","under":"I2"}', 'kept with the iteration that was running');
  page.sel.value = 'I1';
  page.sel.fire('change');
  assert.deepStrictEqual(sorted(page.run('iterationCutIds()')), ['2', '5', '9']);
  assert.strictEqual(page.stored['kanban.plan.iteration'], '{"pick":"I1","under":"I2"}');
  assert.strictEqual(page.input.writes.length, 0);
  page.run(`viewMode = 'board'`);
  assert.deepStrictEqual(sorted(page.run('viewCardIds(true)')), ['2', '5'], 'the Board shows its expanded columns: the Archive column, with member 9, is folded');
  page.run(`viewMode = 'map'`);
  assert.deepStrictEqual(sorted(page.run('viewCardIds(true)')), ['2', '5', '9'], 'the Map reaches an archived member');
});

test('a pick kept in this browser wins over the running iteration, All cards included', async () => {
  const kept = await pageOn({ stored: { 'kanban.plan.iteration': '{"pick":"I1"}' } });
  assert.strictEqual(kept.sel.value, 'I1');
  const all = await pageOn({ stored: { 'kanban.plan.iteration': '{"pick":""}' } });
  assert.strictEqual(all.sel.value, '');
  const gone = await pageOn({ stored: { 'kanban.plan.iteration': '{"pick":"I77"}' } });
  assert.strictEqual(gone.sel.value, 'I2', 'an iteration that is gone falls back to the running one');
  const junk = await pageOn({ stored: { 'kanban.plan.iteration': 'not json' } });
  assert.strictEqual(junk.sel.value, 'I2');
});

test('a pick kept under an iteration that has since ended yields to the running iteration', async () => {
  const stored = { 'kanban.plan.iteration': '{"pick":"I1","under":"I2"}' };
  assert.strictEqual((await pageOn({ today: '2026-10-15', stored })).sel.value, 'I1', 'I2 still runs: the pick holds');
  assert.strictEqual((await pageOn({ today: '2026-11-30', stored })).sel.value, '', 'I2 ended, none runs: All cards');
  const allKept = { 'kanban.plan.iteration': '{"pick":"","under":"I1"}' };
  assert.strictEqual((await pageOn({ today: '2026-10-15', stored: allKept })).sel.value, 'I2', 'a kept All cards yields to the running one');
});

test('a pick made while none ran is kept under none', async () => {
  const page = await pageOn({ today: '2026-11-30' });
  page.sel.value = 'I1';
  page.sel.fire('change');
  assert.strictEqual(page.stored['kanban.plan.iteration'], '{"pick":"I1","under":""}');
});

test('New iteration... opens the group form with the next draft and leaves the pick where it was', async () => {
  const page = await pageOn();
  const opened = [];
  page.ctx.openGroupForm = (draft) => { opened.push(draft); };
  page.sel.value = '__new';
  page.sel.fire('change');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(opened)), [{ folder: 'iteration', name: 'zephyr-3', start_date: '2026-10-24', end_date: '2026-11-04', auto_join: true }]);
  assert.strictEqual(page.sel.value, 'I2');
  assert.strictEqual(page.run('iterationCutIds() !== null'), true);
  assert.deepStrictEqual(page.stored, {}, 'opening the form keeps nothing');
});

test('the Calendar moves to the picked iteration\'s first day when the person picks it, never on load, and shades its days', async () => {
  const page = await pageOn();
  assert.strictEqual(page.run('calendarAnchor'), null, 'a page that opens on the running iteration has not moved the Calendar');
  const kept = await pageOn({ stored: { 'kanban.plan.iteration': '{"pick":"I1","under":"I2"}' } });
  assert.strictEqual(kept.run('calendarAnchor'), null, 'nor one that opens on a kept pick');
  const shaded = page.run('iterationDayShader()');
  assert.deepStrictEqual(['2026-10-11', '2026-10-12', '2026-10-23', '2026-10-24'].map((d) => shaded(d)), [false, true, true, false]);
  page.sel.value = 'I1';
  page.sel.fire('change');
  assert.strictEqual(page.run('calendarAnchor'), '2026-09-28');
  assert.strictEqual(page.run(`iterationDayShader()('2026-10-12')`), false);
  page.run(`calendarAnchor = '2026-09-01'`);
  page.run('renderBoard()');
  assert.strictEqual(page.run('calendarAnchor'), '2026-09-01', 'a refresh that keeps the pick leaves the Calendar where the person put it');
  page.sel.value = '';
  page.sel.fire('change');
  assert.strictEqual(page.run(`iterationDayShader()('2026-09-30')`), false, 'All cards shades nothing');
});

test('the dropdown is a header control that keeps the selection and holds the refresh while it is focused', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web', 'app.html'), 'utf8');
  const tag = html.match(/<select id="iter-select"[^>]*>/)[0];
  assert.match(tag, /data-keeps-selection/);
  assert.match(tag, /data-holds-poll/);
  assert.match(tag, /\bhidden\b/, 'hidden until the board says iterations are on');
  const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>'));
  assert.ok(header.includes('id="iter-select"'));
});

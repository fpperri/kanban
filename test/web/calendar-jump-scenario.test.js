const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scenario = require('./browser/scenarios/calendar-jump');
const scenarios = require('./browser/scenarios');
const { BOARDS } = require('./browser/boards');

// The browser runner's calendar-jump scenario runs in a browser in CI. What can
// be checked without one is checked here: how it is declared, that it reads the
// month from the page, that it waits on the page and never on a pause, and that
// it runs through to its last check against a page that answers each call.

const source = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'calendar-jump.js'), 'utf8');
const code = source.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

test('the calendar-jump scenario is in the runner, on the plan board', () => {
  assert.ok(scenarios.includes(scenario));
  assert.strictEqual(scenario.name, 'calendar-jump');
  assert.strictEqual(scenario.board, 'plan');
  assert.ok(BOARDS[scenario.board]);
  assert.strictEqual(typeof scenario.run, 'function');
  assert.ok(scenario.timeoutMs >= 1000 && scenario.timeoutMs <= 120000);
});

test('the plan board holds the card the scenario aims at: dated in June 2031, and the only card dated in 2031', () => {
  const dir = path.join(__dirname, 'browser', 'fixture-plan');
  const dated = fs.readdirSync(dir).filter((f) => f.endsWith('.card.md'))
    .map((f) => ({ f, text: fs.readFileSync(path.join(dir, f), 'utf8') }))
    .filter((c) => /^(start_date|end_date|due_date): 2031/m.test(c.text));
  assert.deepStrictEqual(dated.map((c) => c.f), ['0028.plan-the-centennial-review.card.md']);
  assert.match(dated[0].text, /^start_date: 2031-06-02$/m);
  assert.match(dated[0].text, /^# Plan the centennial review$/m);
  const matching = fs.readdirSync(dir).filter((f) => f.endsWith('.card.md'))
    .filter((f) => /centennial/i.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(matching, ['0028.plan-the-centennial-review.card.md'], 'the query matches that card alone');
  const fixture = path.join(__dirname, 'browser', 'fixture');
  const inBase = fs.readdirSync(fixture).filter((f) => f.endsWith('.card.md'))
    .filter((f) => /centennial/i.test(fs.readFileSync(path.join(fixture, f), 'utf8')));
  assert.deepStrictEqual(inBase, [], 'and the fixture board under it holds no other match');
});

test('the scenario never names a month of the calendar for today, and waits on the page, not on a pause', () => {
  assert.ok(!/\bsleep\(/.test(code), 'no fixed pause');
  assert.ok(!/\bpause\(/.test(code), 'no fixed pause');
  const named = code.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (19|20)\d\d\b/g) || [];
  assert.deepStrictEqual([...new Set(named)], ['June 2031'], 'the only month written out is the 2031 one the card is dated in');
  assert.match(code, /new Date\(\)/, 'today is read from the page');
});

// A page that answers every call. The month the scenario asks for is read from the
// stand-in's clock, so a scenario that hard-coded one would still run, and the
// separate test above catches that.
function standInPage() {
  const log = { evals: [], waits: [], opened: [], checks: [] };
  return {
    log,
    ev: async (expr) => {
      log.evals.push(expr);
      if (/new Date\(\)/.test(expr)) return [2026, 11];
      return '';
    },
    open: async (url) => { log.opened.push(url); },
    waitFor: async (expr) => { log.waits.push(expr); return true; },
    check: (name, ok, detail) => log.checks.push({ name, ok, detail }),
    shot: async () => {},
  };
}

test('the scenario runs through against a page that answers each call, opening the views by their links', async () => {
  const page = standInPage();
  await scenario.run(page);
  assert.ok(page.log.opened.includes('/?view=calendar'));
  assert.ok(page.log.opened.includes('/?view=gantt'));
  assert.ok(page.log.opened.includes('/?view=board&q=centennial'), 'the query arrives with the Board showing, so entering a view is what moves it');
  assert.ok(page.log.opened.includes('/?view=calendar&q=centennial'));
  const names = page.log.checks.map((c) => c.name);
  for (const wanted of [
    'a query that matches only the card dated in 2031 moves the Calendar to that card\'s month',
    'a query that matches only the card dated in 2031 moves the Gantt\'s month sub-view to that card\'s month',
    'the All sub-view did not move: its Month sub-view opens on the page\'s own current month',
    'after a jump, next pages one month on',
    'and previous pages back',
    'and keeps the paged month',
    'entering the Calendar with that query already in the box shows the 2031 month',
    'entering the Gantt with that query already in the box shows the 2031 month',
  ]) {
    assert.ok(names.includes(wanted), `a check is made: ${wanted}`);
  }
});

test('the scenario asks the page for the month it opens on: the stand-in\'s December 2026 reaches the first title it waits for', async () => {
  const page = standInPage();
  await scenario.run(page);
  assert.ok(page.log.waits.some((w) => w.includes('"December 2026"')), 'the current month, named from the page\'s date');
  assert.ok(page.log.waits.some((w) => w.includes('"June 2031"')));
  assert.ok(page.log.waits.some((w) => w.includes('"July 2031"')), 'one month on from the jump');
  assert.ok(page.log.waits.some((w) => w.includes('"May 2031"')), 'two months back from that');
});

// The plan board's own cards, read by the board's readers and handed to the real
// page in a vm, the way /api/board hands them to a browser. The page's anchor
// starts on the page's own today, so this holds on any date. It is what the
// scenario expects of the browser, minus the drawing.
test('on the plan board\'s own cards the page does what the scenario expects, from the page\'s own today', async () => {
  const cs = require('../../plugin/skills/web/scripts/card-store');
  const { readConfig } = require('../../plugin/skills/web/scripts/config-store');
  const { materialize } = require('./browser/boards');
  const { loadPage } = require('./helpers/page-vm');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kanban-jump-'));
  try {
    const dir = path.join(root, 'board');
    materialize('plan', dir);
    const config = readConfig(dir);
    const payload = {
      projectName: config.name, assignees: config.assignees, priorities: config.priorities, tags: config.tags,
      statuses: config.statuses, types: config.types, notifications: [],
      active: cs.listActive(dir).map(cs.toJSON), archived: cs.listArchived(dir).map(cs.toJSON),
    };
    const open = async (query, view) => {
      const page = loadPage({ board: payload });
      await page.start();
      if (view) page.run(`toggleView('${view}')`);
      if (query) page.input.typed(query);
      return page;
    };
    const monthOf = (page, which) => page.run(`(() => { const m = ${which}; return m.year * 12 + m.monthIndex; })()`);
    const now = new Date();
    const thisMonth = now.getFullYear() * 12 + now.getMonth();
    const june2031 = 2031 * 12 + 5;
    const calendarMonth = (page) => monthOf(page, 'currentCalendarMonth()');
    const ganttMonth = (page) => page.run(`(() => { const [y, m] = currentGanttAnchor().split('-').map(Number); return y * 12 + m - 1; })()`);

    const calendar = await open(null, 'calendar');
    assert.strictEqual(calendarMonth(calendar), thisMonth, 'the Calendar opens on the page\'s own month');
    calendar.input.typed('centennial');
    assert.strictEqual(calendarMonth(calendar), june2031, 'a query that matches the 2031 card alone moves it there');
    calendar.run('shiftCalendarWindow(1)');
    assert.strictEqual(calendarMonth(calendar), june2031 + 1);
    calendar.run('shiftCalendarWindow(-1)');
    calendar.run('shiftCalendarWindow(-1)');
    assert.strictEqual(calendarMonth(calendar), june2031 - 1);
    await calendar.run('autoRefreshTick()');
    assert.strictEqual(calendarMonth(calendar), june2031 - 1, 'a poll keeps the paged month');

    const entering = await open('centennial', null);
    entering.run(`toggleView('calendar')`);
    assert.strictEqual(calendarMonth(entering), june2031, 'entering the Calendar with the query in the box');

    const link = loadPage({ board: payload, search: '?view=calendar&q=centennial' });
    await link.start();
    assert.strictEqual(calendarMonth(link), june2031, 'a link into the Calendar with the query');

    const all = await open(null, 'gantt');
    all.input.typed('centennial');
    all.run(`setGanttSubview('month')`);
    assert.strictEqual(ganttMonth(all), thisMonth, 'the All sub-view did not move');
    all.input.typed('');
    all.input.typed('centennial');
    assert.strictEqual(ganttMonth(all), june2031, 'the Month sub-view moves to the 2031 card\'s month on a write');
    all.run('shiftGanttWindow(1)');
    assert.strictEqual(ganttMonth(all), june2031 + 1);

    const gantt = await open('centennial', null);
    gantt.run(`setGanttSubview('month')`);
    gantt.run(`toggleView('gantt')`);
    assert.strictEqual(ganttMonth(gantt), june2031, 'entering the Gantt with the query in the box');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

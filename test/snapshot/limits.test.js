const { test } = require('node:test');
const assert = require('node:assert');
const { byClass } = require('./page-harness');
const { withBuiltBoard } = require('./search-table');
const { BOARD } = require('./nesting-fixture');
const { open, sheet, tile } = require('./nesting-view');
const { blurBox, boxEl, boxText, openPanel, pill } = require('./panel-table');
const logbook = require('../../plugin/skills/web/scripts/logbook-store');
const scratchpad = require('../../plugin/skills/web/scripts/scratchpad-store');
const todos = require('../../plugin/skills/web/scripts/todo-store');
const { readGroups } = require('../../plugin/skills/web/scripts/group-store');

// What the snapshot editor leaves to kanban-web, held to the page it builds: the notes kit, the hover
// set, the Calendar's jump to the nearest match, the Map's options, the roll-up bar's mode, the
// done warning, kanban-web's keys and a preferences sheet. The skill and docs/snapshot.md say so;
// these are the behaviour they describe, so a feature added to the page by accident shows here.

const press = (page, key) => { blurBox(page); return page.key(page.byId('board'), key); };

test('a board that keeps a logbook, groups, scratchpads, todo lists and iterations is drawn without any of them', () => {
  withBuiltBoard('todos', (page, dir, html) => {
    const texts = [
      ...logbook.listNotes(dir).map((n) => n.note),
      ...['7', 'I2'].flatMap((id) => [scratchpad.readPad(dir, id).body.trim(), ...todos.readTodos(dir, id).lines.filter((l) => l.item).map((l) => l.text)]),
    ].filter((t) => t.length > 6);
    assert.ok(texts.length >= 5, 'the board holds notes, pages and lists');
    assert.ok(readGroups(dir).list.length >= 2, 'and groups');
    assert.ok(!html.includes('auto_join'), 'the page knows no group file');
    for (const text of texts) assert.ok(!html.includes(text), `the page does not carry "${text.slice(0, 40)}"`);
    assert.ok(!/\/api\//.test(html), 'the page asks no server for anything');
    for (const name of ['openNotes', 'scratchPanel', 'todosPanel', 'groupBadges', 'iterationPicker']) assert.strictEqual(page.run(`typeof ${name}`), 'undefined', name);
  });
});

test('the page has no On hover show section and no key for it', () => {
  withBuiltBoard('plan', (page, dir, html) => {
    assert.ok(!html.includes('hover.show') && !html.includes('search-hover'));
    openPanel(page);
    assert.deepStrictEqual(page.byId('search-panel').all().filter((n) => /hover/i.test(n.id) || /hover/i.test(n.className)), []);
  });
});

test('a search that matches only a card in another month leaves the Calendar on the month it shows', () => {
  withBuiltBoard('malformed', (page) => {
    page.run('switchView("calendar")');
    const before = page.plain(page.run('[calY, calM]'));
    page.type(page.byId('q'), '#4');
    assert.deepStrictEqual(page.plain(page.run('[calY, calM]')), before);
    assert.ok(!byClass(page.byId('calview'), 'cal-chip').some((c) => c.textContent === '#4'), 'card 4, dated in 2030, is not on the month shown');
  });
});

test('the Map has no options row: nothing in it is a control but the status pills, and no choice is kept', () => {
  withBuiltBoard('plan', (page, dir, html) => {
    page.run('switchView("map")');
    const view = page.byId('mapview');
    assert.deepStrictEqual(view.all().filter((n) => ['SELECT', 'INPUT', 'TEXTAREA'].includes(n.tagName)), []);
    assert.ok(!html.includes('map.options'));
    assert.strictEqual(page.run('typeof mapOptionsRowHtml'), 'undefined');
  });
});

test('a parent moved to done with leaves open queues the move and nothing else: there is no warning', () => {
  open(BOARD, (page) => {
    assert.ok(!page.scripts.some((src) => /open leaves/i.test(src)), 'the page carries no such warning');
    page.run('queue({op:"move",id:"1",to:"done"})');
    const text = page.run('payload()');
    assert.deepStrictEqual(JSON.parse(text.slice(text.indexOf('\n') + 1)), [{ op: 'move', id: '1', to: 'done' }]);
  });
});

test('a click on a roll-up bar opens the card and leaves every bar as thin as it was: the snapshot has no bar mode', () => {
  open(BOARD, (page) => {
    const bars = () => byClass(page.byId('board'), 'rollup-bar');
    const before = bars().map((b) => b.classList.contains('thin'));
    assert.ok(before.length > 0 && before.every(Boolean), 'the tiles carry thin bars');
    page.click(bars()[0]);
    assert.ok(page.byId('modalscroll').children.length > 0, 'the card opens');
    assert.deepStrictEqual(bars().map((b) => b.classList.contains('thin')), before);
  });
});

test('a badge on a tile is no filter: a tap on the assignee opens the card and writes nothing in the box', () => {
  withBuiltBoard('plan', (page) => {
    const asg = byClass(page.byId('board'), 'meta')[0];
    assert.ok(asg, 'a tile with an assignee');
    page.click(asg);
    assert.strictEqual(boxText(page), '');
  });
});

test('kanban-web\'s l, m, i, n and ? keys do nothing on the page: not handled, the box and the panel as they were', () => {
  withBuiltBoard('plan', (page) => {
    for (const key of ['l', 'm', 'i', 'n', '?']) {
      assert.strictEqual(press(page, key), false, `${key} is not taken`);
      assert.strictEqual(boxText(page), '', `${key} writes nothing`);
      assert.ok(page.byId('search-panel').classList.contains('hidden'), `${key} opens nothing`);
    }
  });
});

test('the panel\'s switch and folds are for the visit: flipping them writes nothing to the browser, and a new page has the defaults', () => {
  withBuiltBoard('plan', (page, dir, html) => {
    page.run('globalThis.__writes = []; localStorage.setItem = (k) => { globalThis.__writes.push(k); }');
    openPanel(page);
    page.click(page.byId('search-panel-toggle'));
    page.click(page.byId('search-panel-toggle'));
    openPanel(page);
    for (const id of ['search-slices-fold', 'search-pills-fold']) {
      const before = page.byId(id).getAttribute('aria-expanded');
      page.click(page.byId(id));
      assert.notStrictEqual(page.byId(id).getAttribute('aria-expanded'), before, `${id} folded`);
    }
    assert.deepStrictEqual(page.plain(page.run('__writes')), []);
    assert.ok(!/search\.panel|panel\.on|panelOnFocus/.test(html), 'the page names no key for them');
  });
  withBuiltBoard('plan', (page) => {
    assert.strictEqual(page.byId('search-panel-toggle').getAttribute('aria-pressed'), 'true');
  });
});

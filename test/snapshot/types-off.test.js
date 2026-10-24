const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../../plugin/skills/web/scripts/config-store');
const { boardTypeView } = require('../../plugin/skills/web/web/type-badge');
const { sliceCards, sliceDepths } = require('../../plugin/skills/web/web/slices');
const { BOARD, withSnapshot } = require('./nesting-fixture');
const { byClass } = require('./page-harness');
const { open, sheet, tile, tiles } = require('./nesting-view');

// Types off (typesOn: false, docs/adr/0018) in the snapshot: the same rule as kanban-web, read from
// config.yaml in Python. The page is built with no types and no hierarchy, so its chips, colors,
// icons, tiers and Type fields are the ones of a board that declares none. The cards stay as written.

const LISTS = 'hierarchy: [objective, epic, story]\n';
const OFF = { ...BOARD, config: `typesOn: false\n${LISTS}${BOARD.config}` };
const ON = { ...BOARD, config: `${LISTS}${BOARD.config}` };

const embeddedConst = (html, name) => JSON.parse(new RegExp(`const ${name}=(.*);\\n`).exec(html)[1]);
const modal = (page) => page.byId('modalscroll');
const control = (page, pred) => modal(page).all().find(pred);

test('a board with typesOn: false is built with no types, no hierarchy and the flag off', () => {
  withSnapshot(OFF, (html) => {
    assert.deepStrictEqual(embeddedConst(html, 'TYPES'), []);
    assert.deepStrictEqual(embeddedConst(html, 'HIERARCHY'), []);
    assert.strictEqual(embeddedConst(html, 'TYPES_ON'), false);
  });
});

test('a board with no typesOn line, or typesOn: true, is built with its lists and the flag on', () => {
  for (const board of [ON, { ...BOARD, config: `typesOn: true\n${LISTS}${BOARD.config}` }]) {
    withSnapshot(board, (html) => {
      assert.deepStrictEqual(embeddedConst(html, 'HIERARCHY'), ['objective', 'epic', 'story']);
      assert.deepStrictEqual(embeddedConst(html, 'TYPES').map((t) => t.name), ['objective', 'epic', 'story']);
      assert.strictEqual(embeddedConst(html, 'TYPES_ON'), true);
    });
  }
});

test('the snapshot reads typesOn as kanban-web does, and embeds what the web gives its views', () => {
  const forms = [
    'typesOn: false\n', 'typesOn: false   # display only\n', 'typesOn: "false"\n', 'typesOn: true\n', 'typesOn:\n', 'typesOn: no\n', '',
    'assignees:\n  - handle: "@x"\n    typesOn: false\n',
  ];
  for (const form of forms) {
    const config = `name: b\nstatuses: [todo, done]\n${form}types:\n  - name: goal\n    icon: star\n  - epic\nhierarchy: [goal, epic]\n`;
    const web = boardTypeView(parseConfig(config));
    withSnapshot({ ...BOARD, config }, (html) => {
      assert.deepStrictEqual(embeddedConst(html, 'TYPES'), web.types, JSON.stringify(form));
      assert.deepStrictEqual(embeddedConst(html, 'HIERARCHY'), web.hierarchy, JSON.stringify(form));
      assert.strictEqual(embeddedConst(html, 'TYPES_ON'), web.typesOn, JSON.stringify(form));
    });
  }
});

test('with types off no tile wears a type chip, and with types on the typed ones do', () => {
  open(OFF, (page) => {
    assert.ok(tiles(page).length > 5);
    for (const t of tiles(page)) assert.strictEqual(byClass(t, 'type-chip').length, 0, `card ${t.dataset.card}`);
  });
  open(ON, (page) => {
    assert.strictEqual(byClass(tile(page, 1), 'type-chip').length, 1);
  });
});

test('with types off the sheet has no type pill and the All fields grid has no type field', () => {
  open(OFF, (page) => {
    sheet(page, 1);
    assert.strictEqual(control(page, (n) => n.dataset.pill === 'type'), undefined);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.strictEqual(control(page, (n) => n.id === 'fm-type'), undefined, 'a card that has a type');
    assert.ok(control(page, (n) => n.id === 'fm-parent'), 'the other fields are still there');
  });
  open(OFF, (page) => {
    sheet(page, 8);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.strictEqual(control(page, (n) => n.id === 'fm-type'), undefined, 'a card that has none');
  });
  open(ON, (page) => {
    sheet(page, 1);
    assert.ok(control(page, (n) => n.dataset.pill === 'type'));
  });
});

test('with types off an edit from the sheet queues no change to a card\'s type', () => {
  open(OFF, (page) => {
    sheet(page, 1);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    control(page, (n) => n.id === 'fm-parent').value = '8';
    page.click(control(page, (n) => n.dataset.act === 'fmsave' && n.dataset.key === 'parent'));
    const text = page.run('payload()');
    assert.deepStrictEqual(JSON.parse(text.slice(text.indexOf('\n') + 1)), [{ op: 'edit', id: '1', fm: { parent: '8' } }]);
  });
});

test('with types off the Map\'s rich row reserves no type line and draws no chip', () => {
  open(OFF, (page) => {
    assert.strictEqual(page.run('typeChip(DATA[0])'), null);
    const rich = page.plain(page.run('richOf({ card: { fm: { type: "story" } }, id: "1", blk: null }, { altitudeOf: () => 0, rollup: () => null })'));
    assert.strictEqual(rich.type, '');
    assert.strictEqual(rich.hasMeta, false);
  });
  open(ON, (page) => {
    const rich = page.plain(page.run('richOf({ card: { fm: { type: "story" } }, id: "1", blk: null }, { altitudeOf: () => 0, rollup: () => null })'));
    assert.strictEqual(rich.type, 'story');
    assert.strictEqual(rich.hasMeta, true);
  });
});

test('with types off the page\'s slices are the depths, as on the web and as on a board with no hierarchy', () => {
  open(OFF, (page) => {
    const onPage = page.plain(page.run('(() => { const cards = DATA.map(searchCard); const { axis } = sliceCards(cards, HIERARCHY, sliceDepths(cards, HIERARCHY, { board: BOARD })); return axis.map((s) => s.kind); })()'));
    assert.ok(onPage.length > 0);
    assert.ok(onPage.every((k) => k === 'depth'));
    const cards = [{ id: '1', type: 'objective' }, { id: '2', type: 'epic', parent: '1' }];
    const web = boardTypeView({ typesOn: false, hierarchy: ['objective', 'epic'] });
    assert.deepStrictEqual(sliceCards(cards, web.hierarchy, sliceDepths(cards, web.hierarchy, { board: 'b' })).axis.map((s) => s.kind), onPage.slice(0, 2));
  });
});

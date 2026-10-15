const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { materialize } = require('../../web/test/browser/boards');
const { buildScript, card, withSnapshot } = require('./nesting-fixture');
const { open, sheet, tile } = require('./nesting-view');
const { byClass, loadPage } = require('./page-harness');
const { withPlanPage } = require('./search-table');

// The snapshot page, run for real against a stand-in DOM: a type with an icon
// starts its chip with that glyph, in the chip's own colour, and a type with no
// icon, or an unknown icon name, draws the chip it always drew. The page also
// holds the board's own pills, in config order, for the panel that lists them.

// The six glyphs, written out here rather than read from the module under test.
const GLYPH = { circle: '\u25cf', square: '\u25a0', diamond: '\u25c6', triangle: '\u25b2', hexagon: '\u2b22', star: '\u2605' };

const embeddedConst = (html, name) => JSON.parse(new RegExp(`const ${name}=(.*);\\n`).exec(html)[1]);

const WIDE = { matchMedia: (q) => q.includes('min-width:900px') };

const chipOf = (node) => byClass(node, 'type-chip')[0];

// What a chip with no icon was before icons: one span, the type as its text, the
// type as its title, the colour on the style object, and nothing else.
function plainChip(type, color) {
  const style = { cssText: '' };
  if (color) { style.color = color; style.borderColor = color; }
  return { tag: 'SPAN', cls: 'type-chip', title: type, attrs: {}, style, text: type, kids: 0 };
}

const shapeOf = (chip) => ({
  tag: chip.tagName, cls: chip.className, title: chip.title, attrs: { ...chip.attrs }, style: { ...chip.style }, text: chip.textContent, kids: chip.children.length,
});

const board = (config, rows) => ({
  config: `name: icons\nstatuses: [todo, done]\n${config}`,
  cards: Object.fromEntries(rows.map(([id, type]) => [`${String(id).padStart(4, '0')}.c.card.md`, card(id, 'todo', `Card ${id}`, { type })])),
});

// Builds a fixture board of the browser runner, and hands fn the page and the built text.
function withBoardPage(key, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-icons-'));
  try {
    const dir = materialize(key, path.join(root, 'board'));
    const out = path.join(root, 'out.html');
    execFileSync('python', [buildScript, dir, '--out', out], { encoding: 'utf8' });
    const html = fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
    return fn(loadPage(html, WIDE), html);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('the plan board', () => {
  test('the page holds the board\'s pills in config order, each as a label and a query', () => {
    withPlanPage((page) => {
      assert.deepStrictEqual(page.plain(page.run('PILLS')), [
        { label: 'next', query: 'tags:"next-up"' },
        { label: 'assignee:@human', query: 'assignee:@human' },
        { label: 'tags:*', query: 'tags:*' },
      ]);
    });
  });

  test('a star-typed card\'s chip draws the star in its type\'s colour', () => {
    withPlanPage((page) => {
      const chip = chipOf(tile(page, 1));
      assert.strictEqual(chip.textContent, `${GLYPH.star}goal`);
      const [icon] = chip.children;
      assert.strictEqual(icon.className, 'type-icon');
      assert.strictEqual(icon.textContent, GLYPH.star);
      assert.strictEqual(chip.style.color, '#a371f7', 'the chip carries the type\'s colour');
      assert.strictEqual(chip.style.borderColor, '#a371f7');
      assert.strictEqual(icon.style.color, undefined, 'and the glyph takes it from the chip, with no colour of its own');
    });
  });

  test('each of the six icons draws its own outline on a chip, wherever the plan board gives it', () => {
    withPlanPage((page) => {
      const byCard = { 1: 'star', 2: 'hexagon', 7: 'diamond', 22: 'square', 11: 'circle', 15: 'triangle' };
      const seen = new Set();
      for (const [id, icon] of Object.entries(byCard)) {
        const chip = chipOf(tile(page, id));
        assert.strictEqual(chip.children[0].textContent, GLYPH[icon], `card ${id}: ${icon}`);
        assert.ok(chip.textContent.startsWith(GLYPH[icon]) && chip.textContent.length > 1, `card ${id}: the glyph comes before the name`);
        seen.add(chip.children[0].textContent);
      }
      assert.strictEqual(seen.size, 6, 'six icons, six different outlines');
    });
  });

  test('a type whose icon is not one of the six draws the chip it always drew', () => {
    withPlanPage((page) => {
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 14))), plainChip('bug'));
    });
  });

  test('the glyph shows in the card sheet too, and a colour from the config stays on the chip', () => {
    withPlanPage((page) => {
      const chip = chipOf(sheet(page, 22));
      assert.strictEqual(chip.children[0].textContent, GLYPH.square);
      assert.strictEqual(chip.style.color, '#d29922');
    });
  });
});

describe('a chip with no icon', () => {
  const CONFIG = [
    'types:',
    '  - name: plain',
    '    color: red',
    '  - name: blobbed',
    '    color: red',
    '    icon: Blob',
    '  - name: bare',
    '  - name: starred',
    '    icon: star',
    '',
  ].join('\n');
  const ROWS = [[1, 'plain'], [2, 'blobbed'], [3, 'bare'], [4, 'saga'], [5, 'starred'], [6, 'Plain'], [7, '"two words"']];

  test('with no icon, an unknown icon name, no entry or no list at all, it is the chip it was before icons, to the last attribute', () => {
    open(board(CONFIG, ROWS), (page) => {
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 1))), plainChip('plain', 'red'));
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 2))), plainChip('blobbed', 'red'));
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 3))), plainChip('bare'));
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 4))), plainChip('saga'));
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 6))), plainChip('Plain', 'red'));
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 7))), plainChip('two words'));
    });
    open(board('', [[1, 'plain']]), (page) => assert.deepStrictEqual(shapeOf(chipOf(tile(page, 1))), plainChip('plain')));
  });

  test('beside it, a chip for a type with an icon starts with the glyph and keeps its name as the title', () => {
    open(board(CONFIG, ROWS), (page) => {
      const chip = chipOf(tile(page, 5));
      assert.strictEqual(chip.textContent, `${GLYPH.star}starred`);
      assert.strictEqual(chip.title, 'starred', 'the title is the type, without the glyph');
      assert.strictEqual(chip.children.filter((n) => n.nodeType === 1).length, 1, 'the glyph is the only element in it');
      assert.strictEqual(chip.children[0].attrs['aria-hidden'], 'true', 'a screen reader reads the type, not the glyph');
    });
  });

  test('the icon is found whatever the case of the type or of the icon name', () => {
    const config = 'types:\n  - name: Epic\n    icon: SQUARE\n';
    open(board(config, [[1, 'epic'], [2, 'EPIC'], [3, ' epic ']]), (page) => {
      for (const id of [1, 2, 3]) assert.strictEqual(chipOf(tile(page, id)).children[0].textContent, GLYPH.square, `card ${id}`);
    });
  });

  test('the first entry of a type name decides its icon, as it decides its colour', () => {
    const config = 'types:\n  - name: epic\n  - name: epic\n    icon: star\n    color: red\n';
    open(board(config, [[1, 'epic']]), (page) => assert.deepStrictEqual(shapeOf(chipOf(tile(page, 1))), plainChip('epic')));
  });
});

describe('the Map', () => {
  const nodes = (view) => byClass(view, 'mnode');
  const label = (g) => byClass(g, 'mid')[0].textContent;

  test('a rich card on the Map wears the same chip, glyph first', () => {
    const rows = [[1, 'epic'], [2, 'plain']];
    const withParent = board('types:\n  - name: epic\n    icon: hexagon\n    color: "#a371f7"\n  - name: plain\n', rows);
    withParent.cards['0002.c.card.md'] = card(2, 'todo', 'Card 2', { type: 'plain', parent: 1 });
    withSnapshot(withParent, (html) => {
      const page = loadPage(html);
      const view = page.byId('mapview');
      const top = nodes(view).find((g) => label(g) === '#1');
      const chip = chipOf(top);
      assert.strictEqual(chip.textContent, `${GLYPH.hexagon}epic`);
      assert.strictEqual(chip.style.color, '#a371f7');
      const leaf = nodes(view).find((g) => label(g) === '#2');
      assert.deepStrictEqual(shapeOf(chipOf(leaf)), plainChip('plain'), 'a type with no icon is unchanged there too');
    });
  });
});

describe('markup in the config', () => {
  test('an icon name that looks like markup is carried as data, draws no glyph and becomes no class or element', () => {
    const hostile = ['<img src=x onerror=alert(1)>', 'star"><script>x</script>', 'url(javascript:x)', '__proto__', 'constructor'];
    const config = `types:\n${hostile.map((h, i) => `  - name: t${i}\n    color: red\n    icon: '${h}'\n`).join('')}`;
    withSnapshot(board(config, hostile.map((_, i) => [i + 1, `t${i}`])), (html) => {
      const page = loadPage(html, WIDE);
      assert.strictEqual(page.scripts.length, 9, 'no icon name closed a script element');
      assert.deepStrictEqual(embeddedConst(html, 'TYPES').map((t) => t.icon), hostile.map((h) => h.toLowerCase()), 'carried as the text it is');
      hostile.forEach((_, i) => {
        const chip = chipOf(tile(page, i + 1));
        assert.deepStrictEqual(shapeOf(chip), plainChip(`t${i}`, 'red'), `icon ${JSON.stringify(hostile[i])} draws the plain chip`);
      });
      assert.deepStrictEqual(page.byId('board').all().filter((n) => ['IMG', 'SCRIPT'].includes(n.tagName)), []);
    });
  });

  test('a pill label that looks like markup is carried as text', () => {
    const config = 'pills:\n  - "<img src=x onerror=alert(1)>": "title:</script><b>"\n  - "</SCRIPT >"\n';
    withSnapshot(board(config, [[1, 'epic']]), (html) => {
      const page = loadPage(html, WIDE);
      assert.strictEqual(page.scripts.length, 9);
      assert.deepStrictEqual(page.plain(page.run('PILLS')), [
        { label: '<img src=x onerror=alert(1)>', query: 'title:</script><b>' },
        { label: '</SCRIPT >', query: '</SCRIPT >' },
      ]);
      assert.deepStrictEqual(page.byId('board').all().filter((n) => ['IMG', 'SCRIPT', 'B'].includes(n.tagName)), []);
    });
  });
});

describe('the malformed board', () => {
  test('builds, holds only its valid pills, and renders with no script error', () => {
    withBoardPage('malformed', (page) => {
      assert.deepStrictEqual(page.plain(page.run('PILLS')), [
        { label: 'tags', query: 'grill' },
        { label: 'assignee:@human', query: 'assignee:@human' },
      ]);
      const ids = page.byId('board').all().filter((n) => n.classList.contains('card')).map((n) => Number(n.dataset.card)).sort();
      assert.deepStrictEqual(ids, [1, 2, 3, 4], 'every live card is drawn');
    });
  });

  test('a type with an unknown icon draws the plain chip, one with a star the star, and a type the list lacks the plain chip', () => {
    withBoardPage('malformed', (page) => {
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 1))), plainChip('Goal'), 'icon: blob is no icon');
      assert.strictEqual(chipOf(tile(page, 2)).textContent, `${GLYPH.star}epic`);
      assert.deepStrictEqual(shapeOf(chipOf(tile(page, 3))), plainChip('story'));
      assert.strictEqual(chipOf(tile(page, 4)), undefined, 'a card with no type has no chip');
    });
  });
});

describe('a board without the new keys', () => {
  test('holds no pills and draws its chips as before', () => {
    withBoardPage('fixture', (page) => {
      assert.deepStrictEqual(page.plain(page.run('PILLS')), []);
      assert.deepStrictEqual(page.plain(page.run('TYPES')), []);
      assert.strictEqual(byClass(page.byId('board'), 'type-icon').length, 0);
    });
  });
});

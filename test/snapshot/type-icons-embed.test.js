const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { topLevelDeclarations, pageScopeCollisions } = require('../../web/test/helpers/global-scope');
const { BOARD, buildScript, card, lf, withSnapshot, writeBoard } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');
const { withPlanPage } = require('./search-table');

// The snapshot carries the web's type icons module as the same source kanban-web
// runs, and only that module: the type chip module beside it pulls in the
// assignee badge module and has a two-argument type colour function that would
// silently replace the page's own one-argument one.

const webDir = path.join(__dirname, '..', '..', 'web', 'web');
const source = (file) => lf(fs.readFileSync(path.join(webDir, file), 'utf8'));
const MODULE = 'type-icons.js';
const PLACEHOLDER = '__TYPE_ICONS_JS__';

test('the built page contains the type icons module exactly, once, in its own script element ahead of the page script', () => {
  const text = source(MODULE);
  withSnapshot(BOARD, (html) => {
    const at = html.indexOf(text);
    assert.ok(at !== -1, 'the module source is in the page verbatim, byte for byte');
    assert.strictEqual(html.indexOf(text, at + 1), -1, 'and only once');
    assert.ok(at < html.indexOf('const BASE='), 'it loads before the page script that uses it');
    const open = html.lastIndexOf('<script>', at);
    assert.ok(open !== -1 && html.slice(open + '<script>'.length, at).trim() === '', 'it opens its own script element');
    assert.ok(html.slice(at + text.length).startsWith('</script>'), 'and that element holds nothing else');
  });
});

test('the page runs the module as shipped: its functions are the module\'s, to the character, and it is the page that holds the glyph table', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const text = source(MODULE);
    for (const name of ['typeIconGlyph', 'typeIconOf']) {
      assert.ok(text.includes(page.run(`${name}.toString()`)), `${name} on the page is the module's`);
    }
    assert.deepStrictEqual(page.plain(page.run('TYPE_ICON_NAMES')), ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star']);
  });
});

test('a card that happens to contain the module\'s placeholder keeps its own text', () => {
  const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd').replace('# Odd', `# Odd\nbody ${PLACEHOLDER} stays text`) } };
  withSnapshot(board, (html) => {
    assert.ok(html.includes(`body ${PLACEHOLDER} stays text`));
    assert.ok(html.includes(source(MODULE)));
  });
});

test('the web\'s type chip module and the assignee badge module it needs are not in the page, and the page\'s type colour takes one argument', () => {
  withPlanPage((page, dir, html) => {
    for (const file of ['type-badge.js', 'assignee-badge.js']) {
      assert.ok(!html.includes(source(file)), `${file} is not embedded`);
    }
    const declared = page.scripts.flatMap((s) => topLevelDeclarations(s));
    for (const name of ['typeBadge', 'escapeHtml']) assert.ok(!declared.includes(name), `${name} is not on the page`);
    assert.strictEqual(page.run('typeColor.length'), 1, 'the page\'s own typeColor, not the module\'s two-argument one');
    assert.strictEqual(page.run('typeColor("goal")'), '#a371f7');
  });
});

test('the module declares nothing the other scripts declare, and the page\'s scripts together pass the top-level-name scan', () => {
  withPlanPage((page, dir, html) => {
    assert.deepStrictEqual(pageScopeCollisions(html), []);
    const mine = topLevelDeclarations(source(MODULE));
    assert.ok(mine.includes('typeIconGlyph') && mine.includes('TYPE_ICON_SHAPES'), 'the scan reads the module\'s declarations');
    const own = topLevelDeclarations(page.scripts[page.scripts.length - 1]);
    assert.deepStrictEqual(own.filter((n) => mine.includes(n)), [], 'the page script re-declares none of them');
    assert.strictEqual(page.scripts.filter((s) => s.includes('const TYPE_ICON_SHAPES')).length, 1, 'one copy of the table');
  });
});

test('the module loads ahead of the page script, after the modules that were there before', () => {
  withSnapshot(BOARD, (html) => {
    const order = ['nesting.js', 'map-relations.js', 'waiting-blocked.js', 'search.js', MODULE].map((f) => html.indexOf(source(f)));
    assert.ok(order.every((at, i) => at !== -1 && (i === 0 || order[i - 1] < at)), `in order: ${order}`);
    assert.ok(order[order.length - 1] < html.indexOf('const BASE='));
  });
});

// The build runs from a copy of the scripts folder beside a copy of the web
// modules, one of them altered, so the refusal under test is the build's own.
function buildWithAltered(file, alter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-icons-embed-'));
  try {
    const script = path.join(root, 'snapshot', 'scripts', 'build_editor.py');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(buildScript, script);
    fs.copyFileSync(path.join(path.dirname(buildScript), 'ids.py'), path.join(path.dirname(script), 'ids.py'));
    fs.cpSync(webDir, path.join(root, 'web', 'web'), { recursive: true });
    const target = path.join(root, 'web', 'web', file);
    const altered = alter(fs.readFileSync(target, 'utf8'));
    if (altered === null) fs.rmSync(target); else fs.writeFileSync(target, altered);
    const board = path.join(root, 'board');
    fs.mkdirSync(board);
    writeBoard(board, BOARD);
    try {
      execFileSync('python', ['-B', script, board, '--out', path.join(root, 'out.html')], { encoding: 'utf8', stdio: 'pipe' });
      return { built: true, stderr: '' };
    } catch (e) {
      return { built: false, stderr: String(e.stderr) };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the build refuses the type icons module if it holds a closing script tag', () => {
  for (const tag of ['</script>', '</SCRIPT >']) {
    const result = buildWithAltered(MODULE, (text) => `${text}\nconst odd = "${tag}";\n`);
    assert.strictEqual(result.built, false, `built with ${tag} in it`);
    assert.match(result.stderr, /the type icons module contains a closing script tag/);
  }
});

test('the build refuses the type icons module if it holds a placeholder name', () => {
  const result = buildWithAltered(MODULE, (text) => `${text}\nconst odd = "__DATA__";\n`);
  assert.strictEqual(result.built, false);
  assert.match(result.stderr, /the type icons module contains a template placeholder/);
});

test('the build says so, and stops, when the module is missing', () => {
  const result = buildWithAltered(MODULE, () => null);
  assert.strictEqual(result.built, false);
  assert.match(result.stderr, /cannot read the type icons module/);
});

test('the build accepts the type icons module as shipped', () => {
  assert.strictEqual(buildWithAltered(MODULE, (text) => text).built, true);
});

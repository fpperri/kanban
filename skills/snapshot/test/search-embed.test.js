const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BOARD, PAGE_SCRIPTS, buildScript, card, lf, withSnapshot, writeBoard } = require('./nesting-fixture');
const { loadPage } = require('./page-harness');
const { topLevelDeclarations } = require('../../web/test/helpers/global-scope');
const { search, withPlanPage } = require('./search-table');

// The snapshot carries the web's search module, the waiting rules it reads and the
// slices module its slice: term cuts by as the same source kanban-web runs, so what
// a query finds is one copy of the rules. The search panel's pill list and run of
// slices are the same source too.

const webDir = path.join(__dirname, '..', '..', 'web', 'web');
const MODULES = [
  { file: 'slices.js', placeholder: '__SLICES_JS__', label: 'the slices module' },
  { file: 'waiting-blocked.js', placeholder: '__WAITING_BLOCKED_JS__', label: 'the waiting rules' },
  { file: 'search.js', placeholder: '__SEARCH_JS__', label: 'the search module' },
  { file: 'pills.js', placeholder: '__PILLS_JS__', label: 'the pill list' },
  { file: 'slice-run.js', placeholder: '__SLICE_RUN_JS__', label: 'the run of slices' },
  { file: 'key-guard.js', placeholder: '__KEY_GUARD_JS__', label: 'the key guard' },
  { file: 'combobox.js', placeholder: '__COMBOBOX_JS__', label: 'the combobox rules' },
];
const source = (file) => lf(fs.readFileSync(path.join(webDir, file), 'utf8'));

for (const { file, placeholder } of MODULES) {
  test(`the built page contains ${file} exactly, once, in its own script element ahead of the page script`, () => {
    const text = source(file);
    withSnapshot(BOARD, (html) => {
      const at = html.indexOf(text);
      assert.ok(at !== -1, 'the module source is in the page verbatim');
      assert.strictEqual(html.indexOf(text, at + 1), -1, 'and only once');
      assert.ok(at < html.indexOf('const BASE='), 'it loads before the page script that uses it');
      const open = html.lastIndexOf('<script>', at);
      assert.ok(open !== -1 && html.slice(open + '<script>'.length, at).trim() === '', 'it opens its own script element');
      assert.ok(html.slice(at + text.length).startsWith('</script>'), 'and that element holds nothing else');
    });
  });

  test(`a card that happens to contain ${placeholder} keeps its own text`, () => {
    const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd').replace('# Odd', `# Odd\nbody ${placeholder} stays text`) } };
    withSnapshot(board, (html) => {
      assert.ok(html.includes(`body ${placeholder} stays text`));
      assert.ok(html.includes(source(file)));
    });
  });
}

test('the waiting rules load ahead of the search module, and both ahead of the page script', () => {
  withSnapshot(BOARD, (html) => {
    const waiting = html.indexOf(source('waiting-blocked.js'));
    const searchAt = html.indexOf(source('search.js'));
    assert.ok(waiting !== -1 && waiting < searchAt && searchAt < html.indexOf('const BASE='));
    const page = loadPage(html);
    assert.strictEqual(page.scripts.length, PAGE_SCRIPTS, 'one script element for each embedded module, then the page');
    assert.strictEqual(page.run('typeof parseSearchQuery + typeof resolveTerms + typeof cardMatchesQuery + typeof isReviewValue'),
      'functionfunctionfunctionfunction');
  });
});

test('the slices module loads after the nesting module and ahead of the page script, and the page can call it', () => {
  withSnapshot(BOARD, (html) => {
    const nesting = html.indexOf(source('nesting.js'));
    const slices = html.indexOf(source('slices.js'));
    assert.ok(nesting !== -1 && nesting < slices && slices < html.indexOf('const BASE='), 'the slices module follows the nesting module and loads before the page script');
    assert.strictEqual(loadPage(html).run('typeof sliceCards + typeof sliceTiers'), 'functionfunction');
  });
});

// The build runs from a copy of the scripts folder beside a copy of the web
// modules, one of them altered, so the refusal under test is the build's own.
function buildWithAltered(file, alter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-embed-'));
  try {
    const script = path.join(root, 'snapshot', 'scripts', 'build_editor.py');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(buildScript, script);
    fs.copyFileSync(path.join(path.dirname(buildScript), 'ids.py'), path.join(path.dirname(script), 'ids.py'));
    fs.cpSync(webDir, path.join(root, 'web', 'web'), { recursive: true });
    const target = path.join(root, 'web', 'web', file);
    fs.writeFileSync(target, alter(fs.readFileSync(target, 'utf8')));
    const board = path.join(root, 'board');
    fs.mkdirSync(board);
    writeBoard(board, BOARD);
    const out = path.join(root, 'out.html');
    try {
      execFileSync('python', ['-B', script, board, '--out', out], { encoding: 'utf8', stdio: 'pipe' });
      return { built: true, stderr: '' };
    } catch (e) {
      return { built: false, stderr: String(e.stderr) };
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const { file, label } of MODULES) {
  test(`the build refuses ${file} if it holds a closing script tag`, () => {
    for (const tag of ['</script>', '</SCRIPT >']) {
      const result = buildWithAltered(file, (text) => `${text}\nconst odd = "${tag}";\n`);
      assert.strictEqual(result.built, false, `built with ${tag} in it`);
      assert.match(result.stderr, new RegExp(`${label} contains a closing script tag`));
    }
  });

  test(`the build refuses ${file} if it holds a placeholder name`, () => {
    const result = buildWithAltered(file, (text) => `${text}\nconst odd = "__DATA__";\n`);
    assert.strictEqual(result.built, false);
    assert.match(result.stderr, new RegExp(`${label} contains a template placeholder`));
  });

  test(`the build accepts ${file} as shipped`, () => {
    assert.strictEqual(buildWithAltered(file, (text) => text).built, true);
  });
}

test('the page declares no term parser, matcher or graph-term resolver of its own: its search functions are the module\'s', () => {
  withSnapshot(BOARD, (html) => {
    const page = loadPage(html);
    const searchSource = source('search.js');
    for (const name of ['parseTerm', 'parseSearchQuery', 'termMatchesCard', 'cardMatchesQuery', 'resolveTerms']) {
      const fn = page.run(`${name}.toString()`);
      assert.ok(searchSource.includes(fn), `${name} on the page is the module's, to the character`);
    }
    for (const name of ['sliceTiers', 'sliceCards']) {
      assert.ok(source('slices.js').includes(page.run(`${name}.toString()`)), `${name} on the page is the slices module's, to the character`);
    }
    const own = topLevelDeclarations(page.scripts[page.scripts.length - 1]);
    const moduleNames = topLevelDeclarations(searchSource).concat(topLevelDeclarations(source('waiting-blocked.js')),
      topLevelDeclarations(source('slices.js')));
    assert.deepStrictEqual(own.filter((n) => moduleNames.includes(n)), [], 'the page script re-declares nothing the modules declare');
    for (const gone of ['resolveGraphTerms', 'qMatch', 'SFIELDS', 'GFIELDS', 'STFIELDS']) {
      assert.ok(!own.includes(gone), `${gone}, the old copy, is gone from the page script`);
    }
  });
});

test('tree: and path: resolve through the page\'s own dependency functions, handed to the resolver', () => {
  withPlanPage((page, dir, html) => {
    assert.ok(!html.includes(source('dependency-graph.js')), 'the web\'s dependency-graph module is not embedded');
    const declared = page.scripts.flatMap((s) => topLevelDeclarations(s));
    assert.ok(!declared.includes('buildDependencyGraph'), 'nor ported under its name: the search has no graph of its own to default to');
    page.run('globalThis.asked = []; treeIds = (id) => { asked.push(["tree", id]); return new Set([3, 4]); }; '
      + 'pathIds = (id) => { asked.push(["path", id]); return new Set([5]); };');
    assert.deepStrictEqual(search(page, 'tree:#12'), [3, 4], 'the page\'s treeIds answers, whatever the real graph says');
    assert.deepStrictEqual(search(page, 'path:12'), [5]);
    assert.deepStrictEqual(page.plain(page.run('asked')), [['tree', '12'], ['path', '12']], 'each asked with the card id as typed, without its #');
  });
});

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The browser runner's scenarios evaluate expressions inside the page that read
// the page scripts' top-level names. A rename there passes npm test and only
// fails the slow browser run, with an eval error. This list is that dependency,
// checked three ways: every name exists in the web sources, no runner file reads
// a page global the list does not declare, and every name on the list is read
// by some runner file.
const PAGE_GLOBALS = [
  'autoRefreshTick',
  'boardControlFocused',
  'graphCur',
  'graphFanLines',
  'graphFanNames',
  'graphLoadOptions',
  'graphNeighbours',
  'graphSetOption',
  'hoveredId',
  'isDragging',
  'renderGraphView',
  'selectedIds',
  'selectionState',
  'state',
  'writeSearch',
];

const webDir = path.join(__dirname, '..', 'web');
const browserDir = path.join(__dirname, 'browser');

// Every runner file: the entry, the harness modules, the scenarios, the checks.
function runnerFiles() {
  const out = [];
  for (const dir of [browserDir, path.join(browserDir, 'scenarios')]) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) out.push(path.join(dir, f));
  }
  return out.sort();
}

function topLevelNames() {
  const names = new Set();
  for (const f of fs.readdirSync(webDir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(webDir, f), 'utf8');
    for (const m of src.matchAll(/^(?:let|const|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  }
  return names;
}

// Whole-line comments and block comments say what a runner file is for, not
// what it reads.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// An identifier use: not part of a longer word, not a property access (a spread
// `...name` still counts), not a path segment like /api/, not a piece of a
// hyphenated selector like #graph-view.
const usesName = (src, name) => new RegExp(`(?:^|[^\\w$./-]|\\.\\.\\.)${name.replace(/\$/g, '\\$')}(?![\\w$/-])`, 'm').test(src);

// The names a file declares itself: variables, functions, classes, destructured
// names and parameters. A page global with the same name is not a read of it.
function ownNames(src) {
  const own = new Set();
  const add = (list) => {
    for (const part of list.split(',')) {
      const name = part.split(':').pop().split('=')[0].replace(/[.\s]/g, '');
      if (/^[A-Za-z_$][\w$]*$/.test(name)) own.add(name);
    }
  };
  for (const m of src.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) own.add(m[1]);
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) own.add(m[1]);
  for (const m of src.matchAll(/\bfunction\s*[\w$]*\s*\(([^()]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g)) own.add(m[1]);
  return own;
}

// The page globals a runner source reads, given the names the page declares.
function pageGlobalsRead(src, pageNames) {
  const code = stripComments(src);
  const own = ownNames(code);
  return [...pageNames].filter((n) => !n.includes('$') && !own.has(n) && usesName(code, n)).sort();
}

const readBy = () => {
  const pageNames = topLevelNames();
  return runnerFiles().map((f) => ({ file: path.relative(browserDir, f), read: pageGlobalsRead(fs.readFileSync(f, 'utf8'), pageNames) }));
};

test('every page global the browser runner reads is declared at top level in skills/web/web', () => {
  const declared = topLevelNames();
  const missing = PAGE_GLOBALS.filter((n) => !declared.has(n));
  assert.deepStrictEqual(missing, [], `renamed or removed, update the scenarios and this list: ${missing.join(', ')}`);
});

test('the check reads every runner file, scenarios included', () => {
  const files = readBy().map((r) => r.file.split(path.sep).join('/'));
  for (const f of ['run.js', 'harness.js', 'cdp.js', 'boards.js', 'scenarios/index.js', 'scenarios/graph.js', 'scenarios/smoke.js']) {
    assert.ok(files.includes(f), `${f} is not among the runner files: ${files.join(', ')}`);
  }
});

test('no runner file reads a page global it does not declare', () => {
  for (const { file, read } of readBy()) {
    const undeclared = read.filter((n) => !PAGE_GLOBALS.includes(n));
    assert.deepStrictEqual(undeclared, [], `${file} reads page globals the list does not declare: add ${undeclared.join(', ')} to PAGE_GLOBALS, or stop reading them`);
  }
});

test('every declared page global is read by some runner file', () => {
  const read = new Set(readBy().flatMap((r) => r.read));
  const unread = PAGE_GLOBALS.filter((n) => !read.has(n));
  assert.deepStrictEqual(unread, [], `no runner file reads ${unread.join(', ')}: drop them from PAGE_GLOBALS`);
});

// The check itself, against runner sources written for the purpose.
const PAGE = new Set(['selectedIds', 'renderGraphView', 'state', 'search', '$']);

test('a runner source that reads an undeclared page global is caught, with the name', () => {
  const src = "await ev(`selectedIds.size===1&&state.cards.length>0`);";
  assert.deepStrictEqual(pageGlobalsRead(src, PAGE), ['selectedIds', 'state']);
  const undeclared = pageGlobalsRead(src, PAGE).filter((n) => !['selectedIds'].includes(n));
  assert.deepStrictEqual(undeclared, ['state']);
});

test('a name the runner file declares itself is not a read of the page global', () => {
  assert.deepStrictEqual(pageGlobalsRead('const state = {}; use(state);', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('function search(q) { return q; } search(1);', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('const { state, other } = page; state.x;', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('const { a: search } = page; search();', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('items.map((state) => state.id);', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('items.map(search => search.id);', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('async function f(selectedIds) { return selectedIds; }', PAGE), []);
});

test('a property, a path, a hyphenated selector and a comment are not reads', () => {
  assert.deepStrictEqual(pageGlobalsRead('page.state; obj.search(); fetch("/state/x"); q("#state-view .search-box")', PAGE), []);
  assert.deepStrictEqual(pageGlobalsRead('// selectedIds is read below\n/* state too */\nrun();', PAGE), []);
});

test('a spread and a call are reads', () => {
  assert.deepStrictEqual(pageGlobalsRead('f(...state); renderGraphView();', PAGE), ['renderGraphView', 'state']);
});

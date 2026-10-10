const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The browser smoke (browser/run.js) evaluates expressions inside the page that
// read app.js and graph-view.js top-level names. A rename there passes npm test
// and only fails the slow browser run, with an eval error. This list is that
// dependency, checked both ways: every name exists in the web sources, and the
// list matches what run.js actually reads.
const PAGE_GLOBALS = [
  'autoRefreshTick',
  'graphCur',
  'graphNeighbours',
  'hoveredId',
  'isDragging',
  'renderGraphView',
  'selectedIds',
];

const webDir = path.join(__dirname, '..', 'web');
const runSrc = fs.readFileSync(path.join(__dirname, 'browser', 'run.js'), 'utf8');

function topLevelNames() {
  const names = new Set();
  for (const f of fs.readdirSync(webDir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(webDir, f), 'utf8');
    for (const m of src.matchAll(/^(?:let|const|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  }
  return names;
}

// An identifier use: not part of a longer word, not a property access (a spread
// `...name` still counts), not a path segment like /api/.
const usesName = (src, name) => new RegExp(`(?:^|[^\\w$./]|\\.\\.\\.)${name.replace(/\$/g, '\\$')}(?![\\w$/])`, 'm').test(src);

test('every page global the browser smoke reads is declared at top level in skills/web/web', () => {
  const declared = topLevelNames();
  const missing = PAGE_GLOBALS.filter((n) => !declared.has(n));
  assert.deepStrictEqual(missing, [], `renamed or removed, update run.js and this list: ${missing.join(', ')}`);
});

test('the list matches the app globals run.js actually reads', () => {
  const own = new Set([...runSrc.matchAll(/\b(?:const|let|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  // A name with a `$` (app.js's `$` helper) is indistinguishable from run.js's own `${...}` template syntax.
  const read = [...topLevelNames()].filter((n) => !n.includes('$') && !own.has(n) && usesName(runSrc, n)).sort();
  assert.deepStrictEqual(read, [...PAGE_GLOBALS].sort(), 'run.js and PAGE_GLOBALS disagree: add new reads to the list, drop names run.js no longer reads');
});

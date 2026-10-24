const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const libs = require('../web/code-libs');

// code-libs.js decides, from the languages a rendered body's fences name, which library the page
// has to load: highlight.js for a language it knows, mermaid for a ```mermaid block, and nothing at
// all otherwise. The page and the snapshot each bring their own loader; this holds the decision, the
// language names and the pinned versions they share.

const vendor = (...parts) => path.join(__dirname, '..', 'web', 'vendor', ...parts);

// --- the language aliases ----------------------------------------------------------------------

test('a language a fence names maps to the highlight.js language that colours it', () => {
  const want = {
    'c#': 'csharp', cs: 'csharp', csharp: 'csharp', ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', javascript: 'javascript', py: 'python', python: 'python', sh: 'bash', bash: 'bash', zsh: 'bash',
    'c++': 'cpp', cpp: 'cpp', c: 'c', h: 'c', yml: 'yaml', yaml: 'yaml', json: 'json', html: 'xml', xml: 'xml', css: 'css', md: 'markdown',
    rs: 'rust', go: 'go', golang: 'go', rb: 'ruby', kt: 'kotlin', sql: 'sql', diff: 'diff', toml: 'ini', java: 'java', php: 'php',
    'obj-c': 'objectivec', objc: 'objectivec', ps: null,
  };
  for (const [lang, canonical] of Object.entries(want)) assert.strictEqual(libs.highlightLanguage(lang), canonical, lang);
});

test('the name is read without regard to case', () => {
  assert.strictEqual(libs.highlightLanguage('C#'), 'csharp');
  assert.strictEqual(libs.highlightLanguage('TypeScript'), 'typescript');
  assert.strictEqual(libs.highlightLanguage('JSON'), 'json');
});

test('a language highlight.js does not know, nothing, plain text and mermaid are not highlighted', () => {
  for (const lang of ['', undefined, null, 'klingon', 'powershell', 'ps1', 'f#', 'fsharp', 'dockerfile', 'text', 'txt', 'plaintext', 'mermaid', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.strictEqual(libs.highlightLanguage(lang), null, String(lang));
  }
});

test('only mermaid is mermaid', () => {
  assert.strictEqual(libs.isMermaid('mermaid'), true);
  assert.strictEqual(libs.isMermaid('Mermaid'), true);
  for (const lang of ['', 'mermaidjs', 'ts', undefined, 'mer maid']) assert.strictEqual(libs.isMermaid(lang), false, String(lang));
});

test('the language table is the vendored build\'s own, less plain text', () => {
  const src = fs.readFileSync(vendor('highlight.js', 'highlight.min.js'), 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(`${src}\nthis.hljs = hljs;`, sandbox);
  const hljs = sandbox.hljs;
  const built = {};
  for (const name of [...hljs.listLanguages()]) {
    if (name === 'plaintext') continue;
    built[name] = [...(hljs.getLanguage(name).aliases || [])].sort();
  }
  const mine = {};
  for (const [name, aliases] of Object.entries(libs.HIGHLIGHT_LANGUAGES)) mine[name] = aliases.slice().sort();
  assert.deepStrictEqual(mine, built);
  for (const name of Object.keys(built)) assert.strictEqual(libs.highlightLanguage(name), name, name);
  for (const [name, aliases] of Object.entries(built)) for (const a of aliases) assert.strictEqual(libs.highlightLanguage(a), name, a);
});

// --- which library a body needs ------------------------------------------------------------

test('no fence, an untyped fence or an unknown language needs nothing', () => {
  assert.deepStrictEqual(libs.libsNeeded([]), { highlight: false, mermaid: false });
  assert.deepStrictEqual(libs.libsNeeded(['', 'klingon', 'text']), { highlight: false, mermaid: false });
});

test('a known language needs highlight.js, a mermaid fence needs mermaid, and both can be needed', () => {
  assert.deepStrictEqual(libs.libsNeeded(['c#']), { highlight: true, mermaid: false });
  assert.deepStrictEqual(libs.libsNeeded(['mermaid']), { highlight: false, mermaid: true });
  assert.deepStrictEqual(libs.libsNeeded(['klingon', 'ts', 'mermaid']), { highlight: true, mermaid: true });
});

// --- the loader is asked only for what a block needs -----------------------------------------------

function loader() {
  const calls = [];
  return {
    calls,
    highlight: (block, language) => calls.push(['highlight', block.id, language]),
    mermaid: (block) => calls.push(['mermaid', block.id]),
  };
}

test('with no typed block the loader is never asked', () => {
  const l = loader();
  libs.enhanceBlocks([], l);
  libs.enhanceBlocks([{ id: 1, lang: '' }, { id: 2, lang: 'klingon' }, { id: 3, lang: 'text' }], l);
  assert.deepStrictEqual(l.calls, []);
});

test('each block asks for exactly the library its language needs, with highlight.js\'s own language name', () => {
  const l = loader();
  libs.enhanceBlocks([{ id: 1, lang: 'c#' }, { id: 2, lang: 'klingon' }, { id: 3, lang: 'mermaid' }, { id: 4, lang: 'TS' }, { id: 5, lang: '' }], l);
  assert.deepStrictEqual(l.calls, [['highlight', 1, 'csharp'], ['mermaid', 3], ['highlight', 4, 'typescript']]);
});

test('a body with only mermaid never asks for highlight.js, and one with only code never asks for mermaid', () => {
  const m = loader();
  libs.enhanceBlocks([{ id: 1, lang: 'mermaid' }, { id: 2, lang: 'mermaid' }], m);
  assert.ok(m.calls.every(([kind]) => kind === 'mermaid'));
  const h = loader();
  libs.enhanceBlocks([{ id: 1, lang: 'json' }, { id: 2, lang: 'sql' }], h);
  assert.ok(h.calls.every(([kind]) => kind === 'highlight'));
});

// --- the pinned versions ----------------------------------------------------------------------------

test('the pinned versions are the vendored builds\' own', () => {
  const mermaid = fs.readFileSync(vendor('mermaid', 'mermaid.min.js'), 'utf8');
  assert.ok(mermaid.includes(`"${libs.MERMAID_VERSION}"`), 'mermaid.min.js carries its version string');
  const highlight = fs.readFileSync(vendor('highlight.js', 'highlight.min.js'), 'utf8');
  assert.ok(highlight.startsWith(`/*!\n  Highlight.js v${libs.HIGHLIGHT_VERSION} `), 'highlight.min.js says its version in its header');
  assert.match(libs.MERMAID_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(libs.HIGHLIGHT_VERSION, /^\d+\.\d+\.\d+$/);
});

test('each library has its licence beside it', () => {
  assert.match(fs.readFileSync(vendor('mermaid', 'LICENSE'), 'utf8'), /MIT License/);
  assert.match(fs.readFileSync(vendor('highlight.js', 'LICENSE'), 'utf8'), /BSD 3-Clause License/);
});

test('the frame page asks for the vendored mermaid by its version, so the server may cache it for good', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'mermaid-frame.html'), 'utf8');
  assert.ok(html.includes(`<script src="/vendor/mermaid/mermaid.min.js?v=${libs.MERMAID_VERSION}"></script>`));
});

test('the module is written to be embedded: no require, no other module\'s names', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'code-libs.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, '').replace(/typeof module[^\n]*\n[^\n]*\n/, ''), /\brequire\(/);
  assert.doesNotMatch(src, /<\/script/i);
  assert.doesNotMatch(src, /__[A-Z_]+__/);
});

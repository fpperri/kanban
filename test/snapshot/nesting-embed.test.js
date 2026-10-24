const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { BOARD, buildScript, card, lf, mapRelationsPath, nestingPath, withSnapshot } = require('./nesting-fixture');

// The snapshot carries the nesting module's source as is, so the page follows
// the same rules as kanban-web with nothing to keep in sync by hand.

const nestingSource = lf(fs.readFileSync(nestingPath, 'utf8'));

test('the built page contains the nesting module source exactly, once, ahead of the page script', () => {
  withSnapshot(BOARD, (html) => {
    const at = html.indexOf(nestingSource);
    assert.ok(at !== -1, 'the module source is in the page verbatim');
    assert.strictEqual(html.indexOf(nestingSource, at + 1), -1, 'and only once');
    assert.ok(at < html.indexOf('const BASE='), 'it loads before the page script that uses it');
    const open = html.lastIndexOf('<script>', at);
    assert.ok(open !== -1 && html.slice(open + '<script>'.length, at).trim() === '', 'it opens its own script element');
    assert.ok(html.slice(at + nestingSource.length).startsWith('</script>'), 'and that element holds nothing else');
  });
});

test('a card that happens to contain the module placeholder keeps its own text', () => {
  const board = { ...BOARD, cards: { ...BOARD.cards, '0012.odd.card.md': card(12, 'todo', 'Odd').replace('# Odd', '# Odd\nbody __NESTING_JS__ stays text') } };
  withSnapshot(board, (html) => {
    assert.ok(html.includes('body __NESTING_JS__ stays text'));
    assert.ok(html.includes(nestingSource));
  });
});

test('every nesting.js function the page calls is declared once by the embedded module', () => {
  withSnapshot(BOARD, (html) => {
    for (const name of ['hasNesting', 'outlineOrder', 'rollupIndex', 'threadOf', 'childrenOf']) {
      assert.strictEqual(html.split(`function ${name}(`).length - 1, 1, `${name} is declared once`);
    }
  });
});

function embed(source) {
  const script = [
    'import importlib.util, sys',
    'sys.dont_write_bytecode = True',
    `spec = importlib.util.spec_from_file_location("build_editor", ${JSON.stringify(buildScript)})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'sys.stdout.buffer.write(mod.embeddable(sys.stdin.buffer.read().decode("utf-8")).encode("utf-8"))',
  ].join('\n');
  return execFileSync('python', ['-c', script], { input: source, encoding: 'utf8' });
}

test('the build refuses a module that could close its own script element', () => {
  assert.throws(() => embed('const a = "</script>";'), /closing script tag/);
  assert.throws(() => embed('const a = "</SCRIPT >";'), /closing script tag/);
});

test('the build refuses a module that contains a template placeholder', () => {
  assert.throws(() => embed('const a = "__DATA__";'), /placeholder/);
});

test('a clean module passes through untouched', () => {
  assert.strictEqual(embed('const a = 1;\n'), 'const a = 1;\n');
});

test('the shipped module passes its own build guards', () => {
  assert.strictEqual(embed(nestingSource), nestingSource);
});

test('the shipped map module passes the same build guards', () => {
  const mapSource = lf(fs.readFileSync(mapRelationsPath, 'utf8'));
  assert.strictEqual(embed(mapSource), mapSource);
});

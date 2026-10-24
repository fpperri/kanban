const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Card bodies render as markdown, replacing the old fmtBodySegs/bodyNode pre-wrap div. The text is
// read by kanban-web's own markdown.js, embedded in the page (markdown-parity.test.js holds the
// embedding and the two renderers to one another; markdown.test.js in the web's tests holds the
// parse). What is left here is the snapshot's part: the cut notice, the card-sheet wiring, and
// the nodes it builds. The page is built from a tiny fixture board once (also exercising the real
// Python "bn" field, goal 5) and its functions are extracted from the generated HTML or run in
// the page harness.

const buildScript = path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts', 'build_editor.py');
const skillSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', 'skills', 'snapshot', 'scripts', 'build_editor.py'), 'utf8');

let tmpDir, html, data;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-md-test-'));
  fs.writeFileSync(path.join(tmpDir, 'config.yaml'), [
    'name: Fixture Board',
    'statuses: [backlog, todo, doing, done]',
    'assignees:',
    '  - handle: "@human"',
  ].join('\n'));
  const longBody = 'x'.repeat(5000);
  const shortBody = 'short body';
  fs.writeFileSync(path.join(tmpDir, '0001.long.card.md'), `---\nid: 1\nstatus: todo\n---\n# Long\n${longBody}\n`);
  fs.writeFileSync(path.join(tmpDir, '0002.short.card.md'), `---\nid: 2\nstatus: todo\nblocked: waiting on infra ticket\n---\n# Short\n${shortBody}\n`);
  const archDir = path.join(tmpDir, 'archived');
  fs.mkdirSync(archDir);
  fs.writeFileSync(path.join(archDir, '0003.archlong.card.md'), `---\nid: 3\nstatus: done\n---\n# Arch long\n${longBody}\n`);
  fs.writeFileSync(path.join(tmpDir, 'notifications.md'), '');

  const outHtml = path.join(tmpDir, 'out.html');
  execFileSync('python', [buildScript, tmpDir, '--out', outHtml], { encoding: 'utf8' });
  html = fs.readFileSync(outHtml, 'utf8');
  const dataMatch = /const DATA=(\[[\s\S]*?\]);\s*\nconst NOTIFS=/.exec(html);
  assert.ok(dataMatch, 'could not find const DATA=... in the built HTML');
  data = JSON.parse(dataMatch[1]);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  let i = html.indexOf('{', start);
  let depth = 0;
  for (; i < html.length; i++) {
    const c = html[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < html.length && html[i] !== q) {
        if (html[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return html.slice(start, i);
}
function extractConst(name) {
  const marker = `const ${name}=`;
  const start = html.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in the built HTML`);
  const end = html.indexOf('\n', start);
  return html.slice(start, end);
}

// --- the "bl" field (goal 5): Python records the UNCAPPED length ------------

test('parse_card records "bn" as the uncapped body length, independent of either 4000/1500 truncation', () => {
  const long = data.find((c) => c.id === '1');
  const short = data.find((c) => c.id === '2');
  const archLong = data.find((c) => c.id === '3');
  assert.strictEqual(long.bn, 5000);
  assert.strictEqual(long.body.length, 4000, 'live cards cap at 4000');
  assert.strictEqual(short.bn, short.body.length, 'an uncapped body reports bn === body.length');
  assert.strictEqual(archLong.bn, 5000, 'bn reflects the TRUE original length, unaffected by the archived re-cap');
  assert.strictEqual(archLong.body.length, 1500, 'archived cards re-cap at 1500');
});

test('build_editor.py source: parse_card sets "bn" from the pre-truncation full_body, and archived re-capping never touches it', () => {
  assert.match(skillSrc, /"bn": len\(full_body\),/);
  assert.match(skillSrc, /"body": full_body\[:4000\],/);
  assert.match(skillSrc, /c\["body"\] = c\["body"\]\[:1500\]/);
  // the archived re-cap block only reassigns "body", never "bn"
  const archBlockStart = skillSrc.indexOf('c["arch"] = True');
  const archBlockEnd = skillSrc.indexOf('cards.append(c)', archBlockStart);
  const archBlock = skillSrc.slice(archBlockStart, archBlockEnd);
  assert.ok(!archBlock.includes('"bn"') && !archBlock.includes("c['bn']") && !archBlock.includes('c["bn"]'), 'archived re-cap must not touch bn');
});

// --- cut notice (goal 5): mdBodyNode appends it only when bl > embedded length ---

test('mdBodyNode source: appends the cut <div class="cut"> only when bl exceeds the embedded body\'s own length', () => {
  const src = extractFunction('mdBodyNode');
  assert.match(src, /if\(trueLen>shownLen\)/);
  assert.match(src, /el\("div","cut",/);
});

test('thousands(): comma-separates regardless of locale', () => {
  const thousands = (n) => loadPage(html).run(`thousands(${n})`);
  assert.strictEqual(thousands(8138), '8,138');
  assert.strictEqual(thousands(4000), '4,000');
  assert.strictEqual(thousands(999), '999');
  assert.strictEqual(thousands(1000000), '1,000,000');
});

// --- never innerHTML ---------------------------------------------------------

test('the body node builders never build the body via innerHTML — el()/textContent only', () => {
  ['mdBodyNode', 'mdBlockNodes', 'mdListNode', 'mdPreNode', 'mdTableNode', 'mdInlineNodes', 'codeSegNode'].forEach((name) => {
    const fnSrc = extractFunction(name);
    assert.ok(!fnSrc.includes('innerHTML'), `${name} must never touch innerHTML`);
  });
});

test('the card-sheet render path calls mdBodyNode(c.body,BOARD,c.bn), not the old bodyNode()', () => {
  assert.match(html, /d\.appendChild\(mdBodyNode\(c\.body,BOARD,c\.bn\)\)/);
  assert.ok(!html.includes('function bodyNode('), 'the old bodyNode() must be fully retired');
  assert.ok(!html.includes('"bodytxt"'), 'the old .bodytxt div must be fully retired');
});

// --- DOM-level: mention rendering, cut notice --------------------------------
// The page runs for real in the harness (a stand-in DOM in a vm), so these call the page's own
// codeSegNode()/mdBodyNode() and look at the nodes they return.

const { loadPage } = require('./page-harness');
const page = () => loadPage(html);

// The mention regex's board-name capture is whitespace-free by design -- real board names are
// single tokens (e.g. a repo-style dotted name), so these use single-word board names rather than
// the space-bearing fixture board name used elsewhere in this file.
test('codeSegNode: a same-board mention gets class="mention same" and a data-mapnode id (openable the way the snapshot opens cards elsewhere)', () => {
  const node = page().run('codeSegNode("MyBoard#42 fix the thing", "MyBoard")');
  assert.strictEqual(node.tagName, 'CODE');
  assert.strictEqual(node.textContent, 'MyBoard#42 fix the thing');
  assert.ok(node.classList.contains('mention'));
  assert.ok(node.classList.contains('same'));
  assert.strictEqual(node.getAttribute('data-mapnode'), '42');
});

test('codeSegNode: a mention of a group or a note carries the whole id, prefix and all, and a padded one the plain number', () => {
  const p = page();
  for (const [text, want] of [['MyBoard#G3 a group', 'G3'], ['MyBoard#_12', '_12'], ['MyBoard#0042 padded', '42']]) {
    const node = p.run(`codeSegNode(${JSON.stringify(text)}, "MyBoard")`);
    assert.ok(node.classList.contains('same'), text);
    assert.strictEqual(node.getAttribute('data-mapnode'), want, text);
  }
  for (const text of ['MyBoard#a371f7', 'MyBoard#g3', 'MyBoard#G3x']) {
    assert.ok(!p.run(`codeSegNode(${JSON.stringify(text)}, "MyBoard")`).classList.contains('mention'), text);
  }
});

test('codeSegNode: another board\'s mention gets class="mention" but not "same", and no data-mapnode (nothing to open on this board)', () => {
  const node = page().run('codeSegNode("OtherBoard#7 title", "MyBoard")');
  assert.ok(node.classList.contains('mention'));
  assert.ok(!node.classList.contains('same'));
  assert.strictEqual(node.getAttribute('data-mapnode'), null);
});

test('codeSegNode: ordinary code (no board#id shape) gets neither mention class', () => {
  const node = page().run('codeSegNode("just some code", "MyBoard")');
  assert.ok(!node.classList.contains('mention'));
  assert.ok(!node.classList.contains('same'));
});

test('a mention in a card body is a chip the page opens on tap', () => {
  const body = page().run('mdBodyNode("see `MyBoard#42 the thing` here", "MyBoard")');
  const chip = body.all().find((n) => n.classList.contains('mention'));
  assert.ok(chip && chip.classList.contains('same'));
  assert.strictEqual(chip.getAttribute('data-mapnode'), '42');
});

test('mdBodyNode: a body shorter than bl gets a trailing .cut node with thousands-separated counts; a body equal to bl does not', () => {
  const p = page();
  const cut = p.run("mdBodyNode('x'.repeat(4000), 'Fixture Board', 8138)");
  const cutDiv = cut.children.find((n) => n.classList && n.classList.contains('cut'));
  assert.ok(cutDiv, 'expected a trailing .cut node when bl exceeds the embedded body');
  assert.strictEqual(cutDiv.textContent, 'Cut at 4,000 of 8,138 characters. Open the card on the desk board for the rest.');

  const uncut = p.run("mdBodyNode('short', 'Fixture Board', 5)");
  assert.ok(!uncut.children.some((n) => n.classList && n.classList.contains('cut')), 'no cut node when bl === the embedded body length');
});

test('mdBodyNode: a cut mid-table or mid-fence still renders without throwing', () => {
  const p = page();
  const drawn = (text, len) => `mdBodyNode(${JSON.stringify(text)}, 'Fixture Board', ${len})`;
  assert.doesNotThrow(() => p.run(drawn('para\n\n| a | b |\n|---|---|\n| 1', 30)));
  const wrap = p.run(drawn('para\n\n| a | b |\n|---|---|\n| 1', 30));
  assert.ok(wrap.children.find((n) => n.classList && n.classList.contains('md-table')), 'expected a .md-table wrapper');
  const fenced = p.run(drawn('```ts\nlet a = 1;\nnever clo', 60));
  assert.strictEqual(fenced.children[0].classList.contains('md-code'), true, 'the typed block is drawn with what the cut left');
});

// "bl" is the blocked sticker's text and always has been; the body length has
// its own key. Sharing one key once flagged every card on the board as blocked.
test('parse_card keeps the blocked sticker text in "bl", apart from the body length', () => {
  const blocked = data.find((c) => c.id === '2');
  const clear = data.find((c) => c.id === '1');
  assert.strictEqual(blocked.bl, 'waiting on infra ticket');
  assert.strictEqual(clear.bl, '', 'a card without the sticker carries an empty bl');
  assert.strictEqual(typeof clear.bn, 'number');
  assert.strictEqual((skillSrc.match(/^\s*"bl":/gm) || []).length, 1, 'parse_card writes "bl" exactly once');
});

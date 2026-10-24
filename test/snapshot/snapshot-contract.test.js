const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { ROOT, read, flat, section, fenced } = require('../web/helpers/doc-text');
const { BOARD, buildScript } = require('./nesting-fixture');
const { open, sheet } = require('./nesting-view');

// What a tool or an agent reads from the snapshot's docs: the payload the editor makes and the shapes
// the apply protocol tells the agent to expect in it, and the web modules the generator embeds, which
// docs/cross-harness.md says must sit beside it. Both are held to the generator and to the page it
// builds, not to the docs' sentences.

const protocol = read('plugin', 'skills', 'snapshot', 'references', 'apply-protocol.md');
const crossHarness = flat(read('docs', 'cross-harness.md'));

const embedded = JSON.parse(execFileSync('python', ['-B', '-c', [
  'import sys, json',
  `sys.path.insert(0, ${JSON.stringify(path.dirname(buildScript))})`,
  'import build_editor',
  'print(json.dumps([entry[1] for entry in build_editor.EMBEDDED]))',
].join('\n')], { encoding: 'utf8' }));

test('docs/cross-harness.md names every web module the generator embeds, and no web module it does not', () => {
  assert.ok(embedded.length >= 15, 'the generator\'s table is read');
  const named = [...crossHarness.matchAll(/skills\/web\/web\/([\w-]+\.js)/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(named)].sort(), [...embedded].sort());
  for (const file of embedded) assert.ok(fs.existsSync(path.join(ROOT, 'plugin', 'skills', 'web', 'web', file)), `${file} exists`);
});

test('the ops the editor can queue are the five the apply protocol\'s table lists, with the shapes it shows', () => {
  const source = fs.readFileSync(buildScript, 'utf8');
  const queued = new Set([...source.matchAll(/\bop:\s*"(\w+)"/g)].map((m) => m[1]));
  const table = section(protocol, '## Op vocabulary', '\n## ');
  const listed = [...table.matchAll(/\{"op":"(\w+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual([...queued].sort(), [...new Set(listed)].sort());
});

test('a payload starts with the line the apply protocol and the skill tell the agent to look for', () => {
  const header = /^Apply kanban changes \(N ops, base <ISO-STAMP>\):$/m.exec(protocol);
  assert.ok(header, 'the protocol shows the header line');
  const pattern = new RegExp(`^${header[0].replace(/[()]/g, '\\$&').replace('N ops', '\\d+ ops').replace('<ISO-STAMP>', '.+')}$`);
  open(BOARD, (page) => {
    sheet(page, 8);
    const first = page.run('payload()').split('\n')[0];
    assert.match(first, pattern);
  });
  assert.ok(read('plugin', 'skills', 'snapshot', 'SKILL.md').includes('Apply kanban changes'));
});

// The fm shapes the protocol shows: {"fm":{"type":"epic"}}, {"fm":{"parent":"12"}}, {"fm":{"parent":"fpp#4"}}.
const SHAPES = [...protocol.matchAll(/\{"fm":\{"(\w+)":"([^"]*)"\}\}/g)].map((m) => [m[1], m[2], JSON.parse(m[0])]);

function queueField(key, value) {
  return open(BOARD, (page) => {
    const modal = page.byId('modalscroll');
    const control = (pred) => modal.all().find(pred);
    sheet(page, 8);
    if (!control((n) => n.id === `fm-${key}`)) page.click(control((n) => n.dataset.act === 'fmtoggle'));
    control((n) => n.id === `fm-${key}`).value = value;
    page.click(control((n) => n.dataset.act === 'fmsave' && n.dataset.key === key));
    const text = page.run('payload()');
    return JSON.parse(text.slice(text.indexOf('\n') + 1));
  });
}

test('each fm payload the protocol shows is the op the editor makes when that field is saved', () => {
  assert.deepStrictEqual(SHAPES.map(([key]) => key), ['type', 'parent', 'parent']);
  for (const [key, value, shape] of SHAPES) {
    const [op] = queueField(key, value);
    assert.strictEqual(op.op, 'edit');
    assert.deepStrictEqual({ fm: op.fm }, shape, `${key}: ${value}`);
  }
});

test('the editor never sends rank, as the protocol says, even for a card that has one', () => {
  assert.match(protocol, /The editor never sends `rank`\./);
  const ops = open(BOARD, (page) => {
    sheet(page, 2);
    page.click(page.byId('modalscroll').all().find((n) => n.dataset.act === 'fmtoggle'));
    const field = page.byId('modalscroll').all().find((n) => n.id === 'fm-type');
    field.value = 'story';
    page.click(page.byId('modalscroll').all().find((n) => n.dataset.act === 'fmsave' && n.dataset.key === 'type'));
    const text = page.run('payload()');
    return JSON.parse(text.slice(text.indexOf('\n') + 1));
  });
  assert.ok(ops.length > 0);
  assert.ok(!JSON.stringify(ops).includes('rank'));
});

test('the quoting rule the protocol gives for a parent that holds a # is the one the card reader honours, quoted or bare', () => {
  const { readCardFile } = require('../../plugin/skills/web/scripts/card-store');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-contract-'));
  try {
    for (const line of ['parent: "fpp#4"', 'parent: fpp#4']) {
      assert.ok(protocol.includes(line.includes('"') ? `\`${line}\`` : `\`${line}\``), `the protocol shows ${line}`);
      const file = path.join(dir, '0001.x.card.md');
      fs.writeFileSync(file, `---\nid: 1\nstatus: todo\n${line}\n---\n# X\n`);
      assert.strictEqual(readCardFile(file).parent, 'fpp#4', line);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

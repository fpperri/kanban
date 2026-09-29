const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The snapshot page carries the plugin's icon inline as its tab icon, so a
// snapshot opened on its own shows it without fetching anything. The inlined
// copy must stay identical to the canonical assets/icon.svg.

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const canonical = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'icon.svg'), 'utf8').replace(/\r\n/g, '\n');

function buildHtml() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-icon-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: Fixture Board\n');
    fs.writeFileSync(path.join(dir, '0001.first.card.md'), '---\nid: 1\nstatus: todo\n---\n# First\nbody __ICON_URI__ stays text\n');
    const out = path.join(dir, 'out.html');
    execFileSync('python', [buildScript, dir, '--out', out], { encoding: 'utf8' });
    return fs.readFileSync(out, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('the snapshot page links the plugin icon inline, identical to assets/icon.svg', () => {
  const html = buildHtml();
  const m = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(html);
  assert.ok(m, 'an inline SVG icon link in the page head');
  assert.ok(html.indexOf(m[0]) < html.indexOf('</head>'), 'the link sits in the head');
  assert.ok(!/["<>\s]/.test(m[1]), 'the data URI is fully percent-encoded');
  assert.strictEqual(decodeURIComponent(m[1]), canonical);
});

test('a card that happens to contain the icon placeholder keeps its own text', () => {
  const html = buildHtml();
  assert.ok(html.includes('body __ICON_URI__ stays text'));
});

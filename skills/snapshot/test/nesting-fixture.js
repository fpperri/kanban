// Shared by the nesting tests: builds a snapshot from a small board on disk.
// Not a test file (the suite runs *.test.js only).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const buildScript = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const nestingPath = path.join(__dirname, '..', '..', 'web', 'web', 'nesting.js');
const mapRelationsPath = path.join(__dirname, '..', '..', 'web', 'web', 'map-relations.js');

const lf = (text) => text.replace(/\r\n/g, '\n');

function card(id, status, title, extra) {
  const lines = ['---', `id: ${id}`, `status: ${status}`];
  for (const [k, v] of Object.entries(extra || {})) lines.push(`${k}: ${v}`);
  lines.push('---', `# ${title}`, '');
  return lines.join('\n');
}

// A board with three layers, a loose card, a card under a missing parent, a card
// under a parent on another board and an archived leaf.
const BOARD = {
  config: [
    'name: fixture',
    'statuses: [backlog, todo, doing, done]',
    'types:',
    '  - name: objective',
    '    color: "#a371f7"',
    '  - name: epic',
    '  - story',
    '',
  ].join('\n'),
  cards: {
    '0001.ship-it.card.md': card(1, 'doing', 'Ship it', { type: 'objective' }),
    '0002.build.card.md': card(2, 'doing', 'Build', { type: 'epic', parent: 1, rank: 20 }),
    '0003.test.card.md': card(3, 'todo', 'Test', { type: 'epic', parent: 1, rank: 10 }),
    '0004.write-code.card.md': card(4, 'done', 'Write code', { type: 'story', parent: 2, rank: 10 }),
    '0005.review-code.card.md': card(5, 'doing', 'Review code', { type: 'story', parent: 2, rank: 20 }),
    '0006.unit-tests.card.md': card(6, 'todo', 'Unit tests', { type: 'story', parent: 3 }),
    '0007.smoke-tests.card.md': card(7, 'backlog', 'Smoke tests', { type: 'Story', parent: 3, priority: 'High' }),
    '0008.loose.card.md': card(8, 'backlog', 'Loose'),
    '0010.elsewhere.card.md': card(10, 'todo', 'Elsewhere', { parent: '"fpp#4"' }),
    '0011.missing.card.md': card(11, 'todo', 'Missing', { parent: 99 }),
  },
  archived: {
    '0009.shipped.card.md': card(9, 'done', 'Shipped', { type: 'story', parent: 2, rank: 30 }),
  },
};

function writeBoard(dir, board) {
  fs.writeFileSync(path.join(dir, 'config.yaml'), board.config);
  for (const [name, text] of Object.entries(board.cards)) fs.writeFileSync(path.join(dir, name), text);
  if (board.archived) {
    fs.mkdirSync(path.join(dir, 'archived'));
    for (const [name, text] of Object.entries(board.archived)) fs.writeFileSync(path.join(dir, 'archived', name), text);
  }
}

// Builds the snapshot for a board and hands the page text (LF line endings) to fn.
function withSnapshot(board, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-snapshot-nesting-'));
  try {
    writeBoard(dir, board);
    const out = path.join(dir, 'out.html');
    execFileSync('python', [buildScript, dir, '--out', out], { encoding: 'utf8' });
    return fn(lf(fs.readFileSync(out, 'utf8')), dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { BOARD, buildScript, card, lf, mapRelationsPath, nestingPath, withSnapshot, writeBoard };

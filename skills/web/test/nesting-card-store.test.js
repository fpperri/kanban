const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../scripts/card-store');

function board(cards) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-nest-'));
  for (const [file, text] of Object.entries(cards)) fs.writeFileSync(path.join(dir, file), text);
  return dir;
}

const card = (id, fm) => `---\nid: ${id}\nstatus: todo\n${fm}---\n\n# Card ${id}\n\nbody\n`;
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const lines = (raw) => raw.split('\n');
const withoutUpdated = (raw) => lines(raw).filter((l) => !/^updated:/.test(l));

// --- reading ---------------------------------------------------------

test('rank reads as a number; absent, blank or non-numeric reads as null; toJSON carries it', () => {
  const dir = board({
    '0001.a.card.md': card(1, 'rank: 20\n'),
    '0002.b.card.md': card(2, ''),
    '0003.c.card.md': card(3, 'rank: abc\n'),
    '0004.d.card.md': card(4, 'rank:\n'),
    '0005.e.card.md': card(5, 'rank: "30"\n'),
    '0006.f.card.md': card(6, 'rank: 12.5\n'),
  });
  const byId = new Map(cs.listActive(dir).map((c) => [c.id, c]));
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((id) => byId.get(id).rank), [20, null, null, null, 30, 12.5]);
  assert.strictEqual(cs.toJSON(byId.get(1)).rank, 20);
  assert.strictEqual(cs.toJSON(byId.get(2)).rank, null);
});

test('parent reads as an id on this board or as board#id, quotes stripped; junk reads as null', () => {
  const dir = board({
    '0001.a.card.md': card(1, 'parent: 42\n'),
    '0002.b.card.md': card(2, 'parent: fpp#4\n'),
    '0003.c.card.md': card(3, 'parent: "fpp#4"\n'),
    '0004.d.card.md': card(4, 'parent: "42"\n'),
    '0005.e.card.md': card(5, 'parent: soon\n'),
    '0006.f.card.md': card(6, 'parent: shop.proj#9\n'),
  });
  const byId = new Map(cs.listActive(dir).map((c) => [c.id, c]));
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((id) => byId.get(id).parent), [42, 'fpp#4', 'fpp#4', 42, null, 'shop.proj#9']);
  assert.strictEqual(cs.toJSON(byId.get(2)).parent, 'fpp#4');
});

// --- writing through the form ----------------------------------------

test('setting a parent and a rank writes a parent: line and a rank: line and changes nothing else', () => {
  const original = '---\nid: 7\nstatus: todo\npriority: High\ntags: [a, b]\nassignee: "@alex"\nsprint: 5\nupdated: 2026-01-01T00:00:00\n---\n\n# Seven\n\nbody\n';
  const dir = board({ '0007.seven.card.md': original });
  cs.updateCard(dir, 7, { parent: '3', rank: '20' });
  const raw = read(dir, '0007.seven.card.md');
  assert.deepStrictEqual(withoutUpdated(raw), [
    '---', 'id: 7', 'status: todo', 'priority: High', 'tags: [a, b]', 'assignee: "@alex"', 'sprint: 5', 'parent: 3', 'rank: 20', '---', '', '# Seven', '', 'body', '',
  ]);
});

test('a board#id parent is written as typed', () => {
  const dir = board({ '0001.a.card.md': card(1, '') });
  cs.updateCard(dir, 1, { parent: ' fpp#4 ' });
  assert.match(read(dir, '0001.a.card.md'), /^parent: fpp#4$/m);
  assert.strictEqual(cs.listActive(dir)[0].parent, 'fpp#4');
});

test('parent and rank given as JSON numbers write the same lines as strings', () => {
  const dir = board({ '0001.a.card.md': card(1, '') });
  cs.updateCard(dir, 1, { parent: 3, rank: 12.5 });
  const raw = read(dir, '0001.a.card.md');
  assert.match(raw, /^parent: 3$/m);
  assert.match(raw, /^rank: 12\.5$/m);
});

test('a blank or null parent and rank remove the lines', () => {
  const dir = board({ '0001.a.card.md': card(1, 'parent: 3\nrank: 10\n'), '0002.b.card.md': card(2, 'parent: fpp#4\nrank: 10\n') });
  cs.updateCard(dir, 1, { parent: '', rank: '' });
  cs.updateCard(dir, 2, { parent: null, rank: null });
  for (const file of ['0001.a.card.md', '0002.b.card.md']) {
    const raw = read(dir, file);
    assert.doesNotMatch(raw, /^parent:/m);
    assert.doesNotMatch(raw, /^rank:/m);
  }
});

test('a parent or rank that reads as nothing clears the line instead of writing junk', () => {
  const dir = board({ '0001.a.card.md': card(1, 'parent: 3\nrank: 10\n') });
  cs.updateCard(dir, 1, { parent: 'soon', rank: 'abc' });
  const raw = read(dir, '0001.a.card.md');
  assert.doesNotMatch(raw, /^parent:/m);
  assert.doesNotMatch(raw, /^rank:/m);
});

test('a form save that sends the values the card already reads as leaves hand-written lines byte for byte', () => {
  const fm = 'parent: "fpp#4"\nrank:   10\n';
  const dir = board({ '0001.a.card.md': card(1, fm), '0002.b.card.md': card(2, 'parent: 5\nrank: "20"\n') });
  cs.updateCard(dir, 1, { priority: 'High', parent: 'fpp#4', rank: '10', title: 'Renamed' });
  cs.updateCard(dir, 2, { parent: '5', rank: '20' });
  assert.match(read(dir, '0001.a.card.md'), /^parent: "fpp#4"\nrank:   10$/m);
  assert.match(read(dir, '0002.b.card.md'), /^parent: 5\nrank: "20"$/m);
});

test('a blank parent or rank from the form leaves a hand-written junk line alone', () => {
  const dir = board({ '0001.a.card.md': card(1, 'parent: soon\nrank: abc\n') });
  cs.updateCard(dir, 1, { parent: '', rank: '' });
  const raw = read(dir, '0001.a.card.md');
  assert.match(raw, /^parent: soon$/m);
  assert.match(raw, /^rank: abc$/m);
});

test('a change that names neither parent nor rank leaves both lines as written, and a status move too', () => {
  const dir = board({ '0001.a.card.md': card(1, 'parent: "fpp#4"\nrank:   10\n') });
  cs.updateCard(dir, 1, { priority: 'High' });
  cs.updateCard(dir, 1, { status: 'doing' });
  assert.match(read(dir, '0001.a.card.md'), /^parent: "fpp#4"\nrank:   10$/m);
});

test('fields the store does not manage survive a status move and a full edit', () => {
  const dir = board({ '0001.a.card.md': card(1, 'parent: fpp#4\nrank: 10\nsprint: 5\nepic: true\ncolour: teal\n') });
  cs.updateCard(dir, 1, { status: 'doing' });
  cs.updateCard(dir, 1, { title: 'New', body: 'b', priority: 'Low', tags: ['x'], assignee: '@a', parent: 'fpp#4', rank: '10' });
  const raw = read(dir, '0001.a.card.md');
  for (const line of ['parent: fpp#4', 'rank: 10', 'sprint: 5', 'epic: true', 'colour: teal']) {
    assert.ok(lines(raw).includes(line), `${line} is still there`);
  }
});

// --- creating --------------------------------------------------------

test('createCard writes parent and rank lines when given, ahead of the updated stamp, and none when blank', () => {
  const dir = board({});
  const withBoth = cs.createCard(dir, { title: 'Child', parent: '3', rank: '10' });
  const raw = fs.readFileSync(withBoth.file, 'utf8');
  const fm = lines(raw).slice(1, lines(raw).indexOf('---', 1));
  assert.ok(fm.indexOf('parent: 3') > -1 && fm.indexOf('rank: 10') > -1);
  assert.ok(fm.indexOf('rank: 10') < fm.findIndex((l) => /^updated:/.test(l)), 'written before the updated stamp');
  assert.strictEqual(withBoth.parent, 3);
  assert.strictEqual(withBoth.rank, 10);

  const cross = cs.createCard(dir, { title: 'Cross', parent: 'fpp#4' });
  assert.strictEqual(cross.parent, 'fpp#4');

  const bare = cs.createCard(dir, { title: 'Bare', parent: '', rank: '' });
  const bareRaw = fs.readFileSync(bare.file, 'utf8');
  assert.doesNotMatch(bareRaw, /^parent:/m);
  assert.doesNotMatch(bareRaw, /^rank:/m);
  const junk = cs.createCard(dir, { title: 'Junk', parent: 'soon', rank: 'abc' });
  assert.doesNotMatch(fs.readFileSync(junk.file, 'utf8'), /^(parent|rank):/m);
});

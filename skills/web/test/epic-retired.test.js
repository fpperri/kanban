const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../scripts/card-store');
const { createServer } = require('../scripts/server');
const { parseSearchQuery, filterCards, searchSuggestionItems } = require('../web/search');
const { buildDependencyGraph } = require('../web/dependency-graph');
const SC = require('../web/status-colors');
const { typeBadge } = require('../web/type-badge');

// Not /epic/i: "datePicker" spells it.
const EPIC_WORD = /\bepic|Epic|EPIC/;

const web = (f) => fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8').replace(/\r\n/g, '\n');

function board(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-retired-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

const OLD_EPIC = '---\nid: 1\nstatus: todo\npriority: Normal\nepic: true\nsprint: 5\n---\n\n# Old epic\n\nbody\n';

// What the edit form sends on every save.
const FORM_BODY = {
  title: 'Old epic, retitled', status: 'doing', priority: 'High', waiting_for: [], blocked: '', review: '', prompt: '',
  tags: ['x'], assignee: '@alex', start_date: '', end_date: '', due_date: '', type: 'epic', parent: '', rank: '', body: 'new body\n',
};

// --- the card store ---------------------------------------------------------

test('a card with epic: true reads as an ordinary card: no epic in the card, its JSON or its detail', () => {
  const dir = board({ '0001.old-epic.card.md': OLD_EPIC });
  const card = cs.readCardFile(path.join(dir, '0001.old-epic.card.md'));
  assert.ok(!('epic' in card));
  assert.ok(!('epic' in cs.toJSON(card)));
  assert.ok(!('epic' in cs.cardDetail(dir, 1)));
  assert.strictEqual(card.type, null, 'the flag does not turn into a type on read');
});

test('an epic: true line survives a status move and a full form edit like any unknown field', () => {
  const dir = board({ '0001.old-epic.card.md': OLD_EPIC });
  const file = path.join(dir, '0001.old-epic.card.md');
  cs.updateCard(dir, 1, { status: 'done' });
  assert.match(fs.readFileSync(file, 'utf8'), /^epic: true$/m);
  cs.updateCard(dir, 1, FORM_BODY);
  const raw = fs.readFileSync(file, 'utf8');
  assert.match(raw, /^epic: true$/m);
  assert.match(raw, /^sprint: 5$/m);
  assert.match(raw, /^type: epic$/m, 'the card now also wears the type the form set');
  const lines = raw.split('\n');
  assert.ok(lines.indexOf('epic: true') < lines.indexOf('sprint: 5'), 'the line keeps its place');
});

test('an epic key in a create or edit body writes nothing, true or false', () => {
  const dir = board({ '0001.old-epic.card.md': OLD_EPIC, '0002.plain.card.md': '---\nid: 2\nstatus: todo\n---\n\n# Plain\n' });
  const made = cs.createCard(dir, { title: 'Fresh', status: 'todo', epic: true });
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, made.id), 'utf8'), /^epic:/m);
  cs.updateCard(dir, 2, { title: 'Plain, retitled', epic: true });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '0002.plain.card.md'), 'utf8'), /^epic:/m);
  cs.updateCard(dir, 1, { title: 'Still flagged', epic: false });
  const raw = fs.readFileSync(path.join(dir, '0001.old-epic.card.md'), 'utf8');
  assert.match(raw, /^epic: true$/m, 'an old browser tab sending epic: false does not strip the line');
  assert.match(raw, /^# Still flagged$/m, 'and the edit itself lands');
});

// --- the API ---------------------------------------------------------------

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

async function send(base, method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('the API carries no epic on a card, takes an epic key without error and writes none', async () => {
  const dir = board({ '0001.old-epic.card.md': OLD_EPIC });
  await withServer(dir, async (base) => {
    const data = (await send(base, 'GET', '/api/board')).json;
    assert.ok(!('epic' in data.active[0]));
    assert.ok(!('epic' in (await send(base, 'GET', '/api/cards/1/detail')).json));
    const made = await send(base, 'POST', '/api/cards', { title: 'Fresh', status: 'todo', epic: true });
    assert.strictEqual(made.status, 201);
    assert.ok(!('epic' in made.json));
    assert.doesNotMatch(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.includes('fresh'))), 'utf8'), /^epic:/m);
    const patched = await send(base, 'PATCH', '/api/cards/1', { title: 'Old epic, retitled', epic: false });
    assert.strictEqual(patched.status, 200);
    assert.match(fs.readFileSync(path.join(dir, '0001.old-epic.card.md'), 'utf8'), /^epic: true$/m);
  });
});

test('the page has no epic checkbox, no epic wash class, no epic token and no Epics filter chip', async () => {
  await withServer(board({ '0001.old-epic.card.md': OLD_EPIC }), async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /f-epic|epic-check/i);
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.doesNotMatch(css, EPIC_WORD);
  });
});

// --- search ------------------------------------------------------------------

test('epic: is no longer a search scope: it searches the literal text like any unknown prefix', () => {
  assert.deepStrictEqual(parseSearchQuery('epic:'), [{ field: null, value: 'epic:' }]);
  assert.deepStrictEqual(parseSearchQuery('Epic:foo'), [{ field: null, value: 'epic:foo' }]);
  const cards = [
    { id: 1, title: 'a', body: '', status: 'todo', priority: 'Normal', tags: [], type: 'epic' },
    { id: 2, title: 'b', body: 'see epic: notes', status: 'todo', priority: 'Normal', tags: [] },
  ];
  assert.deepStrictEqual(filterCards(cards, parseSearchQuery('epic:')).map((c) => c.id), [2]);
  assert.deepStrictEqual(filterCards(cards, parseSearchQuery('type:epic')).map((c) => c.id), [1], 'type: finds epics now');
});

test('the search box does not offer an epic: term', () => {
  assert.ok(!searchSuggestionItems('e').some((i) => i.label.startsWith('epic:')));
});

// --- the map graph -----------------------------------------------------------

test('graph nodes and ghosts carry no epic flag', () => {
  const cards = [
    { id: 1, title: 'Root', status: 'todo', waiting_for: [], archived: false, epic: true },
    { id: 2, title: 'Leaf', status: 'todo', waiting_for: [1], archived: false, parent: 1 },
    { id: 3, title: 'Far', status: 'todo', waiting_for: [999], archived: false },
  ];
  const g = buildDependencyGraph(cards, new Set([2, 3]));
  for (const n of [...g.nodes, ...g.ghosts]) assert.ok(!('epic' in n), `node ${n.id}`);
});

// --- colors ------------------------------------------------------------------

test('the plugin no longer owns an epic color: no constant, no soft helper, no theme token', () => {
  assert.deepStrictEqual(Object.keys(SC).filter((k) => /epic/i.test(k)), []);
  for (const theme of ['light', 'dark']) {
    assert.deepStrictEqual(Object.keys(SC.themeColorTokens(theme)).filter((k) => /epic/i.test(k)), []);
  }
});

test('an epic wears the color the board\'s types: list gives it, and a neutral chip without one', () => {
  assert.strictEqual(typeBadge({ type: 'epic' }, [{ name: 'epic', color: '#f0883e' }]),
    '<span class="type-chip" title="epic" data-type-color="#f0883e">epic</span>');
  assert.strictEqual(typeBadge({ type: 'epic' }, []), '<span class="type-chip" title="epic">epic</span>');
  assert.strictEqual(typeBadge({ type: 'epic' }, [{ name: 'epic', color: '' }]), '<span class="type-chip" title="epic">epic</span>');
});

// --- the browser sources ---------------------------------------------------------

test('app.js names an epic only for the map\'s membership edge kind', () => {
  const stray = web('app.js').split('\n').filter((l) => EPIC_WORD.test(l) && !/kind\s*[!=]==?\s*'epic'/.test(l));
  assert.deepStrictEqual(stray, []);
});

test('the browser modules other than the map graph and its pinned edge kind never say epic', () => {
  for (const f of ['search.js', 'status-colors.js', 'app.html', 'app.css']) {
    const stray = web(f).split('\n').filter((l) => EPIC_WORD.test(l));
    assert.deepStrictEqual(stray, [], f);
  }
});

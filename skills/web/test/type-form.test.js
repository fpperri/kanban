const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createServer } = require('../scripts/server');
const { comboboxSuggestions } = require('../web/combobox');
const { isDirty } = require('../web/form-guard');

const WEB = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8').replace(/\r\n/g, '\n');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// A stand-in for the form: `$('#f-x')` hands back one {value, checked} per selector.
function fakeForm(initial = {}) {
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || { value: '', checked: false, ...(initial[sel] || {}) });
  return { $, els };
}

function typeOptions(types) {
  const src = appSrc.match(/attachCombobox\(\$\('#f-type'\), .*\);\n/);
  assert.ok(src, 'app.js registers a combobox on #f-type');
  const registered = [];
  const { $ } = fakeForm();
  const sandbox = { $, state: { types }, attachCombobox: (input, getOptions) => registered.push({ input, getOptions }) };
  vm.createContext(sandbox);
  vm.runInContext(src[0], sandbox);
  assert.strictEqual(registered.length, 1);
  assert.strictEqual(registered[0].input, $('#f-type'));
  return () => registered[0].getOptions();
}

test('the form has a Type field inside a "Show more fields" row, and the two-row layout is unchanged', () => {
  const rows = html.match(/<div class="row modal-extra">[\s\S]*?<\/div>/g) || [];
  assert.ok(rows.some((row) => /<label>Type\s*<input id="f-type"/.test(row)), 'Type is a labelled text input in a .modal-extra row');
  assert.strictEqual((html.match(/class="row modal-extra"/g) || []).length, 2);
});

test('the type field offers the declared types in the order the config lists them', () => {
  const options = typeOptions([{ name: 'story', color: '' }, { name: 'objective', color: '#a371f7' }, { name: 'epic', color: '' }]);
  assert.deepStrictEqual(comboboxSuggestions(options(), '').map((o) => o.value), ['story', 'objective', 'epic']);
});

test('the type field reads the board\'s list each time it opens, so a poll that changes the list is picked up', () => {
  const types = [{ name: 'story', color: '' }];
  const src = appSrc.match(/attachCombobox\(\$\('#f-type'\), .*\);\n/)[0];
  const registered = [];
  const state = { types };
  const sandbox = { $: fakeForm().$, state, attachCombobox: (input, getOptions) => registered.push(getOptions) };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.deepStrictEqual(registered[0]().map((o) => o.value), ['story']);
  state.types = [{ name: 'milestone', color: '' }, { name: 'story', color: '' }];
  assert.deepStrictEqual(registered[0]().map((o) => o.value), ['milestone', 'story']);
});

test('a word that is not on the list is still legal: it filters the menu to nothing and the field keeps it', () => {
  const options = typeOptions([{ name: 'story', color: '' }, { name: 'epic', color: '' }]);
  assert.deepStrictEqual(comboboxSuggestions(options(), 'spike'), []);
});

test('a board with no types list leaves the field a plain text box with nothing to suggest', () => {
  assert.deepStrictEqual(typeOptions([])(), []);
});

function loadSubmitModal(form) {
  const calls = [];
  const sandbox = {
    $: form.$,
    state: { active: [] },
    api: async (method, url, payload) => { calls.push({ method, url, payload }); },
    parseTags: (s) => s.split(',').map((x) => x.trim()).filter(Boolean),
    parseIds: () => [],
    closeModal() {},
    loadBoard: async () => {},
    toast() {},
    gate422Text: () => '',
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('submitModal'), sandbox);
  return { submit: () => sandbox.submitModal({ preventDefault() {} }), calls };
}

test('saving sends the typed type trimmed, on create and on edit', async () => {
  for (const [id, method, url] of [['', 'POST', '/api/cards'], ['7', 'PATCH', '/api/cards/7']]) {
    const form = fakeForm({ '#f-id': { value: id }, '#f-title': { value: 'T' }, '#f-type': { value: '  spike ' } });
    const { submit, calls } = loadSubmitModal(form);
    await submit();
    assert.strictEqual(calls[0].method, method);
    assert.strictEqual(calls[0].url, url);
    assert.strictEqual(calls[0].payload.type, 'spike');
  }
});

test('clearing the field saves a blank type, which is how an edit removes the line', async () => {
  const form = fakeForm({ '#f-id': { value: '7' }, '#f-title': { value: 'T' }, '#f-type': { value: '   ' } });
  const { submit, calls } = loadSubmitModal(form);
  await submit();
  assert.strictEqual(calls[0].payload.type, '');
});

function loadOpenModal(form) {
  const sandbox = {
    $: form.$,
    state: {},
    formSnapshot: null,
    renderStatusOptions() {}, boardStatuses: () => ['todo'], syncBlockedInputStyle() {}, syncReviewInputStyle() {},
    setPromptRowVisible() {}, syncAssigneeColor() {}, isMinimalCreate: () => false, applyModalFullscreen() {},
    snapshotFormFields() { return {}; },
  };
  sandbox.$ = (sel) => {
    const el = form.$(sel);
    el.classList = el.classList || { toggle() {}, remove() {} };
    el.textContent = el.textContent || '';
    el.focus = el.focus || (() => {});
    return el;
  };
  vm.createContext(sandbox);
  vm.runInContext(fn('openModal'), sandbox);
  return sandbox.openModal;
}

function card(extra) {
  return { id: 7, title: 'T', status: 'todo', priority: 'Normal', tags: [], waiting_for: [], body: '', ...extra };
}

test('editing a typed card opens with its type in the field; a card with none, or a new one, opens empty', () => {
  const form = fakeForm();
  const open = loadOpenModal(form);
  open(card({ type: 'objective' }));
  assert.strictEqual(form.$('#f-type').value, 'objective');
  open(card({ type: null }));
  assert.strictEqual(form.$('#f-type').value, '');
  open(card({ type: 'objective' }));
  open(null);
  assert.strictEqual(form.$('#f-type').value, '');
});

test('typing in the type field counts as unsaved work for the backdrop-close guard', () => {
  const form = fakeForm();
  const sandbox = { $: form.$ };
  vm.createContext(sandbox);
  vm.runInContext(fn('snapshotFormFields'), sandbox);
  const before = sandbox.snapshotFormFields();
  form.$('#f-type').value = 'spike';
  assert.strictEqual(isDirty(before, sandbox.snapshotFormFields()), true);
});

// End to end through the real server: the form PATCHes every managed field on every save.
function tmpBoard(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-type-form-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    '---\nid: 1\nstatus: todo\npriority: Normal\ntype: objective\n---\n\n# One\n\nbody\n');
  if (config) fs.writeFileSync(path.join(dir, 'config.yaml'), config);
  return dir;
}

async function withServer(dir, fn2) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn2(`http://127.0.0.1:${srv.address().port}`); } finally { srv.close(); }
}

async function send(base, method, url, body) {
  const res = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

function formPayload(extra) {
  return {
    title: 'One', status: 'todo', priority: 'Normal', tags: [], waiting_for: [], blocked: '', review: '', prompt: '',
    assignee: '', start_date: '', end_date: '', due_date: '', body: 'body\n', ...extra,
  };
}

test('a word not on the board\'s list saves as the card\'s type, and a later save with the field cleared removes the line', async () => {
  const dir = tmpBoard('types:\n  - objective\n  - story\n');
  const file = path.join(dir, '0001.one.card.md');
  await withServer(dir, async (base) => {
    assert.strictEqual((await send(base, 'PATCH', '/api/cards/1', formPayload({ type: 'spike' }))).json.type, 'spike');
    assert.match(fs.readFileSync(file, 'utf8'), /^type: spike$/m);
    assert.strictEqual((await send(base, 'PATCH', '/api/cards/1', formPayload({ type: '' }))).json.type, null);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /^type:/m);
  });
});

test('a board with no types list still stores a typed type, on create and on edit', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await send(base, 'POST', '/api/cards', formPayload({ title: 'Fresh', type: 'epic' }));
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.type, 'epic');
    assert.strictEqual((await send(base, 'PATCH', '/api/cards/1', formPayload({ type: 'story' }))).json.type, 'story');
    assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^type: story$/m);
  });
});

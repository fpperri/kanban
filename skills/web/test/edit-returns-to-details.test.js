const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The edit form opened from a card's details (the Edit button, or e) gives the card back when it is left:
// Save writes it and shows the details again with what was saved, and Esc, the X and a click on the
// backdrop do the same through the unsaved-changes guard. A form opened anywhere else (New card, Add
// child...) keeps closing to the board. The handlers run here in a vm against stand-ins for the page.

const WEB = path.join(__dirname, '..', 'web');
const appSrc = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(WEB, 'app.html'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

function page({ from = null, id = '7', phone = false, dirty = false, confirms = true, apiFails = false, detailOpens = true } = {}) {
  const log = [];
  const els = {};
  const $ = (sel) => (els[sel] = els[sel] || { value: '', focus(o) { log.push(['focus', sel, o]); } });
  els['#f-id'] = { value: id };
  els['#f-title'] = { value: 'Saved title' };
  els['#f-status'] = { value: 'doing' };
  const sandbox = {
    $, log,
    editFromCardId: from,
    formSnapshot: {},
    state: { active: [{ id: Number(id), status: 'todo' }], typesOn: false },
    isDirty: () => dirty,
    snapshotFormFields: () => ({}),
    confirm: (msg) => { log.push(['confirm', msg]); return confirms; },
    closeModal: () => log.push(['closeModal']),
    api: async (method, url) => { log.push(['api', method, url]); if (apiFails) throw new Error('boom'); },
    parseTags: () => [], parseIds: () => [],
    onPhoneLayout: () => phone,
    setPhoneColumn: (col) => log.push(['setPhoneColumn', col]),
    loadBoard: async () => { log.push(['loadBoard']); },
    openDetailModal: async (cardId) => { log.push(['openDetailModal', cardId]); return detailOpens; },
    closeCard: () => log.push(['closeCard']),
    openLeavesNote: () => '', groupJoinedNote: () => '', gate422Text: () => '',
    toast: (m) => log.push(['toast', m]),
  };
  vm.createContext(sandbox);
  vm.runInContext(['returnToDetails', 'requestCloseModal', 'submitModal'].map(fn).join('\n'), sandbox);
  const names = () => log.map((l) => l[0]);
  return { sandbox, log, names, save: () => sandbox.submitModal({ preventDefault() {} }), leave: () => sandbox.requestCloseModal() };
}

const settle = () => new Promise((r) => setImmediate(r));

test('Save from the details writes the card, closes the form and shows the details again, on every layout', async () => {
  for (const phone of [false, true]) {
    const p = page({ from: 7, phone });
    await p.save();
    assert.deepStrictEqual(p.names().filter((n) => n !== 'focus'), ['api', 'closeModal', ...(phone ? ['setPhoneColumn'] : []), 'loadBoard', 'openDetailModal'], `phone ${phone}`);
    assert.deepStrictEqual(p.log.find((l) => l[0] === 'openDetailModal'), ['openDetailModal', 7]);
    assert.ok(!p.names().includes('closeCard'), 'the card is not closed');
  }
});

test('the details are read after the board has loaded, so they show the saved content, and take the focus', async () => {
  const p = page({ from: 7 });
  await p.save();
  assert.ok(p.names().indexOf('openDetailModal') > p.names().indexOf('loadBoard'));
  assert.strictEqual(JSON.stringify(p.log.at(-1)), JSON.stringify(['focus', '#detail-modal .modal', { preventScroll: true }]));
});

test('the details take no focus when they failed to load', async () => {
  const p = page({ from: 7, detailOpens: false });
  await p.save();
  assert.ok(!p.names().includes('focus'));
});

test('a form opened anywhere else saves and closes as it did: no details come back', async () => {
  const fresh = page({ from: null, id: '' });
  await fresh.save();
  assert.ok(fresh.names().includes('closeModal'));
  assert.ok(!fresh.names().includes('openDetailModal'));
  const other = page({ from: 3, id: '7' });
  await other.save();
  assert.ok(!other.names().includes('openDetailModal'), 'the card the form came from is not the one saved');
});

test('a refused or failed save keeps the form open and returns nowhere', async () => {
  const p = page({ from: 7, apiFails: true });
  await p.save();
  assert.ok(!p.names().includes('closeModal'));
  assert.ok(!p.names().includes('openDetailModal'));
});

test('leaving a clean form that came from the details returns to them with no question', async () => {
  const p = page({ from: 7 });
  p.leave();
  await settle();
  assert.deepStrictEqual(p.names().filter((n) => n !== 'focus'), ['closeModal', 'openDetailModal']);
  assert.deepStrictEqual(p.log.find((l) => l[0] === 'openDetailModal'), ['openDetailModal', 7]);
  assert.ok(!p.names().includes('confirm'));
});

test('leaving a form with unsaved changes asks first, and returns to the details only on yes', async () => {
  const yes = page({ from: 7, dirty: true, confirms: true });
  yes.leave();
  await settle();
  assert.deepStrictEqual(yes.names().filter((n) => n !== 'focus'), ['confirm', 'closeModal', 'openDetailModal']);
  assert.strictEqual(yes.log[0][1], 'Discard unsaved changes to this card?');
  const no = page({ from: 7, dirty: true, confirms: false });
  no.leave();
  await settle();
  assert.deepStrictEqual(no.names(), ['confirm'], 'cancel keeps the form open and the details closed');
});

test('leaving a form that did not come from the details closes it and nothing else', async () => {
  const clean = page({ from: null });
  clean.leave();
  await settle();
  assert.deepStrictEqual(clean.names(), ['closeModal']);
  const dirty = page({ from: null, dirty: true });
  dirty.leave();
  await settle();
  assert.deepStrictEqual(dirty.names(), ['confirm', 'closeModal']);
});

test('Esc with the form up is the form\'s leave, through the same guard as the X and the backdrop', () => {
  assert.match(appSrc, /if \(!\$\('#modal'\)\.classList\.contains\('hidden'\)\) \{ requestCloseModal\(\); return; \}/);
  assert.match(appSrc, /\$\('#modal-close'\)\.addEventListener\('click', requestCloseModal\)/);
  assert.match(appSrc, /if \(e\.target\.id === 'modal'\) requestCloseModal\(\)/);
  assert.match(appSrc, /target === 'edit'\) \{ \$\('#card-form'\)\.requestSubmit\(\)/, 'Ctrl+S submits the same form');
});

test('only the details\' Edit opens a form that returns: every other opening clears the card it came from', () => {
  assert.match(fn('openModal'), /\{\n  editFromCardId = null;/);
  const edit = fn('editFromDetail');
  assert.ok(edit.indexOf('openModal(card)') < edit.indexOf('editFromCardId = card.id'));
  assert.strictEqual((appSrc.match(/editFromCardId = card\.id/g) || []).length, 1);
});

test('the details can take the focus the form hands back', () => {
  assert.match(html, /<div class="modal detail-modal" tabindex="-1">/);
});

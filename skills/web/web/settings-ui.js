'use strict';
// The gear's sheet on the page (docs/adr/0017): its two sections, the layout (menu and page side by
// side from 760 px, else one at a time with a back button), and the pages of This board that write
// config.yaml one line at a time through POST /api/config: Logbook, Groups (with the Iterations
// switch and the groups found), Prefixes (read only, with idDigits) and Counters (read only). The
// rules (layout, Esc, what a switch sends) are settings.js; the server (settings-store.js) judges
// every value and answers with the settings as the file now reads.
//
// This browser's pages are static markup in app.html, drawn and kept by app.js (prefs.js). A page of
// This board is an entry of the list below: { id, title, build(settings) -> nodes, state?(settings) }.
// A later feature adds its page with settingsAddBoardPage(page, afterId), which puts it in the menu
// and gives it the sheet's layout, Esc and focus for free.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: $, state, api, loadBoard, openNotes, openGroupForm, closePrefsSheet, and settings.js's
// functions.

const settingsUi = { page: null, errors: {}, drafts: {}, ready: false };

function settingsEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// A control inside the sheet keeps a selection and holds the poll, as every control of the sheet does.
function settingsMark(el) {
  el.setAttribute('data-keeps-selection', '');
  el.setAttribute('data-holds-poll', '');
  return el;
}

function settingsSheetOpen() {
  return !$('#prefs-sheet').classList.contains('hidden');
}

// ---------- the request ----------

// One change to one line. The page shows the server's answer; a refusal stays on the page, under the
// control that asked, with the value the person typed still in the field.
async function settingsSend(body, draftKey, typed) {
  settingsUi.errors = {};
  try {
    const answer = await api('POST', '/api/config', body);
    state.settings = answer.settings;
    delete settingsUi.drafts[draftKey];
    await loadBoard();
  } catch (e) {
    settingsUi.errors[draftKey] = e.message;
    if (typed !== undefined) settingsUi.drafts[draftKey] = typed;
  }
  settingsRenderBoard();
}

// A typed value: the page refuses what it can see is wrong (the text stays in the field, with the
// reason under it); anything else goes to the server, which judges it.
function settingsSave(key, text, problem, body) {
  if (!problem) { settingsSend(body, key, text); return; }
  settingsUi.errors = { [key]: problem };
  settingsUi.drafts[key] = text;
  settingsRenderBoard();
}

// ---------- the controls ----------

function settingsError(key) {
  const text = settingsUi.errors[key];
  if (!text) return null;
  const p = settingsEl('p', 'prefs-error', text);
  p.setAttribute('role', 'alert');
  return p;
}

function settingsSwitch(key, label, on, o = {}) {
  const id = `pf-${key}-switch`;
  const seg = settingsEl('span', 'prefs-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-labelledby', id);
  for (const choice of ['on', 'off']) {
    const b = settingsMark(settingsEl('button', 'prefs-opt', choice));
    b.type = 'button';
    b.dataset.fk = `${key}:${choice}`;
    b.dataset.switch = key;
    b.dataset.value = choice;
    b.setAttribute('aria-pressed', String((choice === 'on') === on));
    if (o.disabled) { b.disabled = true; b.title = o.disabled; }
    b.addEventListener('click', () => { if ((choice === 'on') !== on) o.set(choice === 'on'); });
    seg.append(b);
  }
  const label_ = settingsEl('span', 'prefs-label', label);
  label_.id = id;
  const item = settingsEl('div', 'prefs-item');
  const row = settingsEl('div', 'prefs-row');
  row.append(label_, seg);
  item.append(row);
  if (o.hint) item.append(settingsEl('p', 'prefs-hint', o.hint));
  const err = settingsError(key);
  if (err) item.append(err);
  return item;
}

// A field with a Save button. `save(text)` runs on Save or Enter. A refused value stays in the field.
function settingsField(key, label, value, o = {}) {
  const item = settingsEl('div', 'prefs-item');
  const input = settingsMark(settingsEl('input'));
  const draft = Object.prototype.hasOwnProperty.call(settingsUi.drafts, key) ? settingsUi.drafts[key] : null;
  Object.assign(input, { type: 'text', id: `pf-${key}`, spellcheck: false, autocomplete: 'off', value: draft !== null ? draft : value, placeholder: o.placeholder || '', disabled: !!o.disabled });
  if (o.numeric) input.inputMode = 'numeric';
  input.dataset.fk = `field:${key}`;
  const save = settingsMark(settingsEl('button', '', 'Save'));
  save.type = 'submit';
  save.dataset.fk = `save:${key}`;
  save.disabled = !!o.disabled;
  const form = settingsEl('form', 'prefs-path');
  form.noValidate = true;
  form.append(input, save);
  form.addEventListener('submit', (e) => { e.preventDefault(); o.save(input.value); });
  const lab = settingsEl('label', 'prefs-label', label);
  lab.htmlFor = input.id;
  item.append(lab, form);
  const err = settingsError(key);
  if (err) item.append(err);
  if (o.hint) item.append(settingsEl('p', 'prefs-hint', o.hint));
  return item;
}

function settingsTable(head, rows) {
  const table = settingsEl('table', 'prefs-table');
  const tr = settingsEl('tr');
  for (const h of head) tr.append(settingsEl('th', '', h));
  const thead = settingsEl('thead');
  thead.append(tr);
  table.append(thead);
  const body = settingsEl('tbody');
  for (const row of rows) {
    const r = settingsEl('tr');
    row.forEach((cell, at) => r.append(settingsEl('td', at === 0 ? 'mono' : '', cell)));
    body.append(r);
  }
  table.append(body);
  return table;
}

// ---------- the pages of This board ----------

// Logbook and Groups: a switch (off removes the line, on writes the folder) and a folder field (a
// folder inside the board; saving one turns the feature on). A folder set by hand outside the board
// shows locked, with the reason, and its controls stand still.
function settingsFeatureNodes(key, label, what) {
  const feature = state.settings[key];
  const lock = feature.locked ? feature.reason : null;
  const nodes = [
    settingsEl('p', 'prefs-hint', `config.yaml's ${key}: line turns ${what} on and names the folder inside the board where they live. Off removes the line; the files stay where they are.`),
  ];
  if (lock) nodes.push(settingsEl('p', 'prefs-note', `Locked. ${lock} (${key}: ${feature.folder})`));
  nodes.push(settingsSwitch(key, label, feature.on, {
    disabled: lock,
    set: (on) => {
      const typed = $(`#pf-${key}`);
      settingsSend(settingsSwitchBody(key, on, typed ? typed.value : feature.folder), key);
    },
  }));
  nodes.push(settingsField(key, 'Folder', feature.folder, {
    placeholder: SETTINGS_FOLDERS[key],
    disabled: !!lock,
    hint: feature.on ? 'Only the line changes; moving the files is yours to do.' : 'Saving a folder turns it on.',
    save: (text) => settingsSave(key, text, settingsFolderProblem(text), settingsFolderBody(key, text)),
  }));
  return nodes;
}

function settingsLogbookNodes() {
  return settingsFeatureNodes('logbook', 'Logbook', 'the notes');
}

function settingsOpenGroup(id) {
  closePrefsSheet();
  openNotes({ kind: 'group', gid: id });
}

function settingsGroupsFoundNodes() {
  const groups = state.groups;
  const item = settingsEl('div', 'prefs-item');
  item.append(settingsEl('span', 'prefs-label', `Groups found (${groups ? groups.list.length : 0})`));
  if (!groups) {
    item.append(settingsEl('p', 'prefs-hint', 'Groups are off, so the board reads none.'));
    return item;
  }
  const box = settingsEl('div', 'prefs-found');
  for (const found of settingsGroupsFound(groups.list)) {
    const section = settingsEl('div');
    section.append(settingsEl('h4', '', found.label));
    const list = settingsEl('ul', 'pick-list');
    for (const g of found.groups) {
      const b = settingsMark(settingsEl('button', 'pick-btn'));
      b.type = 'button';
      b.dataset.groupId = g.id;
      b.title = 'Open this group';
      b.append(settingsEl('span', '', groupLabel(g)), settingsEl('span', 'pick-meta', `${g.cards.length} card${g.cards.length === 1 ? '' : 's'}`));
      b.addEventListener('click', () => settingsOpenGroup(g.id));
      const li = settingsEl('li');
      li.append(b);
      list.append(li);
    }
    section.append(list);
    box.append(section);
  }
  item.append(box);
  if (groups.skipped && groups.skipped.length) {
    item.append(settingsEl('p', 'prefs-hint', `${groups.skipped.length} file${groups.skipped.length === 1 ? '' : 's'} in the folder could not be read as a group and ${groups.skipped.length === 1 ? 'is' : 'are'} skipped.`));
  }
  const add = settingsMark(settingsEl('button', '', 'New group…'));
  add.type = 'button';
  add.dataset.fk = 'new-group';
  add.addEventListener('click', () => { closePrefsSheet(); openGroupForm({ folder: '' }); });
  item.append(add);
  return item;
}

function settingsGroupsNodes() {
  const nodes = settingsFeatureNodes('groups', 'Groups', 'groups');
  const st = state.settings;
  nodes.push(settingsSwitch('iterations', 'Iterations', state.iterations, {
    disabled: st.groups.on ? null : 'Turn groups on first: iterations are groups',
    hint: 'iterations: true gives the header the iteration dropdown. Iterations are the groups in the iteration/ folder; turning groups off turns this off too.',
    set: (on) => settingsSend(settingsSwitchBody('iterations', on), 'iterations'),
  }));
  nodes.push(settingsGroupsFoundNodes());
  return nodes;
}

function settingsPrefixesNodes() {
  const st = state.settings;
  const root = state.groups ? state.groups.folder : '';
  const nodes = [settingsEl('p', 'prefs-hint', 'The prefixes: block, read only here: a card type, or a folder of the groups, and the letters its ids start with. Cards of no listed type keep plain numbers. Edit the block in config.yaml.')];
  if (st.prefixes.length) nodes.push(settingsTable(['Prefix', 'Card type or folder'], st.prefixes.map((row) => [row.prefix, settingsPrefixTarget(row, root)])));
  else nodes.push(settingsEl('p', 'prefs-note', 'config.yaml has no prefixes: block, so every id is a plain number.'));
  nodes.push(settingsField('idDigits', 'idDigits: zero-padding in file names', String(st.idDigits), {
    numeric: true,
    hint: `A new card file is named ${settingsIdExample(st.idDigits)}.a-title.card.md. Files already named stay as they are, and every id is read by its number.`,
    save: (text) => settingsSave('idDigits', text, settingsDigitsProblem(text), settingsDigitsBody(text)),
  }));
  return nodes;
}

function settingsCountersNodes() {
  const st = state.settings;
  const rows = [['nextId', st.nextId === null ? 'none yet' : String(st.nextId)]];
  for (const prefix of Object.keys(st.counters)) rows.push([prefix, String(st.counters[prefix])]);
  return [
    settingsEl('p', 'prefs-hint', 'Read only: the next number each prefix hands out, or higher when a file already holds it. Plain card ids come from nextId.'),
    settingsTable(['Counter', 'Next'], rows),
  ];
}

const settingsBoardPages = [
  { id: 'logbook', title: 'Logbook', build: settingsLogbookNodes },
  { id: 'groups', title: 'Groups', build: settingsGroupsNodes },
  { id: 'prefixes', title: 'Prefixes', build: settingsPrefixesNodes },
  { id: 'counters', title: 'Counters', build: settingsCountersNodes },
];

// Adds a page to This board, after the page `afterId` (at the end when none is named).
function settingsAddBoardPage(page, afterId) {
  const at = settingsBoardPages.findIndex((p) => p.id === afterId);
  settingsBoardPages.splice(at === -1 ? settingsBoardPages.length : at + 1, 0, page);
}

function settingsPageStateText(page) {
  if (!state.settings) return '';
  if (page.state) return page.state(state.settings);
  return settingsPageState(page.id, state.settings, state.groups ? state.groups.list.length : 0);
}

// ---------- the sheet ----------

function settingsMenuItem(page, title, stateText) {
  const li = settingsEl('li');
  const b = settingsMark(settingsEl('button', 'prefs-menu-item'));
  b.type = 'button';
  b.dataset.page = page;
  const name = settingsEl('span', '', title);
  const meta = settingsEl('span', 'prefs-menu-state', stateText);
  b.append(name, meta);
  li.append(b);
  return li;
}

function settingsBoardTitle(id) {
  const page = settingsBoardPages.find((p) => p.id === id);
  return page ? page.title : id;
}

// The board section's menu and, when a board page is showing, that page. The page that has the focus
// keeps it across the redraw, found again by its key.
function settingsRenderBoard() {
  const menu = $('#prefs-board-menu');
  const panel = $('#prefs-board-page');
  if (!menu || !panel) return;
  const active = document.activeElement;
  const keep = active && active.dataset && $('#prefs-sheet').contains(active) ? active.dataset.fk || null : null;
  menu.replaceChildren(...settingsBoardPages.map((p) => settingsMenuItem(`board:${p.id}`, p.title, settingsPageStateText(p))));
  const current = settingsUi.page && settingsUi.page.startsWith('board:') ? settingsBoardPages.find((p) => p.id === settingsUi.page.slice(6)) : null;
  if (!state.settings) {
    panel.replaceChildren(settingsEl('p', 'prefs-hint', 'The board has not answered yet.'));
  } else if (current) {
    const title = settingsEl('h3', 'prefs-page-title', current.title);
    title.id = 'prefs-page-title';
    panel.setAttribute('aria-labelledby', 'prefs-page-title');
    panel.replaceChildren(settingsEl('p', 'prefs-eyebrow', 'This board · written to config.yaml'), title, ...current.build(state.settings));
  } else {
    panel.replaceChildren();
  }
  settingsLayout();
  if (keep) {
    const again = [...$('#prefs-sheet').querySelectorAll('[data-fk]')].find((el) => el.dataset.fk === keep);
    if (again && !again.disabled) again.focus();
  }
}

// Menu and page side by side, or one at a time; the page named by settingsUi.page is the one showing.
function settingsLayout() {
  const wide = settingsIsWide(window.innerWidth);
  settingsUi.page = settingsResized(settingsUi.page, wide);
  const page = settingsUi.page;
  const panel = $('#prefs-panel');
  panel.classList.toggle('is-split', wide);
  panel.classList.toggle('is-drill', !wide);
  $('#prefs-menu').hidden = !wide && !!page;
  $('#prefs-pages').hidden = !wide && !page;
  const kind = page && page.startsWith('board:') ? 'board' : page;
  panel.querySelectorAll('.prefs-page').forEach((el) => { el.hidden = el.dataset.page !== kind; });
  panel.querySelectorAll('.prefs-menu-item').forEach((el) => {
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
}

// The sheet is open: show `asked`, else the page it had (wide) or the menu (narrow).
function settingsShow(asked) {
  const wide = settingsIsWide(window.innerWidth);
  settingsUi.page = settingsOpen(asked, settingsUi.page, wide);
  settingsUi.errors = {};
  settingsUi.drafts = {};
  settingsRenderBoard();
}

// A menu item: its page now. A narrow sheet moves focus to the page's back button.
function settingsGo(page) {
  settingsUi.page = page;
  settingsUi.errors = {};
  settingsUi.drafts = {};
  settingsRenderBoard();
  if (!settingsIsWide(window.innerWidth)) $('#prefs-back').focus();
}

// Esc: back from a page on a narrow sheet (focus to the item that opened it), else the sheet closes.
function settingsStepBack() {
  const from = settingsUi.page;
  const next = settingsEscape(from, settingsIsWide(window.innerWidth));
  if (!next.open) { closePrefsSheet(); return; }
  settingsUi.page = next.page;
  settingsLayout();
  const item = [...$('#prefs-sheet').querySelectorAll('.prefs-menu-item')].find((el) => el.dataset.page === from);
  if (item) item.focus();
}

window.addEventListener('DOMContentLoaded', () => {
  $('#prefs-back').addEventListener('click', settingsStepBack);
  window.addEventListener('resize', () => { if (settingsSheetOpen()) settingsLayout(); });
});

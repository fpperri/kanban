'use strict';
// The gear's sheet on the page (docs/adr/0017): its two sections, the layout (menu and page side by
// side from 760 px, else one at a time with a back button), and the pages of This board that write
// config.yaml through POST /api/config, one line at a time or one whole list at a time (docs/adr/0018):
// Logbook, Groups (with the Iterations switch and the groups found), Types (the switch, the Hierarchy
// and Other types areas, Found on cards), Prefixes (editable, with idDigits) and Counters (read only).
// Each shows the path it reads, with a Copy button. The rules (layout, Esc, what a switch sends, the
// lists a change writes, the warnings) are settings.js; the server (settings-store.js) judges every
// value and answers with the settings as the file now reads.
//
// This browser's pages are static markup in app.html, drawn and kept by app.js (prefs.js). A page of
// This board is an entry of the list below: { id, title, build(settings) -> nodes, state?(settings) }.
// A later feature adds its page with settingsAddBoardPage(page, afterId), which puts it in the menu
// and gives it the sheet's layout, Esc and focus for free.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: $, state, api, loadBoard, openNotes, openGroupForm, closePrefsSheet, paintTypeColors,
// typeIconGlyph, TYPE_ICON_NAMES, and settings.js's functions.

// `tail` is the last save in line (saves of the Types and Prefixes pages go one after the other, each
// read from the state the one before left); `focusKey` the control to focus after the next draw;
// `renamed` the types renamed since the sheet opened (old word -> new), for the leftover warnings;
// `drag` the type being dragged.
const settingsUi = { page: null, errors: {}, drafts: {}, ready: false, sending: 0, tail: Promise.resolve(), focusKey: null, renamed: {}, drag: null };

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
  settingsUi.sending += 1;
  try {
    const answer = await api('POST', '/api/config', body);
    state.settings = answer.settings;
    delete settingsUi.drafts[draftKey];
    await loadBoard();
  } catch (e) {
    if (e.status === 409 && body.version !== undefined) {
      settingsUi.errors = { conflict: settingsConflictNote };
      try { await loadBoard(); } catch (again) { settingsUi.errors[draftKey] = again.message; }
    } else {
      settingsUi.errors[draftKey] = e.message;
    }
    if (typed !== undefined) settingsUi.drafts[draftKey] = typed;
  }
  settingsUi.sending -= 1;
  settingsRenderBoard();
}

// A save whose body is worked out when its turn comes, from the settings as the one before left
// them: `build()` answers the body, or null when there is nothing to write.
function settingsSendLater(build, draftKey, typed) {
  settingsUi.sending += 1;
  settingsUi.tail = settingsUi.tail.then(async () => {
    try {
      const body = build();
      if (body) await settingsSend(body, draftKey, typed);
      else settingsUi.focusKey = null;
    } finally {
      settingsUi.sending -= 1;
    }
  }).catch(() => {});
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
  const draft = Object.prototype.hasOwnProperty.call(settingsUi.drafts, key) && settingsUi.drafts[key] !== String(value) ? settingsUi.drafts[key] : null;
  Object.assign(input, { type: 'text', id: `pf-${key}`, spellcheck: false, autocomplete: 'off', value: draft !== null ? draft : value, placeholder: o.placeholder || '', disabled: !!o.disabled });
  if (o.numeric) input.inputMode = 'numeric';
  input.dataset.fk = `field:${key}`;
  input.dataset.shown = input.value;
  const save = settingsMark(settingsEl('button', '', o.button || 'Save'));
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
    hint: 'iterations: true gives the header the iteration dropdown. Iterations are the groups in the iteration/ folder; the line is ignored while groups are off.',
    set: (on) => settingsSend(settingsSwitchBody('iterations', on), 'iterations'),
  }));
  nodes.push(settingsGroupsFoundNodes());
  return nodes;
}

// A bullet list of what the page has to say in one line each: a conflict first (the page read the
// file again), then every warning. Each is what and why, never more than one bullet.
function settingsBullets(texts) {
  const conflict = settingsUi.errors.conflict;
  if (!conflict && !texts.length) return null;
  const list = settingsEl('ul', 'prefs-bullets');
  if (conflict) {
    const li = settingsEl('li', 'prefs-bullet is-error', conflict);
    li.setAttribute('role', 'alert');
    list.append(li);
  }
  for (const text of texts) list.append(settingsEl('li', 'prefs-bullet', text));
  return list;
}

// The path a page reads, with a Copy button that says Copied for a moment.
function settingsPathNode(path, kind) {
  if (!path) return null;
  const copy = settingsMark(settingsEl('button', 'prefs-copy', 'Copy'));
  copy.type = 'button';
  copy.dataset.fk = 'copy-path';
  copy.setAttribute('aria-label', `Copy the path of the ${(kind || 'file').toLowerCase()}`);
  copy.addEventListener('click', async () => {
    let said = 'Copied';
    try { await navigator.clipboard.writeText(path); } catch (e) { said = 'Select the path and copy it'; }
    copy.textContent = said;
    setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
  });
  const bar = settingsEl('div', 'prefs-pathbar');
  bar.append(settingsEl('span', 'prefs-label', kind || 'File'), settingsEl('code', 'prefs-pathtext', path), copy);
  return bar;
}

// ---------- the Types page (docs/adr/0018) ----------
//
// Hierarchy on top (the hierarchy: list in order), Other types below (the rest of types:). Each
// change is a save at once of the one list it edits, read from the settings as they stand when its
// turn comes. A rename or a removal writes types: only; what else names the old word is shown as a
// warning, never rewritten.

function settingsTypeUsed() {
  return state.settings.typeUse || {};
}

// Hierarchy changes: `next(hierarchy)` answers the new list, or null for no change.
function settingsChangeHierarchy(key, next, focus) {
  settingsUi.focusKey = focus;
  settingsSendLater(() => {
    const list = next(state.settings.hierarchy);
    return list ? settingsBlockBody('hierarchy', list, state.settings.version) : null;
  }, `row:${key}`);
}

function settingsChangeTypes(key, next, focus, typed) {
  settingsUi.focusKey = focus;
  settingsSendLater(() => settingsBlockBody('types', next(state.settings.types), state.settings.version), `row:${key}`, typed);
}

function settingsRowProblem(key, problem, typed) {
  settingsUi.errors = { [`row:${key}`]: problem };
  settingsUi.drafts[`row:${key}`] = typed;
  settingsRenderBoard();
}

function settingsRename(type, input) {
  const key = settingsTypeKey(type.name);
  const to = input.value.trim();
  if (to === type.name) return;
  const problem = settingsTypeNameProblem(state.settings.types, to, type.name);
  if (problem) { settingsRowProblem(key, problem, { name: input.value }); return; }
  if (settingsTypeKey(to) !== key) settingsUi.renamed[type.name] = to;
  settingsChangeTypes(key, (types) => settingsTypesRename(types, type.name, to), `name:${settingsTypeKey(to)}`, { name: input.value });
}

function settingsSetColor(type, raw) {
  const key = settingsTypeKey(type.name);
  const color = raw.trim().toLowerCase();
  const problem = settingsColorProblem(color);
  if (problem) { settingsRowProblem(key, problem, { hex: raw }); return; }
  if (color === (type.color || '').toLowerCase()) { settingsRenderBoard(); return; }
  settingsChangeTypes(key, (types) => settingsTypesPatch(types, type.name, { color }), `hex:${key}`, { hex: raw });
}

function settingsSetIcon(type, icon) {
  const key = settingsTypeKey(type.name);
  if ((type.icon || '') === icon) return;
  settingsChangeTypes(key, (types) => settingsTypesPatch(types, type.name, { icon }), `icon:${key}:${icon || 'none'}`);
}

function settingsRemoveType(type) {
  const ask = settingsRemoveConfirm(type.name, settingsTypeCards(settingsTypeUsed(), type.name));
  if (ask && !confirm(ask)) return;
  settingsChangeTypes(settingsTypeKey(type.name), (types) => settingsTypesRemove(types, type.name), 'field:newType');
}

function settingsTypeButton(key, act, text, label, onClick, disabled) {
  const b = settingsMark(settingsEl('button', 'types-act', text));
  b.type = 'button';
  b.dataset.act = act;
  b.dataset.fk = `act:${key}:${act}`;
  b.setAttribute('aria-label', label);
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

// The chip as the board draws it: icon, name, color.
function settingsTypePreview(type) {
  const chip = settingsEl('span', 'type-chip', '');
  chip.setAttribute('aria-hidden', 'true');
  const glyph = typeIconGlyph(type.icon);
  if (glyph) chip.append(settingsEl('span', 'type-icon', glyph));
  chip.append(type.name);
  if (type.color) chip.dataset.typeColor = type.color;
  return chip;
}

function settingsIconButtons(type, key) {
  const group = settingsEl('span', 'types-icons');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', `Icon of ${type.name}`);
  for (const icon of ['', ...TYPE_ICON_NAMES]) {
    const b = settingsMark(settingsEl('button', 'types-icon', icon === '' ? 'none' : typeIconGlyph(icon)));
    b.type = 'button';
    b.dataset.icon = icon;
    b.dataset.fk = `icon:${key}:${icon || 'none'}`;
    b.setAttribute('aria-label', icon === '' ? 'No icon' : icon);
    b.setAttribute('aria-pressed', String((type.icon || '') === icon));
    b.addEventListener('click', () => settingsSetIcon(type, icon));
    group.append(b);
  }
  return group;
}

function settingsTypeInput(className, label, value, fk) {
  const input = settingsMark(settingsEl('input', className));
  Object.assign(input, { type: 'text', value, spellcheck: false, autocomplete: 'off' });
  input.dataset.fk = fk;
  input.setAttribute('aria-label', label);
  return input;
}

// One row of either area. `row` = { name, type } (type null: a hierarchy name no type has).
function settingsTypeRow(row, where, at, count) {
  const key = settingsTypeKey(row.name);
  const type = row.type;
  const draft = settingsUi.drafts[`row:${key}`] || {};
  const li = settingsEl('li', 'types-row');
  li.dataset.type = row.name;
  li.dataset.key = key;
  li.dataset.area = where;
  const handle = settingsEl('span', 'types-handle', '⋮⋮');
  handle.draggable = true;
  handle.setAttribute('aria-hidden', 'true');
  handle.addEventListener('dragstart', (e) => {
    settingsUi.drag = row.name;
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', row.name);
      e.dataTransfer.effectAllowed = 'move';
      if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(li, 0, 0);
    }
    li.classList.add('is-dragging');
  });
  handle.addEventListener('dragend', () => { settingsUi.drag = null; li.classList.remove('is-dragging'); });
  li.append(handle);
  if (type) {
    li.append(settingsTypePreview(type));
    const name = settingsTypeInput('types-name', `Name of ${type.name}`, draft.name !== undefined ? draft.name : type.name, `name:${key}`);
    name.addEventListener('change', () => settingsRename(type, name));
    const picker = settingsMark(settingsEl('input', 'types-color'));
    picker.type = 'color';
    picker.value = settingsColorForPicker(type.color || '');
    picker.dataset.fk = `color:${key}`;
    picker.setAttribute('aria-label', `Color of ${type.name}`);
    const hex = settingsTypeInput('types-hex', `Hex color of ${type.name}`, draft.hex !== undefined ? draft.hex : type.color || '', `hex:${key}`);
    hex.placeholder = 'none';
    picker.addEventListener('change', () => settingsSetColor(type, picker.value));
    hex.addEventListener('change', () => settingsSetColor(type, hex.value));
    li.append(name, picker, hex, settingsIconButtons(type, key));
    const prefix = settingsPrefixOf(state.settings.prefixes, type.name);
    const prefixText = settingsEl('span', 'types-prefix', prefix ? `Prefix ${prefix}` : 'No prefix');
    const link = settingsMark(settingsEl('button', 'types-link', 'Prefixes'));
    link.type = 'button';
    link.dataset.fk = `prefix-link:${key}`;
    link.setAttribute('aria-label', `Open the Prefixes page to change the prefix of ${type.name}`);
    link.addEventListener('click', () => settingsGo('board:prefixes'));
    prefixText.append(' ', link);
    li.append(prefixText);
  } else {
    li.append(settingsEl('span', 'types-chip-warn', `${row.name} · not a listed type`));
  }
  const actions = settingsEl('span', 'types-acts');
  if (where === 'hierarchy') {
    actions.append(
      settingsTypeButton(key, 'up', 'Up', `Move ${row.name} up`, () => settingsChangeHierarchy(key, (h) => settingsMoveType(h, row.name, -1), `act:${key}:up`), at === 0),
      settingsTypeButton(key, 'down', 'Down', `Move ${row.name} down`, () => settingsChangeHierarchy(key, (h) => settingsMoveType(h, row.name, 1), `act:${key}:down`), at === count - 1),
      settingsTypeButton(key, 'move', 'To Other types', `Move ${row.name} to Other types`, () => settingsChangeHierarchy(key, (h) => settingsDropType(h, row.name, 'other'), `name:${key}`)),
    );
  } else {
    actions.append(settingsTypeButton(key, 'move', 'To Hierarchy', `Move ${row.name} to the Hierarchy`, () => settingsChangeHierarchy(key, (h) => settingsDropType(h, row.name, 'hierarchy', h.length), `name:${key}`)));
  }
  if (type) actions.append(settingsTypeButton(key, 'remove', 'Remove', `Remove ${row.name}`, () => settingsRemoveType(type)));
  else actions.append(settingsTypeButton(key, 'remove', 'Remove', `Remove ${row.name} from the hierarchy`, () => settingsChangeHierarchy(key, (h) => settingsDropType(h, row.name, 'other'), 'field:newType')));
  li.append(actions);
  const err = settingsError(`row:${key}`);
  if (err) li.append(err);
  return li;
}

// An area is a list and a drop target: a drop into Hierarchy lands among its rows, into Other types
// takes the name out of the hierarchy.
function settingsTypeArea(where, title, hint, rows, empty) {
  const section = settingsEl('div', 'types-area');
  const heading = settingsEl('h4', 'prefs-label', title);
  heading.id = `types-${where}-title`;
  const list = settingsEl('ul', 'types-list');
  list.dataset.area = where;
  list.setAttribute('aria-labelledby', heading.id);
  rows.forEach((row, at) => list.append(settingsTypeRow(row, where, at, rows.length)));
  list.addEventListener('dragover', (e) => {
    if (!settingsUi.drag) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    list.classList.add('is-over');
  });
  list.addEventListener('dragleave', () => list.classList.remove('is-over'));
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    list.classList.remove('is-over');
    const name = settingsUi.drag || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
    settingsUi.drag = null;
    if (!name) return;
    const mids = [...list.children].filter((li) => li.dataset.type !== undefined).map((li) => {
      const r = li.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const index = settingsDropIndex(mids, e.clientY);
    const key = settingsTypeKey(name);
    settingsChangeHierarchy(key, (h) => settingsDropType(h, name, where, index), `name:${key}`);
  });
  section.append(heading, settingsEl('p', 'prefs-hint', hint), list);
  if (!rows.length) section.append(settingsEl('p', 'prefs-note', empty));
  return section;
}

function settingsFoundNodes(found) {
  const item = settingsEl('div', 'prefs-item');
  item.append(settingsEl('span', 'prefs-label', `Found on cards (${found.length})`));
  if (!found.length) {
    item.append(settingsEl('p', 'prefs-hint', 'Every type word the cards carry is listed above.'));
    return item;
  }
  item.append(settingsEl('p', 'prefs-hint', 'Words cards carry in type: that the list does not have. Add puts one in Other types.'));
  const list = settingsEl('ul', 'pick-list');
  for (const { word, count } of found) {
    const li = settingsEl('li', 'types-found');
    const add = settingsMark(settingsEl('button', 'types-act', 'Add'));
    add.type = 'button';
    add.dataset.fk = `found:${settingsTypeKey(word)}`;
    add.setAttribute('aria-label', `Add ${word} to the types`);
    add.addEventListener('click', () => {
      const key = settingsTypeKey(word);
      settingsChangeTypes(key, (types) => settingsTypesAdd(types, word), `name:${key}`);
    });
    li.append(settingsEl('span', 'mono', word), settingsEl('span', 'pick-meta', `${count} card${count === 1 ? '' : 's'}`), add);
    list.append(li);
  }
  item.append(list);
  return item;
}

function settingsTypesNodes() {
  const st = state.settings;
  const areas = settingsTypeAreas(st.types, st.hierarchy);
  const nodes = [
    settingsSwitch('typesOn', 'Types', st.typesOn, {
      hint: 'Off writes typesOn: false to config.yaml and on removes the line. It is display only: the web and the snapshot stop showing types (chips, colors, icons, tiers), and the cards and the lists stay as written.',
      set: (on) => settingsSendLater(() => settingsTypesOnBody(on, state.settings.version), 'typesOn'),
    }),
  ];
  const bullets = settingsBullets(settingsTypeWarnings({ types: st.types, hierarchy: st.hierarchy, prefixes: st.prefixes, typeUse: settingsTypeUsed(), renamed: settingsUi.renamed }));
  if (bullets) nodes.push(bullets);
  nodes.push(
    settingsTypeArea('hierarchy', 'Hierarchy', 'The hierarchy: list, top first. Drag a row, or use its buttons. Nothing is enforced; the Graph reads it as tiers.', areas.hierarchy,
      'No hierarchy, so no tiers. Drag a type here, or press To Hierarchy on a row.'),
    settingsTypeArea('other', 'Other types', 'The rest of the types: list.', areas.other.map((type) => ({ name: type.name, type })),
      'Every type is in the hierarchy.'),
  );
  nodes.push(settingsField('newType', 'Add type', '', {
    button: 'Add type',
    placeholder: 'a name, like story',
    save: (text) => {
      const problem = settingsTypeNameProblem(state.settings.types, text, null);
      if (problem) { settingsSave('newType', text, problem); return; }
      settingsUi.focusKey = 'field:newType';
      settingsSendLater(() => settingsBlockBody('types', settingsTypesAdd(state.settings.types, text), state.settings.version), 'newType', text);
    },
  }));
  nodes.push(settingsFoundNodes(settingsFoundOnCards(st.types, settingsTypeUsed())));
  return nodes;
}

// ---------- the Prefixes page ----------

function settingsPrefixSend(kind, at, next, typed) {
  const key = at === null ? 'prefix:new' : `prefix:${at}`;
  if (!confirm(settingsPrefixConfirm(kind, next.prefix, next.target))) {
    delete settingsUi.drafts[key];
    settingsRenderBoard();
    return;
  }
  settingsSendLater(() => {
    const list = settingsPrefixList(state.settings.prefixes);
    const out = kind === 'add' ? settingsPrefixAdd(list, next.prefix, next.target)
      : kind === 'remove' ? settingsPrefixRemove(list, at)
        : settingsPrefixSet(list, at, next);
    return settingsBlockBody('prefixes', out, state.settings.version);
  }, key, typed);
}

function settingsPrefixEdit(at, row, prefix, target) {
  const key = `prefix:${at}`;
  if (prefix.trim() === row.prefix && target.trim() === row.target) { delete settingsUi.drafts[key]; settingsRenderBoard(); return; }
  const next = { prefix: prefix.trim(), target: target.trim() };
  const typed = { prefix, target };
  const problem = settingsPrefixProblem(settingsPrefixList(state.settings.prefixes), next.prefix, next.target, at);
  if (problem) {
    settingsUi.errors = { [key]: problem };
    settingsUi.drafts[key] = typed;
    settingsRenderBoard();
    return;
  }
  settingsPrefixSend('change', at, next, typed);
}

function settingsPrefixCell(label, value, fk, onChange) {
  const input = settingsTypeInput('prefs-cell', label, value, fk);
  input.addEventListener('change', onChange);
  const td = settingsEl('td');
  td.append(input);
  return { td, input };
}

function settingsPrefixRows(root) {
  const table = settingsEl('table', 'prefs-table');
  const head = settingsEl('tr');
  for (const h of ['Prefix', 'Card type or folder', 'Reads as', '']) head.append(settingsEl('th', '', h));
  const thead = settingsEl('thead');
  thead.append(head);
  table.append(thead);
  const body = settingsEl('tbody');
  state.settings.prefixes.forEach((row, at) => {
    const key = `prefix:${at}`;
    const draft = settingsUi.drafts[key] || {};
    const tr = settingsEl('tr');
    tr.dataset.prefixAt = String(at);
    const p = settingsPrefixCell(`Prefix ${row.prefix}`, draft.prefix !== undefined ? draft.prefix : row.prefix, `${key}:prefix`, () => settingsPrefixEdit(at, row, p.input.value, t.input.value));
    const t = settingsPrefixCell(`Card type or folder of ${row.prefix}`, draft.target !== undefined ? draft.target : row.target, `${key}:target`, () => settingsPrefixEdit(at, row, p.input.value, t.input.value));
    const err = settingsError(key);
    if (err) t.td.append(err);
    const remove = settingsMark(settingsEl('button', 'types-act', 'Remove'));
    remove.type = 'button';
    remove.dataset.fk = `${key}:remove`;
    remove.setAttribute('aria-label', `Remove the prefix ${row.prefix}`);
    remove.addEventListener('click', () => settingsPrefixSend('remove', at, row, undefined));
    const act = settingsEl('td');
    act.append(remove);
    tr.append(p.td, t.td, settingsEl('td', '', settingsPrefixTarget(row, root)), act);
    body.append(tr);
  });
  table.append(body);
  return table;
}

function settingsPrefixAddForm() {
  const draft = settingsUi.drafts['prefix:new'] || {};
  const prefix = settingsTypeInput('prefs-cell', 'New prefix', draft.prefix || '', 'prefix:new:prefix');
  const target = settingsTypeInput('prefs-cell', 'Card type or groups folder of the new prefix', draft.target || '', 'prefix:new:target');
  prefix.id = 'pf-newPrefix';
  target.id = 'pf-newTarget';
  prefix.placeholder = 'G';
  target.placeholder = 'a card type or a groups folder';
  const add = settingsMark(settingsEl('button', '', 'Add prefix'));
  add.type = 'submit';
  add.dataset.fk = 'prefix:new:add';
  const form = settingsEl('form', 'prefs-path');
  form.noValidate = true;
  form.dataset.fk = 'prefix-new';
  form.append(prefix, target, add);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const next = { prefix: prefix.value.trim(), target: target.value.trim() };
    const typed = { prefix: prefix.value, target: target.value };
    const problem = settingsPrefixProblem(settingsPrefixList(state.settings.prefixes), next.prefix, next.target, null);
    if (problem) {
      settingsUi.errors = { 'prefix:new': problem };
      settingsUi.drafts['prefix:new'] = typed;
      settingsRenderBoard();
      return;
    }
    settingsPrefixSend('add', null, next, typed);
  });
  const item = settingsEl('div', 'prefs-item');
  item.append(settingsEl('span', 'prefs-label', 'Add a prefix'), form);
  const err = settingsError('prefix:new');
  if (err) item.append(err);
  return item;
}

function settingsPrefixesNodes() {
  const st = state.settings;
  const root = state.groups ? state.groups.folder : '';
  const nodes = [settingsEl('p', 'prefs-hint', 'The prefixes: block: a card type, or a folder of the groups, and the letters its ids start with. Cards of no listed type keep plain numbers. Every change asks first.')];
  nodes.push(settingsBullets([settingsPrefixNote, ...settingsPrefixWarnings(st.prefixes, st.types)]));
  if (st.prefixes.length) nodes.push(settingsPrefixRows(root));
  else nodes.push(settingsEl('p', 'prefs-note', 'config.yaml has no prefixes: block, so every id is a plain number.'));
  nodes.push(settingsPrefixAddForm());
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
  { id: 'types', title: 'Types', build: settingsTypesNodes },
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
  const focused = active && active.dataset && $('#prefs-sheet').contains(active) ? active.dataset.fk || null : null;
  const keep = settingsUi.focusKey || focused;
  settingsUi.focusKey = null;
  for (const input of panel.querySelectorAll('input[data-fk^="field:"]')) {
    if (input.value !== input.dataset.shown) settingsUi.drafts[input.dataset.fk.slice(6)] = input.value;
  }
  menu.replaceChildren(...settingsBoardPages.map((p) => settingsMenuItem(`board:${p.id}`, p.title, settingsPageStateText(p))));
  const current = settingsUi.page && settingsUi.page.startsWith('board:') ? settingsBoardPages.find((p) => p.id === settingsUi.page.slice(6)) : null;
  if (!state.settings) {
    panel.replaceChildren(settingsEl('p', 'prefs-hint', 'The board has not answered yet.'));
  } else if (current) {
    const title = settingsEl('h3', 'prefs-page-title', current.title);
    title.id = 'prefs-page-title';
    panel.setAttribute('aria-labelledby', 'prefs-page-title');
    const where = settingsPagePath(current.id, state.settings);
    const reads = settingsPathNode(where, ['types', 'prefixes', 'counters'].includes(current.id) ? 'File' : 'Folder');
    panel.replaceChildren(settingsEl('p', 'prefs-eyebrow', 'This board · written to config.yaml'), title, ...(reads ? [reads] : []), ...current.build(state.settings));
    paintTypeColors(panel);
  } else {
    panel.replaceChildren();
  }
  settingsLayout();
  if (keep) settingsFocus(keep);
}

// Focus the control with the key; one that is gone or disabled (a row moved to the top has no Up) falls
// back to the first control left in the row it belonged to.
function settingsFocus(keep) {
  let again = [...$('#prefs-sheet').querySelectorAll('[data-fk]')].find((el) => el.dataset.fk === keep);
  if (!again || again.disabled) {
    const row = keep.startsWith('act:') ? keep.slice(4, keep.lastIndexOf(':')) : keep.startsWith('name:') ? keep.slice(5) : null;
    const li = row === null ? null : [...$('#prefs-board-page').querySelectorAll('li.types-row')].find((el) => el.dataset.key === row);
    again = li ? [...li.querySelectorAll('[data-fk]')].find((el) => !el.disabled) : again;
  }
  if (again && !again.disabled) again.focus();
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
  settingsUi.renamed = {};
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

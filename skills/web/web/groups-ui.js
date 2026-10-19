'use strict';
// Groups on the page (docs/adr/0015): the badges a card wears, the group form, the dialog that
// adds cards to a group, the question a note on several cards asks, and the palette's Group tab.
// The rules (which groups a card wears, which hold a whole selection, what the form sends) are
// groups.js; the server's group routes keep the files. Nothing here shows without a groups: line in
// config.yaml: state.groups is null then, and every entry point returns at once.
//
// Badges. A card wears up to two small badges (`#I2 zephyr-2`) and "+N" for the rest, the dates and
// the type path in the tooltip; a badge opens the notes palette on its group. They sit below the
// tile's title, so the head row stays as it was.
//
// Right-click. "Add to group..." adds the menu's cards to a group picked from a list; "Make a group
// from them..." (two or more cards) opens the group form with those cards in it; "Add note..." on
// several cards asks which group all of them share, or offers to make one, or to write the note on
// each card.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: $, state, api, toast, loadBoard, openCard, localTodayStr, writeSearch, menuSubject,
// hideContextMenu, openNotes, notesSetTab, notesClose, notesOn, and groups.js's functions.

const groupsUi = { opener: null, open: false };

function groupsOn() {
  return !!state.groups;
}

function groupsList() {
  return state.groups ? state.groups.list : [];
}

function groupEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function groupButton(className, text, title, onclick) {
  const b = groupEl('button', className, text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onclick(b, e); });
  return b;
}

// A card as the lists here read it: `#7 Port the zephyr schema`.
function groupCardLabel(id) {
  const card = state.active.find((c) => c.id === id) || state.archived.find((c) => c.id === id);
  return card ? `#${id} ${card.title}` : `#${id}`;
}

// ---------- the badges on a card ----------

// A card's group badges, or null when the board keeps no groups or the card is in none. Each is a
// button that opens the notes palette on its group.
function groupBadges(cardId) {
  if (!groupsOn()) return null;
  const model = groupBadgeModel(groupsList(), cardId);
  if (!model.shown.length) return null;
  const wrap = groupEl('div', 'card-groups');
  for (const g of model.shown) {
    const b = groupEl('button', 'group-badge np-trigger', groupLabel(g));
    b.type = 'button';
    b.dataset.groupId = g.id;
    b.title = groupTip(g);
    b.setAttribute('aria-label', `Group ${groupLabel(g)}`);
    wrap.append(b);
  }
  if (model.more > 0) {
    const more = groupEl('span', 'group-more', `+${model.more}`);
    more.title = model.moreTip;
    wrap.append(more);
  }
  return wrap;
}

// ---------- the dialog ----------

function groupDialogOpenNow() {
  return groupsUi.open;
}

function openGroupDialog(title, body) {
  const backdrop = $('#group-dialog');
  if (!groupsUi.open) groupsUi.opener = document.activeElement;
  groupsUi.open = true;
  $('#group-dialog-title').textContent = title;
  $('#group-dialog-body').replaceChildren(body);
  backdrop.classList.remove('hidden');
  const first = body.querySelector('[autofocus], input:not([type="checkbox"]), select, .pick-btn, button');
  if (first) first.focus();
}

function closeGroupDialog() {
  if (!groupsUi.open) return false;
  groupsUi.open = false;
  $('#group-dialog').classList.add('hidden');
  $('#group-dialog-body').replaceChildren();
  const back = groupsUi.opener;
  groupsUi.opener = null;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
  return true;
}

function groupIdChips(ids) {
  const row = groupEl('div', 'group-chips');
  for (const id of ids) row.append(groupEl('span', 'group-chip', groupCardLabel(id)));
  return row;
}

// ---------- the group form ----------

// The form for a new group. `draft` is { name?, folder?, start_date?, end_date?, auto_join?, cards? };
// `after(group)` runs once it has been made.
function openGroupForm(draft = {}, after = null) {
  if (!groupsOn()) { toast('Groups are off: config.yaml has no groups: line.'); return; }
  const cards = (draft.cards || []).slice();
  const form = groupEl('form', 'group-form');
  form.noValidate = true;
  const field = (label, control) => { const l = groupEl('label'); l.append(document.createTextNode(label), control); return l; };
  const name = groupEl('input');
  Object.assign(name, { type: 'text', id: 'gf-name', value: draft.name || '', autocomplete: 'off', spellcheck: false, placeholder: 'e.g. zephyr-3' });
  const folder = groupEl('select');
  folder.id = 'gf-folder';
  for (const c of groupFolderChoices(state.groups)) {
    const o = groupEl('option', '', c.label);
    o.value = c.value;
    folder.append(o);
  }
  folder.value = draft.folder || '';
  const idHint = groupEl('p', 'bulk-hint');
  const paintId = () => {
    const where = `${state.groups.folder}/${folder.value ? `${folder.value}/` : ''}`;
    idHint.textContent = `Its id starts with ${groupPrefixFor(state.groups, folder.value)}; the file goes in ${where}`;
  };
  folder.addEventListener('change', paintId);
  paintId();
  const start = groupEl('input');
  Object.assign(start, { type: 'date', id: 'gf-start', value: draft.start_date || '' });
  const end = groupEl('input');
  Object.assign(end, { type: 'date', id: 'gf-end', value: draft.end_date || '' });
  const auto = groupEl('input');
  Object.assign(auto, { type: 'checkbox', id: 'gf-auto' });
  const autoLabel = groupEl('label', 'group-check');
  autoLabel.append(auto, document.createTextNode(' auto_join: a new card joins it while it runs'));
  let touched = false;
  auto.addEventListener('change', () => { touched = true; });
  const paintAuto = () => {
    const dated = !!(start.value && end.value);
    auto.disabled = !dated;
    autoLabel.title = dated ? '' : 'Needs both dates';
    if (!dated) auto.checked = false;
    else if (!touched) auto.checked = draft.auto_join !== false;
  };
  start.addEventListener('input', paintAuto);
  end.addEventListener('input', paintAuto);
  paintAuto();
  const dates = groupEl('div', 'group-row');
  dates.append(field('Start (optional)', start), field('End (optional)', end));
  const error = groupEl('p', 'group-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const submit = groupEl('button', 'group-submit', draft.folder === 'iteration' ? 'Create iteration' : 'Create group');
  submit.type = 'submit';
  const cancel = groupButton('', 'Cancel', '', () => closeGroupDialog());
  const actions = groupEl('div', 'bulk-actions');
  actions.append(submit, cancel);
  form.append(field('Short name', name), field('Folder (the type path)', folder), idHint, dates, autoLabel);
  if (cards.length) {
    const have = groupEl('div', 'group-field');
    have.append(groupEl('span', 'group-field-label', `Cards (${cards.length})`), groupIdChips(cards));
    form.append(have);
  }
  form.append(error, actions);
  let sending = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    const values = { name: name.value, folder: folder.value, start_date: start.value, end_date: end.value, auto_join: auto.checked, cards };
    const problem = groupFormProblem(values);
    if (problem) { error.textContent = problem; error.hidden = false; return; }
    sending = true;
    let made;
    try {
      made = (await api('POST', '/api/groups', groupFormBody(values))).group;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      return;
    } finally {
      sending = false;
    }
    closeGroupDialog();
    try { await loadBoard(); } catch (err) { toast(err.message); }
    toast(`Made ${groupLabel(made)}${made.cards.length ? ` with ${made.cards.length} card${made.cards.length === 1 ? '' : 's'}` : ''}.`);
    if (after) after(made);
  });
  openGroupDialog(draft.folder === 'iteration' ? 'New iteration' : 'New group', form);
}

// ---------- add to a group ----------

async function groupAddMembers(gid, ids) {
  const r = await api('POST', `/api/groups/${encodeURIComponent(gid)}/members`, { add: ids });
  await loadBoard();
  return r.group;
}

// The dialog behind "Add to group...": the board's groups by type path; a click adds the cards.
function openGroupAdd(ids) {
  if (!groupsOn()) return;
  const body = groupEl('div', 'group-add');
  body.append(groupIdChips(ids));
  const groups = groupsList();
  if (!groups.length) body.append(groupEl('p', 'bulk-hint', 'No groups yet.'));
  const folders = [...new Set(groups.map((g) => g.folder))].sort();
  for (const f of folders) {
    body.append(groupEl('h3', 'group-folder', f || '(no type)'));
    const list = groupEl('ul', 'pick-list');
    for (const g of groups.filter((x) => x.folder === f)) {
      const keys = ids.map((id) => kanbanIds.idKey(id));
      const all = keys.every((k) => g.cards.includes(k));
      const b = groupEl('button', 'pick-btn');
      b.type = 'button';
      b.dataset.groupId = g.id;
      b.disabled = all;
      b.title = groupTip(g);
      b.append(groupEl('span', '', groupLabel(g)), groupEl('span', 'pick-meta', all ? 'already in' : `${g.cards.length} card${g.cards.length === 1 ? '' : 's'}`));
      b.addEventListener('click', async () => {
        try {
          const made = await groupAddMembers(g.id, ids);
          closeGroupDialog();
          toast(`Added ${ids.length} card${ids.length === 1 ? '' : 's'} to ${groupLabel(made)}.`);
        } catch (e) { toast(e.message); }
      });
      const li = groupEl('li');
      li.append(b);
      list.append(li);
    }
    body.append(list);
  }
  const actions = groupEl('div', 'bulk-actions');
  actions.append(
    groupButton('', 'New group from them…', '', () => { closeGroupDialog(); openGroupForm({ cards: ids }); }),
    groupButton('', 'Cancel', '', () => closeGroupDialog()),
  );
  body.append(actions);
  openGroupDialog(ids.length === 1 ? 'Add to a group' : `Add ${ids.length} cards to a group`, body);
}

// ---------- a note on several cards ----------

// "Add note..." on a selection. With groups on it asks where the note goes: a group that holds all
// the cards, a new group made from them, or one note on each card. With none it writes on each card.
function groupsAskNote(ids) {
  if (!ids.length) return;
  if (!groupsOn()) { openNotes({ targets: ids }); return; }
  const body = groupEl('div', 'group-ask');
  body.append(groupIdChips(ids));
  const shared = groupsHoldingAll(groupsList(), ids);
  const option = (className, label, meta, onclick) => {
    const b = groupEl('button', `pick-btn${className ? ` ${className}` : ''}`);
    b.type = 'button';
    b.append(groupEl('span', '', label), groupEl('span', 'pick-meta', meta));
    b.addEventListener('click', onclick);
    const li = groupEl('li');
    li.append(b);
    return [li, b];
  };
  if (shared.length) {
    body.append(groupEl('h3', 'group-folder', 'Which group does the note go on?'));
    const list = groupEl('ul', 'pick-list');
    for (const g of shared) {
      const [li, b] = option('strong', groupLabel(g), groupTypePath(g), () => { closeGroupDialog(); openNotes({ target: g.id }); });
      b.dataset.groupId = g.id;
      list.append(li);
    }
    body.append(list, groupEl('div', 'group-or', 'or'));
  } else {
    body.append(groupEl('h3', 'group-folder', 'These cards aren’t grouped together'));
  }
  const list = groupEl('ul', 'pick-list');
  const [makeLi, make] = option('', 'Make a group from them…', 'then note on it', () => {
    closeGroupDialog();
    openGroupForm({ cards: ids }, (made) => openNotes({ target: made.id }));
  });
  make.dataset.choice = 'make';
  const [eachLi, each] = option('', 'Add the note to each card', `${ids.length} copies`, () => { closeGroupDialog(); openNotes({ targets: ids }); });
  each.dataset.choice = 'each';
  list.append(makeLi, eachLi);
  const actions = groupEl('div', 'bulk-actions');
  actions.append(groupButton('', 'Cancel', '', () => closeGroupDialog()));
  body.append(list, actions);
  openGroupDialog(`Add a note to ${ids.length} cards`, body);
}

// ---------- the palette's Group tab ----------

// The group as its tab shows it: its properties (editable), its members (each removable), and
// what to do with it. Rebuilt by the palette when the group changes under it.
function groupPanel(gid) {
  const g = groupById(groupsList(), gid);
  const wrap = groupEl('div', 'gp');
  wrap.dataset.groupId = gid;
  if (!g) { wrap.append(groupEl('p', 'np-muted', 'That group is gone.')); return wrap; }
  const running = groupRunning(g, localTodayStr());
  const head = groupEl('div', 'gp-meta');
  head.append(groupEl('span', 'gp-chip', groupTypePath(g)));
  if (running) head.append(groupEl('span', 'gp-chip run', 'running'));
  if (g.start_date || g.end_date) head.append(groupEl('span', 'gp-dates', `${g.start_date || '…'} to ${g.end_date || '…'}`));
  head.append(groupEl('span', 'gp-count', `${g.cards.length} card${g.cards.length === 1 ? '' : 's'}`));
  const path = groupEl('p', 'gp-path', g.file);

  const name = groupEl('input');
  Object.assign(name, { type: 'text', value: g.name, spellcheck: false, autocomplete: 'off' });
  name.setAttribute('aria-label', 'Short name');
  const start = groupEl('input');
  Object.assign(start, { type: 'date', value: g.start_date });
  start.setAttribute('aria-label', 'Start date');
  const end = groupEl('input');
  Object.assign(end, { type: 'date', value: g.end_date });
  end.setAttribute('aria-label', 'End date');
  const auto = groupEl('input');
  Object.assign(auto, { type: 'checkbox', checked: g.auto_join });
  auto.setAttribute('aria-label', 'auto_join');
  const autoLabel = groupEl('label', 'group-check');
  autoLabel.append(auto, document.createTextNode(' new cards join while it runs'));
  const paintAuto = () => {
    const dated = !!(start.value && end.value);
    auto.disabled = !dated;
    autoLabel.title = dated ? '' : 'Needs both dates';
    if (!dated) auto.checked = false;
  };
  start.addEventListener('input', paintAuto);
  end.addEventListener('input', paintAuto);
  paintAuto();
  const extras = Object.keys(g.extra).map((key) => {
    const input = groupEl('input');
    Object.assign(input, { type: 'text', value: g.extra[key], autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', key);
    input.dataset.extra = key;
    return [key, input];
  });
  const newKey = groupEl('input');
  Object.assign(newKey, { type: 'text', placeholder: 'new key', autocomplete: 'off', spellcheck: false });
  newKey.setAttribute('aria-label', 'New key');
  const newValue = groupEl('input');
  Object.assign(newValue, { type: 'text', placeholder: 'value', autocomplete: 'off' });
  newValue.setAttribute('aria-label', 'New value');
  const save = groupEl('button', 'gp-save', 'Save');
  save.type = 'submit';
  const form = groupEl('form', 'gp-form');
  form.noValidate = true;
  const row = (label, ...controls) => {
    const l = groupEl('span', 'gp-k', label);
    const v = groupEl('span', 'gp-v');
    v.append(...controls);
    form.append(l, v);
  };
  row('name', name);
  row('dates', start, document.createTextNode(' – '), end);
  row('auto_join', autoLabel);
  for (const [key, input] of extras) row(key, input);
  row('add a key', newKey, newValue);
  form.append(groupEl('span'), save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const problem = groupFormProblem({ name: name.value, start_date: start.value, end_date: end.value });
    if (problem) { toast(problem); return; }
    const extra = {};
    for (const [key, input] of extras) extra[key] = input.value.trim() === '' ? null : input.value.trim();
    const added = newKey.value.trim();
    if (added) extra[added] = newValue.value.trim();
    try {
      await api('PATCH', `/api/groups/${encodeURIComponent(g.id)}`, { name: name.value, start_date: start.value, end_date: end.value, auto_join: auto.checked, extra });
      await loadBoard();
      toast(`Saved ${groupLabel(g)}.`);
    } catch (err) { toast(err.message); }
  });

  const members = groupEl('ul', 'gp-members');
  for (const id of g.cards) {
    const li = groupEl('li');
    li.dataset.member = id;
    const open = groupButton('gp-member-open', groupCardLabel(id), groupCardLabel(id), () => { notesClose(); openCard(id); });
    const remove = groupButton('gp-member-rm', '✕', `Take #${id} out of #${g.id}`, async () => {
      try {
        await api('POST', `/api/groups/${encodeURIComponent(g.id)}/members`, { remove: [id] });
        await loadBoard();
      } catch (err) { toast(err.message); }
    });
    remove.setAttribute('aria-label', `Remove #${id}`);
    li.append(open, remove);
    members.append(li);
  }
  if (!g.cards.length) members.append(groupEl('li', 'np-muted', 'No cards yet.'));

  const buttons = groupEl('div', 'gp-btns');
  const note = groupButton('gp-note', '+ Note', notesOn() ? 'A note on this group' : 'The logbook is off', () => notesSetTab('notes'));
  note.disabled = !notesOn();
  const show = groupButton('gp-show', 'Show this group’s cards', `Search group:${g.id}`, () => { writeSearch(`group:${g.id}`, 'cue'); notesClose(); });
  buttons.append(note, show);

  wrap.append(head, path, form, groupEl('p', 'gp-sub', `Members (${g.cards.length})`), members, buttons);
  return wrap;
}

// ---------- wiring ----------

function onGroupsEscape(e) {
  if (e.key !== 'Escape' || !groupDialogOpenNow()) return;
  e.preventDefault();
  e.stopPropagation();
  closeGroupDialog();
}

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onGroupsEscape, true);
  $('#group-dialog-close').addEventListener('click', closeGroupDialog);
  $('#group-dialog').addEventListener('click', (e) => { if (e.target.id === 'group-dialog') closeGroupDialog(); });
  document.addEventListener('click', (e) => {
    const badge = e.target.closest && e.target.closest('.group-badge');
    if (!badge) return;
    e.preventDefault();
    openNotes({ kind: 'group', gid: badge.dataset.groupId });
  });
  $('#ctx-group-add').addEventListener('click', () => {
    hideContextMenu();
    openGroupAdd(menuSubject.ids.slice());
  });
  $('#ctx-group-make').addEventListener('click', () => {
    hideContextMenu();
    openGroupForm({ cards: menuSubject.ids.slice() });
  });
});

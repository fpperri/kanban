'use strict';
// The delete popup (GLOSSARY.md "Ids, groups and the logbook"): one popup for a card, a whole
// selection of cards, or a group. It says what goes, every extra is a box left unticked, and
// Delete sends the request; the rules of what it says are delete-plan.js, the deleting is the
// server's (delete-store.js). Archiving never comes here: it asks nothing.
//
// It shows in the group dialog's frame (groups-ui.js's openGroupDialog), which already gives it the
// backdrop, Escape and click-away, and it works on a board that keeps no groups.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: state, api, toast, loadBoard, groupsList, notesOn, notesAll, openGroupDialog,
// closeGroupDialog, and delete-plan.js's functions.

function delEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function delCards() {
  return state.active.concat(state.archived);
}

// Send the deletes, one request for each target with the ticked extras, then close the popup, reload
// the board and say what went. Returns an error text when nothing could be deleted (the popup stays
// open to show it), else ''.
async function performDelete(kind, targets, ticked, opts = {}) {
  const options = deleteBody(ticked);
  const route = kind === 'group' ? (id) => `/api/groups/${encodeURIComponent(id)}` : (id) => `/api/cards/${encodeURIComponent(id)}`;
  const results = [];
  const failed = [];
  for (const id of targets) {
    try { results.push(await api('DELETE', route(id), options)); }
    catch (e) { failed.push(`#${id} (${e.message})`); }
  }
  if (!results.length) return failed.join('; ');
  closeGroupDialog();
  if (opts.onDone) opts.onDone();
  try { await loadBoard(); } catch (e) { toast(e.message); }
  toast(deleteSummary(kind, targets, results, failed));
  return '';
}

// Open the popup. kind 'card' with one id or several, or 'group' with one; opts.onDone runs after
// the deletes succeed, before the board reloads.
function openDelete(kind, targets, opts = {}) {
  const have = delCards();
  const live = kind === 'group' ? targets.filter((t) => groupsList().some((g) => g.id === t)) : targets.filter((t) => have.some((c) => c.id === t));
  if (!live.length) { toast(kind === 'group' ? 'That group is gone.' : 'That card is gone.'); return; }
  const plan = deletePlan({ kind, targets: live, cards: have, groups: groupsList(), notes: notesAll(), logbookOn: notesOn() });
  const body = delEl('div', 'del-popup');
  if (plan.chips) {
    const row = delEl('div', 'group-chips');
    for (const label of plan.chips) row.append(delEl('span', 'group-chip', label));
    body.append(row);
  }
  for (const line of plan.lines) body.append(delEl('p', 'bulk-hint', line));
  const boxes = {};
  const box = (option) => {
    const input = delEl('input');
    input.type = 'checkbox';
    input.dataset.del = option.key;
    boxes[option.key] = input;
    const label = delEl('label', 'group-check');
    label.append(input, document.createTextNode(` ${option.label}`));
    return label;
  };
  for (const option of plan.options) body.append(box(option));
  if (plan.members) {
    body.append(box(plan.members));
    const list = delEl('ul', 'del-list off');
    for (const row of plan.members.rows) {
      const li = delEl('li', row.skip ? 'skip' : '', row.text);
      li.dataset.member = row.id;
      list.append(li);
    }
    boxes.members.addEventListener('change', () => list.classList.toggle('off', !boxes.members.checked));
    body.append(list);
  }
  body.append(delEl('p', 'bulk-hint', plan.hint));
  const error = delEl('p', 'group-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const cancel = delEl('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.setAttribute('autofocus', '');
  cancel.addEventListener('click', () => closeGroupDialog());
  const go = delEl('button', 'del-confirm', 'Delete');
  go.type = 'button';
  go.dataset.confirm = 'delete';
  let sending = false;
  go.addEventListener('click', async () => {
    if (sending) return;
    sending = true;
    const ticked = {};
    for (const [key, input] of Object.entries(boxes)) ticked[key] = input.checked;
    const problem = await performDelete(kind, live, ticked, opts);
    sending = false;
    if (problem) { error.textContent = problem; error.hidden = false; }
  });
  const actions = delEl('div', 'bulk-actions');
  actions.append(go, cancel);
  body.append(error, actions);
  openGroupDialog(plan.title, body);
}

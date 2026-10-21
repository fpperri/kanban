'use strict';
// The todo lists on the page (docs/adr/0021): a card's or group's todo list, a Markdown task list in
// the folder `todos:` names in config.yaml. Nothing here shows without that line: state.todos is null
// then. Entry points: the notes palette's Todos tab (a card's or a group's), the `t` key, the card
// menu's Todos... entry, and the small count on a card tile and on a group badge. The gear gains a
// Todos page beside the Scratchpad's.
//
// The tab is a box where Enter adds an item, and the list under it. Up and Down move between the box
// and the rows; on a row Space ticks, e edits in place, c adds a child under it, d twice deletes it
// with its children, Alt+Up and Alt+Down move it among its siblings, Tab indents it under the item above and Shift+Tab outdents it. A ticked item stays where it is,
// struck and muted. An item's text is drawn as inline Markdown (markdownInto with `inline`), and a line
// of the file that is not an item shows muted and read only. The list is read when the tab opens and
// again when the board refreshes (an agent or a hand edit shows without a reload); every write names
// the version of the list it read, and a list changed since is read again with the server's reason
// said. While a change is on its way every other change is ignored (its answer renumbers the lines the
// keys name), and a held key acts once. The board payload carries the open and total of each list (state.todos.counts), which the tiles
// and badges draw; the delete popup reads state.todos.targets.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads, except settingsAddBoardPage which it calls at load: $, state, api, toast, loadBoard, menuSubject,
// hideContextMenu, openNotes, notesLabel, notesAimedCard, NOTES_DETAIL,
// keyGuardOff, markdownInto, settingsFeatureNodes, settingsAddBoardPage.

const todosUi = { refresh: null, parent: null, pending: 0, editing: 0 };

function todosOn() {
  return !!state.todos;
}

function todoTargets() {
  return state.todos ? state.todos.targets : [];
}

function todoEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// The keys the palette's footer names on the Todos tab.
function todosHints() {
  return [['↵', 'add'], ['␣', 'tick'], ['e', 'edit'], ['d d', 'delete'], ['Alt+↑↓', 'move'], ['⇥', 'indent'], ['Esc', 'close']];
}

// ---------- the count on a tile or a badge ----------

// The small count of open items over all items on a card's tile or a group's badge, or null when the
// board keeps no todo lists or the target has no item. A button: it opens the target's Todos tab.
function todoCountButton(id) {
  if (!todosOn()) return null;
  const count = state.todos.counts[id];
  if (!count) return null;
  const b = todoEl('button', `card-todos np-trigger${count.open === 0 ? ' all-done' : ''}`, `${count.open}/${count.total}`);
  b.type = 'button';
  b.dataset.todoTarget = id;
  b.title = `${count.open} of ${count.total} todo${count.total === 1 ? '' : 's'} open; open the list`;
  b.setAttribute('aria-label', `${notesLabel(id)}: ${b.title}`); // names the card or group the count is of
  return b;
}

// ---------- the Todos tab ----------

// The panel of the palette's Todos tab for one card or group id.
function todosPanel(target) {
  const wrap = todoEl('div', 'td');
  wrap.dataset.target = target;
  wrap.append(todoEl('p', 'td-title', notesLabel(target)));
  if (!todosOn()) {
    wrap.append(todoEl('p', 'np-muted', 'Todo lists are off: config.yaml has no todos: line. The gear turns them on.'));
    return wrap;
  }
  const url = `/api/todos/${encodeURIComponent(target)}`;
  const path = todoEl('p', 'td-path', `${state.todos.folder}/…`);
  const add = todoEl('input', 'td-add');
  Object.assign(add, { type: 'text', placeholder: 'Add a todo; Enter adds it', autocomplete: 'off', spellcheck: true, disabled: true });
  add.setAttribute('aria-label', 'New todo');
  add.setAttribute('aria-describedby', 'td-add-hint');
  const hint = todoEl('span', 'td-live', 'Enter adds the item. Down reaches the rows.');
  hint.id = 'td-add-hint';
  const live = todoEl('span', 'td-live'); // says Sure? when a delete is armed
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const empty = todoEl('p', 'np-empty', 'No todos yet. Enter adds the first.');
  empty.hidden = true;
  const bar = todoEl('div', 'td-bar');
  bar.append(add);
  const rows = todoEl('div', 'td-list');
  rows.setAttribute('role', 'list');
  rows.setAttribute('aria-label', 'Todos');
  wrap.append(path, bar, rows, empty, live, hint);
  todosUi.parent = null;

  let list = null;
  const rowEls = () => [...rows.querySelectorAll('.td-row')];
  const focusRow = (row) => { if (row) row.focus(); };
  // The row at that line of the file, else the next one below it, else the last: where the focus goes
  // after a change moved or took the row it was on.
  const focusNear = (index) => {
    const els = rowEls();
    const row = els.find((r) => Number(r.dataset.index) >= index) || els[els.length - 1];
    if (row) row.focus(); else add.focus();
  };

  const paintPath = () => {
    path.textContent = `${list.folder === undefined ? state.todos.folder : list.folder}/${list.file}${list.exists ? '' : ' (not written yet)'}`;
  };

  const paintUnder = () => {
    const p = todosUi.parent;
    const had = document.activeElement === add;
    if (!p) { bar.replaceChildren(add); if (had) add.focus(); return; }
    const chip = todoEl('span', 'td-under');
    const x = todoEl('button', 'td-under-x', '✕');
    x.type = 'button';
    x.title = 'Add at the top level again (Esc)';
    x.setAttribute('aria-label', 'Add at the top level again');
    x.addEventListener('click', () => { todosUi.parent = null; paintUnder(); add.focus(); });
    chip.append(todoEl('span', 'td-under-text', `under: ${p.text}`), x);
    bar.replaceChildren(chip, add);
    if (had) add.focus();
  };

  const paintRows = (focusIndex) => {
    const here = document.activeElement && rows.contains(document.activeElement) ? document.activeElement.closest('.td-row') : null;
    const keep = here ? Number(here.dataset.index) : null;
    const p = todosUi.parent;
    if (p && !list.lines.some((l) => l.item && l.index === p.index && l.text === p.text)) { todosUi.parent = null; paintUnder(); }
    paintPath();
    todosUi.editing = 0;
    empty.hidden = list.lines.length > 0; // the hint sits outside the list, which holds only items
    rows.hidden = !empty.hidden;
    if (!list.lines.length) {
      rows.replaceChildren();
      if (keep !== null) add.focus();
      return;
    }
    rows.replaceChildren(...list.lines.map(rowOf));
    const want = focusIndex !== undefined ? focusIndex : keep;
    if (want !== null && want !== undefined) focusNear(want);
  };

  // One change at a time: while one is on its way another is ignored, since its answer renumbers the lines
  // the keys name. A clash with a hand edit is said and the list read again. The promise answers whether the
  // change was made.
  const send = (method, suffix, build, after) => {
    if (todosUi.pending > 0) return Promise.resolve(false);
    const body = build();
    if (body === null) return Promise.resolve(false);
    todosUi.pending = 1;
    const run = async () => {
      try {
        const answer = await api(method, url + suffix, { ...body, version: list.version });
        list = answer.todos;
        const at = answer.todos.at;
        paintRows(after ? after(answer.todos, at) : undefined);
        try { await loadBoard(); } catch (e) { toast(e.message); }
        return true;
      } catch (e) {
        toast(e.message);
        if (e.status === 409) {
          try { list = (await api('GET', url)).todos; paintRows(); } catch (_) { /* the next refresh reads it */ }
        }
        return false;
      } finally {
        todosUi.pending = 0;
      }
    };
    return run();
  };

  const lineAt = (index) => list.lines.find((l) => l.item && l.index === index) || null;
  const tick = (index) => send('PATCH', '', () => { const l = lineAt(index); return l ? { index, done: !l.done } : null; }, () => index);
  const move = (index, by) => send('POST', '/move', () => (lineAt(index) ? { index, by } : null), (_, at) => at);
  const level = (index, outdent) => send('POST', outdent ? '/outdent' : '/indent', () => (lineAt(index) ? { index } : null), (_, at) => at);
  const remove = (index) => send('DELETE', '', () => (lineAt(index) ? { index } : null), () => index);
  const setText = (index, text) => send('PATCH', '', () => (lineAt(index) ? { index, text } : null), () => index);
  const child = (index) => {
    const l = lineAt(index);
    if (!l) return;
    todosUi.parent = { index, text: l.text };
    paintUnder();
    add.focus();
  };

  function edit(row, l) {
    if (row.classList.contains('editing')) return;
    row.classList.add('editing');
    todosUi.editing += 1;
    const input = todoEl('input', 'td-edit');
    Object.assign(input, { type: 'text', value: l.text, autocomplete: 'off' });
    input.setAttribute('aria-label', 'Edit the todo');
    let closed = false;
    const finish = (save, refocus) => {
      if (closed) return;
      closed = true;
      todosUi.editing = Math.max(0, todosUi.editing - 1);
      const text = input.value.trim();
      if (save && text !== '' && text !== l.text) setText(l.index, text).then((made) => { if (!made) paintRows(refocus ? l.index : undefined); });
      else paintRows(refocus ? l.index : undefined);
    };
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true, true); }
    });
    input.addEventListener('blur', () => finish(true, false));
    const textEl = row.querySelector('.td-text');
    row.replaceChildren(row.querySelector('.td-tick'), input);
    if (textEl) textEl.hidden = true;
    input.focus();
    if (input.select) input.select();
  }

  function rowOf(l) {
    if (!l.item) {
      const plain = todoEl('div', 'td-plain np-muted', l.text);
      plain.setAttribute('role', 'listitem');
      return plain;
    }
    const row = todoEl('div', `td-row td-d${Math.min(l.depth, 6)}${l.done ? ' done' : ''}`);
    row.tabIndex = -1;
    row.setAttribute('role', 'listitem');
    row.dataset.index = String(l.index);
    const box = todoEl('button', 'td-tick');
    box.type = 'button';
    box.tabIndex = -1;
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(l.done));
    box.title = l.done ? 'Untick (Space)' : 'Tick (Space)';
    box.addEventListener('click', (e) => { e.stopPropagation(); tick(l.index); row.focus(); });
    const text = todoEl('span', 'td-text');
    markdownInto(text, l.text, { inline: true });
    box.setAttribute('aria-label', text.textContent || l.text); // the item's plain text, not its Markdown
    const acts = todoEl('span', 'td-acts');
    const act = (name, label, title, onclick) => {
      const b = todoEl('button', 'np-act', label);
      b.type = 'button';
      b.tabIndex = -1;
      b.title = title;
      b.dataset.act = name;
      b.addEventListener('click', (e) => { e.stopPropagation(); onclick(b); });
      return b;
    };
    let sureTimer = 0;
    acts.append(
      act('edit', 'Edit', 'Edit the text (e)', () => edit(row, l)),
      act('child', '+ Sub', 'Add an item under this one (c)', () => child(l.index)),
      act('up', '↑', 'Move up among its siblings (Alt+Up)', () => move(l.index, -1)),
      act('down', '↓', 'Move down among its siblings (Alt+Down)', () => move(l.index, 1)),
      act('delete', 'Delete', 'Delete it with its children and the lines indented under it (press twice)', (b) => {
        if (!b.classList.contains('sure')) {
          b.classList.add('sure');
          b.textContent = 'Sure?';
          live.textContent = 'Sure? Press delete again to delete this item and what is under it.';
          clearTimeout(sureTimer);
          sureTimer = setTimeout(() => { b.classList.remove('sure'); b.textContent = 'Delete'; live.textContent = ''; }, 3500);
          return;
        }
        live.textContent = '';
        remove(l.index);
      }),
    );
    row.append(box, text, acts);
    return row;
  }

  const submit = () => {
    const text = add.value.trim();
    if (text === '') return;
    const parent = todosUi.parent;
    add.value = '';
    return send('POST', '', () => (parent ? { text, parent: parent.index } : { text })).then((made) => {
      if (!made && add.value === '') add.value = text;
    });
  };

  add.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(rowEls()[0]); }
    else if (e.key === 'Escape' && todosUi.parent) { e.preventDefault(); e.stopPropagation(); todosUi.parent = null; paintUnder(); add.focus(); }
    else if (e.key === 'Backspace' && add.value === '' && todosUi.parent) { e.preventDefault(); todosUi.parent = null; paintUnder(); add.focus(); }
  });

  rows.addEventListener('keydown', (e) => {
    const row = e.target.classList && e.target.classList.contains('td-row') ? e.target : null;
    if (!row || row.classList.contains('editing') || e.ctrlKey || e.metaKey) return;
    const index = Number(row.dataset.index);
    const l = lineAt(index);
    const own = () => { e.preventDefault(); e.stopPropagation(); };
    // A key that changes the list acts once: a held key repeats and is ignored.
    const once = () => { own(); return !e.repeat; };
    const els = rowEls();
    const at = els.indexOf(row);
    // Tab and Shift+Tab change the level and never move focus from a row; in the box and the other fields Tab is the browser's.
    if (e.key === 'Tab' && !e.altKey) { if (once()) level(index, e.shiftKey); return; }
    if (e.altKey) {
      if (e.key === 'ArrowUp') { if (once()) move(index, -1); }
      else if (e.key === 'ArrowDown') { if (once()) move(index, 1); }
      return;
    }
    if (e.key === 'ArrowDown') { own(); focusRow(els[Math.min(at + 1, els.length - 1)]); }
    else if (e.key === 'ArrowUp') { own(); if (at <= 0) add.focus(); else focusRow(els[at - 1]); }
    else if (e.key === ' ') { if (once()) tick(index); }
    else if (e.key === 'e' || e.key === 'Enter') { if (once() && l) edit(row, l); }
    else if (e.key === 'c') { if (once()) child(index); }
    else if (e.key === 'd') { if (once()) { const b = row.querySelector('[data-act="delete"]'); if (b) b.click(); } }
    else if (e.key === 'Backspace') { own(); add.focus(); }
  });

  const load = async () => {
    try {
      list = (await api('GET', url)).todos;
      paintRows();
      add.disabled = false;
      const here = document.activeElement;
      const opener = here && here.classList && here.classList.contains('np-trigger'); // the count that opened the tab
      if (wrap.isConnected && (!here || here === document.body || opener || notesUi.el.contains(here))) add.focus({ preventScroll: true });
    } catch (e) {
      path.textContent = e.message;
    }
  };

  // The board refreshed: an agent's or a hand edit shows, unless a write is on its way or an item is being edited.
  todosUi.refresh = async () => {
    if (!list || !wrap.isConnected || todosUi.pending > 0 || todosUi.editing > 0) return;
    try {
      const fresh = (await api('GET', url)).todos;
      if (todosUi.pending > 0 || todosUi.editing > 0 || fresh.version === list.version) return;
      list = fresh;
      paintRows();
    } catch (_) { /* the next refresh tries again */ }
  };

  load();
  return wrap;
}

// Called after every board payload has been applied, while the Todos tab is up.
function todosOnBoard() {
  if (todosUi.refresh) todosUi.refresh();
}

// ---------- the t key ----------

// t opens the Todos tab of the card whose details are open, else the hovered card, else the one selected
// card. A key that types nothing but reads a letter, so it reads the key guard, as n does: off while a
// field has focus and while a menu, a dialog, the notifications panel or the preferences sheet is up;
// the card details are the one popup it works over.
function onTodosKey(e) {
  if (!e.key || e.key.toLowerCase() !== 't' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (keyGuardOff(document, NOTES_DETAIL)) return;
  e.preventDefault();
  if (!todosOn()) { toast('Todo lists are off: config.yaml has no todos: line.'); return; }
  const aimed = notesAimedCard();
  if (aimed !== null) openNotes({ kind: 'todos', target: aimed });
}

// ---------- the gear and the menu ----------

// The gear's Todos page, after the Scratchpad's: the same switch and folder.
settingsAddBoardPage({
  id: 'todos',
  title: 'Todos',
  build: () => settingsFeatureNodes('todos', 'Todos', 'the todo lists'),
}, 'scratchpad');

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('keydown', onTodosKey);
  document.addEventListener('click', (e) => {
    const count = e.target.closest && e.target.closest('.card-todos');
    if (!count) return;
    e.preventDefault();
    openNotes({ kind: 'todos', target: count.dataset.todoTarget });
  });
  $('#ctx-todos').addEventListener('click', () => {
    hideContextMenu();
    if (menuSubject.ids.length === 1) openNotes({ kind: 'todos', target: menuSubject.ids[0] });
  });
});

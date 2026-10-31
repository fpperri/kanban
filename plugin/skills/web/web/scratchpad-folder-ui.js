'use strict';
// The file explorer beside the Scratchpad tab's editor: the files in the card's own scratchpad folder
// (scratchpad-folder.js on the server), one level at a time, like an editor's side bar. It shows only when
// `scratchpad:` holds <card> (scratchFolderOn); without it the tab is as it was. Above the list a one-line
// breadcrumb of the folder shown (a click on a crumb goes up) and two buttons, + File and + Folder, that
// open an inline name field at the head of the list. A row is one line: a small icon for what it is, the
// name (never wrapped), and the size; the row's title holds the whole name and the date. A folder opens, a
// file is selected, and the editor (scratchpad-ui.js) shows it where the page was, so a card can keep one
// scratchpad or several files for scratchpad reasons. The page is the first row, selected when the tab
// opens, and has no menu.
//
// A text file's row has the notes list's menu (notes-palette.js notesMenuOpen: a right-click, a long press,
// the Menu key or Shift+F10): Rename (the name edited in place), Move to... (the parent and the subfolders
// of the folder shown) and Delete (a second "Sure?" press). A picture's or a binary file's row offers Copy
// path only. Each acts on its own row, which need not be the selected file.
//
// Under 600px of tab width the list becomes one line above the editor, the selected file's name with a
// down arrow that opens the list over the editor (the stylesheet's container query). From 600px up a small
// button at the right of the breadcrumb folds the list away (hooks.fold); the editor then has the width and
// brings it back with a Files button in its own header (scratchpad-ui.js).
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: state, api, toast, fallbackCopy, notesIcon, notesMenuOpen, kanbanPadFiles (pad-files.js).

function scratchFolderOn() {
  return !!state.scratchpad && state.scratchpad.folder.split(/[\\/]/).includes('<card>');
}

function spfEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function spfButton(label, className, title) {
  const b = spfEl('button', className, label);
  b.type = 'button';
  if (title) b.title = title;
  return b;
}

// The strokes of a row's small picture, in notesIcon's 16 by 16 box.
const SPF_ICONS = {
  page: 'M3 2.5h8l2 2v9H3z M5.5 6h5 M5.5 8.5h5 M5.5 11h2.5',
  folder: 'M2 4.5h4l1.5 1.5H14v7H2z',
  markdown: 'M2.5 4h11v8h-11z M4.5 9.5v-3l1.5 1.8 1.5-1.8v3 M11 6.5v3 M9.6 8.2l1.4 1.5 1.4-1.5',
  text: 'M4 2h6l3 3v9H4z M10 2v3h3 M6.5 9h4.5 M6.5 11.5h3',
  image: 'M2 3h12v10H2z M2 11l3.5-3.5 3 3 2-2L14 11',
  other: 'M4 2h6l3 3v9H4z M10 2v3h3',
};

function spfIcon(kind) {
  const svg = notesIcon(SPF_ICONS[kind] || SPF_ICONS.other);
  svg.setAttribute('class', `spf-ico spf-ico-${kind}`);
  return svg;
}

// The narrow list that opens over the editor closes on a press outside it and on Esc (which then goes no
// further, so the palette stays), as well as when a file is chosen. Esc is taken at the document in the
// capture phase, registered when this script loads so it runs before the palette's own Esc; a name field in
// the list, or an open row menu, keeps its own Esc.
function spfOpenList() {
  return document.querySelector('.spf.open');
}

function spfCloseList(focusBar) {
  const open = spfOpenList();
  if (!open) return;
  open.classList.remove('open');
  const bar = open.querySelector('.spf-pick');
  bar.setAttribute('aria-expanded', 'false');
  if (focusBar) bar.focus({ preventScroll: true });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !spfOpenList()) return;
  if (typeof notesUi !== 'undefined' && notesUi.menu) return;
  if (e.target.closest && e.target.closest('.spf-ask-input, .spf-rename')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  spfCloseList(true);
}, true);

document.addEventListener('pointerdown', (e) => {
  const open = spfOpenList();
  if (open && !(e.target.closest && e.target.closest('.spf.open'))) spfCloseList(false);
}, true);

// Copy text through the same clipboard ladder as the path buttons; done(ok) says how it went.
function spfCopyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(fallbackCopy(text)));
  } else done(fallbackCopy(text));
}

// The list for one card id. `hooks` is the editor's side:
//   select({ path, page, edit })  a row was chosen (a file's path, or the page), or a file was just made (edit);
//   busy(path)                    the editor is still reading that file: its row's menu entries are off;
//   renamed(from, to)             a file moved: its unsaved text moves with it;
//   gone(path, wasSelected)       a file was deleted: drop its unsaved text; show the page if it was selected;
//   fold()                        the fold button was pressed.
// The returned markNotText(path, bool) tells the list that the editor found a file not to read as text (its
// row's menu is then Copy path only).
// Returns { el, foldButton, refresh(), mark(path|null, label), root() }: refresh reads the folder again (a size and a
// date moved); mark(path, label) highlights the selected row (null for the page) and names it on the narrow
// bar; root() is the absolute path of the card's folder.
function scratchFolderPanel(target, hooks) {
  const pf = kanbanPadFiles;
  const base = `/api/scratchpad/${encodeURIComponent(target)}`;
  const wrap = spfEl('aside', 'spf');
  wrap.dataset.target = target;
  wrap.setAttribute('aria-label', 'Files in the card\'s folder');
  const pick = spfButton('', 'spf-pick');
  pick.setAttribute('aria-expanded', 'false');
  pick.setAttribute('aria-label', 'Files in the card\'s folder');
  const pickName = spfEl('span', 'spf-pick-name', '');
  pick.append(pickName, spfEl('span', 'spf-pick-caret', '▾'));
  const panel = spfEl('div', 'spf-panel');
  const head = spfEl('div', 'spf-head');
  const crumbs = spfEl('nav', 'spf-crumbs');
  crumbs.setAttribute('aria-label', 'Folder');
  const foldBtn = spfButton('\u2039', 'spf-fold', 'Hide the file list');
  foldBtn.setAttribute('aria-label', 'Hide the file list');
  foldBtn.setAttribute('aria-expanded', 'true');
  foldBtn.addEventListener('click', () => hooks.fold());
  head.append(crumbs, foldBtn);
  const tools = spfEl('div', 'spf-tools');
  const newFile = spfButton('+ File', 'spf-btn spf-new-file', 'A new .md or .txt file in this folder');
  const newFolder = spfButton('+ Folder', 'spf-btn spf-new-folder', 'A new folder in this folder');
  tools.append(newFile, newFolder);
  const list = spfEl('ul', 'spf-list');
  const note = spfEl('p', 'np-muted spf-note');
  panel.append(head, tools, list, note);
  wrap.append(pick, panel);

  let cwd = '';
  let listing = null;
  let selected = null; // the selected file's path; null is the page
  let asking = null; // 'file' | 'folder' while the inline name field is open
  let seq = 0;
  const notText = new Set(); // paths the editor found not to read as text, whatever the list's hint said
  let armed = null; // the path whose Delete was pressed once
  let armTimer = 0;
  const q = (p) => `?path=${encodeURIComponent(p)}`;

  const setOpen = (on) => {
    wrap.classList.toggle('open', on);
    pick.setAttribute('aria-expanded', String(on));
  };
  pick.addEventListener('click', () => setOpen(!wrap.classList.contains('open')));

  // ---- the inline name field at the head of the list ----
  const closeAsk = () => { asking = null; if (listing) paintList(); };
  const openAsk = (kind) => {
    asking = kind;
    paintList();
    const input = list.querySelector('.spf-ask-input');
    if (input) input.focus();
  };
  newFile.addEventListener('click', () => openAsk('file'));
  newFolder.addEventListener('click', () => openAsk('folder'));
  const askRow = () => {
    const li = spfEl('li', 'spf-ask');
    const input = spfEl('input', 'spf-ask-input');
    Object.assign(input, { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: asking === 'file' ? 'name (.md unless .txt)' : 'folder name' });
    input.setAttribute('aria-label', asking === 'file' ? 'New file name' : 'New folder name');
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      const kind = asking;
      try {
        if (kind === 'file') {
          const name = pf.newFileName(input.value);
          if (name === '') return;
          const made = await api('POST', `${base}/file`, { path: pf.joinPath(cwd, name), text: '' });
          asking = null;
          await go(cwd);
          hooks.select({ path: made.file.path, edit: true });
        } else {
          const name = input.value.trim();
          if (name === '') return;
          await api('POST', `${base}/folder`, { path: pf.joinPath(cwd, name) });
          asking = null;
          await go(cwd);
        }
      } catch (err) {
        toast(err.message);
      }
    });
    li.append(spfIcon(asking === 'file' ? 'text' : 'folder'), input);
    return li;
  };

  // ---- what a row's menu does ----
  const disarm = () => { clearTimeout(armTimer); armed = null; };

  // One move on the server, then what follows it on the page: the list, the draft's key and the selection.
  async function moveRequest(from, to) {
    const moved = await api('POST', `${base}/move`, { from, to });
    const wasSelected = selected === from;
    await go(cwd);
    hooks.renamed(from, moved.file.path);
    if (wasSelected) hooks.select({ path: moved.file.path });
  }

  async function moveFile(from, to) {
    try {
      await moveRequest(from, to);
    } catch (err) {
      toast(err.message);
      go(cwd);
    }
  }

  async function deleteFile(e) {
    try {
      const read = await api('GET', `${base}/file${q(e.path)}`);
      await api('DELETE', `${base}/file`, { path: e.path, version: read.file.version });
      const wasSelected = selected === e.path;
      if (wasSelected) selected = null;
      await go(cwd);
      hooks.gone(e.path, wasSelected);
    } catch (err) {
      toast(err.message);
      go(cwd);
    }
  }

  function renameInPlace(e, row, nameEl) {
    row.classList.add('editing');
    const input = spfEl('input', 'spf-rename');
    Object.assign(input, { type: 'text', value: e.name, autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', `New name of ${e.name}`);
    nameEl.replaceWith(input);
    input.focus();
    const dot = e.name.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : e.name.length);
    // Enter and a press elsewhere (blur) both commit a name that changed; Esc cancels. A name the server
    // refuses keeps the field open with the server's message.
    let done = false;
    let sending = false;
    const close = () => { done = true; row.classList.remove('editing'); input.replaceWith(nameEl); };
    const commit = async (byKey) => {
      if (done || sending) return;
      const to = pf.renameDest(cwd, e.name, input.value);
      if (to === '') { close(); if (byKey) row.focus(); return; }
      sending = true;
      try {
        await moveRequest(e.path, to);
        done = true;
      } catch (err) {
        toast(err.message);
        sending = false;
        input.focus();
      }
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ev.stopPropagation(); commit(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (!done && !sending) { close(); row.focus(); } }
    });
    input.addEventListener('blur', () => commit(false));
  }

  const actsOf = (e, row, nameEl) => {
    const copyMenu = [['copy', 'Copy path', '']];
    const textMenu = [['rename', 'Rename', ''], ['move', 'Move to…', ''], ['remove', 'Delete', '']];
    const copy = () => spfCopyText(e.abs, (ok) => toast(ok ? `Copied: ${e.abs}` : 'Copy failed'));
    if (!e.readable) return { menu: copyMenu, copy, sure: () => false, onSure: null };
    const acts = {
      get menu() { return notText.has(e.path) ? copyMenu : textMenu; },
      copy,
      off: () => hooks.busy(e.path),
      sure: () => armed === e.path,
      onSure: null,
      rename: () => renameInPlace(e, row, nameEl),
      move: (at) => {
        const targets = pf.moveTargets(cwd, listing.entries);
        const over = { menu: targets.map((t, i) => [`d${i}`, t.label, '']), sure: () => false, onSure: null };
        if (targets.length === 0) { over.menu = [['none', 'No other folder', '']]; over.off = () => true; }
        targets.forEach((t, i) => { over[`d${i}`] = () => moveFile(e.path, pf.joinPath(t.path, e.name)); });
        notesMenuOpen(row, at.x, at.y, over);
      },
      remove: () => {
        if (armed !== e.path) {
          armed = e.path;
          clearTimeout(armTimer);
          armTimer = setTimeout(() => { armed = null; if (acts.onSure) acts.onSure(); }, 3500);
          if (acts.onSure) acts.onSure();
          return;
        }
        disarm();
        deleteFile(e);
      },
    };
    return acts;
  };

  // ---- drawing ----
  const paintCrumbs = () => {
    const nodes = [];
    pf.crumbs(cwd).forEach((c, i, all) => {
      const last = i === all.length - 1;
      const b = spfButton(i === 0 ? 'card folder' : c.name, `spf-crumb${last ? ' here' : ''}`);
      b.dataset.path = c.path;
      b.title = c.path === '' ? 'card folder' : c.path;
      if (last) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => go(c.path));
      if (i > 0) nodes.push(spfEl('span', 'spf-sep', '/'));
      nodes.push(b);
    });
    crumbs.replaceChildren(...nodes);
  };

  const paintMarks = () => {
    for (const r of list.querySelectorAll('.spf-row')) {
      const on = selected === null ? r.classList.contains('spf-page') : r.dataset.path === selected;
      r.classList.toggle('on', on);
      if (on) r.setAttribute('aria-current', 'true'); else r.removeAttribute('aria-current');
    }
  };

  const rowOf = (e) => {
    const li = spfEl('li');
    const row = spfEl('div', `spf-row${e.dir ? ' spf-dir' : ''}${e.page ? ' spf-page' : ''}`);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.dataset.path = e.path;
    row.dataset.kind = e.page ? 'page' : e.kind;
    row.title = pf.rowTitle(e);
    const nameEl = spfEl('span', 'spf-name', e.dir ? `${e.name}/` : e.name);
    row.append(spfIcon(pf.iconOf(e)), nameEl, spfEl('span', 'spf-size', e.dir || e.page ? '' : pf.sizeText(e.size)));
    const open = () => (e.dir ? go(e.path) : hooks.select({ path: e.path, page: !!e.page }));
    row.addEventListener('click', () => { if (!row.classList.contains('editing')) open(); });
    row.addEventListener('keydown', (ev) => {
      if (ev.target !== row) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const rows = [...list.querySelectorAll('.spf-row')];
        const at = rows.indexOf(row) + (ev.key === 'ArrowDown' ? 1 : -1);
        if (rows[at]) { ev.preventDefault(); ev.stopPropagation(); rows[at].focus(); }
      }
    });
    if (!e.dir && !e.page) row.npActs = actsOf(e, row, nameEl);
    li.append(row);
    return li;
  };

  function paintList() {
    const rows = listing.entries.map(rowOf);
    list.replaceChildren(...(asking ? [askRow()] : []), ...rows);
    note.textContent = listing.entries.length || asking ? '' : 'Nothing in this folder yet.';
    paintMarks();
  }

  async function go(rel) {
    const mine = ++seq;
    try {
      const answer = await api('GET', `${base}/files${q(rel)}`);
      if (mine !== seq) return;
      cwd = answer.path;
      listing = answer;
      paintCrumbs();
      paintList();
    } catch (e) {
      if (mine === seq) { note.textContent = e.message; toast(e.message); }
    }
  }

  go('');
  return {
    el: wrap,
    foldButton: foldBtn,
    refresh: () => go(cwd),
    markNotText(path, not) { if (not) notText.add(path); else notText.delete(path); },
    root: () => (listing ? listing.folder : ''),
    mark(path, label) {
      selected = path;
      if (label !== undefined) pickName.textContent = label;
      setOpen(false);
      paintMarks();
    },
  };
}

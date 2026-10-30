'use strict';
// The list beside the Scratchpad tab's editor: the files in the card's own scratchpad folder
// (scratchpad-folder.js on the server), one level at a time. It shows only when `scratchpad:` holds
// <card> (scratchFolderOn); without it the tab is as it was. A row opens a folder (with a way back up)
// or selects a file: the editor (scratchpad-ui.js) then shows the file where the page was, so a card can
// keep one scratchpad or several files for scratchpad reasons. The page is the first row, selected when
// the tab opens. Above the list a New file (a .md or .txt, `.md` by default) and a New folder; below it,
// Rename or move and Delete (a second "Sure?" press) act on the selected file and never on the page.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: state, api, toast, kanbanPadFiles (pad-files.js).

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

// The list for one card id. `hooks` is the editor's side:
//   select({ path, page, edit })  a row was chosen (a file's path, or the page), or a file was just made (edit);
//   selection()                   { path, version } of the selected file, or null when it is the page or none;
//   renamed(from, to)             the selected file moved: its unsaved text moves with it;
//   gone(path)                    the selected file was deleted: drop its unsaved text, show the page.
// Returns { el, refresh(), mark(path|null), acts() }: refresh reads the folder again (a size and a date
// moved); mark(path) highlights the selected row, null for the page; acts() repaints Rename and Delete
// from selection() (off while the selected file is still loading).
function scratchFolderPanel(target, hooks) {
  const pf = kanbanPadFiles;
  const base = `/api/scratchpad/${encodeURIComponent(target)}`;
  const wrap = spfEl('div', 'spf');
  wrap.dataset.target = target;
  const head = spfEl('div', 'spf-head');
  const crumbs = spfEl('nav', 'spf-crumbs');
  crumbs.setAttribute('aria-label', 'Folder');
  const tools = spfEl('div', 'spf-tools');
  const newFile = spfButton('New file', 'spf-btn spf-new-file', 'A new .md or .txt file in this folder');
  const newFolder = spfButton('New folder', 'spf-btn spf-new-folder', 'A new folder in this folder');
  tools.append(newFile, newFolder);
  head.append(crumbs, tools);
  const ask = spfEl('form', 'spf-ask');
  ask.hidden = true;
  const askInput = spfEl('input', 'spf-ask-input');
  Object.assign(askInput, { type: 'text', autocomplete: 'off', spellcheck: false });
  const askGo = spfButton('Create', 'spf-btn spf-ask-go');
  askGo.type = 'submit';
  const askNo = spfButton('Cancel', 'spf-btn spf-ask-no');
  ask.append(askInput, askGo, askNo);
  const list = spfEl('ul', 'spf-list');
  list.setAttribute('aria-label', 'Files in the card\'s folder');
  const note = spfEl('p', 'np-muted spf-note');

  const acts = spfEl('div', 'spf-acts');
  const del = spfButton('Delete', 'spf-btn spf-delete', 'Delete the selected file');
  const moveForm = spfEl('form', 'spf-move');
  const moveInput = spfEl('input', 'spf-move-input');
  Object.assign(moveInput, { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'path in the card\'s folder' });
  moveInput.setAttribute('aria-label', 'Rename or move the selected file to (a path in the card\'s folder)');
  const moveGo = spfButton('Rename or move', 'spf-btn spf-move-go');
  moveGo.type = 'submit';
  moveForm.append(moveInput, moveGo);
  acts.append(moveForm, del);
  wrap.append(head, ask, list, note, acts);

  let cwd = '';
  let listing = null;
  let selected = null; // the selected file's path; null is the page
  let asking = null;
  let seq = 0;
  let sureTimer = null;
  const q = (p) => `?path=${encodeURIComponent(p)}`;

  const paintActs = () => {
    const sel = hooks.selection();
    del.disabled = !sel;
    moveGo.disabled = !sel;
    moveInput.disabled = !sel;
    moveInput.value = sel ? sel.path : '';
    clearTimeout(sureTimer);
    del.classList.remove('sure');
    del.textContent = 'Delete';
  };

  const closeAsk = () => { asking = null; ask.hidden = true; };
  const openAsk = (kind) => {
    asking = kind;
    askInput.value = '';
    askInput.placeholder = kind === 'file' ? 'name (.md unless it ends in .txt)' : 'folder name';
    askInput.setAttribute('aria-label', kind === 'file' ? 'New file name' : 'New folder name');
    ask.hidden = false;
    askInput.focus();
  };
  newFile.addEventListener('click', () => openAsk('file'));
  newFolder.addEventListener('click', () => openAsk('folder'));
  askNo.addEventListener('click', closeAsk);
  askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAsk(); }
  });
  ask.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = asking;
    if (!kind) return;
    try {
      if (kind === 'file') {
        const name = pf.newFileName(askInput.value);
        if (name === '') return;
        const made = await api('POST', `${base}/file`, { path: pf.joinPath(cwd, name), text: '' });
        closeAsk();
        await go(cwd);
        hooks.select({ path: made.file.path, edit: true });
      } else {
        const name = askInput.value.trim();
        if (name === '') return;
        await api('POST', `${base}/folder`, { path: pf.joinPath(cwd, name) });
        closeAsk();
        await go(cwd);
      }
    } catch (err) {
      toast(err.message);
    }
  });

  del.addEventListener('click', async () => {
    const sel = hooks.selection();
    if (!sel) return;
    if (!del.classList.contains('sure')) {
      del.classList.add('sure');
      del.textContent = 'Sure?';
      clearTimeout(sureTimer);
      sureTimer = setTimeout(() => { del.classList.remove('sure'); del.textContent = 'Delete'; }, 3500);
      return;
    }
    clearTimeout(sureTimer);
    try {
      await api('DELETE', `${base}/file`, { path: sel.path, version: sel.version });
      selected = null;
      await go(cwd);
      hooks.gone(sel.path);
    } catch (e) {
      toast(e.message);
      paintActs();
    }
  });
  moveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sel = hooks.selection();
    const to = moveInput.value.trim();
    if (!sel || to === '' || to === sel.path) return;
    try {
      const moved = await api('POST', `${base}/move`, { from: sel.path, to });
      await go(pf.parentPath(moved.file.path));
      hooks.renamed(sel.path, moved.file.path);
      hooks.select({ path: moved.file.path });
    } catch (err) {
      toast(err.message);
    }
  });

  const paintCrumbs = () => {
    const nodes = [];
    pf.crumbs(cwd).forEach((c, i, all) => {
      const last = i === all.length - 1;
      const b = spfButton(i === 0 ? 'Card folder' : c.name, `spf-crumb${last ? ' here' : ''}`);
      b.dataset.path = c.path;
      if (last) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => go(c.path));
      if (i > 0) nodes.push(spfEl('span', 'spf-sep', '/'));
      nodes.push(b);
    });
    crumbs.replaceChildren(...nodes);
  };

  const paintMarks = () => {
    for (const b of list.querySelectorAll('.spf-row')) {
      const on = selected === null ? b.classList.contains('spf-page') : b.dataset.path === selected;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    }
  };

  const paintList = () => {
    const rows = [];
    if (listing.parent !== null) {
      const li = spfEl('li');
      const up = spfButton('..', 'spf-row spf-up', 'Up one folder');
      up.dataset.path = listing.parent;
      up.addEventListener('click', () => go(listing.parent));
      li.append(up);
      rows.push(li);
    }
    for (const e of listing.entries) {
      const li = spfEl('li');
      const b = spfButton('', `spf-row${e.dir ? ' spf-dir' : ''}${e.page ? ' spf-page' : ''}`);
      b.dataset.path = e.path;
      b.dataset.kind = e.page ? 'page' : e.kind;
      b.append(spfEl('span', 'spf-name', e.dir ? `${e.name}/` : e.name), spfEl('span', 'spf-size', e.dir ? '' : pf.sizeText(e.size)), spfEl('span', 'spf-date', pf.dateText(e.mtime)));
      if (e.page) b.append(spfEl('span', 'spf-tag', 'this page'));
      b.addEventListener('click', () => (e.dir ? go(e.path) : hooks.select({ path: e.path, page: !!e.page })));
      li.append(b);
      rows.push(li);
    }
    list.replaceChildren(...rows);
    note.textContent = listing.entries.length ? '' : 'Nothing in this folder yet.';
    paintMarks();
  };

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
  paintActs();
  return {
    el: wrap,
    refresh: () => go(cwd),
    acts: paintActs,
    mark(path) { selected = path; paintMarks(); paintActs(); },
  };
}

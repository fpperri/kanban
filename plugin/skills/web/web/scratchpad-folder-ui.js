'use strict';
// The folder browser under the Scratchpad tab's box: the files in the card's own scratchpad folder
// (scratchpad-folder.js on the server), one level at a time. It shows only when `scratchpad:` holds
// <card> (scratchFolderOn); without it the tab is as it was. A row opens a folder (with a way back up) or
// a file: an image in the tab, Markdown rendered, other text plain, any other file by name and size with a
// Copy path button. A .md or .txt file can also be edited (Ctrl+Enter or Save, a 409 when the file
// changed since it was read), deleted after a second "Sure?" press, renamed or moved into another
// folder of the card's folder; the buttons above the list make a new file and a new folder. The page
// itself is listed first with no controls: it is the tab's own box.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads: state, api, toast, fallbackCopy, markdownInto, cardImageSrc, textEditAttach, kanbanPadFiles
// (pad-files.js).

function scratchFolderOn() {
  return !!state.scratchpad && state.scratchpad.folder.split('/').includes('<card>');
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

function spfCopy(text, btn) {
  const show = (ok) => {
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy path'; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => show(true), () => show(fallbackCopy(text)));
  } else show(fallbackCopy(text));
}

// The browser for one card or group id; `onPage` is called when the page's own row is clicked.
function scratchFolderPanel(target, onPage) {
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
  const view = spfEl('div', 'spf-view');
  wrap.append(head, ask, list, note, view);

  let cwd = '';
  let listing = null;
  let current = null;
  let asking = null;
  let seq = 0;
  const q = (p) => `?path=${encodeURIComponent(p)}`;

  const closeAsk = () => { asking = null; ask.hidden = true; };
  const openAsk = (kind) => {
    asking = kind;
    askInput.value = '';
    askInput.placeholder = kind === 'file' ? 'name.md or name.txt' : 'folder name';
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
        showFile(made.file, true);
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
      const b = spfButton('', `spf-row${e.dir ? ' spf-dir' : ''}${e.page ? ' spf-page' : ''}${current && current.path === e.path ? ' on' : ''}`);
      b.dataset.path = e.path;
      b.dataset.kind = e.page ? 'page' : e.kind;
      b.append(spfEl('span', 'spf-name', e.dir ? `${e.name}/` : e.name), spfEl('span', 'spf-size', e.dir ? '' : pf.sizeText(e.size)), spfEl('span', 'spf-date', pf.dateText(e.mtime)));
      if (e.page) b.append(spfEl('span', 'spf-tag', 'this page'));
      b.addEventListener('click', () => (e.dir ? go(e.path) : e.page ? onPage() : openFile(e.path)));
      li.append(b);
      rows.push(li);
    }
    list.replaceChildren(...rows);
    note.textContent = listing.entries.length ? '' : 'Nothing in this folder yet.';
  };

  async function go(rel) {
    const mine = ++seq;
    try {
      const answer = await api('GET', `${base}/files${q(rel)}`);
      if (mine !== seq) return;
      cwd = answer.path;
      listing = answer;
      if (current && pf.parentPath(current.path) !== cwd) { current = null; view.replaceChildren(); }
      paintCrumbs();
      paintList();
    } catch (e) {
      if (mine === seq) { note.textContent = e.message; toast(e.message); }
    }
  }

  async function openFile(rel) {
    try {
      const answer = await api('GET', `${base}/file${q(rel)}`);
      showFile(answer.file, false);
    } catch (e) {
      toast(e.message);
      go(cwd);
    }
  }

  function paintBody(file, body) {
    if (file.kind === 'image') {
      const img = spfEl('img', 'spf-img');
      img.alt = file.name;
      img.src = cardImageSrc(target, file.abs);
      body.replaceChildren(img);
    } else if (file.kind === 'markdown') {
      const md = spfEl('div', 'spf-md detail-body');
      body.replaceChildren(md);
      markdownInto(md, file.text, { card: target, imageBase: file.base });
    } else if (file.kind === 'text') {
      body.replaceChildren(spfEl('pre', 'spf-pre', file.text));
    } else {
      body.replaceChildren(spfEl('p', 'np-muted spf-other', file.tooLarge ? 'Too large to show here. Open it in an editor from its path.' : 'This kind of file does not show here.'));
    }
  }

  function showFile(file, edit) {
    current = file;
    for (const b of list.querySelectorAll('.spf-row')) b.classList.toggle('on', b.dataset.path === file.path);
    const bar = spfEl('div', 'spf-file-bar');
    bar.append(spfEl('strong', 'spf-file-name', file.name), spfEl('span', 'np-muted', pf.sizeText(file.size)));
    const copy = spfButton('Copy path', 'spf-btn spf-copy', 'Copy this file\'s full path');
    copy.addEventListener('click', () => spfCopy(file.abs, copy));
    bar.append(copy);
    const body = spfEl('div', 'spf-body');
    const status = spfEl('span', 'spf-status');
    status.setAttribute('aria-live', 'polite');
    const acts = spfEl('div', 'spf-acts');
    view.replaceChildren(bar, body, acts);
    paintBody(file, body);
    if (!file.writable) return;

    const editBtn = spfButton('Edit', 'spf-btn spf-edit');
    const del = spfButton('Delete', 'spf-btn spf-delete', 'Delete this file');
    const moveForm = spfEl('form', 'spf-move');
    const moveInput = spfEl('input', 'spf-move-input');
    Object.assign(moveInput, { type: 'text', value: file.path, autocomplete: 'off', spellcheck: false });
    moveInput.setAttribute('aria-label', 'Rename or move to (a path in the card\'s folder)');
    const moveGo = spfButton('Rename or move', 'spf-btn spf-move-go');
    moveGo.type = 'submit';
    moveForm.append(moveInput, moveGo);
    acts.append(editBtn, del, moveForm, status);

    let sureTimer = null;
    del.addEventListener('click', async () => {
      if (!del.classList.contains('sure')) {
        del.classList.add('sure');
        del.textContent = 'Sure?';
        clearTimeout(sureTimer);
        sureTimer = setTimeout(() => { del.classList.remove('sure'); del.textContent = 'Delete'; }, 3500);
        return;
      }
      clearTimeout(sureTimer);
      try {
        await api('DELETE', `${base}/file`, { path: file.path, version: file.version });
        current = null;
        view.replaceChildren();
        await go(cwd);
      } catch (e) {
        toast(e.message);
        del.classList.remove('sure');
        del.textContent = 'Delete';
      }
    });
    moveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = moveInput.value.trim();
      if (to === '' || to === file.path) return;
      try {
        const moved = await api('POST', `${base}/move`, { from: file.path, to });
        await go(pf.parentPath(moved.file.path));
        showFile(moved.file, false);
      } catch (err) {
        toast(err.message);
      }
    });

    const startEdit = () => {
      const box = spfEl('textarea', 'spf-text');
      Object.assign(box, { spellcheck: false, value: file.text });
      box.setAttribute('aria-label', `Text of ${file.name}`);
      textEditAttach(box);
      const save = spfButton('Save', 'spf-btn spf-save', 'Save (Ctrl+Enter)');
      const cancel = spfButton('Cancel', 'spf-btn spf-cancel');
      const reload = spfButton('Reload', 'spf-btn spf-reload', 'Read the file as it is now, dropping this text');
      reload.hidden = true;
      const bar2 = spfEl('div', 'spf-edit-bar');
      bar2.append(save, cancel, reload, spfEl('span', 'np-muted', 'Ctrl+Enter saves'));
      body.replaceChildren(box, bar2);
      editBtn.hidden = true;
      box.focus({ preventScroll: true });
      let saving = false;
      const write = async () => {
        if (saving) return;
        saving = true;
        save.disabled = true;
        try {
          const answer = await api('PUT', `${base}/file`, { path: file.path, text: box.value, version: file.version });
          await go(cwd);
          showFile(answer.file, false);
          const again = view.querySelector('.spf-status');
          if (again) again.textContent = 'Saved';
        } catch (e) {
          status.textContent = e.status === 409 ? 'Changed on disk since you opened it.' : e.message;
          reload.hidden = e.status !== 409;
          if (e.status !== 409) toast(e.message);
          save.disabled = false;
        } finally {
          saving = false;
        }
      };
      save.addEventListener('click', write);
      cancel.addEventListener('click', () => { editBtn.hidden = false; status.textContent = ''; paintBody(file, body); });
      reload.addEventListener('click', () => openFile(file.path));
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); write(); }
      });
    };
    editBtn.addEventListener('click', startEdit);
    if (edit) startEdit();
  }

  go('');
  return wrap;
}

'use strict';
// The scratchpad on the page (docs/adr/0016): a disposable page for a card or a group, a free
// Markdown file in the folder `scratchpad:` names in config.yaml. Nothing here shows without that
// line: state.scratchpad is null then. Three entry points, all in the notes palette's frame:
// the palette's Scratchpad tab (a card's or a group's), the Group tab's Scratchpad button, and the
// card menu's Scratchpad... entry. The gear gains a Scratchpad page beside the Logbook's.
//
// The tab is one editor: a title, the selected file's path, and a multi-line box with an Edit | Preview
// switch over it. Edit is the box, the default; Preview draws the box's text as Markdown (markdownInto,
// the renderer the card body uses), saved or not. Ctrl+Enter or Save writes it. What the editor holds is
// the page, selected when the tab opens, whose refs (the notes, files and folders it points at, read from
// its frontmatter and edited in the file) show only while it is selected and whose frontmatter the server
// keeps. With <card> in the `scratchpad:` path (a card, not a group) the folder's list
// (scratchpad-folder-ui.js) stands beside it and any file that reads as text opens in the same editor in
// the page's place: a .md has Preview, the others Edit only; a picture, or a file that is not text, shows
// in its place. A file is saved under the version it read, so a change on disk is a conflict kept on that
// file, with Reload. Unsaved text survives a tab switch or a closed palette in this page's memory until
// the page is reloaded, one draft per file, and follows a file through a rename and leaves with a delete.
// The page itself is read when the tab opens: the board payload only says which targets have one
// (state.scratchpad.targets), which the delete popup reads. Nothing here deletes a page; only the
// delete popup's "Its scratchpad" box does.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads, except settingsAddBoardPage which it calls at load: $, state, api, toast, loadBoard,
// menuSubject, hideContextMenu, openNotes, notesLabel, notesTextNodes, markdownInto,
// settingsFeatureNodes, settingsAddBoardPage.

const CHANGED_ON_DISK = 'Changed on disk since you opened it.';
const scratchUi = { drafts: new Map(), saving: false, toggle: null };

// The key as this platform names it: Cmd on a Mac, Ctrl elsewhere. Both are read by scratchPreviewKey.
function scratchKeyName() {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const platform = nav ? (nav.userAgentData && nav.userAgentData.platform) || nav.platform || '' : '';
  return `${/mac/i.test(platform) ? 'Cmd' : 'Ctrl'}+Shift+V`;
}

function scratchpadOn() {
  return !!state.scratchpad;
}

function scratchpadTargets() {
  return state.scratchpad ? state.scratchpad.targets : [];
}

function scratchEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// Ctrl+Shift+V (VS Code's preview key) switches the open Scratchpad tab between Edit and Preview, from the
// box or anywhere else in the palette: notesOnPaletteKey hands it every key. In a plain text box it pastes
// as Ctrl+V does, so taking it costs nothing; on any other tab, with the page not yet loaded or with any
// other modifier it is the browser's. The Todos tab's Preview reads the same chord (todos-ui.js todosPreviewKey).
function scratchPreviewChord(e) {
  return !!e.key && e.key.toLowerCase() === 'v' && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !e.repeat;
}

function scratchPreviewKey(e) {
  if (!scratchPreviewChord(e)) return false;
  if (notesUi.tab !== 'scratch' || !scratchUi.toggle) return false;
  if (!scratchUi.toggle()) return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

// The panel of the palette's Scratchpad tab for one card or group id. With <card> in `scratchpad:` (a
// card, not a group) the folder's list stands beside the editor and any file that reads as text opens in
// the same editor the page uses; the page is the first row and is selected when the tab opens.
function scratchPanel(target) {
  const wrap = scratchEl('div', 'sp');
  wrap.dataset.target = target;
  wrap.append(scratchEl('p', 'sp-title', notesLabel(target)));
  if (!scratchpadOn()) {
    wrap.append(scratchEl('p', 'np-muted', 'The scratchpad is off: config.yaml has no scratchpad: line. The gear turns it on.'));
    return wrap;
  }
  const url = `/api/scratchpad/${encodeURIComponent(target)}`;
  const folderOn = scratchFolderOn() && notesCard(target) !== null;
  const main = folderOn ? scratchEl('div', 'sp-main') : wrap;
  const path = scratchEl('p', 'sp-path', `${state.scratchpad.folder}/…`);
  const refs = scratchEl('div', 'sp-refs');
  const text = scratchEl('textarea', 'sp-text');
  Object.assign(text, { spellcheck: false, disabled: true, placeholder: 'Loading…' });
  text.setAttribute('aria-label', 'Scratchpad text');
  textEditAttach(text);
  text.hidden = false;
  const view = scratchEl('div', 'sp-preview detail-body');
  view.hidden = true;
  view.setAttribute('tabindex', '0');
  view.setAttribute('aria-label', 'Scratchpad preview');
  const modes = scratchEl('div', 'sp-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Edit or preview');
  const edit = scratchEl('button', 'sp-mode on', 'Edit');
  const preview = scratchEl('button', 'sp-mode', 'Preview');
  const keyName = scratchKeyName();
  for (const b of [edit, preview]) {
    b.type = 'button';
    b.title = `${b.textContent} (${keyName})`;
    b.dataset.key = keyName; // drawn after the name by the stylesheet, with an empty alternative text: the button's name stays its text
    b.setAttribute('aria-keyshortcuts', 'Control+Shift+V Meta+Shift+V');
  }
  edit.setAttribute('aria-pressed', 'true');
  preview.setAttribute('aria-pressed', 'false');
  preview.disabled = true;
  modes.append(edit, preview);

  let pad = null; // the page as the server last gave it
  let cur = { page: true }; // what the editor holds: the page, or { file } (a text file, or a picture or a binary one the viewer shows)
  let loadSeq = 0;
  let loading = false; // a file is being read: nothing acts on the file shown until it is
  const conflicts = new Map(); // key -> the version a save was refused under, for each file found changed on disk: it keeps that version until Reload, so a Save cannot overwrite what changed
  const keyOf = (c) => (c.page ? target : `${target}\u0000${c.file.path}`);
  const baseText = () => (cur.page ? (pad ? pad.body : null) : cur.file.text);
  const previewOpts = () => (cur.page ? undefined : { card: target, imageBase: cur.file.base });
  const drawPreview = () => markdownInto(view, text.value, previewOpts());

  const showPreview = (on, byKey) => {
    const typing = document.activeElement === text;
    text.hidden = on;
    view.hidden = !on;
    if (on) drawPreview(); // after it is shown: a diagram is measured where it is drawn
    edit.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    edit.setAttribute('aria-pressed', String(!on));
    preview.setAttribute('aria-pressed', String(on));
    if (on && typing) view.focus({ preventScroll: true }); // the hidden box held the focus: the palette's keys need it somewhere inside
    if (!on && !text.disabled) {
      text.focus({ preventScroll: true });
      if (byKey) text.setSelectionRange(text.value.length, text.value.length);
    }
  };
  const toggle = () => {
    if (!wrap.isConnected) { // the palette dropped this panel (the gear turned the scratchpad off): the key is the browser's again
      if (scratchUi.toggle === toggle) scratchUi.toggle = null;
      return false;
    }
    if (preview.disabled) return false;
    showPreview(view.hidden, true);
    return true;
  };
  scratchUi.toggle = toggle;
  edit.addEventListener('click', () => showPreview(false));
  preview.addEventListener('click', () => showPreview(true));
  const status = scratchEl('span', 'sp-status');
  status.setAttribute('aria-live', 'polite');
  const save = scratchEl('button', 'sp-save', 'Save');
  save.type = 'button';
  save.disabled = true;
  const reload = scratchEl('button', 'sp-save sp-reload', 'Reload');
  reload.type = 'button';
  reload.hidden = true;
  reload.title = 'Read the file as it is now, dropping this text';
  const bar = scratchEl('div', 'sp-bar');
  bar.append(save, scratchEl('span', 'np-muted', 'Ctrl+Enter saves'), reload, status);
  const boxNode = mdEditAttach(text); // the box is drawn in colour (markdown-edit-ui.js)
  const viewer = scratchEl('div', 'sp-viewer'); // a picture, or the name and size of a file that is not text
  viewer.hidden = true;
  main.append(path, refs, modes, boxNode, view, bar);
  if (folderOn) main.append(viewer);

  let folder = null;
  if (folderOn) {
    folder = scratchFolderPanel(target, {
      select: (entry) => (entry.page ? selectPage() : selectFile(entry.path, !!entry.edit)),
      selection: () => (loading || cur.page || !cur.file.version ? null : { path: cur.file.path, version: cur.file.version }),
      renamed: (from, to) => {
        const old = `${target}\u0000${from}`;
        const next = `${target}\u0000${to}`;
        if (scratchUi.drafts.has(old)) { scratchUi.drafts.set(next, scratchUi.drafts.get(old)); scratchUi.drafts.delete(old); }
        if (conflicts.has(old)) { conflicts.set(next, conflicts.get(old)); conflicts.delete(old); }
      },
      gone: (from) => {
        scratchUi.drafts.delete(`${target}\u0000${from}`);
        conflicts.delete(`${target}\u0000${from}`);
        selectPage();
      },
    });
    const cq = scratchEl('div', 'sp-cq');
    const split = scratchEl('div', 'sp-split');
    split.append(folder.el, main);
    cq.append(split);
    wrap.append(cq);
  }

  const paintPad = () => {
    path.textContent = `${pad.folder === undefined ? state.scratchpad.folder : pad.folder}/${pad.file}${pad.exists ? '' : ' (not written yet)'}`;
    refs.hidden = false;
    if (!pad.refs.length) {
      refs.replaceChildren(scratchEl('p', 'np-muted', 'No refs. A refs: list in the page\'s frontmatter points it at notes, files and folders.'));
      return;
    }
    const list = scratchEl('ul', 'sp-ref-list');
    list.setAttribute('aria-label', 'refs');
    for (const ref of pad.refs) {
      const li = scratchEl('li');
      li.append(...notesTextNodes(ref));
      list.append(li);
    }
    refs.replaceChildren(list);
  };

  // The editor takes text: the draft kept for this file, else what the server gave.
  const enterText = (next, content, isMarkdown) => {
    cur = next;
    for (const el of [modes, boxNode, view, bar]) el.hidden = false;
    viewer.hidden = true;
    const draft = scratchUi.drafts.has(keyOf(cur)) ? scratchUi.drafts.get(keyOf(cur)) : null;
    text.value = draft !== null ? draft : content;
    text.disabled = false;
    text.placeholder = 'Anything: a checklist, a paste, a half-formed plan';
    save.disabled = false;
    preview.disabled = !isMarkdown;
    const clash = conflicts.has(keyOf(cur));
    if (clash && !cur.page) cur.file = { ...cur.file, version: conflicts.get(keyOf(cur)) };
    reload.hidden = !clash;
    status.textContent = clash ? CHANGED_ON_DISK : '';
    showPreview(false);
    if (cur.page) paintPad();
    else { path.textContent = cur.file.path; refs.hidden = true; }
  };

  // A picture, or a file that does not read as text: shown in the editor's place.
  const enterViewer = (file) => {
    cur = { file };
    for (const el of [modes, boxNode, view, bar, refs]) el.hidden = true;
    text.disabled = true;
    preview.disabled = true;
    path.textContent = file.path;
    const bits = [];
    if (file.kind === 'image') {
      const img = scratchEl('img', 'spf-img');
      img.alt = file.name;
      img.src = cardImageSrc(target, file.abs);
      bits.push(img);
    } else {
      bits.push(scratchEl('p', 'np-muted spf-other', file.tooLarge ? 'Too large to show here. Open it in an editor from its path.' : 'This kind of file does not show here.'));
    }
    const row = scratchEl('div', 'spf-file-bar');
    const copy = scratchEl('button', 'spf-btn spf-copy', 'Copy path');
    copy.type = 'button';
    copy.title = 'Copy this file\'s full path';
    copy.addEventListener('click', () => scratchCopyPath(file.abs, copy));
    row.append(scratchEl('strong', 'spf-file-name', file.name), scratchEl('span', 'np-muted', kanbanPadFiles.sizeText(file.size)), copy);
    viewer.replaceChildren(row, ...bits);
    viewer.hidden = false;
  };

  const selectPage = () => {
    if (!pad) return;
    loadSeq++;
    loading = false;
    enterText({ page: true }, pad.body, true);
    if (folder) folder.mark(null);
    if (!text.disabled && wrap.isConnected) text.focus({ preventScroll: true });
  };

  async function selectFile(rel, focus) {
    const mine = ++loadSeq;
    loading = true;
    text.disabled = true;
    save.disabled = true;
    folder.acts();
    try {
      const answer = await api('GET', `${url}/file?path=${encodeURIComponent(rel)}`);
      if (mine !== loadSeq) return;
      loading = false;
      const file = answer.file;
      if (file.kind === 'markdown' || file.kind === 'text') enterText({ file }, file.text, file.kind === 'markdown');
      else enterViewer(file);
      folder.mark(file.path);
      if (focus && !text.disabled) text.focus({ preventScroll: true });
    } catch (e) {
      if (mine !== loadSeq) return;
      toast(e.message);
      folder.refresh();
      selectPage();
    }
  }

  text.addEventListener('input', () => {
    status.textContent = '';
    const base = baseText();
    if (base !== null && text.value === base) scratchUi.drafts.delete(keyOf(cur));
    else scratchUi.drafts.set(keyOf(cur), text.value);
  });
  // A save's answer lands on the file it was for: shown as it comes if that file is still the one in the
  // editor, kept (a conflict) for when it is selected again if not.
  const write = async () => {
    if (text.disabled || scratchUi.saving) return;
    scratchUi.saving = true;
    save.disabled = true;
    const was = cur;
    const k = keyOf(was);
    const still = () => keyOf(cur) === k;
    try {
      if (was.page) {
        const answer = await api('PUT', url, { body: text.value });
        pad = answer.pad;
        scratchUi.drafts.delete(target);
        if (still()) paintPad();
      } else {
        const answer = await api('PUT', `${url}/file`, { path: was.file.path, text: text.value, version: was.file.version });
        scratchUi.drafts.delete(k);
        conflicts.delete(k);
        if (still()) cur.file = answer.file;
      }
      if (still()) {
        if (!view.hidden) drawPreview();
        reload.hidden = true;
        status.textContent = 'Saved';
      }
      if (was.page) await loadBoard();
      if (folder) folder.refresh();
    } catch (e) {
      if (!was.page && e.status === 409) {
        conflicts.set(k, was.file.version);
        if (still()) {
          status.textContent = CHANGED_ON_DISK;
          reload.hidden = false;
        }
      } else {
        toast(e.message);
      }
    } finally {
      scratchUi.saving = false;
      save.disabled = text.disabled;
    }
  };
  save.addEventListener('click', write);
  reload.addEventListener('click', () => {
    if (cur.page) return;
    scratchUi.drafts.delete(keyOf(cur));
    conflicts.delete(keyOf(cur));
    selectFile(cur.file.path, true);
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); write(); }
  });

  api('GET', url).then((answer) => {
    pad = answer.pad;
    if (cur.page) selectPage();
    const here = document.activeElement;
    if (wrap.isConnected && (!here || here === document.body || notesUi.el.contains(here))) text.focus({ preventScroll: true });
  }).catch((e) => {
    path.textContent = e.message;
  });
  return wrap;
}

function scratchCopyPath(value, btn) {
  const show = (ok) => {
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = 'Copy path'; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(() => show(true), () => show(fallbackCopy(value)));
  } else show(fallbackCopy(value));
}

// The gear's Scratchpad page, after the Logbook's: the same switch and folder.
settingsAddBoardPage({
  id: 'scratchpad',
  title: 'Scratchpad',
  build: () => settingsFeatureNodes('scratchpad', 'Scratchpad', 'the scratchpads'),
}, 'logbook');

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const icon = e.target.closest && e.target.closest('.card-scratch');
    if (!icon) return;
    e.preventDefault();
    openNotes({ kind: 'scratchpad', target: icon.dataset.scratchTarget });
  });
  $('#ctx-scratch').addEventListener('click', () => {
    hideContextMenu();
    if (menuSubject.ids.length === 1) openNotes({ kind: 'scratchpad', target: menuSubject.ids[0] });
  });
});

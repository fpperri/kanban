'use strict';
// The scratchpad on the page (docs/adr/0016): a disposable page for a card or a group, a free
// Markdown file in the folder `scratchpad:` names in config.yaml. Nothing here shows without that
// line: state.scratchpad is null then. Three entry points, all in the notes palette's frame:
// the palette's Scratchpad tab (a card's or a group's), the Group tab's Scratchpad button, and the
// card menu's Scratchpad... entry. The gear gains a Scratchpad page beside the Logbook's.
//
// The tab shows the page's file, its refs (the notes, files and folders it points at, read from the
// page's frontmatter and edited in the file), and a multi-line box with an Edit | Preview switch
// over it: Edit is the box, the default; Preview draws the box's text as Markdown (markdownInto,
// the renderer the card body uses), saved or not. Ctrl+Enter or Save writes the
// body; the server keeps the frontmatter. Unsaved text survives a tab switch or a closed palette in
// this page's memory until the page is reloaded. The page itself is read when the tab opens: the
// board payload only says which targets have one (state.scratchpad.targets), which the delete popup
// reads. Nothing here deletes a page; only the delete popup's "Its scratchpad" box does.
//
// This script reads app.js's and the other page scripts' globals at the moment it runs, never when it
// loads, except settingsAddBoardPage which it calls at load: $, state, api, toast, loadBoard,
// menuSubject, hideContextMenu, openNotes, notesLabel, notesTextNodes, markdownInto,
// settingsFeatureNodes, settingsAddBoardPage.

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

// The panel of the palette's Scratchpad tab for one card or group id.
function scratchPanel(target) {
  const wrap = scratchEl('div', 'sp');
  wrap.dataset.target = target;
  wrap.append(scratchEl('p', 'sp-title', notesLabel(target)));
  if (!scratchpadOn()) {
    wrap.append(scratchEl('p', 'np-muted', 'The scratchpad is off: config.yaml has no scratchpad: line. The gear turns it on.'));
    return wrap;
  }
  const url = `/api/scratchpad/${encodeURIComponent(target)}`;
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
  const showPreview = (on, byKey) => {
    const typing = document.activeElement === text;
    text.hidden = on;
    view.hidden = !on;
    if (on) markdownInto(view, text.value); // after it is shown: a diagram is measured where it is drawn
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
  const bar = scratchEl('div', 'sp-bar');
  bar.append(save, scratchEl('span', 'np-muted', 'Ctrl+Enter saves'), status);
  wrap.append(path, refs, modes, mdEditAttach(text), view, bar); // the box is drawn in colour (markdown-edit-ui.js)
  if (scratchFolderOn()) wrap.append(scratchFolderPanel(target, () => { if (!text.disabled) text.focus({ preventScroll: true }); })); // the card's folder, under the box (scratchpad-folder-ui.js)

  let pad = null;
  const paintPad = () => {
    path.textContent = `${pad.folder === undefined ? state.scratchpad.folder : pad.folder}/${pad.file}${pad.exists ? '' : ' (not written yet)'}`;
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
  const draftOf = () => (scratchUi.drafts.has(target) ? scratchUi.drafts.get(target) : null);
  text.addEventListener('input', () => {
    status.textContent = '';
    if (pad && text.value === pad.body) scratchUi.drafts.delete(target);
    else scratchUi.drafts.set(target, text.value);
  });
  const write = async () => {
    if (!pad || scratchUi.saving) return;
    scratchUi.saving = true;
    save.disabled = true;
    try {
      const answer = await api('PUT', url, { body: text.value });
      pad = answer.pad;
      scratchUi.drafts.delete(target);
      paintPad();
      if (!view.hidden) markdownInto(view, text.value);
      status.textContent = 'Saved';
      await loadBoard();
    } catch (e) {
      toast(e.message);
    } finally {
      scratchUi.saving = false;
      save.disabled = false;
    }
  };
  save.addEventListener('click', write);
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); write(); }
  });

  api('GET', url).then((answer) => {
    pad = answer.pad;
    paintPad();
    const draft = draftOf();
    text.value = draft !== null ? draft : pad.body;
    text.disabled = false;
    text.placeholder = 'Anything: a checklist, a paste, a half-formed plan';
    save.disabled = false;
    preview.disabled = false;
    const here = document.activeElement;
    if (wrap.isConnected && (!here || here === document.body || notesUi.el.contains(here))) text.focus({ preventScroll: true });
  }).catch((e) => {
    path.textContent = e.message;
  });
  return wrap;
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

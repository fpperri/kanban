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

const scratchUi = { drafts: new Map(), saving: false };

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
  for (const b of [edit, preview]) b.type = 'button';
  edit.setAttribute('aria-pressed', 'true');
  preview.setAttribute('aria-pressed', 'false');
  preview.disabled = true;
  modes.append(edit, preview);
  const showPreview = (on) => {
    text.hidden = on;
    view.hidden = !on;
    if (on) markdownInto(view, text.value); // after it is shown: a diagram is measured where it is drawn
    edit.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    edit.setAttribute('aria-pressed', String(!on));
    preview.setAttribute('aria-pressed', String(on));
    if (!on && !text.disabled) text.focus({ preventScroll: true });
  };
  edit.addEventListener('click', () => showPreview(false));
  preview.addEventListener('click', () => showPreview(true));
  const status = scratchEl('span', 'sp-status');
  status.setAttribute('aria-live', 'polite');
  const save = scratchEl('button', 'sp-save', 'Save');
  save.type = 'button';
  save.disabled = true;
  const bar = scratchEl('div', 'sp-bar');
  bar.append(save, scratchEl('span', 'np-muted', 'Ctrl+Enter saves'), status);
  wrap.append(path, refs, modes, text, view, bar);

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
  $('#ctx-scratch').addEventListener('click', () => {
    hideContextMenu();
    if (menuSubject.ids.length === 1) openNotes({ kind: 'scratchpad', target: menuSubject.ids[0] });
  });
});

'use strict';
// The tray screen (docs/adr/0025): the header's "N queued" pill opens the saves a page that carries its
// board has queued, one plain-words row each (tray-describe.js) with a Remove. It is a bottom sheet under
// 760 px and a side panel from it (the stylesheet draws both from the same markup, #tray-sheet), on the modal
// backdrop like the preferences sheet: the poll pauses, Esc closes it, a click outside closes it. Discard
// all, and a Remove that takes other saves with it (the ones that name the temporary id it made), ask first
// in the sheet itself, since a host that sandboxes the page answers a window.confirm with no. Esc is taken
// ahead of the page's own Esc chain, as the group dialog does. A Board
// artifact's tray says "Tell Claude: apply the tray" and keeps Copy changes as the fallback; a downloaded
// file adds Save as file. A record the apply refused shows its reason.
//
// Reads the page's $, boardSource, saveGuard, loadBoard, toast and copyChanges (app.js) when it runs.

let trayAsk = null; // the question the sheet is asking: { kind: 'remove', id, words, more } or { kind: 'discard', count }

function trayIsOpen() {
  return !$('#tray-sheet').classList.contains('hidden');
}

function trayRecords() {
  return boardSource.records ? boardSource.records() : [];
}

function trayWords(record) {
  return window.kanbanTrayDescribe.describeChange(record);
}

function trayRows(records) {
  return records.map((record) => {
    const li = document.createElement('li');
    li.className = `tray-row${record.refused ? ' refused' : ''}`;
    li.dataset.record = record.id;
    const main = document.createElement('div');
    main.className = 'tray-main';
    const words = document.createElement('span');
    words.className = 'tray-words';
    words.textContent = trayWords(record);
    main.appendChild(words);
    if (record.refused) {
      const reason = document.createElement('span');
      reason.className = 'tray-reason';
      reason.textContent = `Refused: ${record.refused}`;
      main.appendChild(reason);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tray-remove';
    remove.dataset.keepsSelection = '';
    remove.dataset.holdsPoll = '';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove: ${words.textContent}`);
    li.append(main, remove);
    return li;
  });
}

function trayShowAsk() {
  const box = $('#tray-confirm');
  box.classList.toggle('hidden', trayAsk === null);
  if (trayAsk === null) return;
  if (trayAsk.kind === 'discard') {
    $('#tray-confirm-text').textContent = `Discard all ${trayAsk.count} queued change${trayAsk.count === 1 ? '' : 's'}? The board in this page goes back to how it was built.`;
    $('#tray-confirm-yes').textContent = 'Discard all';
  } else {
    const more = trayAsk.more === 1 ? '1 more queued change names it and goes too.' : `${trayAsk.more} more queued changes name it and go too.`;
    $('#tray-confirm-text').textContent = `Remove "${trayAsk.words}"? ${more}`;
    $('#tray-confirm-yes').textContent = 'Remove';
  }
}

function trayRender() {
  const records = trayRecords();
  if (trayAsk && trayAsk.kind === 'remove' && !records.some((r) => r.id === trayAsk.id)) trayAsk = null;
  if (trayAsk && trayAsk.kind === 'discard') trayAsk = { kind: 'discard', count: records.length };
  $('#tray-list').replaceChildren(...trayRows(records));
  $('#tray-count').textContent = `${records.length} queued`;
  trayShowAsk();
}

function trayOpen() {
  if (trayRecords().length === 0) return;
  trayAsk = null;
  trayRender();
  $('#tray-sheet').classList.remove('hidden');
  $('#queued-pill').setAttribute('aria-expanded', 'true');
  $('#tray-close').focus();
}

function trayClose() {
  trayAsk = null;
  $('#tray-sheet').classList.add('hidden');
  $('#queued-pill').setAttribute('aria-expanded', 'false');
  const pill = $('#queued-pill');
  if (!pill.classList.contains('hidden')) pill.focus();
}

// Esc steps back from a question to the list, then closes the sheet.
function trayEscape() {
  if (trayAsk !== null) { trayAsk = null; trayShowAsk(); return; }
  trayClose();
}

// What applyQueued tells the sheet when the count changes: it follows the tray while open, and closes when
// the tray is empty. The buttons that depend on the board source show here too.
function traySync(source) {
  const n = source && source.kind !== 'server' ? source.queued : 0;
  $('#queued-pill').classList.toggle('hidden', n === 0);
  $('#copy-changes-btn').classList.toggle('hidden', n === 0);
  $('#save-changes-btn').classList.toggle('hidden', n === 0 || !source || source.kind !== 'page');
  $('#apply-hint').classList.toggle('hidden', n === 0 || !source || source.kind !== 'artifact');
  if (!trayIsOpen()) return;
  if (n === 0) trayClose();
  else trayRender();
}

function trayAskRemove(id) {
  const record = trayRecords().find((r) => r.id === id);
  const plan = record ? boardSource.removal(id) : null;
  if (!plan) return;
  if (plan.more === 0) { trayRemoveNow(id); return; }
  trayAsk = { kind: 'remove', id, words: trayWords(record), more: plan.more };
  trayShowAsk();
  $('#tray-confirm-no').focus();
}

async function trayRemoveNow(id) {
  trayAsk = null;
  boardSource.remove(id);
  await loadBoard();
  trayRender();
}

function trayAskDiscard() {
  const count = trayRecords().length;
  if (count === 0 || !boardSource.clear) return;
  trayAsk = { kind: 'discard', count };
  trayShowAsk();
  $('#tray-confirm-no').focus();
}

async function trayDiscardNow() {
  trayAsk = null;
  boardSource.clear();
  await loadBoard();
  trayRender();
}

async function trayConfirmed() {
  const ask = trayAsk;
  if (!ask) return;
  if (ask.kind === 'discard') await trayDiscardNow();
  else await trayRemoveNow(ask.id);
}

// Save as file: the change payload as a text file, for Claude to apply (the same text Copy changes puts on
// the clipboard). It counts as sent for the leaving guard, as a copy does.
function saveChangesFile() {
  const text = boardSource.payload ? boardSource.payload() : '';
  if (!text) return;
  const taken = boardSource.fingerprint();
  const name = String(state.projectName || 'board').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'board';
  const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `kanban-changes-${name}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  saveGuard.sent(taken);
  syncLeaveGuard();
  toast('Saved the changes as a file. Give the file to Claude to apply.');
}

function onTrayEscape(e) {
  if (e.key !== 'Escape' || !trayIsOpen()) return;
  e.preventDefault();
  e.stopPropagation();
  trayEscape();
}

function trayWire() {
  document.addEventListener('keydown', onTrayEscape, true); // key-guard: exempt (acts only while the tray is open)
  $('#queued-pill').addEventListener('click', trayOpen);
  $('#tray-close').addEventListener('click', trayClose);
  $('#tray-sheet').addEventListener('click', (e) => { if (e.target.id === 'tray-sheet') trayClose(); });
  $('#tray-list').addEventListener('click', (e) => {
    const button = e.target.closest('.tray-remove');
    const row = button && button.closest('.tray-row');
    if (row) trayAskRemove(row.dataset.record);
  });
  $('#discard-changes-btn').addEventListener('click', trayAskDiscard);
  $('#tray-confirm-yes').addEventListener('click', trayConfirmed);
  $('#tray-confirm-no').addEventListener('click', () => { trayAsk = null; trayShowAsk(); });
  $('#save-changes-btn').addEventListener('click', saveChangesFile);
}

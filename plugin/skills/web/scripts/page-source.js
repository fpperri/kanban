'use strict';
// The board source of a page that carries its board (docs/adr/0025): the page's api() asks it instead of
// a server. makePageSource({ route, tray, board }) answers request(method, path, body) the way
// the server's reply reads ({ status, json, text }) through route over the board held in memory, and
// records every save that worked in the tray, a list of queued changes kept in browser storage under a
// key that names the board and its Base. A reload makes the source again over the embedded board and
// replays the tray through route, so the board shows its queued changes applied. A queued change is
// { id: '<device>-<n>', at, device, change: { method, path, body } }: the server save as route took it.
// Settings and notifications do not save in a page (a desk job); they answer 403 and queue nothing.
// Every edit to one todo list folds into one queued change for that list, a whole-list save
// (PUT /api/todos/<target>) carrying the version of the list as the page was built, so the apply checks
// the list once and refuses it as stale when the list changed at the desk since.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanPageSource).

const pageSourceModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryRoute } = node ? require('./memory-route') : window.kanbanMemoryRoute;
  const bufferShim = node ? require('./buffer-shim') : window.kanbanBufferShim;

  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;
  const TODO_EDIT = /^\/api\/todos\/([^/]+)(?:\/(?:move|indent|outdent))?$/;

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  // The queued changes of one board in `storage` under `key`, stored as { records, next } where `next` is
  // the number the next change takes (it only goes up, so a number is never used twice by a device). A
  // storage that throws or is missing leaves the tray in memory for as long as the page is open. A change
  // is added to what storage holds now, not to what this page last read, so two tabs of one board
  // each keep what they queued.
  function makeTrayStore(storage, key, device) {
    const read = () => {
      try {
        const stored = JSON.parse(storage.getItem(key));
        if (stored && Array.isArray(stored.records) && Number.isInteger(stored.next)) return stored;
      } catch (_) { /* nothing stored, or not readable */ }
      return null;
    };
    let held = read() || { records: [], next: 1 };
    return {
      records: () => held.records.slice(),
      add(at, change) {
        const stored = read() || held;
        const record = { id: `${device}-${stored.next}`, at, device, change };
        held = { records: [...stored.records, record], next: stored.next + 1 };
        try { storage.setItem(key, JSON.stringify(held)); } catch (_) { /* kept in memory */ }
        return record;
      },
      // The record `id` takes `change`, keeping its id and its place in the tray.
      replace(id, at, change) {
        const stored = read() || held;
        if (!stored.records.some((r) => r.id === id)) return this.add(at, change);
        held = { records: stored.records.map((r) => (r.id === id ? { ...r, at, change } : r)), next: stored.next };
        try { storage.setItem(key, JSON.stringify(held)); } catch (_) { /* kept in memory */ }
        return held.records.find((r) => r.id === id);
      },
    };
  }

  const reply = (status, json) => ({ status, json, text: json === null ? '' : JSON.stringify(json), statusText: '' });

  function makePageSource({ route, tray, board, now = () => new Date().toISOString() }) {
    for (const { change } of tray.records()) route(change.method, change.path, clone(change.body) || {});

    function request(method, path, body) {
      return Promise.resolve(answer(method, path, body));
    }

    function answer(method, path, body) {
      const pathname = path.split('?')[0];
      const write = method !== 'GET';
      if (write && DESK_JOB_PATH.test(pathname)) return reply(403, { error: DESK_JOB });
      const sent = clone(body);
      const list = write ? TODO_EDIT.exec(pathname) : null;
      const folded = list ? foldedChange(list[1]) : null;
      const result = route(method, path, clone(body) || {});
      if (result === null) return { status: 404, json: null, text: 'not found', statusText: 'Not Found' };
      if (result.status >= 200 && result.status < 300 && write) {
        if (list) queueList(list[1], folded, result);
        else tray.add(now(), { method, path, body: sent === undefined ? {} : sent });
      }
      if (bufferShim.isBuffer(result.body) || (typeof Buffer !== 'undefined' && Buffer.isBuffer(result.body))) return { status: result.status, json: null, text: '', statusText: '', bytes: result.body, type: result.type };
      if (method === 'GET' && pathname === '/api/board' && result.status === 200) {
        return reply(200, { ...result.body, boardDir: '', source: { kind: 'page', queued: tray.records().length, base: board.base } });
      }
      return reply(result.status, result.body);
    }

    // The queued change that already holds the list `target` and the version it was read at: from the
    // tray, else from the list as it is now, before the write that is about to change it.
    function foldedChange(target) {
      const at = `/api/todos/${target}`;
      const held = tray.records().find((r) => r.change.method === 'PUT' && r.change.path === at);
      if (held) return { id: held.id, version: held.change.body.version };
      const read = route('GET', at, {});
      return { id: null, version: read && read.status === 200 ? read.body.todos.version : null };
    }

    function queueList(target, folded, result) {
      if (folded.version === null || !result.body || !result.body.todos) return;
      const change = { method: 'PUT', path: `/api/todos/${target}`, body: { text: result.body.todos.text, version: folded.version } };
      if (folded.id === null) tray.add(now(), change);
      else tray.replace(folded.id, now(), change);
    }

    function payload() {
      const records = tray.records();
      const n = records.length;
      return `Apply kanban changes (board ${JSON.stringify(board.name)}, base ${board.base}, ${n} change${n === 1 ? '' : 's'}):\n${JSON.stringify(records, null, 2)}`;
    }

    return { kind: 'page', request, records: () => tray.records(), payload };
  }

  // A label for this browser, kept in storage so its changes carry one name across reloads.
  function deviceLabel(storage) {
    const key = 'kanban-device';
    try {
      const had = storage.getItem(key);
      if (had) return had;
    } catch (_) { /* no storage */ }
    const label = `d${Math.random().toString(36).slice(2, 6)}`;
    try { storage.setItem(key, label); } catch (_) { /* fresh each load */ }
    return label;
  }

  // The tray is keyed by board and Base: a file rebuilt from the same board starts empty, so a tray that
  // was applied to the board never replays into a newer build, and each build keeps its own queue.
  const trayKey = (board) => `kanban-tray:${board.id}:${board.base}`;

  // The source for the data a built page embeds: { board: { name, id, base }, sources, files, dir }.
  function boot(data, { storage, device } = {}) {
    const given = typeof Buffer === 'undefined' ? { Buffer: bufferShim } : {};
    const { route } = makeMemoryRoute(data.sources, { files: data.files, dir: data.dir, ...given });
    const tray = makeTrayStore(storage, trayKey(data.board), device || deviceLabel(storage));
    return makePageSource({ route, tray, board: data.board });
  }

  return { makePageSource, makeTrayStore, deviceLabel, trayKey, boot };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageSourceModule;
} else {
  window.kanbanPageSource = pageSourceModule;
}

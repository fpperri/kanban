'use strict';
// The board source of a page that carries its board (docs/adr/0025): the page's api() asks it instead of
// a server. makePageSource({ route, tray, board }) answers request(method, path, body) the way
// the server's reply reads ({ status, json, text }) through route over the board held in memory, and
// records every save that worked in the tray, a list of queued changes kept in browser storage under a
// key that names the board. A reload makes the source again over the embedded board and replays the tray
// through route, so the board shows its queued changes applied. A queued change is
// { id: '<device>-<n>', at, device, change: { method, path, body } }: the server save as route took it.
// Settings and notifications do not save in a page (a desk job); they answer 403 and queue nothing.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanPageSource).

const pageSourceModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryRoute } = node ? require('./memory-route') : window.kanbanMemoryRoute;
  const bufferShim = node ? require('./buffer-shim') : window.kanbanBufferShim;

  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;

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
      const result = route(method, path, clone(body) || {});
      if (result === null) return { status: 404, json: null, text: 'not found', statusText: 'Not Found' };
      if (result.status >= 200 && result.status < 300 && write) tray.add(now(), { method, path, body: sent === undefined ? {} : sent });
      if (bufferShim.isBuffer(result.body) || (typeof Buffer !== 'undefined' && Buffer.isBuffer(result.body))) return { status: result.status, json: null, text: '', statusText: '', bytes: result.body, type: result.type };
      if (method === 'GET' && pathname === '/api/board' && result.status === 200) {
        return reply(200, { ...result.body, boardDir: '', source: { kind: 'page', queued: tray.records().length } });
      }
      return reply(result.status, result.body);
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

  // The source for the data a built page embeds: { board: { name, id, base }, sources, files, dir }.
  function boot(data, { storage, device } = {}) {
    const given = typeof Buffer === 'undefined' ? { Buffer: bufferShim } : {};
    const { route } = makeMemoryRoute(data.sources, { files: data.files, dir: data.dir, ...given });
    const tray = makeTrayStore(storage, `kanban-tray:${data.board.id}`, device || deviceLabel(storage));
    return makePageSource({ route, tray, board: data.board });
  }

  return { makePageSource, makeTrayStore, deviceLabel, boot };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageSourceModule;
} else {
  window.kanbanPageSource = pageSourceModule;
}

'use strict';
// The board source of a page that carries its board (docs/adr/0025): the page's api() asks it instead of
// a server. makePageSource({ route, tray, board }) answers request(method, path, body) the way
// the server's reply reads ({ status, json, text }) through route over the board held in memory, and
// records every save that worked in the tray, a list of queued changes kept in browser storage under a
// key that names the board and its Base. A reload makes the source again over the embedded board and
// replays the tray through route, so the board shows its queued changes applied. A queued change is
// { id: '<device>-<n>', at, device, change: { method, path, body }, temp? }: the server save as route took it,
// and `temp`, when it made a card or group, the temporary id (n1, web/ids.js) the page gave it. A card or
// group made in the page takes a temporary id, not the real one the board would allocate; later saves may
// name it (scripts/temp-ids.js), and a reload gives the same card the same id. Removing a record removes
// the records that name the temporary id it made. The apply maps each to the real id (scripts/apply-tray.js).
// Settings and notifications do not save in a page (a desk job); they answer 403 and queue nothing.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanPageSource).

const pageSourceModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryRoute } = node ? require('./memory-route') : window.kanbanMemoryRoute;
  const bufferShim = node ? require('./buffer-shim') : window.kanbanBufferShim;
  const tempIds = node ? require('./temp-ids') : window.kanbanTempIds;
  const ids = node ? require('../web/ids') : window.kanbanIds;

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
    const write = () => {
      try { storage.setItem(key, JSON.stringify(held)); } catch (_) { /* kept in memory */ }
    };
    return {
      records: () => held.records.slice(),
      // What storage holds now, which another tab of the board may have added to since this page last read.
      latest: () => (read() || held).records.slice(),
      add(at, change, temp) {
        const stored = read() || held;
        const record = { id: `${device}-${stored.next}`, at, device, change, ...(temp ? { temp } : {}) };
        held = { records: [...stored.records, record], next: stored.next + 1 };
        write();
        return record;
      },
      remove(gone) {
        const stored = read() || held;
        held = { records: stored.records.filter((r) => !gone.includes(r.id)), next: stored.next };
        write();
      },
    };
  }

  const reply = (status, json) => ({ status, json, text: json === null ? '' : JSON.stringify(json), statusText: '' });

  // The temporary ids a page hands out: allocate() answers the next one no record of the tray holds
  // (read from storage as it is now), unless expect(id) named the one the next create must take, which is
  // how a reload gives a card the id its record says it made.
  function makeTempIds(tray) {
    let expected = null;
    return {
      expect(id) { expected = id || null; },
      allocate() {
        if (expected) {
          const id = expected;
          expected = null;
          return id;
        }
        return tempIds.nextTemp(tray.latest());
      },
    };
  }

  // `fresh`, when given, makes a route over the embedded board as it was built: the page uses it to show
  // the board again after a record is removed. `temp` is the allocator the route was made with.
  function makePageSource({ route, tray, board, fresh = null, temp = null, now = () => new Date().toISOString() }) {
    let current = route;
    const replay = () => {
      for (const { change, temp: made } of tray.records()) {
        if (temp) temp.expect(made);
        current(change.method, change.path, clone(change.body) || {});
      }
      if (temp) temp.expect(null);
    };
    replay();

    function request(method, path, body) {
      return Promise.resolve(answer(method, path, body));
    }

    function answer(method, path, body) {
      const pathname = path.split('?')[0];
      const write = method !== 'GET';
      if (write && DESK_JOB_PATH.test(pathname)) return reply(403, { error: DESK_JOB });
      const sent = clone(body);
      const result = current(method, path, clone(body) || {});
      if (result === null) return { status: 404, json: null, text: 'not found', statusText: 'Not Found' };
      if (result.status >= 200 && result.status < 300 && write) {
        const made = tempIds.createdId(method, path, result.body);
        tray.add(now(), { method, path, body: sent === undefined ? {} : sent }, ids.isTempId(made) ? made : undefined);
      }
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

    // What removing a record takes with it: { ids, more } (the records it removes, itself first in tray
    // order, and how many besides it), or null when the tray has no such record.
    function removal(id) {
      const gone = tempIds.closure(tray.records(), id);
      return gone.length ? { ids: gone, more: gone.length - 1 } : null;
    }

    // Remove a record and the ones that go with it, then show the board without them. The ids removed.
    function remove(id) {
      const plan = removal(id);
      if (!plan) return [];
      if (!fresh) throw new Error('this page source cannot show the board again, so it cannot remove a record');
      tray.remove(plan.ids);
      current = fresh();
      replay();
      return plan.ids;
    }

    // The id of the record that made temporary id `temp`, or null.
    function recordMaking(temp) {
      const found = tray.records().find((r) => r.temp === temp);
      return found ? found.id : null;
    }

    return { kind: 'page', request, records: () => tray.records(), payload, removal, remove, recordMaking };
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
    const tray = makeTrayStore(storage, trayKey(data.board), device || deviceLabel(storage));
    const temp = makeTempIds(tray);
    const fresh = () => makeMemoryRoute(data.sources, { files: data.files, dir: data.dir, newId: temp.allocate, ...given }).route;
    return makePageSource({ route: fresh(), fresh, tray, board: data.board, temp });
  }

  return { makePageSource, makeTrayStore, makeTempIds, deviceLabel, trayKey, boot };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageSourceModule;
} else {
  window.kanbanPageSource = pageSourceModule;
}

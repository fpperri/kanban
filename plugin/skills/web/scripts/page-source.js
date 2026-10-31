'use strict';
// The board source of a page that carries its board (docs/adr/0025): the page's api() asks it instead of
// a server. makePageSource({ route, tray, board }) answers request(method, path, body) the way
// the server's reply reads ({ status, json, text }) through route over the board held in memory, and
// records every save that worked in the tray, a list of queued changes kept in browser storage under a
// key that names the board and its Base. A reload makes the source again over the embedded board and
// replays the tray through route, so the board shows its queued changes applied. A queued change is
// { id: '<device>-<n>', at, device, change: { method, path, body } }: the server save as route took it.
// Settings and notifications do not save in a page (a desk job); they answer 403 and queue nothing.
// A page inside a Board artifact whose database resolves keeps the tray there instead, one document per
// change (scripts/artifact-tray.js); a database that is absent, not the owner's to use or silent
// leaves the tray in browser storage, so the page behaves as the downloaded file does.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanPageSource).

const pageSourceModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryRoute } = node ? require('./memory-route') : window.kanbanMemoryRoute;
  const bufferShim = node ? require('./buffer-shim') : window.kanbanBufferShim;
  const artifactTray = node ? require('./artifact-tray') : window.kanbanArtifactTray;

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
      kind: 'page',
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

  // A tray that has to be found first (the artifact's database answers later than the page starts) says so
  // with `ready`; the board is replayed over the tray once it is found, before the first request is answered.
  function makePageSource({ route, tray, board, now = () => new Date().toISOString() }) {
    const applied = new Set();
    const listeners = [];

    // Replays every record the board has not seen yet through route, in tray order: all of them at start,
    // and after that the ones another device wrote.
    function catchUp() {
      for (const record of tray.records()) {
        if (applied.has(record.id)) continue;
        applied.add(record.id);
        route(record.change.method, record.change.path, clone(record.change.body) || {});
      }
    }

    let started = null;
    if (tray.ready) {
      started = Promise.resolve(tray.ready).then(() => {
        catchUp();
        if (tray.subscribe) {
          tray.subscribe(() => {
            catchUp();
            for (const fn of listeners.slice()) fn();
          });
        }
      });
    } else {
      catchUp();
    }

    async function request(method, path, body) {
      if (started) await started;
      return answer(method, path, body);
    }

    async function answer(method, path, body) {
      const pathname = path.split('?')[0];
      const write = method !== 'GET';
      if (write && DESK_JOB_PATH.test(pathname)) return reply(403, { error: DESK_JOB });
      const sent = clone(body);
      const result = route(method, path, clone(body) || {});
      if (result === null) return { status: 404, json: null, text: 'not found', statusText: 'Not Found' };
      if (result.status >= 200 && result.status < 300 && write) {
        const record = tray.add(now(), { method, path, body: sent === undefined ? {} : sent });
        applied.add(record.id);
        if (tray.written) {
          try { await tray.written(record.id); } catch (e) {
            const why = [e && e.code, e && e.message].filter(Boolean).join(': ');
            return reply(500, { error: `The change shows here but is not queued in the artifact's database (${why || 'no reason given'}); reloading this page would lose it.` });
          }
        }
      }
      if (bufferShim.isBuffer(result.body) || (typeof Buffer !== 'undefined' && Buffer.isBuffer(result.body))) return { status: result.status, json: null, text: '', statusText: '', bytes: result.body, type: result.type };
      if (method === 'GET' && pathname === '/api/board' && result.status === 200) {
        return reply(200, { ...result.body, boardDir: '', source: { kind: tray.kind, queued: tray.records().length } });
      }
      return reply(result.status, result.body);
    }

    function payload() {
      const records = tray.records();
      const n = records.length;
      return `Apply kanban changes (board ${JSON.stringify(board.name)}, base ${board.base}, ${n} change${n === 1 ? '' : 's'}):\n${JSON.stringify(records, null, 2)}`;
    }

    return {
      kind: 'page',
      request,
      records: () => tray.records(),
      payload,
      ready: started || Promise.resolve(),
      onChange(fn) { listeners.push(fn); },
    };
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

  // Where this page keeps its tray: the artifact's database when `claude.use("db")` resolves and the viewer
  // may use it, else browser storage. Never rejects: a database that is missing, refuses, cannot be read or
  // does not answer in time (a tray the page cannot reach is not worth a page that does not open) leaves the
  // queue in browser storage, the downloaded file's way. The collection is owner-only, so a viewer who is
  // told they are not the owner never reaches it.
  async function pickTray({ claude, storage, board, device, timeoutMs }) {
    const inStorage = () => makeTrayStore(storage, trayKey(board), device);
    try {
      const [db, user] = await Promise.all([claude.use('db'), Promise.resolve(claude.use('user')).catch(() => null)]);
      if (!db) return inStorage();
      if (user && typeof user.isOwner === 'function' && !user.isOwner()) return inStorage();
      return await artifactTray.openTray({ db, device, board, storage, timeoutMs });
    } catch (_) {
      return inStorage();
    }
  }

  function deferTray(find) {
    let found = null;
    const listeners = [];
    const ready = find().then((tray) => {
      found = tray;
      if (tray.subscribe) tray.subscribe(() => { for (const fn of listeners.slice()) fn(); });
    });
    return {
      ready,
      get kind() { return found ? found.kind : 'page'; },
      records: () => (found ? found.records() : []),
      add: (at, change) => found.add(at, change),
      written: (id) => (found.written ? found.written(id) : Promise.resolve()),
      subscribe(fn) { listeners.push(fn); },
    };
  }

  // The source for the data a built page embeds: { board: { name, id, base }, sources, files, dir }.
  // `claude` is window.claude where the page runs in an artifact; a page opened as a file has none.
  function boot(data, { storage, device, claude, timeoutMs } = {}) {
    const given = typeof Buffer === 'undefined' ? { Buffer: bufferShim } : {};
    const { route } = makeMemoryRoute(data.sources, { files: data.files, dir: data.dir, ...given });
    const label = device || deviceLabel(storage);
    const tray = claude && typeof claude.use === 'function'
      ? deferTray(() => pickTray({ claude, storage, board: data.board, device: label, timeoutMs }))
      : makeTrayStore(storage, trayKey(data.board), label);
    return makePageSource({ route, tray, board: data.board });
  }

  return { makePageSource, makeTrayStore, deviceLabel, trayKey, boot };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = pageSourceModule;
} else {
  window.kanbanPageSource = pageSourceModule;
}

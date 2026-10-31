'use strict';
// The board source of a page that carries its board (docs/adr/0025): the page's api() asks it instead of
// a server. makePageSource({ route, tray, board }) answers request(method, path, body) the way
// the server's reply reads ({ status, json, text }) through route over the board held in memory, and
// records every save that worked in the tray, a list of queued changes kept in browser storage under a
// key that names the board and its Base. A reload makes the source again over the embedded board and
// replays the tray through route, so the board shows its queued changes applied. A queued change is
// { id: '<device>-<n>', at, device, change: { method, path, body }, temp?, before?, refused? }: the server save
// as route took it, `temp`, when it made a card or group, the temporary id (n1, web/ids.js) the page gave it,
// `before`, on a card edit, the page's value of each field the edit changed, and `refused`, set by the apply,
// the reason it kept the record out. An edit records only the fields that differ from the card as the page had
// it (the edit form sends the whole card), so the apply can refuse it only for a field changed at the desk
// since and an unrelated desk edit never blocks it. A refused record stays in the tray and is not replayed
// (the board does not show a change the apply kept out), and the board load names it. A card or
// group made in the page takes a temporary id, not the real one the board would allocate; later saves may
// name it (scripts/temp-ids.js), and a reload gives the same card the same id. Removing a record removes
// the records that name the temporary id it made. The apply maps each to the real id (scripts/apply-tray.js).
// Settings and notifications do not save in a page (a desk job); they answer 403 and queue nothing.
// A page inside a Board artifact whose database resolves keeps the tray there instead, one document per
// change (scripts/artifact-tray.js); a database that is absent, not the owner's to use or silent
// leaves the tray in browser storage, so the page behaves as the downloaded file does.
// Every edit to one todo list folds into one queued change for that list, a whole-list save
// (PUT /api/todos/<target>) carrying the version of the list as the page was built, so the apply checks
// the list once and refuses it as stale when the list changed at the desk since.
// Same dual-environment pattern as ids.js: required by node --test, and loaded as a plain <script>
// (one global, window.kanbanPageSource).

const pageSourceModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const { makeMemoryRoute } = node ? require('./memory-route') : window.kanbanMemoryRoute;
  const bufferShim = node ? require('./buffer-shim') : window.kanbanBufferShim;
  const artifactTray = node ? require('./artifact-tray') : window.kanbanArtifactTray;
  const tempIds = node ? require('./temp-ids') : window.kanbanTempIds;
  const ids = node ? require('../web/ids') : window.kanbanIds;

  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;
  const DESK_LOCK = 'a desk job';
  const LOCKED_FEATURES = ['logbook', 'scratchpad', 'todos', 'groups'];

  // The gear's settings as the page shows them: read, never saved. Every feature the gear can switch shows
  // locked through the gear's own locked path (the reason a folder set by hand outside the board gets), and
  // `lock` is the same reason for the pages that have no feature to lock.
  function lockedSettings(settings) {
    if (!settings) return settings;
    const out = { ...settings, lock: DESK_LOCK };
    for (const key of LOCKED_FEATURES) if (settings[key]) out[key] = { ...settings[key], locked: true, reason: DESK_LOCK };
    return out;
  }
  const TODO_LIST = /^\/api\/todos\/[^/]+$/;
  const TODO_EDIT = /^\/api\/todos\/([^/]+)(?:\/(?:move|indent|outdent))?$/;
  const CARD_EDIT = /^\/api\/cards\/([^/]+)$/;
  // The fields of a card's JSON an edit can set (card-store's toJSON).
  const CARD_FIELDS = ['title', 'status', 'priority', 'parent', 'rank', 'tags', 'waiting_for', 'blocked', 'review', 'prompt', 'assignee', 'type', 'start_date', 'end_date', 'due_date', 'body'];
  const valueOf = (card, key) => (card[key] === undefined ? null : card[key]);
  // A value as a person would call it the same: an empty text, list or nothing at all is one value, and a
  // number reads as its text (the form sends a parent as text, the card holds it as a number).
  const plain = (v) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? JSON.stringify(v) : String(v));

  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  // The queued changes of one board in `storage` under `key`, stored as { records, next } where `next` is
  // the number the next change takes (it only goes up, so a number is never used twice by a device). A
  // storage that throws or is missing leaves the tray in memory for as long as the page is open. A change
  // is added to what storage holds now, not to what this page last read, so two tabs of one board
  // each keep what they queued.
  function makeTrayStore(storage, key, device, numbers = null) {
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
      kind: 'page',
      device,
      records: () => held.records.slice(),
      // What storage holds now, which another tab of the board may have added to since this page last read.
      latest: () => (read() || held).records.slice(),
      add(at, change, temp, before) {
        const stored = read() || held;
        const n = numbers ? numbers.take(stored.next) : stored.next;
        const record = { id: `${device}-${n}`, at, device, change, ...(temp ? { temp } : {}), ...(before ? { before } : {}) };
        held = { records: [...stored.records, record], next: n + 1 };
        write();
        return record;
      },
      remove(gone) {
        const stored = read() || held;
        held = { records: stored.records.filter((r) => !gone.includes(r.id)), next: stored.next };
        write();
      },
      // The record `id` takes `change`, keeping its id and its place in the tray.
      replace(id, at, change) {
        const stored = read() || held;
        if (!stored.records.some((r) => r.id === id)) return this.add(at, change);
        held = { records: stored.records.map((r) => (r.id === id ? { ...r, at, change } : r)), next: stored.next };
        write();
        return held.records.find((r) => r.id === id);
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

  // A tray that has to be found first (the artifact's database answers later than the page starts) says so
  // with `ready`; the board is replayed over the tray once it is found, before the first request is answered.
  // `fresh`, when given, makes a route over the embedded board as it was built: the page uses it to show
  // the board again after a record is removed. `temp` is the allocator the route was made with.
  function makePageSource({ route, tray, board, fresh = null, temp = null, now = () => new Date().toISOString() }) {
    let current = route;
    const applied = new Map(); // record id -> the change as the board last replayed it
    const refusedSeen = new Map(); // record id -> whether it was refused when the board last saw it
    const listeners = [];

    function replayRecord(record) {
      if (temp) temp.expect(record.temp);
      current(record.change.method, record.change.path, clone(record.change.body) || {});
      if (temp) temp.expect(null);
    }

    // Another device rewrote a whole-list save this page has replayed: its text is put on the list as it
    // stands in this page, so the next edit here builds on it.
    function replayRewrite(record) {
      if (!TODO_LIST.test(record.change.path)) return;
      const read = current('GET', record.change.path, {});
      if (!read || read.status !== 200) return;
      current('PUT', record.change.path, { ...clone(record.change.body), version: read.body.todos.version });
    }

    // Replays every record the board has not seen yet through route, in tray order: all of them at start,
    // and after that the ones another device wrote. A record the board has seen whose change differs now
    // is a list another device rewrote. A card another device made under a temporary id this page holds
    // for its own card stays out (temp-ids.js shadowed): the apply makes both.
    function catchUp() {
      const records = tray.records();
      // A record the apply refused since the board replayed it (or the other way) is not what the board
      // shows now: show the board again without it.
      if (fresh && records.some((r) => applied.has(r.id) && refusedSeen.get(r.id) !== !!r.refused)) {
        current = fresh();
        applied.clear();
        refusedSeen.clear();
      }
      const left = tempIds.shadowed(records, tray.device);
      for (const record of records) {
        const key = JSON.stringify(record.change);
        const had = applied.get(record.id);
        if (had === key) continue;
        applied.set(record.id, key);
        refusedSeen.set(record.id, !!record.refused);
        if (left.has(record.id) || record.refused) continue;
        if (had === undefined) replayRecord(record);
        else replayRewrite(record);
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
      const list = write ? TODO_EDIT.exec(pathname) : null;
      const folded = list ? foldedChange(list[1]) : null;
      const edit = write && method === 'PATCH' ? CARD_EDIT.exec(pathname) : null;
      const held = edit ? cardNow(edit[1]) : null;
      const result = current(method, path, clone(body) || {});
      if (result === null) return { status: 404, json: null, text: 'not found', statusText: 'Not Found' };
      if (result.status >= 200 && result.status < 300 && write) {
        const record = list ? queueList(list[1], folded, result) : edit && held ? queueEdit(path, sent, held, result) : queueSave(method, path, sent, result);
        if (record) {
          applied.set(record.id, JSON.stringify(record.change));
          refusedSeen.set(record.id, !!record.refused);
          if (tray.written) {
            try { await tray.written(record.id); } catch (e) {
              const why = [e && e.code, e && e.message].filter(Boolean).join(': ');
              return reply(500, { error: `The change shows here but is not queued in the artifact's database (${why || 'no reason given'}); reloading this page would lose it.` });
            }
          }
        }
      }
      if (bufferShim.isBuffer(result.body) || (typeof Buffer !== 'undefined' && Buffer.isBuffer(result.body))) return { status: result.status, json: null, text: '', statusText: '', bytes: result.body, type: result.type };
      if (method === 'GET' && pathname === '/api/board' && result.status === 200) {
        return reply(200, {
          ...result.body,
          boardDir: '',
          source: sourceInfo(),
          ...(board.snapshot ? { snapshot: board.snapshot } : {}),
          settings: lockedSettings(result.body.settings),
        });
      }
      return reply(result.status, result.body);
    }

    // The queued change that already holds the list `target` and the version it was read at: from the
    // tray, else from the list as it is now, before the write that is about to change it.
    function foldedChange(target) {
      const at = `/api/todos/${target}`;
      const held = tray.records().find((r) => r.change.method === 'PUT' && r.change.path === at);
      if (held) return { id: held.id, version: held.change.body.version };
      const read = current('GET', at, {});
      return { id: null, version: read && read.status === 200 ? read.body.todos.version : null };
    }

    // The card `seg` names (a card id in a path) as the board shows it now, or null.
    function cardNow(seg) {
      const read = current('GET', '/api/board', {});
      if (!read || read.status !== 200) return null;
      const key = String(ids.idKey(seg) === null ? seg : ids.idKey(seg));
      return read.body.active.concat(read.body.archived).find((c) => String(c.id) === key) || null;
    }

    // The record of a card edit: only the fields the person changed, as the edit sent them, each with the value
    // the card had. A field the store changed on its own (a move into todo stamps start_date) or the form sent
    // as the card already held it is not the person's. An edit that changed none queues nothing.
    function queueEdit(path, sent, held, result) {
      const body = {};
      const before = {};
      for (const key of CARD_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(sent || {}, key)) continue;
        if (JSON.stringify(valueOf(held, key)) === JSON.stringify(valueOf(result.body, key))) continue;
        if (plain(sent[key]) === plain(held[key])) continue;
        body[key] = sent[key];
        before[key] = valueOf(held, key);
      }
      if (!Object.keys(body).length) return null;
      return tray.add(now(), { method: 'PATCH', path, body }, undefined, before);
    }

    function sourceInfo() {
      const records = tray.records();
      const refused = records.filter((r) => r.refused).map((r) => ({ id: r.id, reason: r.refused }));
      return { kind: tray.kind, queued: records.length, ...(refused.length ? { refused } : {}), base: board.base };
    }

    function queueSave(method, path, sent, result) {
      const made = tempIds.createdId(method, path, result.body);
      return tray.add(now(), { method, path, body: sent === undefined ? {} : sent }, ids.isTempId(made) ? made : undefined);
    }

    function queueList(target, folded, result) {
      if (folded.version === null || !result.body || !result.body.todos) return null;
      const change = { method: 'PUT', path: `/api/todos/${target}`, body: { text: result.body.todos.text, version: folded.version } };
      return folded.id === null ? tray.add(now(), change) : tray.replace(folded.id, now(), change);
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
      applied.clear();
      catchUp();
      return plan.ids;
    }

    // Discard the whole tray, then show the board as it was built. The ids removed.
    function clear() {
      const gone = tray.records().map((r) => r.id);
      if (!gone.length) return [];
      if (!fresh) throw new Error('this page source cannot show the board again, so it cannot discard the tray');
      tray.remove(gone);
      current = fresh();
      applied.clear();
      catchUp();
      return gone;
    }

    // The id of the record that made temporary id `temp`, or null.
    function recordMaking(temp) {
      const found = tray.records().find((r) => r.temp === temp);
      return found ? found.id : null;
    }

    // What the tray holds, whole: the leaving guard compares it with the one a copy took, so an edit folded
    // into a record already copied, or a record gone, counts as a change. Empty when nothing is queued.
    function fingerprint() {
      const records = tray.records();
      return records.length ? JSON.stringify(records) : '';
    }

    return {
      kind: 'page',
      pictures: false,
      request,
      records: () => tray.records(),
      payload,
      fingerprint,
      removal,
      remove,
      clear,
      recordMaking,
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
  // told they are not the owner never reaches it (isOwner() answers a promise).
  async function pickTray({ claude, storage, board, device, timeoutMs, retryMs }) {
    const inStorage = () => makeTrayStore(storage, trayKey(board), device);
    try {
      const [db, user] = await artifactTray.withTimeout(Promise.all([claude.use('db'), Promise.resolve(claude.use('user')).catch(() => null)]), timeoutMs);
      if (!db) return inStorage();
      if (user && typeof user.isOwner === 'function' && !(await artifactTray.withTimeout(Promise.resolve(user.isOwner()), timeoutMs))) return inStorage();
      return await artifactTray.openTray({ db, device, board, storage, timeoutMs, retryMs });
    } catch (_) {
      return inStorage();
    }
  }

  function deferTray(find, device) {
    let found = null;
    const listeners = [];
    const ready = find().then((tray) => {
      found = tray;
      if (tray.subscribe) tray.subscribe(() => { for (const fn of listeners.slice()) fn(); });
    });
    return {
      ready,
      device,
      get kind() { return found ? found.kind : 'page'; },
      records: () => (found ? found.records() : []),
      latest: () => (found ? found.latest() : []),
      add: (at, change, temp, before) => found.add(at, change, temp, before),
      remove: (gone) => found.remove(gone),
      replace: (id, at, change) => found.replace(id, at, change),
      written: (id) => (found.written ? found.written(id) : Promise.resolve()),
      subscribe(fn) { listeners.push(fn); },
    };
  }

  // The source for the data a built page embeds: { board: { name, id, base }, sources, files, dir }.
  // `claude` is window.claude where the page runs in an artifact; a page opened as a file has none.
  function boot(data, { storage, device, claude, timeoutMs, retryMs } = {}) {
    ids.acceptTempIds(true); // the page's own id module reads n1 as an id from here on
    const given = typeof Buffer === 'undefined' ? { Buffer: bufferShim } : {};
    const label = device || deviceLabel(storage);
    const tray = claude && typeof claude.use === 'function'
      ? deferTray(() => pickTray({ claude, storage, board: data.board, device: label, timeoutMs, retryMs }), label)
      : makeTrayStore(storage, trayKey(data.board), label, artifactTray.makeNumbers({ storage, board: data.board, device: label }));
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

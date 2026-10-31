'use strict';
// The tray of a Board artifact: the queued changes kept in the artifact's database (docs/adr/0025), one
// document per change in the collection `tray`, under a rule that only the owner reads and writes it
// (the rule is declared when the artifact is published, never by the page). A change is written the
// moment it is made, so switching apps on a phone never loses one; a second device with the page open
// hears the write and shows the change. Claude reads the collection, applies it, and deletes what landed.
// The record is the one the browser-storage tray holds: { id: '<device>-<n>', at, device, change:
// { method, path, body } }, and the apply adds `refused` (and `before`) to the ones it kept.
//
// openTray({ db, device, board, storage, timeoutMs, retryMs }) reads the collection once and resolves the tray,
// or rejects when the database cannot be read in time (the caller then keeps the queue in browser
// storage). The tray has the same face as the browser-storage tray (records(), add(at, change)) plus
// written(id), a promise for the write of a record that add() returned, and subscribe(fn), told when the
// set of records changed from outside this page (another device wrote one, Claude deleted the applied
// ones, the apply marked one refused). Same dual-environment pattern as ids.js: required by node --test,
// and loaded as a plain <script> (one global, window.kanbanArtifactTray).

const artifactTrayModule = (() => {
  const COLLECTION = 'tray';
  const MAX_RETRY_MS = 30000;

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const byTime = (a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  };
  const numberOf = (device, id) => {
    const m = /^(.*)-(\d+)$/.exec(id);
    return m && m[1] === device ? Number(m[2]) : 0;
  };
  // A document is shared data: only one that holds a save the page could have made is taken.
  const recordOf = (id, data) => {
    if (!data || typeof data !== 'object' || !data.change || typeof data.change.method !== 'string' || typeof data.change.path !== 'string') return null;
    if (typeof data.at !== 'string') return null;
    return { ...data, id };
  };

  function withTimeout(promise, ms = 10000) {
    let timer;
    const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the database did not answer in time')), ms); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // The numbers a device gives its changes. A number only goes up, for the device and the board: past what
  // the caller holds (`atLeast`), past what an earlier visit stored under a key that names the board and not
  // the build, and past what the board has applied for the device (`board.taken`, embedded by the build). A
  // number the apply already took must never come round again, whatever the storage or the board id the
  // page was built with. A storage that throws or is missing leaves the counter in memory.
  function makeNumbers({ storage, board, device }) {
    const counterKey = `kanban-tray-next:${board.id}`;
    const floor = Number((board.taken || {})[device]) || 0;
    const stored = () => {
      try {
        const n = Number(storage && storage.getItem(counterKey));
        return Number.isInteger(n) && n > 0 ? n : 0;
      } catch (_) { return 0; }
    };
    let next = 0;
    return {
      take(atLeast = 1) {
        const n = Math.max(atLeast, floor + 1, next, stored());
        next = n + 1;
        try { if (storage) storage.setItem(counterKey, String(next)); } catch (_) { /* in memory */ }
        return n;
      },
    };
  }

  async function openTray({ db, device, board, storage, timeoutMs, retryMs = 1000 }) {
    const collection = db.collection(COLLECTION);
    const first = await withTimeout(collection.get(), timeoutMs);
    const held = new Map();
    const unsynced = new Set();
    const writes = new Map();
    const listeners = [];

    for (const doc of first.docs) {
      const record = recordOf(doc.id, doc.data());
      if (record) held.set(record.id, record);
    }

    const numbers = makeNumbers({ storage, board, device });
    let next = 1 + Math.max(0, ...[...held.keys()].map((id) => numberOf(device, id)));
    const take = () => {
      const n = numbers.take(next);
      next = n + 1;
      return n;
    };

    function adopt(snapshot) {
      let changed = false;
      const seen = new Set();
      for (const doc of snapshot.docs) {
        const record = recordOf(doc.id, doc.data());
        if (!record) continue;
        seen.add(record.id);
        const had = held.get(record.id);
        if (!had || JSON.stringify(had) !== JSON.stringify(record)) {
          held.set(record.id, record);
          changed = true;
        }
      }
      for (const id of [...held.keys()]) {
        if (seen.has(id) || unsynced.has(id)) continue;
        held.delete(id);
        changed = true;
      }
      return changed;
    }

    // A listener that errors is dead, and only a fresh onSnapshot hears the collection again: it is
    // subscribed again after a short wait that doubles while the errors go on (and its first snapshot is
    // the whole collection, so what was written meanwhile arrives with it). Until then the tray keeps what it holds.
    let wait = retryMs;
    function listen() {
      const retry = () => {
        setTimeout(listen, wait);
        wait = Math.min(wait * 2, MAX_RETRY_MS);
      };
      try {
        collection.onSnapshot((snapshot) => {
          wait = retryMs;
          if (adopt(snapshot)) for (const fn of listeners.slice()) fn();
        }, retry);
      } catch (_) { retry(); }
    }
    listen();

    function put(record) {
      const id = record.id;
      held.set(id, record);
      unsynced.add(id);
      let write;
      try { write = Promise.resolve(collection.doc(id).set(clone(record))); } catch (e) { write = Promise.reject(e); }
      const done = write.then(() => { if (writes.get(id) === done) unsynced.delete(id); });
      writes.set(id, done);
      done.catch(() => { /* the caller of written() hears it */ });
      return record;
    }

    return {
      kind: 'artifact',
      records: () => [...held.values()].sort(byTime),
      device,
      latest: () => [...held.values()].sort(byTime),
      add(at, change, temp, before) {
        const id = `${device}-${take()}`;
        return put({ id, at, device, change, ...(temp ? { temp } : {}), ...(before ? { before } : {}) });
      },
      // The records `gone` leave the tray, and their documents are deleted.
      remove(gone) {
        for (const id of gone) {
          held.delete(id);
          unsynced.delete(id);
          writes.delete(id);
          Promise.resolve().then(() => collection.doc(id).delete()).catch(() => { /* the document stays until Claude deletes it */ });
        }
      },
      // The record `id` takes `change`, keeping its id and its time, so its place in the tray: its
      // document is written again. A record that is no longer held (the apply deleted it) is added as a new one.
      replace(id, at, change) {
        const had = held.get(id);
        if (!had) return this.add(at, change);
        return put({ ...had, change });
      },
      written: (id) => writes.get(id) || Promise.resolve(),
      subscribe(fn) { listeners.push(fn); },
    };
  }

  return { openTray, withTimeout, makeNumbers, COLLECTION };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = artifactTrayModule;
} else {
  window.kanbanArtifactTray = artifactTrayModule;
}

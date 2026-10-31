// A stand-in for the artifact's `claude.use("db")`: the collection calls the page's tray makes (get, doc set
// and delete, onSnapshot), over a Map. `change` plays the other side (another device writing, Claude
// deleting the applied documents) and tells every listener.
function makeFakeDb(initial = {}) {
  const docs = new Map(Object.entries(initial));
  const listeners = new Set();
  const fail = { set: null, get: null };
  const snap = () => ({
    size: docs.size,
    empty: docs.size === 0,
    docs: [...docs].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, data]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(data)) })),
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const tell = () => { for (const fn of [...listeners]) queueMicrotask(() => fn(snap())); };
  const collection = (name) => {
    if (name !== 'tray') throw new Error(`the tray uses the collection "tray", not "${name}"`);
    return {
      path: name,
      get: async () => {
        if (fail.get === 'hang') return new Promise(() => {});
        if (fail.get) throw fail.get;
        return snap();
      },
      doc: (id) => ({
        id,
        set: async (data) => {
          if (fail.set) throw fail.set;
          docs.set(id, JSON.parse(JSON.stringify(data)));
          tell();
        },
        delete: async () => { docs.delete(id); tell(); },
      }),
      onSnapshot: (next) => { listeners.add(next); return () => listeners.delete(next); },
    };
  };
  return {
    db: { collection, doc: () => { throw new Error('the tray reads and writes the collection'); } },
    docs,
    fail,
    listeners,
    change(fn) { fn(docs); tell(); },
  };
}

const claudeWith = (db, { owner } = {}) => ({
  use: async (name) => {
    if (name === 'db') return db;
    if (name === 'user' && owner !== undefined) return { isOwner: () => owner };
    return null;
  },
});

module.exports = { makeFakeDb, claudeWith };

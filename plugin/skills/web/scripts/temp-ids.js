'use strict';
// Temporary ids in queued changes. A page that carries its board gives a card or group made in it a
// temporary id (`n1`, web/ids.js), and later changes may name it: as the card in a path, as a parent, in a
// waiting_for list, in a group's list, as a note's target. A queued change is { method, path, body }. This
// finds where one names a temporary id (namesIn), puts the real id in its place once the board has
// allocated it (rewrite), tells which save made an id (createdId), lists what removing a record removes
// (closure) and gives the next temporary id (nextTemp). Only the places an id goes are read: text that
// reads "n1" in a title or a note is text. Same dual-environment pattern as ids.js: required by node --test
// and apply-tray.js, and loaded as a plain <script> (one global, window.kanbanTempIds).

const tempIdsModule = (() => {
  const node = typeof module !== 'undefined' && module.exports;
  const ids = node ? require('../web/ids') : window.kanbanIds;

  // The body fields that hold one id and those that hold a list of them. A note's ref holds a target.
  const SCALARS = ['parent', 'target', 'to', 'prev', 'next'];
  const LISTS = ['waiting_for', 'cards', 'add', 'remove'];

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function mapBody(body, fn) {
    const out = { ...body };
    for (const key of SCALARS) if (ids.isTempId(out[key])) out[key] = fn(out[key]);
    for (const key of LISTS) if (Array.isArray(out[key])) out[key] = out[key].map((v) => (ids.isTempId(v) ? fn(v) : v));
    if (isObject(out.ref)) out.ref = mapBody(out.ref, fn);
    return out;
  }

  // A copy of the change with every temporary id in an id place replaced by fn(id).
  function mapChange(change, fn) {
    const [pathname, ...query] = String(change.path).split('?');
    const path = pathname.split('/').map((seg) => (ids.isTempId(seg) ? fn(seg) : seg)).join('/');
    return { ...change, path: query.length ? `${path}?${query.join('?')}` : path, body: isObject(change.body) ? mapBody(change.body, fn) : change.body };
  }

  // The temporary ids a change names, each once, in the order they appear.
  function namesIn(change) {
    const found = [];
    mapChange(change, (id) => { if (!found.includes(id)) found.push(id); return id; });
    return found;
  }

  // { change, missing }: the change with each temporary id in `map` (temporary to real) put in its place,
  // and the temporary ids it names that the map has no entry for, which stay as they were.
  function rewrite(change, map) {
    const missing = [];
    const out = mapChange(change, (id) => {
      if (Object.prototype.hasOwnProperty.call(map, id)) return map[id];
      if (!missing.includes(id)) missing.push(id);
      return id;
    });
    return { change: out, missing };
  }

  // The id a save made, as route answered it: a card's or a group's. null for any other save.
  function createdId(method, path, body) {
    if (method !== 'POST' || !isObject(body)) return null;
    const route = String(path).split('?')[0];
    const made = route === '/api/cards' ? body.id : route === '/api/groups' && isObject(body.group) ? body.group.id : undefined;
    return typeof made === 'string' || typeof made === 'number' ? String(made) : null;
  }

  // The ids of the records removing `id` removes, in tray order: the record, every record that names a
  // temporary id a removed record made, and so on. A record is { id, change, temp? }. [] when none has the id.
  function closure(records, id) {
    const first = records.find((r) => r.id === id);
    if (!first) return [];
    const gone = new Set([first.id]);
    const made = new Set(first.temp ? [first.temp] : []);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of records) {
        if (gone.has(r.id) || !namesIn(r.change).some((t) => made.has(t))) continue;
        gone.add(r.id);
        if (r.temp) made.add(r.temp);
        grew = true;
      }
    }
    return records.filter((r) => gone.has(r.id)).map((r) => r.id);
  }

  // The temporary id after the highest one the records made.
  function nextTemp(records) {
    let top = 0;
    for (const r of records) {
      const parsed = r && ids.isTempId(r.temp) ? ids.parseId(r.temp) : null;
      if (parsed && parsed.number > top) top = parsed.number;
    }
    return `n${top + 1}`;
  }

  return { namesIn, rewrite, createdId, closure, nextTemp };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tempIdsModule;
} else {
  window.kanbanTempIds = tempIdsModule;
}

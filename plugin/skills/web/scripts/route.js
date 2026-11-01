'use strict';
// The /api routes as one function: makeRoute(dir, { homeUrl }) gives route(method, path, body),
// which answers { status, body } and never throws. It knows nothing of HTTP, origins or sockets (the
// server keeps those), so the same table can run where there is no server. `path` may carry a query
// string; `body` is the parsed JSON a write sent ({} when none). A route that answers a file's bytes
// (a card's image) answers body as a Buffer with its `type` beside it. null = no such route.
const fs = require('fs');
const path = require('path');
const cs = require('./card-store');
const ns = require('./notifications-store');
const lb = require('./logbook-store');
const iter = require('./iteration-folders');
const { cardImage } = require('./card-images');
const sp = require('./scratchpad-store');
const spf = require('./scratchpad-folder');
const td = require('./todo-store');
const gs = require('./group-store');
const del = require('./delete-store');
const cfg = require('./config-store');
const settings = require('./settings-store');
const nesting = require('../web/nesting');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');

// A neighbour in a reorder body: a card id as its whole string (`7`, `G3`),
// null when absent, undefined when it is neither.
function readNeighbour(v) {
  if (v === undefined || v === null) return null;
  const key = ids.idKey(typeof v === 'string' ? v.trim() : v);
  return key === null ? undefined : key;
}

function boardName(dir, config) {
  return config.name || cs.projectName(dir);
}

const ok = (body) => ({ status: 200, body });
const created = (body) => ({ status: 201, body });

function makeRoute(dir, { homeUrl = null } = {}) {
  function dispatch(method, p, url, body) {
    if (method === 'GET' && p === '/api/board') {
      const active = cs.listActive(dir);
      const archived = cs.listArchived(dir);
      const bad = [...active, ...archived].filter((c) => c.unparseable);
      if (bad.length) console.warn(`[kanban-app] skipping ${bad.length} unparseable card(s): ${bad.map((c) => path.basename(c.file)).join(', ')}`);
      const config = cfg.readConfig(dir); // one read carries the board name, assignees + official lists
      const groups = gs.readGroups(dir);
      if (groups && groups.skipped.length) console.warn(`[kanban-app] skipping ${groups.skipped.length} group file(s): ${groups.skipped.map((s) => `${s.file} (${s.reason})`).join(', ')}`);
      return iter.scoped(() => ok({
        // The BOARD NAME: config.yaml's human-declared `name:` when present,
        // else the parent-folder derivation. Wire name kept as projectName —
        // it is also the localStorage namespace for every per-board view
        // preference, so renaming the field would orphan saved state.
        projectName: boardName(dir, config),
        homeUrl,
        source: { kind: 'server', queued: 0 }, // where the board is answered from: the server here; a page that carries its board says page, and how many saves it has queued
        // the header copy button copies the board dir's ABSOLUTE
        // path — resolve()d because the CLI defaults dir to a relative
        // '.kanban'/'kanban' (resolveDefaultBoardDir()), and a relative
        // path is useless pasted elsewhere.
        boardDir: path.resolve(dir),
        active: active.filter((c) => !c.unparseable).map(cs.toJSON),
        archived: archived.filter((c) => !c.unparseable).map(cs.toJSON),
        notifications: ns.readNotifications(dir),
        assignees: config.assignees,
        priorities: config.priorities,
        tags: config.tags,
        statuses: config.statuses, // ordered column list; [] = built-in four
        types: config.types, // [{name, color}] card-type vocabulary, plus icon on an entry that sets one; [] = none declared
        hierarchy: config.hierarchy, // type names, top tier first, as written; [] = none declared
        typesOn: config.typesOn, // false = types off (ADR 0018): the web ignores types and hierarchy; the lists above stay as written
        pills: config.pills, // [{label, query}] the board's own pills, in config order; [] = none declared
        archivePackages: cs.listArchivePackages(dir), // archived/<package>/ folder names the archive popup completes against (ADR 0010)
        logbook: config.paths.logbook ? { folder: config.paths.logbook, notes: lb.listNotes(dir) } : null, // the notes of every day file (ADR 0016); null = no logbook: line, nothing shows
        scratchpad: config.paths.scratchpad ? { folder: config.paths.scratchpad, targets: sp.listTargets(dir) } : null, // the folder and the ids that have a page (ADR 0016); the page itself is read when opened; null = no scratchpad: line, nothing shows
        todos: config.paths.todos ? { folder: config.paths.todos, targets: td.listTargets(dir), counts: td.counts(dir) } : null, // the folder, the ids that have a list and the open and total of each (ADR 0021); the list itself is read when opened; null = no todos: line, nothing shows
        groups, // { folder, list, skipped, folders, prefixes } (ADR 0015); null = no groups: line, nothing shows
        settings: settings.readSettings(dir, [...active, ...archived]), // the config the gear's This board pages show (ADR 0017)
        iterations: !!(groups && config.iterations), // iterations: true over a groups: line adds the header's iteration dropdown (ADR 0015)
      }));
    }

    // notifications: the file protocol's app-side mutations
    if (method === 'POST' && p === '/api/notifications/mark-read') {
      return ok({ notifications: ns.markRead(dir, Array.isArray(body.ids) ? body.ids : undefined) });
    }
    const nm = p.match(/^\/api\/notifications(?:\/(\d+))?$/);
    if (nm && method === 'DELETE') {
      return ok({ notifications: nm[1] ? ns.removeNotification(dir, Number(nm[1])) : ns.clearNotifications(dir) });
    }

    // The logbook, the scratchpad, the gear's settings and the groups: a store refusal is a
    // StatusError, which route answers with its own status
    // (400 a bad value, 404 nothing there, 409 a change that clashed, 413 too long).
    if (p === '/api/notes' || p === '/api/notes/assign') {
      if (method === 'POST' && p === '/api/notes') return created({ note: lb.addNote(dir, body) });
      if (method === 'PATCH' && p === '/api/notes') return ok({ note: lb.editNote(dir, body.ref, body) });
      if (method === 'DELETE' && p === '/api/notes') return ok(lb.deleteNote(dir, body.ref));
      if (method === 'POST' && p === '/api/notes/assign') return ok({ note: lb.assignNote(dir, body.ref, body.to) });
    }

    // the scratchpad: GET reads a page, PUT writes its body; there is no delete route (only the
    // delete flow takes a page, when asked)
    const pm = p.match(new RegExp(`^/api/scratchpad/(${ids.ID_SOURCE})$`));
    if (pm && (method === 'GET' || method === 'PUT')) {
      return ok({ pad: method === 'GET' ? sp.readPad(dir, pm[1]) : sp.writePad(dir, pm[1], body.body) });
    }

    // the scratchpad's folder browser: the files of a card's own scratchpad folder (scratchpad-folder.js).
    // GET .../files?path= lists a folder one level down, GET .../file?path= opens a file; POST .../file
    // creates a .md or .txt, PUT .../file saves one (naming the version it read), DELETE .../file deletes
    // one, POST .../move renames or moves one and POST .../folder makes a subfolder
    const fm = p.match(new RegExp(`^/api/scratchpad/(${ids.ID_SOURCE})/(files|file|move|folder)$`));
    if (fm) {
      const [, who, what] = fm;
      const rel = url.searchParams.get('path');
      if (method === 'GET' && what === 'files') return ok(spf.list(dir, who, rel === null ? '' : rel));
      if (method === 'GET' && what === 'file') return ok(spf.open(dir, who, rel === null ? '' : rel));
      if (method !== 'GET') {
        if (what === 'file' && method === 'POST') return created(spf.create(dir, who, body));
        if (what === 'file' && method === 'PUT') return ok(spf.save(dir, who, body));
        if (what === 'file' && method === 'DELETE') return ok(spf.remove(dir, who, body));
        if (what === 'move' && method === 'POST') return ok(spf.move(dir, who, body));
        if (what === 'folder' && method === 'POST') return created({ entry: spf.makeFolder(dir, who, body) });
      }
    }

    // the todo lists (ADR 0021): GET reads a list; POST adds an item, PATCH ticks or edits one, DELETE
    // removes one and POST .../move reorders one, POST .../indent and .../outdent change its level, and PUT
    // writes the whole text (the tab's Edit), each naming the version it read (a clash is a 409)
    const tm = p.match(new RegExp(`^/api/todos/(${ids.ID_SOURCE})(/move|/indent|/outdent)?$`));
    if (tm) {
      if (!tm[2] && method === 'GET') return ok({ todos: td.readTodos(dir, tm[1]) });
      if (!tm[2] && method === 'POST') return created({ todos: td.addTodo(dir, tm[1], body) });
      if (!tm[2] && method === 'PATCH') return ok({ todos: td.setTodo(dir, tm[1], body) });
      if (!tm[2] && method === 'DELETE') return ok({ todos: td.deleteTodo(dir, tm[1], body) });
      if (!tm[2] && method === 'PUT') return ok({ todos: td.writeTodos(dir, tm[1], body) });
      if (tm[2] === '/move' && method === 'POST') return ok({ todos: td.moveTodo(dir, tm[1], body) });
      if (tm[2] === '/indent' && method === 'POST') return ok({ todos: td.indentTodo(dir, tm[1], body) });
      if (tm[2] === '/outdent' && method === 'POST') return ok({ todos: td.outdentTodo(dir, tm[1], body) });
    }

    // the gear's This board pages: one config.yaml line per request (ADR 0017)
    if (method === 'POST' && p === '/api/config') return ok({ settings: settings.writeSetting(dir, body) });

    // groups
    const gm = p.match(new RegExp(`^/api/groups(?:/(${ids.ID_SOURCE})(/members)?)?$`));
    if (gm) {
      if (!gm[1] && method === 'POST') return created({ group: gs.createGroup(dir, body) });
      if (gm[1] && !gm[2] && method === 'PATCH') return ok({ group: gs.updateGroup(dir, gm[1], body) });
      if (gm[1] && gm[2] && method === 'POST') return ok({ group: gs.changeMembers(dir, gm[1], body) });
      // the extras to delete with it ride in the body, each only when true (delete-store.js)
      if (gm[1] && !gm[2] && method === 'DELETE') return ok({ ok: true, ...del.deleteGroup(dir, gm[1], body) });
    }

    // mutations
    if (method === 'POST' && p === '/api/cards') {
      try {
        const made = cs.toJSON(cs.createCard(dir, body));
        // Auto-join in the same request: the groups running on the creator's local date
        // with auto_join take the card, and the reply names them for the flash.
        return created({ ...made, joined: gs.joinRunning(dir, made.id, cs.todayLocalDate()) });
      } catch (e) {
        // the 422 names WHICH gate refused — waiting carries the
        // unresolved deps, blocked carries the sticker's reason.
        if (e.name === 'WaitingError') return { status: 422, body: { error: e.message, waiting: e.waiting } };
        if (e.name === 'BlockedError') return { status: 422, body: { error: e.message, reason: e.reason } };
        throw e;
      }
    }
    const m = p.match(new RegExp(`^/api/cards/(${ids.ID_SOURCE})(/archive|/restore|/detail|/reorder|/image)?$`));
    if (m) {
      const id = ids.idKey(m[1]); // the whole id; null when the digits run past what an id holds
      if (id === null || !cs.findCardFile(dir, id)) return { status: 404, body: { error: `no card #${m[1]}` } };
      // A Markdown image of the card's body: the file is found and judged by card-images.js; its bytes are the answer.
      if (method === 'GET' && m[2] === '/image') {
        const { file, type } = cardImage(dir, id, url.searchParams.get('path'));
        return { status: 200, type, body: fs.readFileSync(file) };
      }
      if (method === 'GET' && m[2] === '/detail') {
        const detail = cs.cardDetail(dir, id);
        // file mtime for the popup's "Last modified" fallback when
        // the card predates the `updated` frontmatter field.
        const mtime = fs.statSync(detail.path).mtime.toISOString();
        return ok({ ...detail, mtime });
      }
      if (method === 'PATCH' && !m[2]) {
        try {
          return ok(cs.toJSON(cs.updateCard(dir, id, body)));
        } catch (e) {
          if (e.name === 'WaitingError') return { status: 422, body: { error: e.message, waiting: e.waiting } };
          if (e.name === 'BlockedError') return { status: 422, body: { error: e.message, reason: e.reason } };
          throw e;
        }
      }
      // Optional `package` body field files the card into
      // archived/<package>/ instead of the archived/ root (ADR 0010); a
      // bodyless POST still archives to the root, so every pre-package
      // caller is untouched. A name that isn't one plain path component is
      // the caller's mistake, not a server fault — 400, never 500.
      if (method === 'POST' && m[2] === '/archive') {
        try {
          return ok(cs.toJSON(cs.archiveCard(dir, id, body.package)));
        } catch (e) {
          if (e.name === 'PackageError') return { status: 400, body: { error: e.message } };
          throw e;
        }
      }
      if (method === 'POST' && m[2] === '/restore') return ok(cs.toJSON(cs.restoreCard(dir, id)));
      // Each card is written on its own, with no transaction across them: a
      // failure part-way leaves the cards before it written.
      if (method === 'POST' && m[2] === '/reorder') {
        const prev = readNeighbour(body.prev);
        const next = readNeighbour(body.next);
        if (prev === undefined || next === undefined) return { status: 400, body: { error: 'prev and next must be card ids' } };
        const config = cfg.readConfig(dir);
        const cards = cs.listActive(dir).concat(cs.listArchived(dir)).filter((c) => !c.unparseable);
        const plan = nesting.reorderPlan(cards, id, { prev, next }, { board: boardName(dir, config), priorities: config.priorities });
        if (plan.error) return { status: 400, body: { error: plan.error } };
        const written = nesting.reorderWrites(id, plan).map((w) => cs.toJSON(cs.updateCard(dir, w.id, { rank: w.rank })));
        return ok({
          card: written.find((c) => c.id === id) || cs.toJSON(cards.find((c) => c.id === id)),
          renumbered: written.filter((c) => c.id !== id),
        });
      }
      // Its id always leaves every group's list; the body names the extras to delete with it (delete-store.js).
      if (method === 'DELETE' && !m[2]) return ok({ ok: true, ...del.deleteCard(dir, id, body) });
    }

    return null;
  }

  return function route(method, rawPath, body) {
    const url = new URL(rawPath, 'http://localhost');
    try {
      return dispatch(method, url.pathname, url, body || {});
    } catch (err) {
      if (err instanceof StatusError) return { status: err.status, body: { error: err.message } };
      return { status: 500, body: { error: String((err && err.message) || err) } };
    }
  };
}

module.exports = { makeRoute };

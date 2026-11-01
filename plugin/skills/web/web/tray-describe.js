'use strict';
// The words of the tray: one plain sentence per queued change ("moved #412 to doing"), written from the
// write route the change was sent to and its body. One table, one entry per write route route.js answers;
// `marker` is the text of that route's guard in route.js, which test/web/tray-describe.test.js holds
// against the file, so a write route added without its words fails there. A route the table does not
// know reads as its method and path, never as nothing. Pure. Same dual-environment pattern as ids.js:
// loaded as a plain <script> in the browser (one global, window.kanbanTrayDescribe) AND required directly
// by node --test.

const trayDescribeModule = (() => {
  const TEMP_RE = /^n[0-9]{1,15}$/;
  const SHORT = 60;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clip = (text) => {
    const one = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
    return one.length > SHORT ? `${one.slice(0, SHORT - 1)}…` : one;
  };
  const quoted = (text) => `"${clip(text)}"`;
  // A card as the board names it: #412, and a temporary id as it is.
  const card = (id) => (TEMP_RE.test(String(id)) ? String(id) : `#${id}`);
  const group = (id) => `group ${id}`;
  const list = (items) => items.join(', ');
  const andList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''));
  const refTarget = (body) => (isObject(body.ref) && body.ref.target !== undefined && body.ref.target !== null ? card(body.ref.target) : null);
  const padOf = (id) => `the scratchpad of ${card(id)}`;
  const DELETE_EXTRAS = [['logbook', 'notes'], ['scratchpad', 'scratchpad'], ['todos', 'todos']];

  const entry = (method, template, marker, pattern, words) => ({ key: `${method} ${template}`, method, marker, pattern, words });
  const at = (template) => new RegExp(`^${template.replace(/:id/g, '([^/]+)').replace(/\//g, '\\/')}$`);

  const ROUTES = [
    entry('POST', '/api/cards', "method === 'POST' && p === '/api/cards')", at('/api/cards'),
      (m, body, rec) => (rec && rec.temp ? `created card ${rec.temp} ${quoted(body.title)}` : `created a card ${quoted(body.title)}`)),
    entry('PATCH', '/api/cards/:id', "method === 'PATCH' && !m[2]", at('/api/cards/:id'), (m, body) => {
      const fields = Object.keys(body);
      if (fields.length === 1 && fields[0] === 'status') return `moved ${card(m[1])} to ${body.status}`;
      return `edited ${card(m[1])}: ${list(fields)}`;
    }),
    entry('POST', '/api/cards/:id/archive', "method === 'POST' && m[2] === '/archive'", at('/api/cards/:id/archive'),
      (m, body) => `archived ${card(m[1])}${body.package ? ` into the package ${body.package}` : ''}`),
    entry('POST', '/api/cards/:id/restore', "method === 'POST' && m[2] === '/restore'", at('/api/cards/:id/restore'), (m) => `restored ${card(m[1])}`),
    entry('POST', '/api/cards/:id/reorder', "method === 'POST' && m[2] === '/reorder'", at('/api/cards/:id/reorder'), (m, body) => {
      const prev = body.prev === undefined || body.prev === null ? null : card(body.prev);
      const next = body.next === undefined || body.next === null ? null : card(body.next);
      if (prev && next) return `reordered ${card(m[1])} between ${prev} and ${next}`;
      if (prev) return `reordered ${card(m[1])} after ${prev}`;
      if (next) return `reordered ${card(m[1])} before ${next}`;
      return `reordered ${card(m[1])}`;
    }),
    entry('DELETE', '/api/cards/:id', "method === 'DELETE' && !m[2]", at('/api/cards/:id'), (m, body) => {
      const extras = DELETE_EXTRAS.filter(([key]) => body[key] === true).map(([, name]) => name);
      return `deleted ${card(m[1])}${extras.length ? ` with its ${andList(extras)}` : ''}`;
    }),

    entry('POST', '/api/notes', "method === 'POST' && p === '/api/notes')", at('/api/notes'),
      (m, body) => (body.target !== undefined && body.target !== null ? `added a note to ${card(body.target)}` : `added a note for ${body.day || 'the board'}`)),
    entry('PATCH', '/api/notes', "method === 'PATCH' && p === '/api/notes'", at('/api/notes'),
      (m, body) => `edited a note ${refTarget(body) ? `on ${refTarget(body)}` : `of ${(body.ref && body.ref.day) || 'the board'}`}`),
    entry('DELETE', '/api/notes', "method === 'DELETE' && p === '/api/notes'", at('/api/notes'),
      (m, body) => `deleted a note ${refTarget(body) ? `on ${refTarget(body)}` : `of ${(body.ref && body.ref.day) || 'the board'}`}`),
    entry('POST', '/api/notes/assign', "method === 'POST' && p === '/api/notes/assign'", at('/api/notes/assign'),
      (m, body) => `moved a note from ${refTarget(body) || `the board's ${(body.ref && body.ref.day) || 'day'}`} to ${card(body.to)}`),

    entry('PUT', '/api/scratchpad/:id', "(method === 'GET' || method === 'PUT')", at('/api/scratchpad/:id'), (m) => `saved the scratchpad page of ${card(m[1])}`),
    entry('POST', '/api/scratchpad/:id/file', "what === 'file' && method === 'POST'", at('/api/scratchpad/:id/file'), (m, body) => `created ${body.path} in ${padOf(m[1])}`),
    entry('PUT', '/api/scratchpad/:id/file', "what === 'file' && method === 'PUT'", at('/api/scratchpad/:id/file'), (m, body) => `saved ${body.path} in ${padOf(m[1])}`),
    entry('DELETE', '/api/scratchpad/:id/file', "what === 'file' && method === 'DELETE'", at('/api/scratchpad/:id/file'), (m, body) => `deleted ${body.path} from ${padOf(m[1])}`),
    entry('POST', '/api/scratchpad/:id/move', "what === 'move' && method === 'POST'", at('/api/scratchpad/:id/move'), (m, body) => `moved ${body.from} to ${body.to} in ${padOf(m[1])}`),
    entry('POST', '/api/scratchpad/:id/folder', "what === 'folder' && method === 'POST'", at('/api/scratchpad/:id/folder'), (m, body) => `made the folder ${body.path} in ${padOf(m[1])}`),

    entry('POST', '/api/todos/:id', "!tm[2] && method === 'POST'", at('/api/todos/:id'), (m, body) => `added a todo to ${card(m[1])}: ${quoted(body.text)}`),
    entry('PATCH', '/api/todos/:id', "!tm[2] && method === 'PATCH'", at('/api/todos/:id'), (m, body) => {
      if (typeof body.text === 'string') return `edited a todo on ${card(m[1])}`;
      return `${body.done === false ? 'unticked' : 'ticked'} a todo on ${card(m[1])}`;
    }),
    entry('DELETE', '/api/todos/:id', "!tm[2] && method === 'DELETE'", at('/api/todos/:id'), (m) => `deleted a todo on ${card(m[1])}`),
    entry('PUT', '/api/todos/:id', "!tm[2] && method === 'PUT'", at('/api/todos/:id'), (m) => `edited the todo list of ${card(m[1])}`),
    entry('POST', '/api/todos/:id/move', "tm[2] === '/move' && method === 'POST'", at('/api/todos/:id/move'), (m) => `moved a todo on ${card(m[1])}`),
    entry('POST', '/api/todos/:id/indent', "tm[2] === '/indent' && method === 'POST'", at('/api/todos/:id/indent'), (m) => `indented a todo on ${card(m[1])}`),
    entry('POST', '/api/todos/:id/outdent', "tm[2] === '/outdent' && method === 'POST'", at('/api/todos/:id/outdent'), (m) => `outdented a todo on ${card(m[1])}`),

    entry('POST', '/api/config', "method === 'POST' && p === '/api/config'", at('/api/config'),
      (m, body) => `changed the setting ${body.key || body.block || 'of the board'} (a desk job)`),

    entry('POST', '/api/groups', "!gm[1] && method === 'POST'", at('/api/groups'),
      (m, body, rec) => (rec && rec.temp ? `created group ${rec.temp} ${quoted(body.name)}` : `created a group ${quoted(body.name)}`)),
    entry('PATCH', '/api/groups/:id', "gm[1] && !gm[2] && method === 'PATCH'", at('/api/groups/:id'), (m, body) => {
      const fields = Object.keys(body);
      if (fields.length === 1 && fields[0] === 'name') return `renamed ${group(m[1])} to ${quoted(body.name)}`;
      return `changed ${group(m[1])}: ${list(fields)}`;
    }),
    entry('POST', '/api/groups/:id/members', "gm[1] && gm[2] && method === 'POST'", at('/api/groups/:id/members'), (m, body) => {
      const parts = [];
      if (Array.isArray(body.add) && body.add.length) parts.push(`added ${list(body.add.map(card))}`);
      if (Array.isArray(body.remove) && body.remove.length) parts.push(`removed ${list(body.remove.map(card))}`);
      return `changed the members of ${group(m[1])}${parts.length ? `: ${list(parts)}` : ''}`;
    }),
    entry('DELETE', '/api/groups/:id', "gm[1] && !gm[2] && method === 'DELETE'", at('/api/groups/:id'), (m) => `deleted ${group(m[1])}`),

    entry('POST', '/api/notifications/mark-read', "p === '/api/notifications/mark-read'", at('/api/notifications/mark-read'), () => 'marked notifications read (a desk job)'),
    entry('DELETE', '/api/notifications/:id', "nm && method === 'DELETE'", at('/api/notifications/:id'), () => 'removed a notification (a desk job)'),
    entry('DELETE', '/api/notifications', "nm && method === 'DELETE'", at('/api/notifications'), () => 'cleared notifications (a desk job)'),
  ];

  // The sentence for a tray record ({ change: { method, path, body }, temp? }).
  function describeChange(record) {
    const { method, path } = record.change;
    const body = isObject(record.change.body) ? record.change.body : {};
    const pathname = String(path).split('?')[0];
    for (const route of ROUTES) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(pathname);
      if (m) return route.words(m, body, record);
    }
    return `${method} ${pathname}`;
  }

  return { describeChange, ROUTES };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = trayDescribeModule;
} else {
  window.kanbanTrayDescribe = trayDescribeModule;
}

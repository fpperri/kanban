'use strict';
// Settings and notifications are a desk job: a page and the apply of its tray both refuse them. deskJob({ method,
// path, body }) answers the reason a change is refused, or null. A path is read the way the route reads it (a URL
// against a dummy base, ids.routePath), so `/api/./config`, `/api/x/../config`, `/api/config#x` and a path with a tab in it
// are the config route too; a path that does not parse is refused. Same dual-environment pattern as ids.js:
// required by node --test and the apply, and loaded as a plain <script> (one global, window.kanbanDeskJob).

const deskJobModule = (() => {
  const ids = typeof module !== 'undefined' && module.exports ? require('../web/ids') : window.kanbanIds;
  const DESK_JOB = 'That is a desk job: settings and notifications do not save in this page.';
  const UNREADABLE = 'That path cannot be read as a route, so it is refused.';
  const DESK_JOB_PATH = /^\/api\/(?:config|notifications)(?:\/|$)/;

  function deskJob(change) {
    const at = ids.routePath(change.path);
    if (at === null) return UNREADABLE;
    return DESK_JOB_PATH.test(at.split('?')[0]) ? DESK_JOB : null;
  }

  return { deskJob, DESK_JOB };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = deskJobModule;
} else {
  window.kanbanDeskJob = deskJobModule;
}

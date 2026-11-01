'use strict';
// What the page's api() asks: a board source answers request(method, path, body) with
// { status, json, text, statusText }, and call() turns a refusal into the Error the toasts read. The
// server source is fetch; a page that carries its board answers through route over the board in memory
// instead (scripts/page-source.js). No feature reads which one it is: the board load says
// `source: { kind, queued, pictures? }` for the few things that must (the queued count, and `pictures: false` where the board holds no picture files). Same dual-environment
// pattern as ids.js/nesting.js: loaded as a plain <script> in the browser (one global,
// window.kanbanBoardSource) AND required directly by node --test.

const boardSourceModule = (() => {
  function serverSource(fetchFn) {
    return {
      kind: 'server',
      async request(method, path, body) {
        const res = await fetchFn(path, {
          method,
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        const isJson = (res.headers.get('content-type') || '').includes('application/json');
        let json = null;
        if (isJson && text) {
          try { json = JSON.parse(text); } catch (e) { json = null; } // malformed JSON body falls back to status+text below
        }
        return { status: res.status, json, text, statusText: res.statusText };
      },
    };
  }

  async function call(source, method, path, body) {
    const res = await source.request(method, path, body);
    if (res.status < 200 || res.status >= 300) {
      const msg = (res.json && res.json.error) || `${res.status} — ${res.text || res.statusText}`;
      throw Object.assign(new Error(msg), { status: res.status, data: res.json });
    }
    return res.json;
  }

  return { serverSource, call };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = boardSourceModule;
} else {
  window.kanbanBoardSource = boardSourceModule;
}

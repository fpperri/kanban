'use strict';
// The built page's content security policy, in a browser. The file the build makes opens with no server in
// its way and draws the Board under its policy (so the page needs no eval and no inline source its policy
// does not name by hash), and the browser refuses what the policy leaves out: a script put in the page as
// text, a script with a remote address, an inline handler and a request out of the page. None of the
// page's own start-up raises a violation. A card dropped on Doing still queues, so the page's own scripts
// and the module loader's route run under it.
//
// The Board artifact's publisher wraps the built file in a page of its own, so the built file's
// <!DOCTYPE html><html><head> lands inside the wrapper's <body>. The same file is opened in that shape
// (wrapped.html): the page must still draw and queue, and what the browser does with a policy that is not
// in the head of the page it sits in is pinned here: it is ignored, so the wrapped page has no policy.
// Each step waits on what the page shows, never on a fixed sleep.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');

const fileUrl = (p) => `file:///${p.replace(/\\/g, '/')}`;
const NAME = `document.getElementById('project-name').textContent`;
const PILL = `(()=>{const p=document.getElementById('queued-pill');return p.classList.contains('hidden')?'':p.textContent})()`;
const DRAWN = `document.querySelectorAll('#board .column .card-el').length>0`;
const column = (id, col) => `!!document.querySelector('#board .column[data-col="${col}"] .card-el[data-id="${id}"]')`;

const WATCH = `(function () {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', function (e) {
    window.__violations.push(e.effectiveDirective + ' ' + (e.blockedURI || '(inline)'));
  });
})();`;

// What the policy refuses, asked of the page by putting each thing in it. It starts them and returns; the
// answers are read from window.__probe once `done` is set (the violations arrive as the browser raises them).
const PROBES = `(function () {
  window.__violations.length = 0;
  window.__probe = { done: false, fetched: 'allowed' };
  const inline = document.createElement('script');
  inline.textContent = 'window.__inlineRan = true';
  document.head.appendChild(inline);
  const remote = document.createElement('script');
  remote.src = 'https://example.invalid/remote.js';
  document.head.appendChild(remote);
  const holder = document.createElement('div');
  holder.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__handlerRan = true">';
  document.body.appendChild(holder);
  fetch('https://example.invalid/x').catch(() => { window.__probe.fetched = 'refused'; }).then(() => { window.__probe.done = true; });
  return true;
})()`;
const PROBED = `JSON.stringify({ violations: window.__violations.slice(), inline: !!window.__inlineRan, handler: !!window.__handlerRan, fetched: window.__probe.fetched })`;

module.exports = {
  name: 'artifact-csp',
  board: 'fixture',
  timeoutMs: 100000,
  // The console entries the probes provoke on purpose: the browser's refusals, the notice that the wrapped page ignored its
  // policy (the one console entry that opens with the policy's own text), and the failed lookups of the probes' unresolvable address.
  expectedErrors: [
    /Executing inline script violates/,
    /Executing inline event handler violates/,
    /Loading the script 'https:\/\/example\.invalid\/remote\.js' violates/,
    /Connecting to 'https:\/\/example\.invalid\/x' violates/,
    /Fetch API cannot load https:\/\/example\.invalid\/x/,
    /The Content Security Policy 'default-src 'none'; script-src 'sha256-/,
    /Failed to load resource: net::ERR_NAME_NOT_RESOLVED.*example\.invalid/,
  ],
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-csp-scenario-'));
    try {
      const dir = materialize('fixture', path.join(root, 'board', '.kanban'));
      const { html } = buildPage({ boardDir: dir });
      const direct = path.join(root, 'fixture.html');
      fs.writeFileSync(direct, html);
      const wrapped = path.join(root, 'wrapped.html');
      fs.writeFileSync(wrapped, `<!doctype html><html><head><meta charset="utf8"><style>body{margin:0}</style></head><body>${html}</body></html>`);

      await send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
      const stayPut = () => ev(`window.askBeforeLeaving&&window.removeEventListener('beforeunload',window.askBeforeLeaving)`);
      const load = async (file) => {
        await stayPut();
        await send('Page.navigate', { url: fileUrl(file) });
        return waitFor(`document.readyState==='complete'&&${NAME}==='fixture'&&${DRAWN}`, 15000);
      };
      const drop = (id, col) => ev(`(()=>{const card=document.querySelector('#board .card[data-id="${id}"]');const col=document.querySelector('#board .column[data-col="${col}"]');if(!card||!col)return false;const dt=new DataTransfer();const fire=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:col.getBoundingClientRect().top+8}));fire('dragstart',card);fire('dragover',col);fire('drop',col);fire('dragend',card);return true})()`);

      await load(direct);
      await ev('localStorage.clear()');
      check('the built file opens under its policy and draws the Board', await load(direct));
      check('the policy is in the head', await ev(`!!document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
      check('the page raised no violation of its own', (await ev(`window.__violations.length`)) === 0, JSON.stringify(await ev('window.__violations')));
      check('a card dropped on Doing is queued under the policy', await drop('7', 'doing') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000), await ev(PILL));
      await ev(PROBES);
      check('the probes finished', await waitFor(`window.__probe.done&&window.__violations.length>=4`, 6000), await ev(PROBED));
      const probed = JSON.parse(await ev(PROBED));
      check('a script put in the page as text did not run', probed.inline === false, JSON.stringify(probed));
      check('a script with a remote address was refused', probed.violations.some((v) => v.startsWith('script-src-elem https://example.invalid')), JSON.stringify(probed));
      check('an inline handler did not run', probed.handler === false && probed.violations.some((v) => v.startsWith('script-src-attr')), JSON.stringify(probed));
      check('a request out of the page was refused', probed.fetched === 'refused' && probed.violations.some((v) => v.startsWith('connect-src https://example.invalid')), JSON.stringify(probed));

      await load(wrapped);
      await ev('localStorage.clear()');
      check('the file wrapped in a page of its own still draws the Board', await load(wrapped));
      check('and its policy sits in the wrapper\'s body, not in a head', await ev(`!!document.body.querySelector('meta[http-equiv="Content-Security-Policy"]')&&!document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')`));
      check('the wrapped page raised no violation', (await ev(`window.__violations.length`)) === 0, JSON.stringify(await ev('window.__violations')));
      check('a card dropped on Doing is queued in the wrapped page', await drop('7', 'doing') && await waitFor(`${PILL}==='1 queued'&&${column('7', 'doing')}`, 6000), await ev(PILL));
      await ev(PROBES);
      check('the wrapped probes finished', await waitFor(`window.__probe.done`, 6000));
      const wrappedProbe = JSON.parse(await ev(PROBED));
      check('the browser ignores that policy: a script put in the page as text runs', wrappedProbe.inline === true && wrappedProbe.violations.length === 0, JSON.stringify(wrappedProbe));
    } finally {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* the temp folder is the OS's to clear */ }
    }
  },
};

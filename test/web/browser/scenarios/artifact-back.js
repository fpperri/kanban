'use strict';
// Android Back on the Board artifact in a viewer-like frame: the built page sits in a cross-origin iframe whose
// sandbox lacks allow-top-navigation, as an artifact viewer's does. A frame may not traverse the tab history
// onto the viewer's own entry, so a Back that had to let a stale entry through (history.back() from the page's
// entry) stopped on the frame's first entry and cost a second press. With touch on, 390 by 844: two taps select
// two cards, Clear on the bar empties the selection without a Back, which leaves the page's entry with nothing
// to keep, and the page takes that entry off itself once the double-tap window has passed, a traversal inside the
// frame the sandbox allows; one Back from the viewer then leaves it. A Back that steps the selection is the
// control: Back, Back, Back leaves. Each wait is for the page's state.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): selectedIds.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { materialize } = require('../boards');
const { buildPage } = require('../../../../plugin/skills/web/scripts/artifact-build');
const { tap, outwaitDoubleTap, backOut } = require('../steps');
const { withFrameAnswers, viewerHtml } = require('../viewer-frame');


module.exports = {
  name: 'artifact-back',
  board: 'fixture',
  timeoutMs: 100000,
  async run(page) {
    const { ev, waitFor, check, send } = page;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-artifact-back-'));
    const dir = materialize('fixture', path.join(root, 'board', '.kanban'));
    const { html } = buildPage({ boardDir: dir });
    const files = { '/page.html': withFrameAnswers(html), '/start.html': '<!doctype html><title>start</title><link rel="icon" href="data:,"><p>start</p>' };
    const server = http.createServer((req, res) => {
      const body = files[new URL(req.url, 'http://x').pathname];
      if (body === undefined) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    files['/viewer.html'] = viewerHtml(`http://localhost:${port}/page.html`); // another origin from the viewer's, as a viewer's frame is

    // What the frame answers, and a wait for it to answer true.
    const inFrame = (expr) => ev(`window.q(${JSON.stringify(expr)})`);
    const frameWaitFor = async (expr, ms = 10000) => {
      const until = Date.now() + page.scaled(ms);
      for (;;) {
        let answer;
        try { answer = await inFrame(expr); } catch (e) { answer = 'ERR'; }
        if (answer === true) return true;
        if (Date.now() > until) return answer;
        await page.sleep(100);
      }
    };
    const tapInFrame = async (sel) => {
      const at = await inFrame(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (!at || typeof at !== 'object') throw new Error(`nothing in the frame matches ${sel}`);
      await tap(page, at.x, at.y);
    };
    const titleOf = (id) => `#board .column .card-el[data-id="${id}"] .card-title`;
    const kept = '!!(history.state&&history.state.kanbanBack)';
    const topBack = () => backOut(page);
    const start = async (what) => {
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/start.html` });
      await waitFor(`document.title==='start'`, 8000);
      await send('Page.navigate', { url: `http://127.0.0.1:${port}/viewer.html` });
      await waitFor(`document.readyState==='complete'&&typeof window.q==='function'`, 8000);
      check(`${what}: the Board draws in the frame`, await frameWaitFor(`document.querySelectorAll('#board .column .card-el').length>0`, 25000) === true);
      await tapInFrame('.board-tab[data-col="todo"]');
      await frameWaitFor(`JSON.stringify([...document.querySelectorAll('#board .column')].map((c)=>c.dataset.col))==='["todo"]'`);
      await tapInFrame(titleOf(3));
      await outwaitDoubleTap();
      await tapInFrame(titleOf(7));
      check(`${what}: two taps select two cards, and the page keeps an entry of its own`, await frameWaitFor(`selectedIds.size===2&&${kept}`) === true, await inFrame(`JSON.stringify({n:selectedIds.size,s:history.state})`));
    };

    try {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

      await start('Clear');
      await tapInFrame('#selection-bar-clear');
      check('Clear empties the selection', await frameWaitFor('selectedIds.size===0') === true);
      check('the page takes its own entry off once nothing wants it', await frameWaitFor(`!(${kept})`) === true, await inFrame(`JSON.stringify(history.state)`));
      await topBack();
      check('one Back from the viewer leaves the frame\'s page', await waitFor(`document.title==='start'`, 6000), await ev('location.href'));

      await start('Back steps');
      await topBack();
      check('Back 1 steps the selection to one card, in the page', await frameWaitFor(`selectedIds.size===1&&${kept}`) === true && await ev('document.title') !== 'start');
      await topBack();
      check('Back 2 empties it, in the page', await frameWaitFor('selectedIds.size===0') === true && await ev('document.title') !== 'start');
      await topBack();
      check('Back 3 leaves', await waitFor(`document.title==='start'`, 6000), await ev('location.href'));
    } finally {
      try { await send('Emulation.setTouchEmulationEnabled', { enabled: false }); } catch (e) { /* the page is over */ }
      server.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
};

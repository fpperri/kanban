const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const graph = require('./browser/scenarios/graph');

// A click on empty space keeps the selection and a double click on it clears it (the
// page's own rule, held in empty-space-click.test.js). A browser scenario that wants
// a selection gone must therefore make a double click, two real clicks with the second
// one's click count 2. These tests hold the scenarios to that, without a browser: the
// Graph scenario is run against a stand-in page that keeps a selection by the page's
// rule, and every scenario's source is read for the click that cannot clear one.

const DIR = path.join(__dirname, 'browser', 'scenarios');
const ZOOM_CHECK = 'clicking a zoom button keeps a multi-selection';

const DOT = { x: 100, y: 100 };
const BACKGROUND = { x: 986, y: 786 };
const ZOOM_IN = { x: 200, y: 200 };
const STAGE = { x: 300, y: 300 };
const CANVAS = { l: 0, t: 0, r: 1000, b: 800 };
const FIRST = '7';

class Stop extends Error {}

// The Graph as the scenario sees it up to the zoom check: one dot, a background corner,
// a world that pans and zooms, and a selection that follows the page's click rule: a
// Ctrl+click on a dot toggles it, a plain click on it picks it alone, a single click on
// the background leaves the selection and a double click on it clears it. What the
// scenario reads that this does not model is answered `true`, which its checks may
// fail on; only the zoom check is read.
function graphPage() {
  const picked = new Set();
  const world = { x: 0, y: 0, k: 1 };
  const fitted = { ...world };
  let pan = null;
  const checks = [];
  const here = (p, x, y) => p.x === x && p.y === y;
  const sizeTest = /^selectedIds\.size(>=|===)(\d+)$/;
  const page = {
    checks,
    picked,
    sleep: async () => {},
    shot: async () => {},
    key: async () => {},
    send: async (method, params) => {
      if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseWheel') world.k *= params.deltaY < 0 ? 1.2 : 1 / 1.2;
    },
    open: async () => {},
    centre: async (sel) => {
      if (/graph-zoom-btn\[data-graph-action=in\]/.test(sel)) return ZOOM_IN;
      if (/graph-stage/.test(sel)) return STAGE;
      if (/graph-dot/.test(sel)) return DOT;
      return { x: 1, y: 1 };
    },
    mouse: async (type, x, y, extra = {}) => {
      if (type === 'mousePressed' && here(BACKGROUND, x, y)) pan = { x, y, wx: world.x, wy: world.y };
      else if (type === 'mouseMoved' && pan && extra.buttons === 1) { world.x = pan.wx + (x - pan.x); world.y = pan.wy + (y - pan.y); }
      else if (type === 'mouseReleased') pan = null;
    },
    click: async (x, y, extra = {}) => {
      if (here(DOT, x, y)) {
        const id = FIRST;
        if (extra.modifiers === 2) { if (picked.has(id)) picked.delete(id); else picked.add(id); }
        else { picked.clear(); picked.add(id); }
      } else if (here(BACKGROUND, x, y)) {
        if (extra.clickCount === 2) picked.clear();
      } else if (here(ZOOM_IN, x, y)) {
        world.k *= 1.2;
      }
    },
    waitFor: async (expr) => {
      const m = sizeTest.exec(expr);
      if (!m) return true;
      return m[1] === '>=' ? picked.size >= Number(m[2]) : picked.size === Number(m[2]);
    },
    ev: async (expr) => {
      if (expr === 'selectedIds.size') return picked.size;
      if (/graph-world/.test(expr) && /translate/.test(expr)) return { ...world };
      if (/graph-canvas/.test(expr) && /getBoundingClientRect/.test(expr)) return CANVAS;
      if (/querySelector\('\.graph-node'\)\.dataset\.id$/.test(expr)) return FIRST;
      if (/graph-zoom-btn\[data-graph-action=out\]'\)\.click\(\)$/.test(expr)) { world.k /= 1.2; return undefined; }
      if (/graph-zoom-btn\[data-graph-action=fit\]'\)\.click\(\)$/.test(expr)) { Object.assign(world, fitted); return undefined; }
      return true;
    },
    check: (name, ok, detail) => {
      checks.push([name, ok, detail]);
      if (name === ZOOM_CHECK) throw new Stop();
    },
  };
  return page;
}

async function runGraphToTheZoomCheck() {
  const page = graphPage();
  try { await graph.run(page); } catch (e) { if (!(e instanceof Stop)) throw e; }
  return page;
}

test('on the Graph, a Ctrl+click picks a card and the zoom button keeps it: the scenario brings no leftover selection into that check', async () => {
  const page = await runGraphToTheZoomCheck();
  const zoom = page.checks.find(([name]) => name === ZOOM_CHECK);
  assert.ok(zoom, 'the scenario reaches the zoom check');
  assert.strictEqual(zoom[1], true, JSON.stringify(zoom[2]));
  assert.strictEqual(zoom[2].selBefore, 1, 'one card is picked before the zoom button is clicked');
});

test('a pan keeps the selection, and then the scenario clears it with a double click on the empty background, the way the page does', async () => {
  const page = await runGraphToTheZoomCheck();
  const names = page.checks.map(([name]) => name);
  const pan = names.indexOf('a pan does not clear the selection (phantom click swallowed)');
  const cleared = names.indexOf('a double click on the empty canvas after a pan clears the selection');
  assert.ok(pan >= 0 && page.checks[pan][1], 'the pan keeps the selection');
  assert.ok(cleared > pan && names.indexOf(ZOOM_CHECK) > cleared, 'and the clear is checked before the zoom drive begins');
  assert.strictEqual(page.checks[cleared][1], true, 'the double click took the selection down');
});

test('a single click on the background of the stand-in leaves the selection, and a double click clears it', async () => {
  const page = graphPage();
  await page.click(DOT.x, DOT.y, { modifiers: 2 });
  await page.click(BACKGROUND.x, BACKGROUND.y);
  assert.strictEqual(page.picked.size, 1);
  await page.click(BACKGROUND.x, BACKGROUND.y, { clickCount: 1 });
  await page.click(BACKGROUND.x, BACKGROUND.y, { clickCount: 2 });
  assert.strictEqual(page.picked.size, 0);
});

test('no scenario takes a selection down with a synthetic click on the body: it has no click count, so the page never reads it as a double click', () => {
  const files = [DIR, path.join(DIR, 'phone-steps'), path.join(DIR, 'phone-flip-steps')]
    .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => path.relative(DIR, path.join(d, f))));
  assert.ok(files.length >= 19, files.join(', '));
  for (const f of files) {
    const text = fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/document\.body\.click\(\)/.test(text), `${f} clicks the body with no click count`);
  }
});

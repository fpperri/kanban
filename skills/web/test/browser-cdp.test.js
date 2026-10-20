const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { connectCdp, makePage, createBrowserEnv, consoleErrorsFrom } = require('./browser/cdp');

// The page driver of the browser runner, tested against a stand-in for the
// DevTools socket and for the page: what is sent, what comes back, what happens
// when the socket closes or does not answer. Nothing here opens a socket.

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen && this.onopen());
  }

  send(data) {
    const msg = JSON.parse(data);
    this.sent.push(msg);
    if (FakeSocket.reply) FakeSocket.reply(msg, (m) => this.onmessage({ data: JSON.stringify(m) }));
  }

  close() { if (this.onclose) this.onclose(); }

  push(m) { this.onmessage({ data: JSON.stringify(m) }); }
}
const connect = (opts) => connectCdp('ws://stand-in', { WebSocketImpl: FakeSocket, ...opts });
const answer = (result) => (msg, reply) => reply({ id: msg.id, result });

test('a call resolves with the result the browser answers with', async () => {
  FakeSocket.reply = answer({ ok: 1 });
  const cdp = await connect();
  assert.deepStrictEqual(await cdp.send('Page.enable', { x: 1 }), { ok: 1 });
  assert.deepStrictEqual(FakeSocket.last.sent[0].method, 'Page.enable');
  assert.deepStrictEqual(FakeSocket.last.sent[0].params, { x: 1 });
});

test('a call the browser refuses rejects with the method and the error', async () => {
  FakeSocket.reply = (msg, reply) => reply({ id: msg.id, error: { message: 'nope' } });
  const cdp = await connect();
  await assert.rejects(cdp.send('Page.navigate'), /Page\.navigate: .*nope/);
});

test('a call waiting when the socket closes rejects at once instead of hanging', async () => {
  FakeSocket.reply = null;
  const cdp = await connect({ callTimeoutMs: 20000 });
  const pending = cdp.send('Runtime.evaluate');
  const t0 = Date.now();
  FakeSocket.last.close();
  await assert.rejects(pending, /socket closed/);
  assert.ok(Date.now() - t0 < 1000);
});

test('a call nobody answers rejects after its timeout', async () => {
  FakeSocket.reply = null;
  const cdp = await connect({ callTimeoutMs: 30 });
  await assert.rejects(cdp.send('Runtime.evaluate'), /no answer in 0\.03s/);
});

test('a call on a closed socket rejects', async () => {
  FakeSocket.reply = null;
  const cdp = await connect();
  FakeSocket.last.close();
  await assert.rejects(cdp.send('Page.enable'), /socket closed/);
});

test('closed settles with a reason when the socket closes', async () => {
  FakeSocket.reply = null;
  const cdp = await connect();
  FakeSocket.last.close();
  assert.match(await cdp.closed, /DevTools socket closed/);
});

test('events are kept until they are taken, and taking them empties the list', async () => {
  FakeSocket.reply = null;
  const cdp = await connect();
  FakeSocket.last.push({ method: 'Log.entryAdded', params: { entry: { level: 'error' } } });
  FakeSocket.last.push({ method: 'Page.loadEventFired', params: {} });
  assert.deepStrictEqual(cdp.takeEvents().map((e) => e.method), ['Log.entryAdded', 'Page.loadEventFired']);
  assert.deepStrictEqual(cdp.takeEvents(), []);
});

test('dropEvents takes out the events that match and leaves the rest, answering how many went', async () => {
  FakeSocket.reply = null;
  const cdp = await connect();
  FakeSocket.last.push({ method: 'Log.entryAdded', params: { entry: { level: 'error', n: 1 } } });
  FakeSocket.last.push({ method: 'Page.loadEventFired', params: {} });
  FakeSocket.last.push({ method: 'Log.entryAdded', params: { entry: { level: 'error', n: 2 } } });
  assert.strictEqual(cdp.dropEvents((e) => e.method === 'Log.entryAdded' && e.params.entry.n === 1), 1);
  assert.deepStrictEqual(cdp.takeEvents().map((e) => e.method), ['Page.loadEventFired', 'Log.entryAdded']);
});

test('ev evaluates an expression in the page and answers its value', async () => {
  FakeSocket.reply = answer({ result: { value: 42 } });
  const cdp = await connect();
  assert.strictEqual(await cdp.ev('6*7'), 42);
  const sent = FakeSocket.last.sent[0];
  assert.strictEqual(sent.method, 'Runtime.evaluate');
  assert.deepStrictEqual([sent.params.expression, sent.params.returnByValue, sent.params.awaitPromise], ['6*7', true, true]);
});

test('ev throws when the page throws', async () => {
  FakeSocket.reply = answer({ exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: nope is not defined' } } });
  const cdp = await connect();
  await assert.rejects(cdp.ev('nope'), /eval: .*ReferenceError/);
});

// A page over a stand-in for the connection.
function fakeCdp(values = {}) {
  const calls = [];
  return {
    calls,
    async send(method, params) { calls.push([method, params]); return values[method] || {}; },
    async ev(expr) {
      calls.push(['ev', expr]);
      return typeof values.ev === 'function' ? values.ev(expr) : values.ev;
    },
    takeEvents() { return []; },
  };
}
const livePage = (cdp, extra = {}) => {
  const scope = { aborted: false };
  const checks = [];
  const page = makePage({ cdp, base: 'http://127.0.0.1:7000', scope, check: (...a) => checks.push(a), ...extra });
  return { page, scope, checks };
};

test('open goes to a path on the board the scenario is driving', async () => {
  const cdp = fakeCdp();
  const { page } = livePage(cdp);
  await page.open('/?view=graph');
  assert.deepStrictEqual(cdp.calls[0], ['Page.navigate', { url: 'http://127.0.0.1:7000/?view=graph' }]);
});

test('a key press goes to the page as a key down then a key up, with its modifiers', async () => {
  const cdp = fakeCdp();
  const { page } = livePage(cdp);
  await page.key('k', { ctrl: true, shift: true });
  assert.deepStrictEqual(cdp.calls.map((c) => [c[0], c[1].type, c[1].modifiers]), [
    ['Input.dispatchKeyEvent', 'keyDown', 10], ['Input.dispatchKeyEvent', 'keyUp', 10]]);
});

test('a right-click on a selector evaluates a contextmenu dispatch in the page', async () => {
  const cdp = fakeCdp({ ev: true });
  const { page } = livePage(cdp);
  await page.rightClick('.graph-node[data-id="3"]');
  assert.match(cdp.calls[0][1], /contextmenu/);
  assert.match(cdp.calls[0][1], /graph-node\[data-id=\\"3\\"\]/);
});

test('a right-click on an element that is not there throws and says which', async () => {
  const { page } = livePage(fakeCdp({ ev: false }));
  await assert.rejects(page.rightClick('.missing'), /right-click: nothing matches \.missing/);
});

test('a click is a press and a release at the point, with the extra fields', async () => {
  const cdp = fakeCdp();
  const { page } = livePage(cdp);
  await page.click(10, 20, { modifiers: 2 });
  assert.deepStrictEqual(cdp.calls.map((c) => [c[1].type, c[1].x, c[1].y, c[1].modifiers]), [['mousePressed', 10, 20, 2], ['mouseReleased', 10, 20, 2]]);
});

test('waitFor answers true as soon as the expression holds, and false when it never does', async () => {
  let n = 0;
  const { page } = livePage(fakeCdp({ ev: () => ++n >= 3 }));
  assert.strictEqual(await page.waitFor('x', 2000), true);
  const never = livePage(fakeCdp({ ev: false })).page;
  assert.strictEqual(await never.waitFor('x', 120), false);
});

test('waitUntil throws, naming what it waited for, when the time runs out', async () => {
  const { page } = livePage(fakeCdp());
  await assert.rejects(page.waitUntil(() => false, 80, 'the board to settle'), /timed out waiting for the board to settle/);
});

test('once the scenario is over, every call on its page throws so a cut-off scenario unwinds', async () => {
  const cdp = fakeCdp({ ev: true });
  const { page, scope } = livePage(cdp);
  scope.aborted = true;
  await assert.rejects(page.ev('1'), /scenario is over/);
  await assert.rejects(page.send('Page.enable'), /scenario is over/);
  await assert.rejects(page.sleep(5), /scenario is over/);
  await assert.rejects(page.waitFor('x', 1000), /scenario is over/);
  await assert.rejects(page.key('a'), /scenario is over/);
  assert.deepStrictEqual(cdp.calls, []);
});

test('a scenario that ends while it waits unwinds at its next step', async () => {
  const { page, scope } = livePage(fakeCdp({ ev: false }));
  const waiting = page.waitFor('x', 5000);
  setTimeout(() => { scope.aborted = true; }, 60);
  const t0 = Date.now();
  await assert.rejects(waiting, /scenario is over/);
  assert.ok(Date.now() - t0 < 1500);
});

const tmps = [];
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }); });

test('shot saves a numbered screenshot named for its scenario, and does nothing without a folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-shots-'));
  tmps.push(dir);
  const png = Buffer.from('not really a png').toString('base64');
  const cdp = fakeCdp({ 'Page.captureScreenshot': { data: png } });
  const { page } = livePage(cdp, { shotsDir: dir, scenario: 'graph' });
  await page.shot('tiers');
  await page.shot('force');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['graph-01-tiers.png', 'graph-02-force.png']);
  const none = livePage(fakeCdp(), { scenario: 'graph' });
  await none.page.shot('tiers');
});

// The browser side of the scenario loop.
function envFixture({ resetBoard = () => {}, shotsDir = null, chromeExited = new Promise(() => {}), refuseReset = 0, historyResetMs } = {}) {
  const order = [];
  const cdp = fakeCdp();
  const send = cdp.send;
  let refused = 0;
  cdp.send = async (m, p) => {
    order.push(`send:${m}`);
    if (m === 'Page.resetNavigationHistory' && refused < refuseReset) {
      refused++;
      throw new Error('Page.resetNavigationHistory: {"code":-32000,"message":"Not attached to an active page"}');
    }
    return send(m, p);
  };
  cdp.takeEvents = () => { order.push('takeEvents'); return []; };
  cdp.closed = new Promise(() => {});
  const env = createBrowserEnv({
    cdp, shotsDir, chromeExited,
    boards: { fixture: { base: 'http://127.0.0.1:7001' }, plan: { base: 'http://127.0.0.1:7002' } },
    resetBoard: (key) => { order.push(`reset:${key}`); return resetBoard(key); },
    historyResetMs,
  });
  return { env, cdp, order };
}

test('a scenario begins with the old page gone, its board\'s browser storage cleared and the board put back', async () => {
  const { env, cdp, order } = envFixture();
  await env.begin({ name: 'smoke', board: 'plan' }, { check() {}, scope: { aborted: false } });
  assert.deepStrictEqual(cdp.calls[0], ['Page.navigate', { url: 'about:blank' }]);
  assert.strictEqual(cdp.calls[1][0], 'Page.resetNavigationHistory', 'the tab history is emptied, so history counts do not depend on run order');
  const clear = cdp.calls.find((c) => c[0] === 'Storage.clearDataForOrigin');
  assert.deepStrictEqual(clear[1], { origin: 'http://127.0.0.1:7002', storageTypes: 'all' });
  assert.ok(order.indexOf('send:Page.navigate') < order.indexOf('reset:plan'), order.join(' '));
  assert.ok(order.indexOf('send:Storage.clearDataForOrigin') < order.indexOf('takeEvents'));
});

test('a scenario begins with the page emulated as focused, so a focus() fires its focus event in a tab nobody has clicked in, whatever ran before', async () => {
  const { env, cdp, order } = envFixture();
  const ctx = { check() {}, scope: { aborted: false } };
  await env.begin({ name: 'smoke', board: 'plan' }, ctx);
  assert.deepStrictEqual(cdp.calls.filter((c) => c[0] === 'Emulation.setFocusEmulationEnabled'), [['Emulation.setFocusEmulationEnabled', { enabled: true }]]);
  assert.ok(order.indexOf('send:Emulation.setFocusEmulationEnabled') < order.indexOf('takeEvents'), order.join(' '));
  await env.begin({ name: 'graph', board: 'fixture' }, ctx);
  assert.strictEqual(cdp.calls.filter((c) => c[0] === 'Emulation.setFocusEmulationEnabled').length, 2, 'every scenario starts with it, not only the first');
});

test('a scenario begins with touch emulation off, so one that turned it on does not leak it into the next, and the page names its boards', async () => {
  const { env, cdp, order } = envFixture();
  const ctx = { check() {}, scope: { aborted: false } };
  const page = await env.begin({ name: 'smoke', board: 'plan' }, ctx);
  assert.deepStrictEqual(cdp.calls.filter((c) => c[0] === 'Emulation.setTouchEmulationEnabled'), [['Emulation.setTouchEmulationEnabled', { enabled: false }]]);
  assert.ok(order.indexOf('send:Emulation.setTouchEmulationEnabled') < order.indexOf('takeEvents'), order.join(' '));
  assert.deepStrictEqual(page.bases, { plan: 'http://127.0.0.1:7002' });
  await env.begin({ name: 'graph', board: 'fixture' }, ctx);
  assert.strictEqual(cdp.calls.filter((c) => c[0] === 'Emulation.setTouchEmulationEnabled').length, 2, 'every scenario starts with it');
});

test('a history reset Chrome refuses while it swaps the page in is tried again until it takes', async () => {
  const { env, order } = envFixture({ refuseReset: 2 });
  await env.begin({ name: 'smoke', board: 'plan' }, { check() {}, scope: { aborted: false } });
  assert.strictEqual(order.filter((o) => o === 'send:Page.resetNavigationHistory').length, 3);
  assert.ok(order.lastIndexOf('send:Page.resetNavigationHistory') < order.indexOf('reset:plan'), order.join(' '));
});

test('a history reset still refused when the time is up fails the scenario', async () => {
  const { env } = envFixture({ refuseReset: Infinity, historyResetMs: 200 });
  await assert.rejects(
    env.begin({ name: 'smoke', board: 'plan' }, { check() {}, scope: { aborted: false } }),
    /Not attached to an active page/,
  );
});

test('each scenario drives the base of its own board', async () => {
  const { env } = envFixture();
  const page = await env.begin({ name: 'graph', board: 'fixture' }, { check() {}, scope: { aborted: false } });
  assert.strictEqual(page.base, 'http://127.0.0.1:7001');
  const other = await env.begin({ name: 'smoke', board: 'plan' }, { check() {}, scope: { aborted: false } });
  assert.strictEqual(other.base, 'http://127.0.0.1:7002');
});

test('a scenario naming a board the run did not start is refused', async () => {
  const { env } = envFixture();
  await assert.rejects(env.begin({ name: 'x', board: 'nope' }, { check() {}, scope: {} }), /scenario 'x' names board 'nope'/);
});

test('console errors are the exceptions, the console.error calls and the error log entries, and nothing else', () => {
  const events = [
    { method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'Uncaught' } } },
    { method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [] } },
    { method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [] } },
    { method: 'Log.entryAdded', params: { entry: { level: 'error', text: 'bad' } } },
    { method: 'Log.entryAdded', params: { entry: { level: 'warning', text: 'meh' } } },
    { method: 'Page.loadEventFired', params: {} },
  ];
  assert.strictEqual(consoleErrorsFrom(events).length, 3);
});

test('the run sees Chrome as gone when its process exits, with the reason', async () => {
  let exit;
  const { env } = envFixture({ chromeExited: new Promise((r) => { exit = r; }) });
  exit('killed by SIGKILL');
  assert.match(await env.gone, /Chrome killed by SIGKILL/);
});

test('the run sees Chrome as gone when the DevTools socket closes', async () => {
  let close;
  const cdp = fakeCdp();
  cdp.closed = new Promise((r) => { close = r; });
  const env = createBrowserEnv({ cdp, boards: {}, resetBoard() {}, chromeExited: new Promise(() => {}) });
  close('the DevTools socket closed');
  assert.match(await env.gone, /DevTools socket closed/);
});

test('a failed scenario leaves a screenshot named FAIL for it when screenshots are on', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-shots-'));
  tmps.push(dir);
  const { env, cdp } = envFixture({ shotsDir: dir });
  const realSend = cdp.send;
  cdp.send = async (m, p) => (m === 'Page.captureScreenshot' ? { data: Buffer.from('x').toString('base64') } : realSend(m, p));
  await env.end({ name: 'smoke', board: 'plan' }, { status: 'FAIL' });
  assert.deepStrictEqual(fs.readdirSync(dir), ['FAIL-smoke.png']);
  await env.end({ name: 'graph', board: 'fixture' }, { status: 'PASS' });
  assert.deepStrictEqual(fs.readdirSync(dir), ['FAIL-smoke.png']);
});

test('a page tells its scenario whether screenshots are on', () => {
  assert.strictEqual(livePage(fakeCdp(), { shotsDir: os.tmpdir() }).page.shotsOn, true);
  assert.strictEqual(livePage(fakeCdp()).page.shotsOn, false);
});

test('a scenario that names more boards gets each one cleared and put back, and can open a path on any of them', async () => {
  const resets = [];
  const { env, cdp } = envFixture({ resetBoard: (k) => { resets.push(k); } });
  const page = await env.begin({ name: 'smoke', board: 'plan', alsoBoards: ['fixture'] }, { check() {}, scope: { aborted: false } });
  const cleared = cdp.calls.filter((c) => c[0] === 'Storage.clearDataForOrigin').map((c) => c[1].origin).sort();
  assert.deepStrictEqual(cleared, ['http://127.0.0.1:7001', 'http://127.0.0.1:7002']);
  assert.deepStrictEqual(resets.sort(), ['fixture', 'plan']);
  assert.strictEqual(page.base, 'http://127.0.0.1:7002');
  assert.strictEqual(page.baseOf('fixture'), 'http://127.0.0.1:7001');
  await page.open('/?view=map', 'fixture');
  const nav = cdp.calls.filter((c) => c[0] === 'Page.navigate').pop();
  assert.deepStrictEqual(nav[1], { url: 'http://127.0.0.1:7001/?view=map' });
  assert.throws(() => page.baseOf('malformed'), /scenario 'smoke' did not name board 'malformed'/);
});

const refusal = (status, url) => ({ method: 'Log.entryAdded', params: { entry: { source: 'network', level: 'error', text: `Failed to load resource: the server responded with a status of ${status} (Unprocessable Entity)`, url } } });

test('expectRefusedRequest takes the named refusal out of the console errors and leaves any other, so the scenario\'s console check still sees it', async () => {
  const events = [refusal(422, 'http://127.0.0.1:7000/api/cards/4'), refusal(500, 'http://127.0.0.1:7000/api/cards/4'), refusal(422, 'http://127.0.0.1:7000/api/cards/9')];
  const cdp = fakeCdp();
  cdp.dropEvents = (match) => { const n = events.length; const kept = events.filter((e) => !match(e)); events.length = 0; events.push(...kept); return n - kept.length; };
  const { page } = livePage(cdp);
  assert.strictEqual(await page.expectRefusedRequest(422, '/api/cards/4', 50), true);
  assert.deepStrictEqual(consoleErrorsFrom(events).length, 2, 'the 500 and the other card\'s 422 are still errors');
  assert.strictEqual(await page.expectRefusedRequest(422, '/api/cards/4', 50), false, 'a refusal that never came is not found');
});

const { test, after } = require('node:test');
const assert = require('node:assert');

const { createRegistry, isAlive, waitForPageTarget, startChromeUntilPage } = require('./browser/harness');

// The CI browser job once died before its first scenario: "timed out waiting for
// Chrome to expose a page target", twenty seconds in, with nothing printed and no
// way to tell a Chrome that was slow from one whose DevTools port never opened.
// The runner now says what the port answered and what Chrome printed, and starts
// Chrome a second time, on a port and profile of its own, when the first stays up
// without listing a page. These tests stand in for the DevTools port with a
// function and for Chrome with a node child that sleeps; no browser starts here.

const SLEEPER = ['-e', 'setInterval(() => {}, 1000)'];
const FAST = { ms: 150, pollMs: 5 };
const PAGE = { type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/1' };
const quiet = () => {};

const registries = [];
after(() => { for (const r of registries) r.cleanupSync(); });
const registry = () => { const r = createRegistry(); registries.push(r); return r; };

const alive = (out = '') => ({ child: { exitCode: null, signalCode: null }, out });

test('the first page the DevTools port lists is the one answered', async () => {
  const page = await waitForPageTarget({ rec: alive(), port: 9222, ...FAST, targets: async () => [{ type: 'service_worker' }, PAGE] });
  assert.strictEqual(page, PAGE);
});

test('a port that refuses at first is asked again until it lists a page', async () => {
  let asked = 0;
  const targets = async () => {
    asked += 1;
    if (asked < 3) throw new Error('ECONNREFUSED');
    return [PAGE];
  };
  assert.strictEqual(await waitForPageTarget({ rec: alive(), port: 9222, ...FAST, targets }), PAGE);
  assert.strictEqual(asked, 3);
});

test('a port that never answers ends in an error that names the port, says so, and quotes what Chrome printed', async () => {
  const refuse = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    waitForPageTarget({ rec: alive('Cannot start http server for devtools.\n'), port: 41234, ...FAST, targets: refuse }),
    (e) => e.noPageTarget === true
      && /timed out waiting for Chrome to expose a page target/.test(e.message)
      && e.message.includes('41234') && /never answered/.test(e.message)
      && e.message.includes('Cannot start http server for devtools.'),
  );
});

test('a port that answers with no page says what it listed', async () => {
  await assert.rejects(
    waitForPageTarget({ rec: alive(), port: 9222, ...FAST, targets: async () => [{ type: 'browser' }, { type: 'service_worker' }] }),
    (e) => e.noPageTarget === true && /answered with browser, service_worker/.test(e.message) && /printed nothing/.test(e.message),
  );
  await assert.rejects(
    waitForPageTarget({ rec: alive(), port: 9222, ...FAST, targets: async () => [] }),
    (e) => /answered with no targets/.test(e.message),
  );
});

test('a Chrome that has exited is reported as exited, and is not marked for another start', async () => {
  const gone = { child: { exitCode: 1, signalCode: null }, out: 'crashed' };
  await assert.rejects(
    waitForPageTarget({ rec: gone, port: 9222, ...FAST, targets: async () => [] }),
    (e) => /Chrome exited early: crashed/.test(e.message) && !e.noPageTarget,
  );
});

// A launch that starts a sleeper in place of Chrome, on a port and profile of its own for each start.
function launcher(reg, behaviours) {
  const started = [];
  const launch = async (n) => {
    const rec = reg.spawn(`chrome-${n}`, process.execPath, SLEEPER);
    await new Promise((resolve, reject) => { rec.child.once('spawn', resolve); rec.child.once('error', reject); });
    started.push({ n, rec, port: 40000 + n });
    return { rec, port: 40000 + n };
  };
  const targets = async (port) => behaviours[port - 40000]();
  return { launch, targets, started };
}

test('a Chrome that stays up without a page is ended, and a second one is started and answered', async () => {
  const reg = registry();
  const noPage = async () => [];
  const { launch, targets, started } = launcher(reg, { 1: noPage, 2: async () => [PAGE] });
  const log = [];
  const got = await startChromeUntilPage({ launch, targets, log: (l) => log.push(l), ...FAST });
  assert.strictEqual(got.page, PAGE);
  assert.strictEqual(got.port, 40002);
  assert.strictEqual(got.rec, started[1].rec);
  assert.deepStrictEqual(started.map((s) => s.n), [1, 2], 'the second start has its own number, so its own port and profile');
  assert.ok(!isAlive(started[0].rec.child.pid), 'the first Chrome is still running');
  assert.ok(isAlive(started[1].rec.child.pid), 'the Chrome that answered must stay up');
  assert.strictEqual(log.length, 1);
  assert.match(log[0], /timed out waiting for Chrome to expose a page target/);
  assert.match(log[0], /starting Chrome again/);
  await reg.cleanup();
});

test('a Chrome that lists its page at once is started once', async () => {
  const reg = registry();
  const { launch, targets, started } = launcher(reg, { 1: async () => [PAGE] });
  const got = await startChromeUntilPage({ launch, targets, log: quiet, ...FAST });
  assert.strictEqual(got.page, PAGE);
  assert.strictEqual(started.length, 1);
  await reg.cleanup();
});

test('after the last start the run gives up with the error of that start, and no Chrome is left up', async () => {
  const reg = registry();
  const { launch, targets, started } = launcher(reg, { 1: async () => [], 2: async () => [] });
  await assert.rejects(
    startChromeUntilPage({ launch, targets, starts: 2, log: quiet, ...FAST }),
    (e) => e.noPageTarget === true && /timed out waiting for Chrome to expose a page target/.test(e.message) && e.message.includes('40002'),
  );
  assert.strictEqual(started.length, 2);
  for (const s of started) assert.ok(!isAlive(s.rec.child.pid), `Chrome start ${s.n} is still running`);
  await reg.cleanup();
});

test('a Chrome that exits is not started again', async () => {
  const reg = registry();
  let launched = 0;
  const launch = async () => {
    launched += 1;
    const rec = reg.spawn('chrome', process.execPath, ['-e', 'process.exit(1)']);
    await rec.exited;
    return { rec, port: 40001 };
  };
  await assert.rejects(startChromeUntilPage({ launch, targets: async () => [], log: quiet, ...FAST }), /Chrome exited early/);
  assert.strictEqual(launched, 1);
  await reg.cleanup();
});

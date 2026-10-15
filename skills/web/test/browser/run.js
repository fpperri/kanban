#!/usr/bin/env node
'use strict';
// Browser test for the web app: named scenarios, each on a fixture board.
//
// Serves a copy of each board the chosen scenarios name (see boards.js) with
// skills/web/scripts/server.js, one server per board, launches one headless
// Chrome (or Edge/Chromium) and drives the real page over the Chrome DevTools
// Protocol. Every scenario starts from a cleared browser and its board's cards
// as they were, has its own timeout and console-error check, and is recorded
// as PASS or FAIL under its name: a scenario that throws does not stop the rest.
// No dependencies; needs Node >= 22 (global fetch and WebSocket).
//
// Run:    npm run test:browser
//         node skills/web/test/browser/run.js [--only <name>[,<name>]] [--reverse]
//                                             [--shots <dir>] [--list] [--plugin <dir>]
// Chrome: found automatically; set CHROME_PATH to override or to point at a
//         browser in a non-standard place. Chrome keeps its sandbox; set
//         KANBAN_BROWSER_NO_SANDBOX=1 where the system refuses it (CI).
//         A Chrome that stays up without listing a page in 20s is ended and started
//         once more on a new port and profile; the error says what its port answered
//         and what it printed.
// --only  runs those scenarios alone; --reverse runs them last to first, which
//         gives the same results; --list prints the names.
// --shots saves a screenshot per step, and one for each scenario that fails.
// --plugin serves the boards with the server of another checkout of the plugin, and the
//         page that server serves, so a scenario can show that a board written for this
//         plugin opens on an older one (CI runs the smoke scenario on main's checkout).
// --fault throw:<name> makes that scenario throw; --fault kill-chrome kills
//         Chrome mid-run. They exist for fault-check.js, which proves both are
//         reported and cleaned up.
// Exit:   0 all scenarios passed, 1 a scenario failed, 2 no browser found,
//         3 harness error.
//
// Deliberately NOT part of `npm test`: it needs a real browser and takes a
// while, so it lives outside the skills/web/test/*.test.js glob. Its parts that
// need no browser are tested there (browser-*.test.js).

const fs = require('fs');
const net = require('net');
const path = require('path');
const {
  EXIT, DEFAULT_TIMEOUT_MS, parseArgs, serverScriptOf, selectScenarios, chromeArgs, createRegistry, runScenarios, withFault,
  exitCodeFor, summaryLines, boardsOf, sleep, startChromeUntilPage,
} = require('./harness');
const { connectCdp, createBrowserEnv } = require('./cdp');
const { BOARDS, materialize } = require('./boards');
const scenarios = require('./scenarios');

const IS_WIN = process.platform === 'win32';
const WATCHDOG_MS = 300000;
const KILL_CHROME_AFTER_MS = 1500;

function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) return fs.existsSync(env) ? env : null;
  const cands = [];
  if (IS_WIN) {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      cands.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      cands.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  }
  for (const c of cands) if (fs.existsSync(c)) return c;
  if (!IS_WIN) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge']) {
        const p = path.join(dir, n);
        try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* next */ }
      }
    }
  }
  return null;
}

function freePorts(n) {
  const servers = [];
  const ports = [];
  const one = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { ports.push(s.address().port); servers.push(s); resolve(); });
  });
  return (async () => {
    for (let i = 0; i < n; i++) await one();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    return ports;
  })();
}

async function waitUntil(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

let registry = null;
const exited = (rec) => rec.child.exitCode !== null || rec.child.signalCode !== null;

async function startServer(serverJs, key, boardDir, port) {
  const rec = registry.spawn(`server-${key}`, process.execPath, [serverJs, boardDir, String(port)]);
  const base = `http://127.0.0.1:${port}`;
  await waitUntil(async () => {
    if (exited(rec)) throw new Error(`the ${key} server exited early: ${rec.out}`);
    try { return (await fetch(`${base}/`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch (e) { return false; }
  }, 15000, `the ${key} server to answer HTTP 200`);
  const board = await (await fetch(`${base}/api/board`, { signal: AbortSignal.timeout(5000) })).json();
  if (board.projectName !== BOARDS[key].name) {
    throw new Error(`port ${port} is serving board '${board.projectName}', not the ${key} board '${BOARDS[key].name}'`);
  }
  return base;
}

// Each start gets a debug port and a profile of its own, chosen when it starts, so a
// second start after a Chrome that never listed a page cannot meet what held the first.
async function startChrome(chrome, root) {
  const { rec, page } = await startChromeUntilPage({
    launch: async (n) => {
      const [port] = await freePorts(1);
      const rec = registry.spawn(n === 1 ? 'chrome' : `chrome-${n}`, chrome, chromeArgs({ cdpPort: port, profileDir: path.join(root, `profile-${n}`) }));
      return { rec, port };
    },
  });
  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  return { rec, cdp };
}

async function main(argv) {
  const args = parseArgs(argv);
  const picked = withFault(selectScenarios(scenarios, args), args.fault);
  if (args.list) {
    console.log(scenarios.map((s) => s.name).join('\n'));
    return EXIT.OK;
  }
  const serverJs = serverScriptOf(args.plugin);
  const chrome = findChrome();
  if (!chrome) {
    console.error('No Chrome/Chromium/Edge found: set CHROME_PATH to a browser executable.');
    return EXIT.NO_BROWSER;
  }
  if (typeof WebSocket === 'undefined') throw new Error('Node >= 22 is required (global WebSocket)');
  if (args.shots) fs.mkdirSync(args.shots, { recursive: true });

  const keys = [...new Set(picked.flatMap(boardsOf))];
  const boardPorts = await freePorts(keys.length);
  registry = createRegistry();
  const root = registry.tmpDir('kanban-browser-');
  const dirs = {};
  const ports = {};
  const boards = {};
  for (const [i, key] of keys.entries()) {
    dirs[key] = path.join(root, `board-${key}`);
    ports[key] = boardPorts[i];
    materialize(key, dirs[key], { port: ports[key] });
    boards[key] = { base: await startServer(serverJs, key, dirs[key], ports[key]) };
  }
  const { rec: chromeRec, cdp } = await startChrome(chrome, root);

  const env = createBrowserEnv({
    cdp, boards, shotsDir: args.shots, chromeExited: chromeRec.exited,
    resetBoard: (key) => materialize(key, dirs[key], { port: ports[key] }),
  });
  if (args.fault && args.fault.kind === 'kill-chrome') {
    const begin = env.begin.bind(env);
    let armed = false;
    env.begin = async (sc, ctx) => {
      const page = await begin(sc, ctx);
      if (!armed) {
        armed = true;
        setTimeout(() => { try { process.kill(chromeRec.child.pid, 'SIGKILL'); } catch (e) { /* already gone */ } }, KILL_CHROME_AFTER_MS);
      }
      return page;
    };
  }

  const results = await runScenarios(picked, env, { timeoutMs: DEFAULT_TIMEOUT_MS });
  for (const line of summaryLines(results)) console.log(line);
  cdp.close();
  return exitCodeFor(results);
}

async function finish(code) {
  const problems = registry ? await registry.cleanup() : [];
  for (const p of problems) console.log(`WARNING: ${p}`);
  process.exit(code);
}

process.on('exit', () => { if (registry) registry.cleanupSync(); });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => finish(130));
const fatal = (e) => {
  console.error(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  return finish(EXIT.HARNESS);
};
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);
setTimeout(() => fatal(new Error(`the run took longer than ${WATCHDOG_MS / 1000}s`)), WATCHDOG_MS).unref();

main(process.argv.slice(2)).then(finish, (e) => {
  console.error(`HARNESS ERROR: ${e && e.message ? e.message : e}`);
  return finish(EXIT.HARNESS);
});

#!/usr/bin/env node
'use strict';
// Proves the browser runner's two failure paths against a real Chrome:
//
//   a scenario forced to throw    reported FAIL under its name, the other scenario
//                                 still runs, the run exits non-zero
//   Chrome killed mid-run         the run exits non-zero within the time limit and
//                                 leaves no Chrome, no server and no temporary
//                                 board copy behind; the scenario it runs kills
//                                 Chrome once it has started and then waits, so
//                                 the run cannot end before the kill lands
//
// It runs run.js with the --fault flag in a temporary folder of its own, so
// whatever is left in that folder, or running on it, is the runner's doing.
// Needs the same Chrome run.js needs; CI runs it after the scenarios.
//
//   node test/web/browser/fault-check.js
//
// Exit: 0 both paths behave, 1 one does not.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RUN_JS = path.join(__dirname, 'run.js');
const TMP_PREFIX = 'kanban-browser-';
const KILLED_CHROME_LIMIT_MS = 30000;
const RUN_LIMIT_MS = 240000;
const SETTLE_MS = 5000;

// What the runner left in `tmpRoot`: board copies by their folder name, and
// the processes whose command line names one of those folders (Chrome's
// profile, a server's board). The process table is /proc, so it is checked
// on Linux only; elsewhere checkedProcesses says so.
function findLeftovers({ tmpRoot, procDir = '/proc' }) {
  const dirs = fs.existsSync(tmpRoot) ? fs.readdirSync(tmpRoot).filter((n) => n.startsWith(TMP_PREFIX)) : [];
  const processes = [];
  const checkedProcesses = fs.existsSync(procDir) && fs.readdirSync(procDir).some((n) => /^\d+$/.test(n));
  if (checkedProcesses) {
    const needle = path.join(tmpRoot, TMP_PREFIX);
    for (const name of fs.readdirSync(procDir).filter((n) => /^\d+$/.test(n))) {
      let cmd;
      try { cmd = fs.readFileSync(path.join(procDir, name, 'cmdline'), 'utf8').split('\0').join(' ').trim(); } catch (e) { continue; }
      if (cmd.includes(needle)) processes.push({ pid: Number(name), cmd });
    }
  }
  return { dirs, processes, checkedProcesses };
}

function leftoverProblems(leftovers) {
  const out = leftovers.dirs.map((d) => `a temporary board copy is left behind: ${d}`);
  for (const p of leftovers.processes) out.push(`a process is left running (pid ${p.pid}): ${p.cmd.slice(0, 160)}`);
  return out;
}

function problemsForForcedThrow({ code, out, leftovers }) {
  const problems = [];
  if (code === 0) problems.push('the run exited 0 although a scenario was forced to fail');
  if (!/^FAIL +graph\b.*forced to fail/m.test(out)) problems.push('graph is not reported FAIL under its name');
  if (!/^PASS +smoke\b/m.test(out)) problems.push('smoke did not run and pass after graph failed');
  return problems.concat(leftoverProblems(leftovers));
}

function problemsForKilledChrome({ code, out, ms, limitMs, leftovers }) {
  const problems = [];
  if (code === 0) problems.push('the run exited 0 although Chrome was killed');
  if (ms > limitMs) problems.push(`the run took ${ms / 1000}s to end, past the ${limitMs / 1000}s limit`);
  if (!/Chrome is gone/.test(out)) problems.push('the run does not say that Chrome is gone');
  if (/HARNESS ERROR/.test(out)) problems.push('the run ended in a harness error instead of failing the scenario');
  return problems.concat(leftoverProblems(leftovers));
}

function runRunner(args, tmpRoot) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = { ...process.env, TMPDIR: tmpRoot, TEMP: tmpRoot, TMP: tmpRoot, KANBAN_BROWSER_CPU_THROTTLE: '1' };
    const child = spawn(process.execPath, [RUN_JS, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\nfault-check: the runner did not end, killing it\n'; child.kill('SIGKILL'); }, RUN_LIMIT_MS);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code: code === null ? 137 : code, out, ms: Date.now() - t0 }); });
  });
}

// Leftovers may take a moment to go (Chrome's helpers), so look until clean or out of time.
async function settledLeftovers(tmpRoot) {
  const t0 = Date.now();
  let found = findLeftovers({ tmpRoot });
  while ((found.dirs.length || found.processes.length) && Date.now() - t0 < SETTLE_MS) {
    await new Promise((r) => setTimeout(r, 250));
    found = findLeftovers({ tmpRoot });
  }
  return found;
}

async function check(label, args, judge) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-faultcheck-'));
  const run = await runRunner(args, tmpRoot);
  const leftovers = await settledLeftovers(tmpRoot);
  if (!leftovers.checkedProcesses) console.log('note: no /proc here, so leftover processes are not looked for');
  const problems = judge({ ...run, leftovers });
  for (const p of leftovers.processes) { try { process.kill(p.pid, 'SIGKILL'); } catch (e) { /* gone */ } }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`${problems.length ? 'FAIL' : 'PASS'}  ${label}  (exit ${run.code}, ${run.ms / 1000}s)`);
  for (const p of problems) console.log(`      ${p}`);
  if (problems.length) console.log(run.out.split('\n').map((l) => `      | ${l}`).join('\n'));
  return problems.length === 0;
}

async function main() {
  const results = [
    await check('a scenario forced to throw is FAIL under its name and the other still runs',
      ['--only', 'graph,smoke', '--fault', 'throw:graph'], problemsForForcedThrow),
    await check('Chrome killed mid-run fails the run in time and leaves nothing behind',
      ['--only', 'graph', '--fault', 'kill-chrome'], (r) => problemsForKilledChrome({ ...r, limitMs: KILLED_CHROME_LIMIT_MS })),
  ];
  return results.every(Boolean) ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => { console.error(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`); process.exit(3); });
}

module.exports = { findLeftovers, problemsForForcedThrow, problemsForKilledChrome };

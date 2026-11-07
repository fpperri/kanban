'use strict';
// What a Board artifact's page was built from, and how far each part has moved since: the plugin commit (the
// page's code) and the board commit (the cards and their files), as short ids. The build puts them in the page
// for people (stampNow); the publish step keeps them in a small file in the board folder, .artifact-stamp,
// committed with the board so a cloud session sees it too (record); a refresh asks check first, which reads that
// file and local git only, with no build and no download of the page.
//
// An id ends in "+" when the files it covers had uncommitted changes then: such a stamp never reads as current.
// A plugin or board that is not a git checkout has no id (null), and a check that cannot tell says so.
//
// The stamp file is the board's own file but not a change to the board, so it is left out of the board's id,
// its count and its dirty check.
const fs = require('fs');
const path = require('path');

const STAMP_FILE = '.artifact-stamp';
const OUT = `:(exclude)${STAMP_FILE}`;
const MERGED_PR = /^Merge pull request (#\d+)/;

function git(cwd, args) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return r.error ? { status: 128, out: '' } : { status: r.status, out: (r.stdout || '').trim() };
}

// The last commit that touched `dir`, with "+" when `dir` has uncommitted changes. null when `dir` is not in a
// checkout or no commit touched it.
function idOf(dir) {
  if (!fs.existsSync(dir)) return null;
  const last = git(dir, ['log', '-1', '--abbrev=7', '--format=%h', '--', '.', OUT]);
  if (last.status !== 0 || !last.out) return null;
  const dirty = git(dir, ['status', '--porcelain', '--', '.', OUT]).out !== '';
  return dirty ? `${last.out}+` : last.out;
}

function stampNow({ boardDir, pluginDir }) {
  return { plugin: idOf(pluginDir), board: idOf(boardDir) };
}

function readStamp(boardDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(boardDir, STAMP_FILE), 'utf8'));
    return s && typeof s === 'object' ? s : null;
  } catch (_) { return null; }
}

function record(boardDir, stamp, now = () => new Date()) {
  const file = path.join(boardDir, STAMP_FILE);
  fs.writeFileSync(file, `${JSON.stringify({ plugin: stamp.plugin, board: stamp.board, at: now().toISOString() }, null, 2)}\n`);
  return file;
}

// The title a merged change goes by: a merge commit's own PR title (the first line of its body), a squash
// commit's subject.
function titleOf(subject, body) {
  const m = MERGED_PR.exec(subject);
  if (!m) return subject;
  const first = body.split('\n').map((l) => l.trim()).find(Boolean);
  return first ? `${m[1]} ${first}` : subject;
}

// How far `dir` has moved since the commit `was`: { behind, titles } or { unknown: reason }.
function movedSince(dir, was, label) {
  const id = was.replace(/\+$/, '');
  if (!fs.existsSync(dir)) return { unknown: `the ${label} folder is not here` };
  const ancestor = git(dir, ['merge-base', '--is-ancestor', id, 'HEAD']).status;
  if (ancestor === 128) return { unknown: `the ${label} is not a git checkout here, or its commit ${id} is not in this checkout (shallow clone, or another history)` };
  if (ancestor !== 0) return { unknown: `the ${label} commit ${id} is not an ancestor of HEAD` };
  const count = git(dir, ['rev-list', '--count', `${id}..HEAD`, '--', '.', OUT]);
  const log = git(dir, ['log', '--first-parent', '--format=%s%x1f%b%x1e', `${id}..HEAD`, '--', '.', OUT]);
  if (count.status !== 0 || log.status !== 0) return { unknown: `git could not count the ${label} commits since ${id}` };
  const titles = log.out.split('\x1e').map((e) => e.trim()).filter(Boolean).map((e) => { const [s, b = ''] = e.split('\x1f'); return titleOf(s.trim(), b); });
  const dirty = git(dir, ['status', '--porcelain', '--', '.', OUT]).out !== '';
  return { behind: Number(count.out), titles, dirty };
}

// verdict: 'current' (nothing moved: skip the build), 'board' (only the board moved: a plain refresh), 'plugin'
// (the plugin moved: a refresh that brings new page code), or 'unknown' (cannot tell: build as before).
function check({ boardDir, pluginDir }) {
  const was = readStamp(boardDir);
  const unknown = (reason) => ({ verdict: 'unknown', reason, was });
  if (!was) return unknown(`no ${STAMP_FILE} in the board folder: no refresh has recorded what the page was built from`);
  if (!was.plugin || !was.board) return unknown(`the recorded stamp has no ${was.plugin ? 'board' : 'plugin'} commit (it was built outside a git checkout)`);
  const plugin = movedSince(pluginDir, was.plugin, 'plugin');
  const board = movedSince(boardDir, was.board, 'board');
  if (plugin.unknown || board.unknown) return unknown([plugin.unknown, board.unknown].filter(Boolean).join('; '));
  const pluginMoved = plugin.behind > 0 || plugin.dirty || was.plugin.endsWith('+');
  const boardMoved = board.behind > 0 || board.dirty || was.board.endsWith('+');
  const verdict = pluginMoved ? 'plugin' : boardMoved ? 'board' : 'current';
  const part = (p, w) => ({ behind: p.behind, titles: p.titles, uncommitted: p.dirty || w.endsWith('+') });
  return { verdict, was, plugin: part(plugin, was.plugin), board: part(board, was.board) };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describe(r) {
  if (r.verdict === 'unknown') return `cannot tell: ${r.reason}. Build and publish as usual.`;
  const from = `built from plugin ${r.was.plugin}, board ${r.was.board}`;
  if (r.verdict === 'current') return `current: ${from}; nothing has moved. Skip the build.`;
  const note = (p, name) => (p.behind ? `${plural(p.behind, 'commit')} on the ${name}` : p.uncommitted ? `uncommitted changes on the ${name}` : null);
  const moved = [note(r.plugin, 'plugin'), note(r.board, 'board')].filter(Boolean).join(', ');
  const prs = r.plugin.titles.length ? ` Brings new page code: ${r.plugin.titles.join('; ')}.` : r.verdict === 'plugin' ? ' Brings new page code.' : '';
  return `${r.verdict === 'plugin' ? 'plugin moved' : 'board moved'}: ${from}; ${moved}.${prs}`;
}

const EXIT = { current: 0, board: 10, plugin: 11, unknown: 12 };

module.exports = { STAMP_FILE, stampNow, readStamp, record, check, describe, EXIT };

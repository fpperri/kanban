'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROLLUP = path.join(__dirname, 'rollup.js');

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeCard(boardDir, filename, frontmatter, title) {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const content = `---\n${fm}\n---\n\n# ${title}\n`;
  fs.writeFileSync(path.join(boardDir, filename), content, 'utf8');
}

function buildFixture() {
  const root = mkTmpDir('rollup-test-');
  const boardA = path.join(root, 'boardA');
  const boardB = path.join(root, 'boardB');
  fs.mkdirSync(boardA, { recursive: true });
  fs.mkdirSync(boardB, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'config.yaml'),
    'boards:\n  - boardA\n  - boardB\n',
    'utf8'
  );

  fs.writeFileSync(path.join(boardA, 'config.yaml'), 'name: alpha\nnextId: 5\n', 'utf8');
  fs.writeFileSync(path.join(boardB, 'config.yaml'), 'name: beta\nnextId: 5\n', 'utf8');

  writeCard(boardA, '0001.human-backlog.card.md', {
    id: 1,
    status: 'backlog',
    priority: 'Normal',
    assignee: '"@human"',
  }, 'Human owned backlog card');

  writeCard(boardA, '0002.review-doing.card.md', {
    id: 2,
    status: 'doing',
    priority: 'High',
    assignee: '"@afk"',
    review: '"PR #6"',
  }, 'Review stickered doing card');

  writeCard(boardA, '0003.blocked-todo.card.md', {
    id: 3,
    status: 'todo',
    priority: 'Normal',
    assignee: '"@hitl"',
    blocked: '"legal sign-off pending"',
  }, 'Blocked todo card');

  writeCard(boardB, '0004.decide-title.card.md', {
    id: 4,
    status: 'todo',
    priority: 'Low',
    assignee: '"@hitl"',
  }, 'Decide: which vendor to pick');

  writeCard(boardB, '0005.plain-hitl.card.md', {
    id: 5,
    status: 'todo',
    priority: 'Normal',
    assignee: '"@hitl"',
  }, 'Plain hitl todo card, no decision needed');

  writeCard(boardA, '0006.backtick-title.card.md', {
    id: 6,
    status: 'backlog',
    priority: 'Normal',
    assignee: '"@human"',
  }, 'Card with `inner` backticks in title');

  fs.writeFileSync(
    path.join(boardB, '0007.hitl-decision-section.card.md'),
    '---\nid: 7\nstatus: todo\npriority: Normal\nassignee: "@hitl"\n---\n\n' +
      '# Contract rev needing a call\n\nSome body text.\n\n## Decision needed\n\n1. Pick a scope.\n',
    'utf8'
  );

  writeCard(boardB, '0008.review-no-text.card.md', {
    id: 8,
    status: 'doing',
    priority: 'Normal',
    assignee: '"@afk"',
    review: 'true',
  }, 'Review flagged with no text');

  fs.writeFileSync(
    path.join(root, 'notifications.md'),
    '- id: 1\n  at: 2026-01-01T00:00:00\n  from: "skill:kanban"\n  level: info\n  message: "seed entry; more: nothing yet."\n  read: true\n',
    'utf8'
  );

  return { root, boardA, boardB };
}

function runRollup(args) {
  return execFileSync('node', [ROLLUP, ...args], { encoding: 'utf8' });
}

test('DECIDE includes human/review/blocked/Decide-title/decision-section cards, excludes plain hitl todo', () => {
  const { root } = buildFixture();
  const out = runRollup([root]);
  const decideSection = out.split('DECIDE:')[1].split('NEW SINCE')[0];

  assert.match(decideSection, /alpha#1 Human owned backlog card/);
  assert.match(decideSection, /alpha#2 Review stickered doing card/);
  assert.match(decideSection, /alpha#3 Blocked todo card/);
  assert.match(decideSection, /beta#4 Decide: which vendor to pick/);
  assert.match(decideSection, /beta#7 Contract rev needing a call/);
  assert.doesNotMatch(decideSection, /Plain hitl todo card/);
});

test('review sticker with text renders that text; review sticker with no text renders "text unspecified"', () => {
  const { root } = buildFixture();
  const out = runRollup([root]);
  const decideSection = out.split('DECIDE:')[1].split('NEW SINCE')[0];
  assert.match(decideSection, /alpha#2 Review stickered doing card` — PR #6/);
  assert.match(decideSection, /beta#8 Review flagged with no text` — text unspecified/);
});

test('PORTFOLIO reports per-board doing/todo/review/blocked/human counts', () => {
  const { root } = buildFixture();
  const out = runRollup([root]);
  const portfolioSection = out.split('PORTFOLIO:')[1].split('DECIDE:')[0];

  assert.match(portfolioSection, /alpha\s+doing:1 todo:1 review:1 blocked:1 human:2/);
  assert.match(portfolioSection, /beta\s+doing:1 todo:3 review:1 blocked:0 human:0/);
});

test('NEW SINCE lists notifications newer than the cutoff, newest first', () => {
  const { root, boardA } = buildFixture();
  fs.writeFileSync(
    path.join(boardA, 'notifications.md'),
    '- id: 1\n  at: 2099-01-01T00:00:00\n  from: "skill:kanban"\n  level: info\n  message: "older; more: x"\n  read: false\n' +
      '- id: 2\n  at: 2099-01-02T00:00:00\n  from: "skill:kanban"\n  level: info\n  message: "newer TLDR; more: y"\n  read: false\n',
    'utf8'
  );
  const out = runRollup([root, '--since', '2098-01-01T00:00:00']);
  const newSection = out.split(/NEW SINCE [^\n]+:\n?/)[1];

  const olderIdx = newSection.indexOf('alpha n1');
  const newerIdx = newSection.indexOf('alpha n2');
  assert.ok(olderIdx !== -1 && newerIdx !== -1);
  assert.ok(newerIdx < olderIdx, 'newest entry should list first');
  assert.match(newSection, /alpha n2 2099-01-02T00:00:00 newer TLDR/);
});

test('handles UTF-8 BOM and CRLF line endings in config.yaml and card files', () => {
  const root = mkTmpDir('rollup-test-bom-');
  const boardDir = path.join(root, 'boardC');
  fs.mkdirSync(boardDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, 'config.yaml'),
    '﻿boards:\r\n  - boardC\r\n',
    'utf8'
  );
  fs.writeFileSync(path.join(boardDir, 'config.yaml'), '﻿name: gamma\r\n', 'utf8');
  fs.writeFileSync(
    path.join(boardDir, '0001.bom-card.card.md'),
    '﻿---\r\nid: 1\r\nstatus: todo\r\npriority: Normal\r\nassignee: "@human"\r\n---\r\n\r\n# BOM and CRLF card\r\n',
    'utf8'
  );

  const out = runRollup([root]);
  assert.match(out, /gamma\s+doing:0 todo:1 review:0 blocked:0 human:1/);
  assert.match(out, /gamma#1 BOM and CRLF card/);
});

test('--write escapes embedded quotes and parseNotifications unescapes them back on read', () => {
  const { parseNotifications } = require('./rollup.js');
  const root = mkTmpDir('rollup-test-quotes-');
  const boardDir = path.join(root, 'boardD');
  fs.mkdirSync(boardDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'config.yaml'), 'boards:\n  - boardD\n', 'utf8');
  fs.writeFileSync(path.join(boardDir, 'config.yaml'), 'name: delta\n', 'utf8');
  writeCard(boardDir, '0001.quoted-blocked.card.md', {
    id: 1,
    status: 'todo',
    priority: 'Normal',
    assignee: '"@hitl"',
    blocked: `'waiting on "legal" sign-off'`,
  }, 'Blocked card with quotes');

  runRollup([root, '--write']);

  const written = fs.readFileSync(path.join(root, 'notifications.md'), 'utf8');
  assert.match(written, /\\"legal\\"/, 'on-disk entry should carry the escaped quotes');

  const entries = parseNotifications(root);
  const rollupEntry = entries.find((e) => e.from === 'rollup');
  assert.ok(rollupEntry, 'rollup notification should be present');
  assert.match(rollupEntry.message, /waiting on "legal" sign-off/);
  assert.doesNotMatch(rollupEntry.message, /\\"/);
});

test('card mentions render as one code span with inner backticks stripped', () => {
  const { root } = buildFixture();
  const out = runRollup([root]);
  const decideSection = out.split('DECIDE:')[1].split('NEW SINCE')[0];

  assert.match(decideSection, /`alpha#6 Card with inner backticks in title`/);
  assert.doesNotMatch(decideSection, /``/);
});

test('--write appends exactly one notification and touches no other file', () => {
  const { root, boardA, boardB } = buildFixture();

  const listFiles = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();

  const snapshot = (dir) => {
    const files = listFiles(dir);
    const contents = {};
    for (const f of files) contents[f] = fs.readFileSync(path.join(dir, f), 'utf8');
    return { files, contents };
  };

  const before = {
    root: snapshot(root),
    boardA: snapshot(boardA),
    boardB: snapshot(boardB),
  };

  runRollup([root, '--write']);

  const after = {
    root: snapshot(root),
    boardA: snapshot(boardA),
    boardB: snapshot(boardB),
  };

  assert.deepEqual(after.boardA, before.boardA);
  assert.deepEqual(after.boardB, before.boardB);
  assert.deepEqual(after.root.files, before.root.files);

  for (const f of before.root.files) {
    if (f === 'notifications.md') continue;
    assert.equal(after.root.contents[f], before.root.contents[f], `${f} should be unchanged`);
  }

  const beforeEntries = (before.root.contents['notifications.md'].match(/^- id:/gm) || []).length;
  const afterEntries = (after.root.contents['notifications.md'].match(/^- id:/gm) || []).length;
  assert.equal(afterEntries, beforeEntries + 1);

  assert.match(after.root.contents['notifications.md'], /- id: 2\n\s+at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\n\s+from: "rollup"/);
});

test('missing board path exits non-zero', () => {
  const root = mkTmpDir('rollup-test-missing-');
  assert.throws(() => {
    execFileSync('node', [ROLLUP, root, '--boards', path.join(root, 'nope')], { encoding: 'utf8' });
  });
});

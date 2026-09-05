#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function stripBom(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

function readFileLines(file) {
  const raw = stripBom(fs.readFileSync(file, 'utf8'));
  return raw.split(/\r\n|\r|\n/);
}

function unquote(v) {
  let s = v.trim();
  if (s.length >= 2) {
    const first = s[0], last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      s = s.slice(1, -1);
    }
  }
  return s;
}

function isAlnum(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

function hasAlnum(s) {
  for (const ch of s) if (isAlnum(ch)) return true;
  return false;
}

// Sticker predicate shared by review/blocked: trimmed value with >=1
// alnum char is present-with-text; YAML false/no => absent; true => present, no text.
function stickerText(raw) {
  if (raw === undefined) return { present: false, text: '' };
  const v = unquote(raw);
  const lower = v.trim().toLowerCase();
  if (lower === 'false' || lower === 'no') return { present: false, text: '' };
  if (lower === 'true') return { present: true, text: '' };
  if (hasAlnum(v)) return { present: true, text: v.trim() };
  return { present: false, text: '' };
}

// Tolerant line-based YAML: only UNINDENTED "key:" lines count at the
// top level; indented lines (list items, nested fields) are skipped here.
function parseTopLevelConfig(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const result = {};
  for (const line of lines) {
    if (/^\s/.test(line)) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    const hashIdx = findUnquotedHash(value);
    if (hashIdx !== -1) value = value.slice(0, hashIdx);
    value = value.trim();
    if (!(key in result)) result[key] = value;
  }
  return result;
}

function findUnquotedHash(s) {
  let inQuote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#') {
      return i;
    }
  }
  return -1;
}

function parseInlineList(value) {
  const v = value.trim();
  if (!v.startsWith('[') || !v.endsWith(']')) return null;
  const inner = v.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((s) => unquote(s.trim())).filter((s) => s.length > 0);
}

// Registry's "boards:" list: inline [a, b] on the boards: line itself, or
// block form as subsequent more-indented "  - path" lines.
function parseBoardsList(text) {
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;
    const m = line.match(/^boards:\s*(.*)$/);
    if (!m) continue;
    const rest = m[1];
    let valuePart = rest;
    const hashIdx = findUnquotedHash(valuePart);
    if (hashIdx !== -1) valuePart = valuePart.slice(0, hashIdx);
    valuePart = valuePart.trim();
    if (valuePart) {
      const inline = parseInlineList(valuePart);
      return inline || [];
    }
    const entries = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!/^\s/.test(l)) break;
      const im = l.match(/^\s+-\s*(.+)$/);
      if (!im) break;
      let iv = im[1];
      const ih = findUnquotedHash(iv);
      if (ih !== -1) iv = iv.slice(0, ih);
      entries.push(unquote(iv.trim()));
    }
    return entries;
  }
  return [];
}

function resolveBoardPath(rootDir, entry) {
  return path.isAbsolute(entry) ? entry : path.resolve(rootDir, entry);
}

function loadBoardRegistry(rootDir, boardsOverride) {
  if (boardsOverride && boardsOverride.length > 0) {
    return boardsOverride.map((b) => resolveBoardPath(rootDir, b));
  }
  const configPath = path.join(rootDir, 'config.yaml');
  if (!fs.existsSync(configPath)) return [rootDir];
  const text = stripBom(fs.readFileSync(configPath, 'utf8'));
  const entries = parseBoardsList(text);
  if (entries.length === 0) return [rootDir];
  return entries.map((e) => resolveBoardPath(rootDir, e));
}

function boardName(boardDir) {
  const configPath = path.join(boardDir, 'config.yaml');
  if (fs.existsSync(configPath)) {
    const text = stripBom(fs.readFileSync(configPath, 'utf8'));
    const cfg = parseTopLevelConfig(text);
    if (cfg.name) return unquote(cfg.name);
  }
  return path.basename(path.dirname(boardDir));
}

function parseCardFrontmatter(text) {
  const lines = text.split(/\r\n|\r|\n/);
  let fenceCount = 0;
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      fenceCount++;
      if (fenceCount === 1) start = i;
      else if (fenceCount === 2) { end = i; break; }
    }
  }
  const fm = {};
  if (start !== -1 && end !== -1) {
    for (let i = start + 1; i < end; i++) {
      const line = lines[i];
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (!m) continue;
      fm[m[1]] = m[2].trim();
    }
  }
  let title = '';
  let hasDecisionSection = false;
  for (let i = end === -1 ? 0 : end + 1; i < lines.length; i++) {
    if (!title && lines[i].startsWith('# ')) title = lines[i].slice(2).trim();
    if (/^##\s*Decision needed\s*$/i.test(lines[i])) hasDecisionSection = true;
  }
  return { fm, title, hasDecisionSection };
}

function readCards(boardDir) {
  const cards = [];
  let entries;
  try {
    entries = fs.readdirSync(boardDir, { withFileTypes: true });
  } catch (e) {
    return cards;
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith('.card.md')) continue;
    const full = path.join(boardDir, ent.name);
    const text = stripBom(fs.readFileSync(full, 'utf8'));
    const { fm, title, hasDecisionSection } = parseCardFrontmatter(text);
    const review = stickerText(fm.review);
    const blocked = stickerText(fm.blocked);
    cards.push({
      id: fm.id !== undefined ? unquote(fm.id) : '',
      status: fm.status !== undefined ? unquote(fm.status) : '',
      priority: fm.priority !== undefined ? unquote(fm.priority) : '',
      assignee: fm.assignee !== undefined ? unquote(fm.assignee) : '',
      due_date: fm.due_date !== undefined ? unquote(fm.due_date) : '',
      updated: fm.updated !== undefined ? unquote(fm.updated) : '',
      review,
      blocked,
      title,
      hasDecisionSection,
    });
  }
  return cards;
}

function parseNotifications(boardDir) {
  const file = path.join(boardDir, 'notifications.md');
  if (!fs.existsSync(file)) return [];
  const lines = readFileLines(file);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const idm = line.match(/^-\s+id:\s*(.*)$/);
    if (idm) {
      if (current) entries.push(current);
      current = { id: unquote(idm[1].trim()), at: '', level: '', message: '', from: '' };
      continue;
    }
    if (!current) continue;
    let m;
    if ((m = line.match(/^\s+at:\s*(.*)$/))) current.at = unquote(m[1].trim());
    else if ((m = line.match(/^\s+level:\s*(.*)$/))) current.level = unquote(m[1].trim());
    else if ((m = line.match(/^\s+from:\s*(.*)$/))) current.from = unquote(m[1].trim());
    else if ((m = line.match(/^\s+message:\s*(.*)$/))) current.message = unescapeQuotes(unquote(m[1].trim()));
  }
  if (current) entries.push(current);
  return entries;
}

function unescapeQuotes(s) {
  return s.replace(/\\"/g, '"');
}

function messageTldr(message) {
  const idx = message.indexOf('; more: ');
  return idx === -1 ? message : message.slice(0, idx);
}

const PRIORITY_ORDER = { High: 0, Normal: 1, Low: 2 };

function priorityRank(p) {
  if (p in PRIORITY_ORDER) return PRIORITY_ORDER[p];
  return p ? 3 : 4;
}

function stripBackticks(s) {
  return s.replace(/`/g, '');
}

function cardMention(boardNm, id, title) {
  return '`' + boardNm + '#' + id + ' ' + stripBackticks(title) + '`';
}

function parseArgs(argv) {
  const args = { rootDir: null, boards: null, write: false, since: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--boards') {
      if (i + 1 >= argv.length) { args.error = '--boards requires a value'; break; }
      args.boards = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--write') {
      args.write = true;
    } else if (a === '--since') {
      if (i + 1 >= argv.length) { args.error = '--since requires a value'; break; }
      args.since = argv[++i];
    } else {
      rest.push(a);
    }
  }
  args.rootDir = rest[0];
  return args;
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

function localIsoNow() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function defaultSince(rootNotifications) {
  const rollupEntries = rootNotifications.filter((n) => n.from === 'rollup' && n.at);
  if (rollupEntries.length > 0) {
    rollupEntries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return rollupEntries[rollupEntries.length - 1].at;
  }
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.rootDir || args.error) {
    if (args.error) console.error(args.error);
    console.error('Usage: node rollup.js <root-board-dir> [--boards p1,p2,...] [--write] [--since <ISO>]');
    process.exit(1);
  }
  const rootDir = path.resolve(args.rootDir);
  if (!fs.existsSync(rootDir)) {
    console.error('Root board dir not found: ' + rootDir);
    process.exit(1);
  }

  const boardDirs = loadBoardRegistry(rootDir, args.boards);
  for (const bd of boardDirs) {
    if (!fs.existsSync(bd)) {
      console.error('Board directory not found: ' + bd);
      process.exit(1);
    }
  }

  const boards = boardDirs.map((bd) => ({
    dir: bd,
    name: boardName(bd),
    cards: readCards(bd),
    notifications: parseNotifications(bd),
  }));

  const portfolioLines = [];
  const decideRows = [];

  for (const board of boards) {
    let doing = 0, todo = 0, review = 0, blocked = 0, human = 0;
    for (const card of board.cards) {
      if (card.status === 'doing') doing++;
      if (card.status === 'todo') todo++;
      if (card.review.present) review++;
      if (card.blocked.present) blocked++;
      if (card.assignee === '@human') human++;

      const needsHuman = card.assignee === '@human' || card.review.present ||
        card.blocked.present || card.title.startsWith('Decide') || card.hasDecisionSection;
      if (needsHuman) {
        decideRows.push({ board: board.name, card });
      }
    }
    portfolioLines.push(
      `${board.name}  doing:${doing} todo:${todo} review:${review} blocked:${blocked} human:${human}`
    );
  }

  decideRows.sort((a, b) => {
    const pr = priorityRank(a.card.priority) - priorityRank(b.card.priority);
    if (pr !== 0) return pr;
    if (a.board !== b.board) return a.board < b.board ? -1 : 1;
    const an = Number(a.card.id), bn = Number(b.card.id);
    if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
    return String(a.card.id).localeCompare(String(b.card.id));
  });

  const decideLines = decideRows.map(({ board, card }) => {
    const mention = cardMention(board, card.id, card.title);
    let detail;
    if (card.review.present) detail = card.review.text || 'text unspecified';
    else if (card.blocked.present) detail = card.blocked.text || 'text unspecified';
    else if (card.due_date) detail = 'due ' + card.due_date;
    else detail = card.assignee;
    return `${mention} — ${detail}`;
  });

  const rootNotifications = parseNotifications(rootDir);
  const since = args.since || defaultSince(rootNotifications);

  const allNotifications = [];
  for (const board of boards) {
    for (const n of board.notifications) {
      if (!n.at) continue;
      if (n.at > since) allNotifications.push({ board: board.name, entry: n });
    }
  }
  allNotifications.sort((a, b) => (a.entry.at > b.entry.at ? -1 : a.entry.at < b.entry.at ? 1 : 0));

  const newLines = allNotifications.map(({ board, entry }) =>
    `${board} n${entry.id} ${entry.at} ${messageTldr(entry.message)}`
  );

  const out = [];
  out.push('PORTFOLIO:');
  out.push(...portfolioLines);
  out.push('');
  out.push('DECIDE:');
  out.push(...decideLines);
  out.push('');
  out.push(`NEW SINCE ${since}:`);
  out.push(...newLines);
  console.log(out.join('\n'));

  if (args.write) {
    const notifPath = path.join(rootDir, 'notifications.md');
    const existing = parseNotifications(rootDir);
    let maxId = 0;
    for (const n of existing) {
      const nId = Number(n.id);
      if (!isNaN(nId) && nId > maxId) maxId = nId;
    }
    const nextId = maxId + 1;
    const at = localIsoNow();
    const decideSummary = decideLines.join(' · ').replace(/\r?\n/g, ' ');
    const message = `Rollup: ${decideRows.length} items need you across ${boards.length} boards; more: ${decideSummary}`
      .replace(/"/g, '\\"');
    const entryText =
      `- id: ${nextId}\n` +
      `  at: ${at}\n` +
      `  from: "rollup"\n` +
      `  level: info\n` +
      `  message: "${message}"\n` +
      `  read: false\n`;
    let prefix = '';
    if (fs.existsSync(notifPath)) {
      const cur = stripBom(fs.readFileSync(notifPath, 'utf8'));
      prefix = cur.length > 0 && !cur.endsWith('\n') ? cur + '\n' : cur;
    }
    fs.writeFileSync(notifPath, prefix + entryText, 'utf8');
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  parseTopLevelConfig,
  parseBoardsList,
  parseCardFrontmatter,
  parseNotifications,
  stickerText,
  cardMention,
  messageTldr,
  priorityRank,
  boardName,
  loadBoardRegistry,
  readCards,
  main,
};

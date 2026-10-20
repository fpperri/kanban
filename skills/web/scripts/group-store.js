'use strict';
// Groups (docs/adr/0015): a set of the board's cards kept in a file of its own, in the
// folder `groups:` names in config.yaml (off without the line). The file is
// `<padded id>.<slug>.md`; its type and subtype are the folders it sits in, at most two
// levels, none for a group at the root:
//
//   ---
//   id: I2                    # the truth; the file name is only a label
//   name: zephyr-2
//   start_date: 2026-10-12    # optional
//   end_date: 2026-10-23      # optional
//   auto_join: true           # optional
//   cards: [3, 7]             # the ids of its member cards, this board's cards only
//   owner: "@human"           # any other key is kept as written
//   ---
//   free markdown, kept as written
//
// Cards never know their groups: membership lives only here. A group's prefix comes from
// the exact folder `prefixes:` maps to it (config-store's prefixForGroupFolder), else `_`.
//
// The frontmatter is read by its own tolerant reader, line by line: a write replaces,
// inserts or removes the one top-level key it changes and writes every other line back as
// it was (comments, unknown keys, the body, the file's line ending). A file that cannot be
// read as a group is skipped and reported with its reason, never fatal; a file nested
// deeper than two folders is skipped the same way. Request text never builds a path: a
// group is found by its id in the folder's own listing, a folder is validated one segment at
// a time, and a new file's name is built from the allocated id and the slug of the name.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const cs = require('./card-store');
const ids = require('../web/ids');
const { groupRunning } = require('../web/groups');
const { scalar, quote } = require('./yaml-list');

class GroupError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GroupError';
    this.status = status;
  }
}

const MANAGED = ['id', 'name', 'start_date', 'end_date', 'auto_join', 'cards'];
const MAX_FOLDERS = 2;
const MAX_NAME = 120;
const KEY_LINE = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/;
const CONTINUES = /^(?:[ \t]+\S|-(?:[ \t]|$))/;

// ---------- the folder ----------

function groupsFolder(dir) {
  const config = cfg.readConfig(dir);
  return config.groups ? path.resolve(dir, config.groups) : null;
}

function mustGroups(dir) {
  const config = cfg.readConfig(dir);
  if (!config.groups) throw new GroupError('Groups are off: config.yaml has no groups: line.', 404);
  return { config, root: path.resolve(dir, config.groups) };
}

const posix = (p) => p.split(path.sep).join('/');

// ---------- the file ----------

function splitFile(raw) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  if (lines[0].trimEnd() !== '---') return null;
  let close = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === '---') { close = i; break; }
  return close === -1 ? null : { eol, lines, close };
}

// The top-level keys of the frontmatter: { key, start, end, inline, cont } by line, a key's
// continuation being the indented lines (and `- ` items) under it.
function keysOf(file) {
  const keys = [];
  for (let i = 1; i < file.close; i++) {
    const m = KEY_LINE.exec(file.lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < file.close && CONTINUES.test(file.lines[end])) end++;
    keys.push({ key: m[1], start: i, end, inline: m[2].trim(), cont: file.lines.slice(i + 1, end) });
    i = end - 1;
  }
  return keys;
}

function firstKey(keys, name) {
  return keys.find((k) => k.key === name) || null;
}

function validDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function flowItems(inline) {
  const s = inline.trim();
  const close = s.indexOf(']');
  const inner = close === -1 ? s.slice(1) : s.slice(1, close);
  return inner.split(',').map((x) => scalar(x)).filter((x) => x !== '');
}

function memberIds(key) {
  let items = [];
  if (key) {
    if (key.inline[0] === '[') items = flowItems(key.inline);
    else if (key.inline === '' || key.inline[0] === '#') items = key.cont.map((l) => /^\s*-\s*(.*)$/.exec(l)).filter(Boolean).map((m) => scalar(m[1]));
  }
  const out = [];
  for (const item of items) {
    const id = ids.idKey(item);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

function scalarOf(keys, name) {
  const k = firstKey(keys, name);
  return k && k.inline[0] !== '#' ? scalar(k.inline) : '';
}

// A group file's text -> { group } or { reason }. `folder` is where the file sits.
function parseGroup(raw, folder, file) {
  const parsed = splitFile(raw);
  if (!parsed) return { reason: 'no frontmatter' };
  const keys = keysOf(parsed);
  const idText = scalarOf(keys, 'id');
  if (idText === '') return { reason: 'no id: line' };
  const id = ids.idKey(idText);
  if (id === null) return { reason: `${idText} is not an id` };
  const date = (name) => { const v = scalarOf(keys, name); return validDate(v) ? v : ''; };
  const extra = {};
  for (const k of keys) {
    if (MANAGED.includes(k.key) || k.key in extra || k.cont.length || k.inline === '' || k.inline[0] === '#') continue;
    extra[k.key] = scalar(k.inline);
  }
  return {
    group: {
      id, name: scalarOf(keys, 'name'), folder, start_date: date('start_date'), end_date: date('end_date'),
      auto_join: scalarOf(keys, 'auto_join').toLowerCase() === 'true', cards: memberIds(firstKey(keys, 'cards')), extra, file,
    },
  };
}

// ---------- reading ----------

function mdFilesBelow(abs) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory()) out.push(...mdFilesBelow(path.join(abs, e.name)));
    else if (e.name.endsWith('.md')) out.push(path.join(abs, e.name));
  }
  return out;
}

// Every group file of the folder: { found: [{ group, abs }], skipped, dirs } where dirs are
// the folders of the groups folder, at most two levels deep, empty ones included.
function scan(dir, root) {
  const found = [];
  const skipped = [];
  const dirs = new Set();
  const seen = new Set();
  const skip = (abs, reason) => skipped.push({ file: posix(path.relative(dir, abs)), reason });
  const visit = (abs, parts) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (parts.length >= MAX_FOLDERS) {
          for (const f of mdFilesBelow(full)) skip(f, 'nested deeper than two folders');
        } else {
          dirs.add([...parts, e.name].join('/'));
          visit(full, [...parts, e.name]);
        }
      } else if (e.name.endsWith('.md')) {
        let raw;
        try { raw = fs.readFileSync(full, 'utf8'); } catch (_) { skip(full, 'could not be read'); continue; }
        const read = parseGroup(raw, parts.join('/'), posix(path.relative(dir, full)));
        if (read.reason) { skip(full, read.reason); continue; }
        if (seen.has(read.group.id)) { skip(full, `${read.group.id} is already the id of another group`); continue; }
        seen.add(read.group.id);
        found.push({ group: read.group, abs: full });
      }
    }
  };
  visit(root, []);
  return { found, skipped, dirs };
}

// The groups of a board for the page: null when the board keeps none.
function readGroups(dir) {
  const config = cfg.readConfig(dir);
  if (!config.groups) return null;
  const { found, skipped, dirs } = scan(dir, path.resolve(dir, config.groups));
  const prefixes = {};
  const folders = new Set(['', ...dirs]);
  for (const target of Object.values(config.prefixes)) {
    const folder = cfg.groupFolderOf(config, target);
    if (folder !== null) folders.add(folder);
  }
  for (const { group } of found) folders.add(group.folder);
  for (const f of folders) prefixes[f] = cfg.prefixForGroupFolder(config, f);
  return {
    folder: config.groups,
    list: found.map((f) => f.group).sort((a, b) => ids.compareIds(a.id, b.id)),
    skipped,
    folders: [...folders].sort(),
    prefixes,
  };
}

function findGroup(dir, id) {
  const { root } = mustGroups(dir);
  const want = ids.idKey(id);
  const hit = want === null ? null : scan(dir, root).found.find((f) => f.group.id === want);
  if (!hit) throw new GroupError(`no group #${id}`, 404);
  return hit;
}

// ---------- checks ----------

function oneLine(v) {
  return String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function checkName(name) {
  const text = oneLine(name);
  if (text === '') throw new GroupError('A group needs a short name.', 400);
  if (text.length > MAX_NAME) throw new GroupError('That name is too long.', 400);
  return text;
}

function checkDate(value, what) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  if (text !== '' && !validDate(text)) throw new GroupError(`${what} reads YYYY-MM-DD.`, 400);
  return text;
}

// A folder of the groups folder: '' (none), `type` or `type/subtype`, each a plain name.
function checkFolder(folder) {
  if (folder === undefined || folder === null) return '';
  if (typeof folder !== 'string') throw new GroupError('A folder is text.', 400);
  const parts = folder.trim().replace(/\/+$/, '').split('/');
  if (parts.length === 1 && parts[0] === '') return '';
  if (parts.length > MAX_FOLDERS) throw new GroupError('A group sits in at most two folders: a type and a subtype.', 400);
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..' || part !== part.trim() || /[\\/:*?"<>|\u0000-\u001f]/.test(part) || /\.$/.test(part)) {
      throw new GroupError(`${folder} is not a folder name.`, 400);
    }
  }
  return parts.join('/');
}

function boardCardIds(dir) {
  const out = new Set();
  for (const c of [...cs.listActive(dir), ...cs.listArchived(dir)]) {
    const id = c.unparseable ? null : ids.idKey(c.id);
    if (id !== null) out.add(id);
  }
  return out;
}

// A list of ids that must all be cards of this board, whole ids, once each, in id order.
function checkCards(dir, list, what = 'cards') {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new GroupError(`${what} is a list of card ids.`, 400);
  const have = boardCardIds(dir);
  const out = [];
  for (const raw of list) {
    const id = typeof raw === 'string' || typeof raw === 'number' ? ids.idKey(typeof raw === 'string' ? raw.trim() : raw) : null;
    if (id === null) throw new GroupError(`${JSON.stringify(raw)} is not an id.`, 400);
    if (!have.has(id)) throw new GroupError(`#${id} is no card of this board.`, 400);
    if (!out.includes(id)) out.push(id);
  }
  return ids.sortIds(out);
}

function checkSpan(start, end) {
  if (start !== '' && end !== '' && end < start) throw new GroupError('A group cannot end before it starts.', 400);
}

// ---------- writing ----------

const BARE = /^[A-Za-z0-9_][\w .,'()/+-]*$/;

function yamlText(value) {
  const t = String(value);
  const plain = BARE.test(t) && t === t.trim() && !/^(~|null|true|false|yes|no|on|off)$/i.test(t) && !/^[-+]?(\d[\d_]*\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t);
  return plain ? t : quote(t);
}

const cardsLine = (list) => `cards: [${list.join(', ')}]`;

// Set (a line of text), or with null remove, the one top-level key. A key not there is
// inserted after the last of `after` that is, else at the end of the frontmatter.
function setKey(file, key, line, after = []) {
  const keys = keysOf(file);
  const have = firstKey(keys, key);
  if (have) {
    file.lines.splice(have.start, have.end - have.start, ...(line === null ? [] : [line]));
    file.close += (line === null ? 0 : 1) - (have.end - have.start);
    return;
  }
  if (line === null) return;
  const anchor = after.map((a) => firstKey(keys, a)).filter(Boolean).sort((a, b) => b.end - a.end)[0];
  const at = anchor ? anchor.end : file.close;
  file.lines.splice(at, 0, line);
  file.close += 1;
}

function writeFile(file, abs) {
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, file.lines.join(file.eol));
  fs.renameSync(tmp, abs);
}

function slugOf(name) {
  return cs.capSlug(cs.slugify(name)) || 'group';
}

function uniquePath(folder, base) {
  let candidate = path.join(folder, `${base}.md`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(folder, `${base}-${n}.md`);
  return candidate;
}

// The scan candidate for a new group id: one past the highest number among the ids of
// cards and groups that carry the prefix.
function nextNumber(dir, root, prefix) {
  const groupNumbers = scan(dir, root).found.map((f) => ids.parseId(f.group.id)).filter((p) => p && p.prefix === prefix).map((p) => p.number);
  return Math.max(cs.nextId(dir, prefix), groupNumbers.length ? Math.max(...groupNumbers) + 1 : 1);
}

function createGroup(dir, input) {
  const { config, root } = mustGroups(dir);
  const body = input || {};
  const name = checkName(body.name);
  const folder = checkFolder(body.folder);
  const start = checkDate(body.start_date, 'A start date');
  const end = checkDate(body.end_date, 'An end date');
  checkSpan(start, end);
  const cards = checkCards(dir, body.cards);
  const prefix = cfg.prefixForGroupFolder(config, folder);
  const number = cfg.allocateId(dir, nextNumber(dir, root, prefix), prefix);
  const id = ids.idKey({ prefix, number });
  const lines = ['---', `id: ${id}`, `name: ${yamlText(name)}`];
  if (start) lines.push(`start_date: ${start}`);
  if (end) lines.push(`end_date: ${end}`);
  if (body.auto_join === true && start && end) lines.push('auto_join: true');
  lines.push(cardsLine(cards), '---', '');
  const where = path.join(root, ...(folder ? folder.split('/') : []));
  fs.mkdirSync(where, { recursive: true });
  const abs = uniquePath(where, `${ids.formatId(id, config.idDigits)}.${slugOf(name)}`);
  const tmp = `${abs}.tmp`;
  fs.writeFileSync(tmp, lines.join('\n'));
  fs.renameSync(tmp, abs);
  return findGroup(dir, id).group;
}

function checkExtra(extra) {
  if (extra === undefined || extra === null) return {};
  if (typeof extra !== 'object' || Array.isArray(extra)) throw new GroupError('extra is a map of keys to text.', 400);
  const out = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][\w-]*$/.test(key) || MANAGED.includes(key)) throw new GroupError(`${key} is not a key a group can carry as an extra.`, 400);
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new GroupError(`${key} is text.`, 400);
    out[key] = value === null ? null : oneLine(value);
  }
  return out;
}

function updateGroup(dir, id, patch) {
  const { group, abs } = findGroup(dir, id);
  const body = patch || {};
  const name = body.name === undefined ? group.name : checkName(body.name);
  const start = body.start_date === undefined ? group.start_date : checkDate(body.start_date, 'A start date');
  const end = body.end_date === undefined ? group.end_date : checkDate(body.end_date, 'An end date');
  checkSpan(start, end);
  const autoJoin = (body.auto_join === undefined ? group.auto_join : body.auto_join === true) && start !== '' && end !== '';
  const extra = checkExtra(body.extra);
  const file = splitFile(fs.readFileSync(abs, 'utf8'));
  if (!file) throw new GroupError(`${group.file} can no longer be read as a group.`, 409);
  const earlier = ['end_date', 'start_date', 'name', 'id'];
  if (name !== group.name) setKey(file, 'name', `name: ${yamlText(name)}`, ['id']);
  if (start !== group.start_date) setKey(file, 'start_date', start ? `start_date: ${start}` : null, ['name', 'id']);
  if (end !== group.end_date) setKey(file, 'end_date', end ? `end_date: ${end}` : null, ['start_date', 'name', 'id']);
  if (autoJoin !== group.auto_join) setKey(file, 'auto_join', autoJoin ? 'auto_join: true' : null, earlier);
  for (const [key, value] of Object.entries(extra)) {
    const now = value === null || value === '' ? null : String(value);
    if (now === (group.extra[key] === undefined ? null : group.extra[key])) continue;
    setKey(file, key, now === null ? null : `${key}: ${yamlText(now)}`, ['cards', 'auto_join', ...earlier]);
  }
  writeFile(file, abs);
  return findGroup(dir, id).group;
}

// Members in, members out. Only a card of this board can join; leaving a list a card is not
// in is nothing.
function changeMembers(dir, id, change) {
  const { group, abs } = findGroup(dir, id);
  const body = change || {};
  if (body.add === undefined && body.remove === undefined) throw new GroupError('Name the cards to add or remove.', 400);
  const add = checkCards(dir, body.add, 'add');
  if (body.remove !== undefined && !Array.isArray(body.remove)) throw new GroupError('remove is a list of card ids.', 400);
  const gone = new Set((body.remove || []).map((r) => ids.idKey(typeof r === 'string' ? r.trim() : r)).filter((r) => r !== null));
  const cards = ids.sortIds([...new Set([...group.cards, ...add])].filter((c) => !gone.has(c)));
  const file = splitFile(fs.readFileSync(abs, 'utf8'));
  if (!file) throw new GroupError(`${group.file} can no longer be read as a group.`, 409);
  setKey(file, 'cards', cardsLine(cards), ['auto_join', 'end_date', 'start_date', 'name', 'id']);
  writeFile(file, abs);
  return findGroup(dir, id).group;
}

// Every group file that lists the card, as { group, abs }, in id order. Empty when the board keeps
// no groups.
function groupsHolding(dir, cardId) {
  const config = cfg.readConfig(dir);
  const key = ids.idKey(cardId);
  if (!config.groups || key === null) return [];
  return scan(dir, path.resolve(dir, config.groups)).found
    .filter((f) => f.group.cards.includes(key))
    .sort((a, b) => ids.compareIds(a.group.id, b.group.id));
}

// A deleted card's id leaves every group's list; the ids of the groups it left. A group that did
// not list it is not rewritten.
function dropCard(dir, cardId) {
  const left = groupsHolding(dir, cardId).map((f) => f.group.id);
  for (const gid of left) changeMembers(dir, gid, { remove: [cardId] });
  return left;
}

// Delete the group's file and nothing else; the group as it was.
function deleteGroup(dir, id) {
  const { group, abs } = findGroup(dir, id);
  fs.unlinkSync(abs);
  return group;
}

// A new card joins every group that is running on `day` (the creator's local date) with
// `auto_join` on, and no other. Returns the groups it newly joined as { id, name }, in id
// order. The card is already written, so one group that cannot take it is warned about and
// skipped, never fatal: the card stays, and the next group still gets its turn.
function joinRunning(dir, cardId, day) {
  const read = readGroups(dir);
  if (!read) return [];
  const card = ids.idKey(cardId);
  const joined = [];
  for (const g of read.list) {
    if (!g.auto_join || !groupRunning(g, day) || g.cards.includes(card)) continue;
    try {
      changeMembers(dir, g.id, { add: [card] });
      joined.push({ id: g.id, name: g.name });
    } catch (e) {
      if (e.name !== 'GroupError') throw e;
      console.warn(`[kanban-app] card #${card} did not join group #${g.id}: ${e.message}`);
    }
  }
  return joined;
}

module.exports = { GroupError, groupsFolder, readGroups, createGroup, updateGroup, changeMembers, joinRunning, groupsHolding, dropCard, deleteGroup };

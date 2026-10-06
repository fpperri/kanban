const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cs = require('../scripts/card-store');

const REAL_CARD = `---
id: 1
status: done
priority: Normal
waiting_for: []
assignee: "@alex"
tags: [skill, browse, feature]
---

# Build the kanban browse skill

A para.

## Narrative
- 2026-06-26: done. (by @assistant)
`;

test('parseFrontmatter + serializeCard round-trip byte-for-byte', () => {
  const { order, values, body } = cs.parseFrontmatter(REAL_CARD);
  assert.deepStrictEqual(order, ['id', 'status', 'priority', 'waiting_for', 'assignee', 'tags']);
  assert.strictEqual(values['status'].trim(), 'done');
  assert.strictEqual(values['assignee'].trim(), '"@alex"');
  const out = cs.serializeCard({ order, values }, body);
  assert.strictEqual(out, REAL_CARD);
});

test('parseFrontmatter preserves exact spacing after the colon', () => {
  const raw = `---\nid:  7\nstatus: todo\n---\nbody\n`;
  const { values } = cs.parseFrontmatter(raw);
  const out = cs.serializeCard(cs.parseFrontmatter(raw), cs.parseFrontmatter(raw).body);
  assert.strictEqual(out, raw); // "id:  7" (two spaces) round-trips unchanged
});

test('splitTitleBody pulls the first H1 as title, rest as description', () => {
  const body = `\n# My Title\n\nLine one.\n\n## Section\n- a\n`;
  const { title, description } = cs.splitTitleBody(body);
  assert.strictEqual(title, 'My Title');
  assert.strictEqual(description, 'Line one.\n\n## Section\n- a\n');
});

test('joinTitleBody reconstructs the H1 body shape', () => {
  const body = `\n# My Title\n\nLine one.\n\n## Section\n- a\n`;
  const { title, description } = cs.splitTitleBody(body);
  assert.strictEqual(cs.joinTitleBody(title, description), body);
});

test('splitTitleBody with no H1 yields empty title', () => {
  const { title, description } = cs.splitTitleBody('just text\n');
  assert.strictEqual(title, '');
  assert.strictEqual(description, 'just text\n');
});

test('projectName derives the folder ABOVE the given board dir (the "parent folder" rule)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-proj-'));
  assert.strictEqual(cs.projectName(dir), path.basename(path.dirname(dir)));
});

test('projectName resolves a relative board-dir path the same as its absolute equivalent', () => {
  const abs = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-proj-'));
  const rel = path.relative(process.cwd(), abs);
  assert.strictEqual(cs.projectName(rel), cs.projectName(abs));
});

test('projectName uses plain parent-basename even when nested deeper than one "kanban" level (e.g. work/planning/kanban -> "planning")', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-proj-'));
  const nested = path.join(base, 'planning', 'kanban');
  fs.mkdirSync(nested, { recursive: true });
  assert.strictEqual(cs.projectName(nested), 'planning');
});

test('projectName does not special-case the board dir\'s own name — a board dir not literally named "kanban" still yields the plain parent folder', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-proj-'));
  const customDir = path.join(base, 'my-board');
  fs.mkdirSync(customDir);
  assert.strictEqual(cs.projectName(customDir), path.basename(base));
});

test('parseList / formatList', () => {
  assert.deepStrictEqual(cs.parseList('[skill, browse, feature]'), ['skill', 'browse', 'feature']);
  assert.deepStrictEqual(cs.parseList('[]'), []);
  assert.deepStrictEqual(cs.parseList(''), []);
  assert.strictEqual(cs.formatList(['a', 'b']), '[a, b]');
  assert.strictEqual(cs.formatList([]), '[]');
});

test('slugify', () => {
  assert.strictEqual(cs.slugify('Make /browse feel FAST!'), 'make-browse-feel-fast');
});

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '1.card.md'), REAL_CARD);
  fs.writeFileSync(path.join(dir, 'two.card.md'),
    `---\nid: 2\nstatus: todo\npriority: High\nwaiting_for: [1]\ntags: []\n---\n\n# Second\n\nbody2\n`);
  fs.writeFileSync(path.join(dir, 'board.md'), '# not a card\n'); // must be ignored
  return dir;
}

test('listActive reads only *.card.md and parses typed fields', () => {
  const dir = tmpBoard();
  const cards = cs.listActive(dir).sort((a, b) => a.id - b.id);
  assert.strictEqual(cards.length, 2);
  assert.strictEqual(cards[0].id, 1);
  assert.strictEqual(cards[0].title, 'Build the kanban browse skill');
  assert.strictEqual(cards[0].status, 'done');
  assert.deepStrictEqual(cards[0].tags, ['skill', 'browse', 'feature']);
  assert.strictEqual(cards[0].assignee, '@alex'); // quotes stripped
  assert.strictEqual(cards[1].priority, 'High');
  assert.deepStrictEqual(cards[1].waiting_for, [1]);
});

test('findCardFile locates by id; nextId is max+1', () => {
  const dir = tmpBoard();
  assert.ok(cs.findCardFile(dir, 2).endsWith('two.card.md'));
  assert.strictEqual(cs.findCardFile(dir, 99), null);
  assert.strictEqual(cs.nextId(dir), 3);
});

test('cardDetail returns the raw frontmatter block, absolute path, title, and body', () => {
  const dir = tmpBoard();
  const d = cs.cardDetail(dir, 1);
  assert.strictEqual(d.id, 1);
  assert.strictEqual(d.title, 'Build the kanban browse skill');
  assert.ok(path.isAbsolute(d.path));
  assert.ok(d.path.endsWith('1.card.md'));
  assert.match(d.frontmatter, /^id: 1$/m);
  assert.match(d.frontmatter, /^assignee: "@alex"$/m); // extension-style field survives verbatim
  assert.ok(d.body.includes('A para.'));
});

// the detail popup's own title fallback needs `prompt`
// alongside title — cardDetail only carried title/body/epic/etc before.
test('cardDetail carries prompt so the popup can fall back to it for a titleless card', () => {
  const dir = tmpBoard();
  cs.createCard(dir, { title: '', prompt: 'summarize the PR', status: 'backlog' });
  const d = cs.cardDetail(dir, cs.nextId(dir) - 1);
  assert.strictEqual(d.title, '');
  assert.strictEqual(d.prompt, 'summarize the PR');
});

test('cardDetail surfaces a genuinely unrecognized frontmatter key verbatim', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'ext.card.md'),
    `---\nid: 5\nstatus: backlog\npriority: Normal\nwaiting_for: []\ntags: []\nsprint: 5\n---\n\n# Extension field card\n\nbody\n`);
  const d = cs.cardDetail(dir, 5);
  assert.match(d.frontmatter, /^sprint: 5$/m); // unallowlisted key, not one card-store gives special handling (parent stopped qualifying once the store parsed it)
});

test('cardDetail carries updated: null when absent, and the value once set', () => {
  const dir = tmpBoard(); // card 1 (REAL_CARD) has no updated field
  assert.strictEqual(cs.cardDetail(dir, 1).updated, null);
  const created = cs.createCard(dir, { title: 'Stamped Detail', status: 'todo' });
  assert.match(cs.cardDetail(dir, created.id).updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('cardDetail throws for an unknown id', () => {
  const dir = tmpBoard();
  assert.throws(() => cs.cardDetail(dir, 999));
});

test('cardDetail flags archived: false for an active card, true for an archived one', () => {
  const dir = tmpBoard();
  assert.strictEqual(cs.cardDetail(dir, 1).archived, false);
  cs.archiveCard(dir, 1);
  assert.strictEqual(cs.cardDetail(dir, 1).archived, true);
});

test('cardDetail carries epic: false for a plain card, true for one flagged epic (the detail popup wash)', () => {
  const dir = tmpBoard();
  assert.strictEqual(cs.cardDetail(dir, 1).epic, false);
  const wayfinder = cs.createCard(dir, { title: 'Wayfinder', status: 'todo', epic: true });
  assert.strictEqual(cs.cardDetail(dir, wayfinder.id).epic, true);
});

test('readCardFile flags a malformed card (no closing fence) as unparseable', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'broken.card.md'), `---\nid: 5\nstatus: todo\n# no closing fence\n`);
  const broken = cs.listActive(dir).find((c) => c.file.endsWith('broken.card.md'));
  assert.strictEqual(broken.unparseable, true);
});

test('createCard assigns next id, slug filename, canonical frontmatter', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'New Thing', status: 'todo', tags: ['x'], body: 'desc here' });
  assert.strictEqual(card.id, 3);
  assert.strictEqual(card.status, 'todo');
  assert.deepStrictEqual(card.tags, ['x']);
  assert.ok(fs.existsSync(path.join(dir, '0003.new-thing.card.md')));
  // re-read from disk to prove it persisted and parses back
  const reread = cs.readCardFile(path.join(dir, '0003.new-thing.card.md'));
  assert.strictEqual(reread.title, 'New Thing');
  assert.strictEqual(reread.body.trim(), 'desc here');
  assert.deepStrictEqual(reread.waiting_for, []);
  assert.strictEqual(reread.priority, 'Normal');
});

test('createCard filename is <0000-id>.<slug>.card.md, 4-digit zero-padded', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Small Id', status: 'todo' });
  assert.strictEqual(card.id, 3);
  assert.ok(fs.existsSync(path.join(dir, '0003.small-id.card.md')));
});

test('createCard past id 9999 skips the numeric prefix (avoids breaking lexicographic sort)', () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, '9999.big-id.card.md'),
    `---\nid: 9999\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# Big Id\n\nbody\n`);
  const card = cs.createCard(dir, { title: 'Over The Line', status: 'todo' });
  assert.strictEqual(card.id, 10000);
  assert.ok(fs.existsSync(path.join(dir, 'over-the-line.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, '10000.over-the-line.card.md')));
});

// AI-prompt cards may save with no title at all — the
// server must accept it (no forced "Untitled") and the filename's slug
// component degrades to nothing, leaving the bare id prefix.
test('createCard accepts an empty title — no "Untitled" fallback, filename is the bare id prefix', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: '', prompt: 'summarize the PR', status: 'backlog' });
  assert.strictEqual(card.title, '');
  const base = path.basename(card.file);
  assert.strictEqual(base, `${String(card.id).padStart(4, '0')}.card.md`, 'no dangling dot, no slug segment');
  const reread = cs.readCardFile(card.file);
  assert.strictEqual(reread.title, '');
  assert.strictEqual(reread.prompt, 'summarize the PR');
});

test('createCard treats a missing title field the same as an explicit empty one', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { status: 'backlog', prompt: 'do the thing' });
  assert.strictEqual(card.title, '');
  assert.strictEqual(path.basename(card.file), `${String(card.id).padStart(4, '0')}.card.md`);
});

// neither title nor prompt is no data at
// all — nothing left for cardTitleDisplay to fall back to on any view.
// The "Untitled" safety net survives for exactly that case (the
// browser's `required` toggle is not the only path in — curl, kanban-afk
// dispatch, any direct POST /api/cards caller bypasses it entirely).
test('createCard falls back to "Untitled" when both title and prompt are empty', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: '', prompt: '', status: 'backlog' });
  assert.strictEqual(card.title, 'Untitled');
  assert.strictEqual(path.basename(card.file), `${String(card.id).padStart(4, '0')}.untitled.card.md`);
});

test('createCard falls back to "Untitled" when title and prompt fields are both absent', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { status: 'backlog' });
  assert.strictEqual(card.title, 'Untitled');
});

test('createCard falls back to "Untitled" when title is whitespace-only and prompt is absent', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: '   ', status: 'backlog' });
  // Guards the exact browser scenario that let this slip: the modal's
  // native `required` accepts a single space, submitModal .trim()s it to ''
  // before POSTing — so a whitespace-only title must be judged as blank here
  // too, same as a literal empty string, not preserved verbatim.
  assert.strictEqual(card.title, 'Untitled');
});

test('createCard keeps a real (non-blank) title as-is even with a prompt present', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: '  Ship it  ', prompt: 'ignored', status: 'backlog' });
  assert.strictEqual(card.title, 'Ship it'); // H1 round-trip trims surrounding whitespace, same as any other title
});

test('createCard avoids filename collisions', () => {
  const dir = tmpBoard();
  const a = cs.createCard(dir, { title: 'Dup', status: 'todo' });
  const b = cs.createCard(dir, { title: 'Dup', status: 'todo' });
  // ids differ (3, 4), so the id-prefixed filenames never collide on their own;
  // uniqueFilePath's -2 fallback still guards a same-id/-slug clash if it ever occurs.
  assert.ok(fs.existsSync(path.join(dir, `0003.dup.card.md`)));
  assert.ok(fs.existsSync(path.join(dir, `0004.dup.card.md`)));
  assert.notStrictEqual(a.id, b.id);
});

test('atomic write leaves no .tmp file behind', () => {
  const dir = tmpBoard();
  cs.createCard(dir, { title: 'Atomic', status: 'todo' });
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no leftover .tmp');
});

// --- NTFS caps a filename COMPONENT at 255 chars. A monster title
// slugified past it (~270 chars), writeAtomic's `.tmp` open died with ENOENT,
// and the save failed (burning an id per retry). Filenames built
// from slugs must cap the slug (~160) with headroom for the `NNNN.` prefix,
// `.card.md`, `.tmp`, and uniqueFilePath's `-N` dedup suffix. The filename is
// cosmetic — frontmatter id is identity, readers glob *.card.md — so
// truncating it loses nothing.

// The EXACT title that failed live on 2026-07-10 (slugifies to ~270 chars).
const MONSTER_TITLE = 'the minimalistic create card pop up should show title and assignee. in that way i can use the button on each column to decide in which column it appear. i enter the title and choose afk and i could with few clicks create something for automated implementation';
// prefix "NNNN." (5) + capped slug (<=160) + ".card.md" (8) = 173; + ".tmp" (4)
// and a "-NN" dedup still clear 255 with >70 chars to spare.
const MAX_BASENAME = 5 + 160 + 8;

test('createCard survives the exact live-failure monster title — capped filename, full title preserved', () => {
  const dir = tmpBoard();
  assert.ok(cs.slugify(MONSTER_TITLE).length > 255 - '0082..card.md.tmp'.length,
    'precondition: uncapped slug really blows the NTFS component budget');
  const card = cs.createCard(dir, { title: MONSTER_TITLE, status: 'backlog' });
  const base = path.basename(card.file);
  assert.ok(fs.existsSync(card.file), 'card file exists on disk');
  assert.ok(base.length <= MAX_BASENAME, `basename ${base.length} within cap budget`);
  assert.ok(base.length + '.tmp'.length <= 255, 'writeAtomic .tmp sibling also fits');
  const slugPart = base.replace(/^\d{4}\./, '').replace(/\.card\.md$/, '');
  assert.ok(slugPart.length <= 160, `slug component ${slugPart.length} <= 160`);
  assert.ok(!slugPart.endsWith('-'), 'capped slug never ends in a hyphen');
  assert.ok(cs.slugify(MONSTER_TITLE).startsWith(`${slugPart}-`), 'cap cut at a hyphen boundary, never mid-word');
  // identity is untouched: the FULL title round-trips from the H1, id from frontmatter
  const reread = cs.readCardFile(card.file);
  assert.strictEqual(reread.title, MONSTER_TITLE);
  assert.strictEqual(reread.id, card.id);
});

test('capSlug trims at a hyphen boundary, never mid-word, never a trailing hyphen', () => {
  // short slugs pass through byte-identical — the cap only exists for filenames
  assert.strictEqual(cs.capSlug('new-thing'), 'new-thing');
  const slug160 = 'x'.repeat(155) + '-tail'; // exactly 160: untouched
  assert.strictEqual(cs.capSlug(slug160), slug160);
  // over the cap: cut at the last hyphen at/before 160, no trailing hyphen
  const long = cs.slugify(MONSTER_TITLE);
  const capped = cs.capSlug(long);
  assert.ok(capped.length <= 160);
  assert.ok(!capped.endsWith('-'));
  assert.ok(long.startsWith(`${capped}-`), 'boundary cut: next char in the full slug is the hyphen');
  // a boundary-less slug (no hyphen inside the cap) hard-truncates to the cap
  assert.strictEqual(cs.capSlug('z'.repeat(300)), 'z'.repeat(160));
  // hyphen exactly at the cap index: word before it survives whole, hyphen dropped
  assert.strictEqual(cs.capSlug('a'.repeat(160) + '-' + 'b'.repeat(50)), 'a'.repeat(160));
  // slugify itself stays uncapped — it is a general helper, the cap is filename-only
  assert.ok(cs.slugify(MONSTER_TITLE).length > 160);
});

test('updateCard title-change to another monster title keeps the on-disk filename within the cap budget', () => {
  // updateCard has no re-slug/rename path today (verified: none in this file's
  // entire history) — a title edit rewrites the same file, so the basename set
  // at create time is the only name that ever needs to fit. This test is the
  // tripwire: if a title-change rename is ever added, an uncapped slug would
  // balloon the basename past the budget and fail here — any future rename
  // MUST route its slug through capSlug.
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Short And Sweet', status: 'todo' });
  const monster2 = 'please rename this card to an absurdly detailed novella of a title that spells out every micro decision the implementer could possibly make including the column the assignee the priority the tags the dates and the phase of the moon under which the work should ideally commence for maximum productivity';
  assert.ok(cs.slugify(monster2).length > 255 - '0003..card.md.tmp'.length,
    'precondition: second monster slug would also blow the budget uncapped');
  const updated = cs.updateCard(dir, card.id, { title: monster2 });
  assert.strictEqual(updated.title, monster2, 'full title round-trips');
  const base = path.basename(updated.file);
  assert.ok(fs.existsSync(updated.file), 'card file still on disk');
  assert.ok(base.length <= MAX_BASENAME, `basename ${base.length} within cap budget after title change`);
  assert.ok(base.length + '.tmp'.length <= 255, 'the rewrite .tmp sibling fits too');
});

test('createCard short-title filenames stay byte-identical to the pre-cap behavior', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Fix The Save Path', status: 'todo' });
  assert.strictEqual(path.basename(card.file), '0003.fix-the-save-path.card.md');
  assert.ok(fs.existsSync(path.join(dir, '0003.fix-the-save-path.card.md')));
});

test('updateCard changes only the touched frontmatter key; body preserved verbatim', () => {
  const dir = tmpBoard();
  const before = fs.readFileSync(path.join(dir, '1.card.md'), 'utf8');
  const updated = cs.updateCard(dir, 1, { status: 'doing' });
  assert.strictEqual(updated.status, 'doing');
  const after = fs.readFileSync(path.join(dir, '1.card.md'), 'utf8');
  // only the status line changed (plus the appended `updated:` bump);
  // body (incl ## Narrative) and every other key identical
  const afterMinusUpdatedLine = after.replace(/\nupdated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?=\n---\n)/, '');
  assert.strictEqual(afterMinusUpdatedLine, before.replace('status: done', 'status: doing'));
});

test('updateCard edits title via targeted H1 + body, keeps frontmatter', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { title: 'Renamed', body: 'fresh desc' });
  const c = cs.readCardFile(path.join(dir, 'two.card.md'));
  assert.strictEqual(c.title, 'Renamed');
  assert.strictEqual(c.body.trim(), 'fresh desc');
  assert.strictEqual(c.id, 2);
  assert.strictEqual(c.priority, 'High');
});

test('updateCard to doing is refused while WAITING (a waiting_for dep not done)', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { status: 'todo' }); // card 2 waits on card 1; now not done
  assert.throws(() => cs.updateCard(dir, 2, { status: 'doing' }), (e) => {
    assert.strictEqual(e.name, 'WaitingError');
    assert.deepStrictEqual(e.waiting.map((w) => w.id), [1]);
    assert.match(e.message, /^waiting on #1 \(todo\)$/, 'the refusal names which — "waiting on #id (status)"');
    return true;
  });
});

test('updateCard to doing is allowed once every dep is done — no waiting treatment left', () => {
  const dir = tmpBoard(); // card 1 starts done
  const c = cs.updateCard(dir, 2, { status: 'doing' });
  assert.strictEqual(c.status, 'doing');
});

test('updateCard with a full modal-style payload does NOT inject blank assignee/due_date', () => {
  const dir = tmpBoard(); // card 2 has no assignee/due_date
  cs.updateCard(dir, 2, {
    title: 'Second', status: 'todo', priority: 'High',
    tags: [], waiting_for: [1], assignee: '', due_date: '', body: 'b',
  });
  const raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.ok(!/^assignee:/m.test(raw), 'no blank assignee line added');
  assert.ok(!/^due_date:/m.test(raw), 'no blank due_date line added');
});

test('updateCard re-checks effective waiting_for when status+waiting_for change together', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { status: 'todo' });        // dep #1 now NOT done
  // clearing the dep in the same patch must ALLOW doing:
  const ok = cs.updateCard(dir, 2, { status: 'doing', waiting_for: [] });
  assert.strictEqual(ok.status, 'doing');
});

test('createCard refuses status doing while a waiting_for dep is unfinished', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { status: 'todo' }); // #1 not done
  assert.throws(() => cs.createCard(dir, { title: 'X', status: 'doing', waiting_for: [1] }),
    (e) => e.name === 'WaitingError');
});

test('archiveCard moves file into archived/, status untouched', () => {
  const dir = tmpBoard();
  const c = cs.archiveCard(dir, 1);
  assert.strictEqual(c.archived, true);
  assert.strictEqual(c.status, 'done'); // status unchanged
  assert.ok(!fs.existsSync(path.join(dir, '1.card.md')));
  assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
  assert.strictEqual(cs.listActive(dir).length, 1);
  assert.strictEqual(cs.listArchived(dir).length, 1);
});

test('archiveCard on an already-archived card is a no-op (idempotency guard)', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1);
  const before = fs.readFileSync(path.join(dir, 'archived', '1.card.md'), 'utf8');
  const c = cs.archiveCard(dir, 1); // second archive call on the same id
  assert.strictEqual(c.archived, true);
  assert.strictEqual(c.id, 1);
  // must NOT have renamed to a -2 duplicate
  assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '1-2.card.md')));
  assert.strictEqual(cs.listArchived(dir).length, 1);
  const after = fs.readFileSync(path.join(dir, 'archived', '1.card.md'), 'utf8');
  assert.strictEqual(after, before, 'file content untouched by the no-op');
});

test('restoreCard moves an archived file back to the board', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1);
  const c = cs.restoreCard(dir, 1);
  assert.strictEqual(c.archived, false);
  assert.ok(fs.existsSync(path.join(dir, '1.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '1.card.md')));
});

test('deleteCard removes the file permanently', () => {
  const dir = tmpBoard();
  cs.deleteCard(dir, 2);
  assert.strictEqual(cs.findCardFile(dir, 2), null);
  assert.ok(!fs.existsSync(path.join(dir, 'two.card.md')));
});

test('toJSON exposes the public card shape without internal underscores', () => {
  const dir = tmpBoard();
  const j = cs.toJSON(cs.readCardFile(path.join(dir, '1.card.md')));
  assert.deepStrictEqual(Object.keys(j).sort(), [
    'archived', 'assignee', 'blocked', 'body', 'due_date', 'end_date', 'epic', 'file', 'id', 'parent', 'priority', 'prompt', 'rank', 'review', 'start_date', 'status', 'tags', 'title', 'updated', 'waiting_for', // epic joined the shape; waiting_for replaced blocked_by and blocked joined; parent joined; review joined (ADR 0009); prompt joined; rank joined
  ]);
  assert.strictEqual(j._order, undefined);
});

test('toJSON exposes file as the basename, not the full path (file: search)', () => {
  const dir = tmpBoard();
  const j = cs.toJSON(cs.readCardFile(path.join(dir, 'two.card.md')));
  assert.strictEqual(j.file, 'two.card.md');
  assert.ok(!j.file.includes(path.sep), 'basename only, no directory separators');
});

test('archive/restore never overwrite a file with the same basename', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1); // archived/1.card.md holds id 1
  // A same-basename active/archived clash is no longer reachable via createCard now
  // that filenames are id-prefixed (ids are unique, so its output can't collide with
  // an existing archived file). Simulate the legacy/manually-placed-file case that
  // archiveCard/restoreCard's own uniqueFilePath guard still has to defend against.
  const dup = { id: 3 };
  fs.writeFileSync(path.join(dir, '1.card.md'),
    `---\nid: 3\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# 1\n\n`);
  assert.ok(fs.existsSync(path.join(dir, '1.card.md')));
  cs.archiveCard(dir, dup.id); // must NOT clobber archived/1.card.md
  // both archived cards survive
  assert.strictEqual(cs.listArchived(dir).length, 2);
  assert.ok(cs.findCardFile(dir, 1), 'original archived card still findable');
  assert.ok(cs.findCardFile(dir, dup.id), 'second archived card still findable');
  // restoring the original must not clobber anything either
  const restored = cs.restoreCard(dir, 1);
  assert.strictEqual(restored.archived, false);
  assert.ok(cs.findCardFile(dir, 1), 'restored card still findable');
  assert.ok(cs.findCardFile(dir, dup.id), 'archived card untouched by restore');
});

// --- archive packages: archived/ is scanned RECURSIVELY, and
// archived/<package>/ folders are optional grouping (ADR 0010). Everything
// below is the store's half of that contract — the recursive glob, the
// package-aware archive, and restore/delete/detail reaching into a package.

test('listArchived walks archived/ recursively — a card inside a package folder is archived like any other', () => {
  const dir = tmpBoard();
  const pkg = path.join(dir, 'archived', '2026-q2');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, '0009.packaged.card.md'),
    `---\nid: 9\nstatus: done\npriority: Normal\n---\n\n# Packaged\n\nbody\n`);
  const archived = cs.listArchived(dir);
  assert.deepStrictEqual(archived.map((c) => c.id), [9]);
  assert.strictEqual(archived[0].archived, true);
  assert.strictEqual(cs.nextId(dir), 10); // id allocation sees into packages too
  assert.ok(cs.findCardFile(dir, 9), 'findCardFile reaches into the package folder');
  assert.strictEqual(cs.cardDetail(dir, 9).archived, true); // the archived flag is a location test at ANY depth
});

test('the recursive walk still only collects *.card.md — archived/notifications.md is not a card', () => {
  const dir = tmpBoard();
  const archived = path.join(dir, 'archived', 'shipped');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(dir, 'archived', 'notifications.md'), '- id: 1\n  message: kept\n');
  fs.writeFileSync(path.join(archived, 'README.md'), '# not a card\n');
  assert.deepStrictEqual(cs.listArchived(dir), []);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'archived', 'notifications.md'), 'utf8'), '- id: 1\n  message: kept\n');
});

test('archiveCard with a package moves the file into archived/<package>/, creating the folder', () => {
  const dir = tmpBoard();
  const c = cs.archiveCard(dir, 1, '2026-q2');
  assert.strictEqual(c.archived, true);
  assert.strictEqual(c.status, 'done'); // packaging is a location move, same as a plain archive
  assert.ok(!fs.existsSync(path.join(dir, '1.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '1.card.md')), 'not at the archived/ root');
  assert.ok(fs.existsSync(path.join(dir, 'archived', '2026-q2', '1.card.md')));
  assert.strictEqual(cs.listArchived(dir).length, 1);
});

test('archiveCard with a blank/absent package keeps writing to the archived/ root', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1); // absent
  cs.archiveCard(dir, 2, '   '); // whitespace-only is no package
  assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
  assert.ok(fs.existsSync(path.join(dir, 'archived', 'two.card.md')));
  assert.deepStrictEqual(cs.listArchivePackages(dir), []);
});

test('a package-less re-archive never demotes a packaged card back to the archived/ root', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1, 'shipped');
  const again = cs.archiveCard(dir, 1); // stale tab / double-click, no package named
  assert.strictEqual(again.archived, true);
  assert.ok(fs.existsSync(path.join(dir, 'archived', 'shipped', '1.card.md')), 'stays filed in its package');
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '1.card.md')));
  assert.strictEqual(cs.listArchived(dir).length, 1);
});

test('archiveCard into the package a card already sits in is a no-op — no -2 duplicate', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1, 'shipped');
  const before = fs.readFileSync(path.join(dir, 'archived', 'shipped', '1.card.md'), 'utf8');
  cs.archiveCard(dir, 1, 'shipped');
  assert.ok(!fs.existsSync(path.join(dir, 'archived', 'shipped', '1-2.card.md')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'archived', 'shipped', '1.card.md'), 'utf8'), before);
});

test('naming a package re-files an already-archived card into it', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1); // lands at the archived/ root
  cs.archiveCard(dir, 1, '2026-q2');
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '1.card.md')));
  assert.ok(fs.existsSync(path.join(dir, 'archived', '2026-q2', '1.card.md')));
  assert.strictEqual(cs.listArchived(dir).length, 1);
});

test('restoreCard pulls a packaged card back to the board root, leaving the package folder behind', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1, '2026-q2');
  const c = cs.restoreCard(dir, 1);
  assert.strictEqual(c.archived, false);
  assert.ok(fs.existsSync(path.join(dir, '1.card.md')));
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '2026-q2', '1.card.md')));
  assert.ok(fs.existsSync(path.join(dir, 'archived', '2026-q2')), 'the emptied package folder stays');
  assert.deepStrictEqual(cs.listArchived(dir), []);
});

test('deleteCard removes a card from inside a package folder', () => {
  const dir = tmpBoard();
  cs.archiveCard(dir, 1, '2026-q2');
  cs.deleteCard(dir, 1);
  assert.strictEqual(cs.findCardFile(dir, 1), null);
  assert.ok(!fs.existsSync(path.join(dir, 'archived', '2026-q2', '1.card.md')));
});

test('listArchivePackages names the archived/ subfolders, sorted — an empty one included', () => {
  const dir = tmpBoard();
  assert.deepStrictEqual(cs.listArchivePackages(dir), []); // no archived/ at all
  cs.archiveCard(dir, 1, 'shipped');
  cs.archiveCard(dir, 2, '2026-q2');
  fs.mkdirSync(path.join(dir, 'archived', 'empty-package'));
  assert.deepStrictEqual(cs.listArchivePackages(dir), ['2026-q2', 'empty-package', 'shipped']);
});

test('a package name must be ONE plain path component — traversal and nesting are refused, nothing moves', () => {
  const dir = tmpBoard();
  for (const bad of ['..', '.', '../evil', 'a/b', 'a\\b', '/abs']) {
    assert.throws(() => cs.archiveCard(dir, 1, bad), (e) => e.name === 'PackageError', `accepted ${bad}`);
  }
  assert.ok(fs.existsSync(path.join(dir, '1.card.md')), 'the card never moved');
});

test('archivePackageDir resolves a blank package to archived/ and a named one to archived/<name>/', () => {
  assert.strictEqual(cs.archivePackageDir('board', ''), path.join('board', 'archived'));
  assert.strictEqual(cs.archivePackageDir('board', null), path.join('board', 'archived'));
  assert.strictEqual(cs.archivePackageDir('board', ' 2026-q2 '), path.join('board', 'archived', '2026-q2')); // trimmed, otherwise verbatim — no slugging
});

test('parseFrontmatter tolerates CRLF and serializeCard emits no carriage returns', () => {
  const crlf = '---\r\nid: 1\r\nstatus: todo\r\n---\r\nbody\r\n';
  const { order, values, body } = cs.parseFrontmatter(crlf);
  assert.deepStrictEqual(order, ['id', 'status']);
  const out = cs.serializeCard({ order, values }, body);
  assert.ok(!out.includes('\r'), 'no carriage returns in serialized output');
  assert.strictEqual(out, '---\nid: 1\nstatus: todo\n---\nbody\n');
});

test('parseFrontmatter is first-occurrence-wins for duplicate keys', () => {
  const raw = '---\nid: 1\nstatus: todo\nstatus: doing\n---\nbody\n';
  const { order, values } = cs.parseFrontmatter(raw);
  assert.deepStrictEqual(order, ['id', 'status']); // key appears once
  assert.strictEqual(values['status'].trim(), 'todo'); // first wins
  const out = cs.serializeCard({ order, values }, cs.parseFrontmatter(raw).body);
  assert.ok(!/status: doing/.test(out), 'no duplicate status line emitted');
});

// --- clearing optional fields — PATCH assignee: "" / due_date: ""
// removes the frontmatter line (bulk unassign needs it; the edit form's
// blank-means-clear now actually clears instead of being silently ignored)

test('updateCard with assignee "" removes the assignee line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-clear-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), REAL_CARD);
  const card = cs.updateCard(dir, 1, { assignee: '' });
  assert.strictEqual(card.assignee, null);
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /assignee:/);
  assert.match(raw, /## Narrative/); // body untouched
});

test('updateCard with due_date "" removes the due_date line, and a real value still sets it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-clear-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), REAL_CARD.replace('tags:', 'due_date: 2026-08-01\ntags:'));
  const cleared = cs.updateCard(dir, 1, { due_date: '' });
  assert.strictEqual(cleared.due_date, null);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /due_date:/);
  const set = cs.updateCard(dir, 1, { assignee: '@ai' });
  assert.strictEqual(set.assignee, '@ai');
});

// --- machine-maintained "updated" frontmatter — createCard sets it,
// updateCard bumps it on every call, archive/restore (file-location moves) never
// touch it.

test('createCard writes an updated line in ISO local datetime format', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Stamped', status: 'todo' });
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.match(raw, /^updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m);
  assert.match(card.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('updateCard bumps updated on every call, even one with no other changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-updated-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\nupdated: 2000-01-01T00:00:00\n---\n\n# One\n\nbody\n`);
  const updated = cs.updateCard(dir, 1, { priority: 'High' });
  assert.notStrictEqual(updated.updated, '2000-01-01T00:00:00');
  assert.match(updated.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /updated: 2000-01-01T00:00:00/);
});

test('updateCard on a card WITHOUT updated gains the field without disturbing other keys\' order', () => {
  const dir = tmpBoard(); // card 1 (REAL_CARD) has no updated field
  const before = cs.parseFrontmatter(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8')).order;
  assert.ok(!before.includes('updated'), 'sanity: source card has no updated field');
  const c = cs.updateCard(dir, 1, { priority: 'High' });
  assert.match(c.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  const raw = fs.readFileSync(path.join(dir, '1.card.md'), 'utf8');
  const after = cs.parseFrontmatter(raw).order;
  assert.deepStrictEqual(after.slice(0, before.length), before, 'existing keys keep their order');
  assert.deepStrictEqual(after.slice(before.length), ['updated'], 'updated appended at the end');
});

test('archiveCard leaves the updated line byte-identical (file-location move, content untouched)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-updated-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\nupdated: 2000-01-01T00:00:00\n---\n\n# One\n\nbody\n`);
  const before = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  cs.archiveCard(dir, 1);
  const after = fs.readFileSync(path.join(dir, 'archived', '0001.one.card.md'), 'utf8');
  assert.strictEqual(after, before, 'archive must not touch updated (or anything else)');
});

test('restoreCard leaves the updated line byte-identical (file-location move, content untouched)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-updated-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\nupdated: 2000-01-01T00:00:00\n---\n\n# One\n\nbody\n`);
  cs.archiveCard(dir, 1);
  const before = fs.readFileSync(path.join(dir, 'archived', '0001.one.card.md'), 'utf8');
  cs.restoreCard(dir, 1);
  const after = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.strictEqual(after, before, 'restore must not touch updated (or anything else)');
});

test('readCardFile exposes updated: null when the field is absent', () => {
  const dir = tmpBoard(); // card 1 (REAL_CARD) has no updated field
  const c = cs.readCardFile(path.join(dir, '1.card.md'));
  assert.strictEqual(c.updated, null);
});

test('toJSON carries updated (null when absent, ISO string once set)', () => {
  const dir = tmpBoard();
  const withoutIt = cs.toJSON(cs.readCardFile(path.join(dir, '1.card.md')));
  assert.strictEqual(withoutIt.updated, null);
  const created = cs.createCard(dir, { title: 'Has It', status: 'todo' });
  assert.match(cs.toJSON(created).updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

// --- start_date — optional, pairs with due_date as a from-to range.
// Both accept a plain date (YYYY-MM-DD) or a local datetime (YYYY-MM-DDTHH:MM);
// NEITHER is validated (house style: tolerate, never reject), and no
// start<=due ordering is enforced — semantics live in the docs, not in code.

test('readCardFile exposes start_date: null when absent', () => {
  const dir = tmpBoard(); // neither seed card has start_date
  assert.strictEqual(cs.readCardFile(path.join(dir, '1.card.md')).start_date, null);
});

test('readCardFile exposes start_date verbatim — date and datetime forms', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-start-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\nstart_date: 2026-07-10\ntags: []\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\npriority: Normal\nwaiting_for: []\nstart_date: 2026-07-10T09:30\ntags: []\n---\n\n# B\n\nbody\n`);
  assert.strictEqual(cs.readCardFile(path.join(dir, '0001.a.card.md')).start_date, '2026-07-10');
  assert.strictEqual(cs.readCardFile(path.join(dir, '0002.b.card.md')).start_date, '2026-07-10T09:30');
});

test('updateCard sets start_date, empty string clears the line, undefined preserves it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-start-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), REAL_CARD);
  const set = cs.updateCard(dir, 1, { start_date: '2026-07-10' });
  assert.strictEqual(set.start_date, '2026-07-10');
  assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^start_date: 2026-07-10$/m);
  // unrelated change leaves it alone
  const untouched = cs.updateCard(dir, 1, { priority: 'High' });
  assert.strictEqual(untouched.start_date, '2026-07-10');
  // empty string removes the line (same clear pattern as assignee/due_date)
  const cleared = cs.updateCard(dir, 1, { start_date: '' });
  assert.strictEqual(cleared.start_date, null);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /start_date:/);
});

test('updateCard with a full modal-style payload does NOT inject a blank start_date line', () => {
  const dir = tmpBoard(); // card 2 has no start_date
  cs.updateCard(dir, 2, {
    title: 'Second', status: 'todo', priority: 'High',
    tags: [], waiting_for: [1], assignee: '', due_date: '', start_date: '', body: 'b',
  });
  assert.ok(!/^start_date:/m.test(fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8')), 'no blank start_date line added');
});

test('updateCard accepts a datetime in start_date AND due_date, verbatim round-trip', () => {
  const dir = tmpBoard();
  const c = cs.updateCard(dir, 2, { start_date: '2026-07-10T09:30', due_date: '2026-07-12T17:00' });
  assert.strictEqual(c.start_date, '2026-07-10T09:30');
  assert.strictEqual(c.due_date, '2026-07-12T17:00');
  const reread = cs.readCardFile(path.join(dir, 'two.card.md'));
  assert.strictEqual(reread.start_date, '2026-07-10T09:30');
  assert.strictEqual(reread.due_date, '2026-07-12T17:00');
});

test('updateCard bumps updated on a start_date-only change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-start-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\nupdated: 2000-01-01T00:00:00\n---\n\n# One\n\nbody\n`);
  const c = cs.updateCard(dir, 1, { start_date: '2026-07-10' });
  assert.notStrictEqual(c.updated, '2000-01-01T00:00:00');
  assert.match(c.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('createCard accepts start_date the same way it accepts due_date', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Ranged', status: 'todo', start_date: '2026-07-10', due_date: '2026-07-12' });
  assert.strictEqual(card.start_date, '2026-07-10');
  assert.strictEqual(card.due_date, '2026-07-12');
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.match(raw, /^start_date: 2026-07-10$/m);
  // omitted start_date writes no line (status backlog: creating INTO todo
  // now auto-stamps start_date — deliberate contract change)
  const plain = cs.createCard(dir, { title: 'No Range', status: 'backlog' });
  assert.strictEqual(plain.start_date, null);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, plain.id), 'utf8'), /start_date:/);
});

test('createCard accepts a reversed range without complaint — no start<=due validation', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Reversed', status: 'todo', start_date: '2026-08-01', due_date: '2026-07-01' });
  assert.strictEqual(card.start_date, '2026-08-01');
  assert.strictEqual(card.due_date, '2026-07-01');
});

test('toJSON carries start_date (null when absent, verbatim once set)', () => {
  const dir = tmpBoard();
  assert.strictEqual(cs.toJSON(cs.readCardFile(path.join(dir, '1.card.md'))).start_date, null);
  const created = cs.createCard(dir, { title: 'Ranged JSON', status: 'todo', start_date: '2026-07-10T09:30' });
  assert.strictEqual(cs.toJSON(created).start_date, '2026-07-10T09:30');
});

// --- end_date — optional "to" of the working range (date triad:
// from = start_date, to = end_date, due = due_date). Mirrors start_date
// everywhere: verbatim, never validated, empty string clears.

test('readCardFile exposes end_date: null when absent', () => {
  const dir = tmpBoard(); // neither seed card has end_date
  assert.strictEqual(cs.readCardFile(path.join(dir, '1.card.md')).end_date, null);
});

test('readCardFile exposes end_date verbatim — date and datetime forms', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-end-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\nend_date: 2026-07-14\ntags: []\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\npriority: Normal\nwaiting_for: []\nend_date: 2026-07-14T18:00\ntags: []\n---\n\n# B\n\nbody\n`);
  assert.strictEqual(cs.readCardFile(path.join(dir, '0001.a.card.md')).end_date, '2026-07-14');
  assert.strictEqual(cs.readCardFile(path.join(dir, '0002.b.card.md')).end_date, '2026-07-14T18:00');
});

test('updateCard sets end_date, empty string clears the line, undefined preserves it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-end-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), REAL_CARD);
  const set = cs.updateCard(dir, 1, { end_date: '2026-07-14' });
  assert.strictEqual(set.end_date, '2026-07-14');
  assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^end_date: 2026-07-14$/m);
  // unrelated change leaves it alone
  const untouched = cs.updateCard(dir, 1, { priority: 'High' });
  assert.strictEqual(untouched.end_date, '2026-07-14');
  // empty string removes the line (same clear pattern as assignee/due_date/start_date)
  const cleared = cs.updateCard(dir, 1, { end_date: '' });
  assert.strictEqual(cleared.end_date, null);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /end_date:/);
});

test('updateCard with a full modal-style payload does NOT inject a blank end_date line', () => {
  const dir = tmpBoard(); // card 2 has no end_date
  cs.updateCard(dir, 2, {
    title: 'Second', status: 'todo', priority: 'High',
    tags: [], waiting_for: [1], assignee: '', due_date: '', start_date: '', end_date: '', body: 'b',
  });
  assert.ok(!/^end_date:/m.test(fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8')), 'no blank end_date line added');
});

test('updateCard bumps updated on an end_date-only change', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-end-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: []\ntags: []\nupdated: 2000-01-01T00:00:00\n---\n\n# One\n\nbody\n`);
  const c = cs.updateCard(dir, 1, { end_date: '2026-07-14' });
  assert.notStrictEqual(c.updated, '2000-01-01T00:00:00');
  assert.match(c.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
});

test('createCard accepts end_date; the triad writes in start, end, due order', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, {
    title: 'Triad', status: 'todo',
    start_date: '2026-07-10', end_date: '2026-07-14', due_date: '2026-07-16',
  });
  assert.strictEqual(card.start_date, '2026-07-10');
  assert.strictEqual(card.end_date, '2026-07-14');
  assert.strictEqual(card.due_date, '2026-07-16');
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.match(raw, /^start_date: 2026-07-10\nend_date: 2026-07-14\ndue_date: 2026-07-16$/m);
  // omitted end_date writes no line
  const plain = cs.createCard(dir, { title: 'No End', status: 'todo' });
  assert.strictEqual(plain.end_date, null);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, plain.id), 'utf8'), /end_date:/);
});

test('updateCard adding the whole triad at once appends start, end, due in that order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-end-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'), REAL_CARD);
  cs.updateCard(dir, 1, { start_date: '2026-07-10', end_date: '2026-07-14', due_date: '2026-07-16' });
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.match(raw, /^start_date: 2026-07-10\nend_date: 2026-07-14\ndue_date: 2026-07-16$/m);
});

test('createCard accepts a reversed end-range without complaint — no ordering validation', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Reversed End', status: 'todo', start_date: '2026-08-01', end_date: '2026-07-01' });
  assert.strictEqual(card.start_date, '2026-08-01');
  assert.strictEqual(card.end_date, '2026-07-01');
});

test('toJSON carries end_date (null when absent, verbatim once set)', () => {
  const dir = tmpBoard();
  assert.strictEqual(cs.toJSON(cs.readCardFile(path.join(dir, '1.card.md'))).end_date, null);
  const created = cs.createCard(dir, { title: 'End JSON', status: 'todo', end_date: '2026-07-14T18:00' });
  assert.strictEqual(cs.toJSON(created).end_date, '2026-07-14T18:00');
});

// --- no-data frontmatter fields are OMITTED — a field whose value is
// null/undefined, an empty string, or an empty array writes NO line (no more
// `tags: []` / `waiting_for: []` boilerplate). Applies uniformly to the managed
// optional fields (tags, waiting_for, assignee, start/end/due) on BOTH create and
// update — clearing via the edit form removes the line, exactly the established
// blank-date behavior. id, status, and the
// machine-managed updated are ALWAYS written; any real value (including a chosen
// priority "Normal") is data and stays. Readers already default missing fields.

test('createCard omits tags/waiting_for lines when the arrays are empty', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Lean', status: 'todo' });
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m, 'no empty tags line');
  assert.doesNotMatch(raw, /^waiting_for:/m, 'no empty waiting_for line');
  assert.doesNotMatch(raw, /^assignee:/m, 'no blank assignee line');
  // always-written fields survive, and priority's default is still data
  assert.match(raw, /^id: \d+$/m);
  assert.match(raw, /^status: todo$/m);
  assert.match(raw, /^priority: Normal$/m);
  assert.match(raw, /^updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/m);
  // reader defaults hold: missing lines parse back as empty values
  assert.deepStrictEqual(card.tags, []);
  assert.deepStrictEqual(card.waiting_for, []);
  assert.strictEqual(card.assignee, null);
});

test('createCard explicitly given empty tags/waiting_for ([] is no data) still omits the lines', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Explicit Empty', status: 'todo', tags: [], waiting_for: [], assignee: '' });
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m);
  assert.doesNotMatch(raw, /^waiting_for:/m);
  assert.doesNotMatch(raw, /^assignee:/m);
});

test('createCard still writes tags/waiting_for when they hold data', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Loaded', status: 'todo', tags: ['x', 'y'], waiting_for: [1] });
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.match(raw, /^tags: \[x, y\]$/m);
  assert.match(raw, /^waiting_for: \[1\]$/m);
  assert.deepStrictEqual(card.tags, ['x', 'y']);
  assert.deepStrictEqual(card.waiting_for, [1]);
});

test('updateCard clearing tags/waiting_for to [] removes their lines; unmanaged keys survive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: [2]\ntags: [a, b]\nsprint: 5\n---\n\n# One\n\nbody\n`);
  const card = cs.updateCard(dir, 1, { tags: [], waiting_for: [] });
  assert.deepStrictEqual(card.tags, []);
  assert.deepStrictEqual(card.waiting_for, []);
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m, 'cleared tags line removed');
  assert.doesNotMatch(raw, /^waiting_for:/m, 'cleared waiting_for line removed');
  assert.match(raw, /^sprint: 5$/m, 'form-unmanaged key untouched, verbatim');
  assert.match(raw, /# One/, 'body untouched');
});

test('updateCard treats null tags/waiting_for like empty — line removed, no crash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: [2]\ntags: [a]\n---\n\n# One\n\nbody\n`);
  const card = cs.updateCard(dir, 1, { tags: null, waiting_for: null });
  assert.deepStrictEqual(card.tags, []);
  assert.deepStrictEqual(card.waiting_for, []);
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m);
  assert.doesNotMatch(raw, /^waiting_for:/m);
});

test('updateCard keeps tags/waiting_for lines that still hold data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: [2]\ntags: [a]\n---\n\n# One\n\nbody\n`);
  cs.updateCard(dir, 1, { tags: ['keep'], waiting_for: [3, 4] });
  const raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.match(raw, /^tags: \[keep\]$/m);
  assert.match(raw, /^waiting_for: \[3, 4\]$/m);
});

test('updateCard full modal-style payload strips pre-existing empty-list lines', () => {
  const dir = tmpBoard(); // card 2 carries legacy `tags: []` and `waiting_for: [1]` lines
  cs.updateCard(dir, 2, {
    title: 'Second', status: 'todo', priority: 'High',
    tags: [], waiting_for: [], assignee: '', start_date: '', end_date: '', due_date: '', body: 'b',
  });
  const raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m, 'legacy empty tags line rewritten away');
  assert.doesNotMatch(raw, /^waiting_for:/m, 'cleared waiting_for line rewritten away');
  assert.match(raw, /^priority: High$/m, 'a real value (priority) stays');
  assert.match(raw, /^updated: /m, 'machine-managed updated always written');
});

test('updateCard leaves an existing empty-list line alone when the field is not in the patch', () => {
  const dir = tmpBoard(); // card 2 carries a legacy `tags: []` line
  cs.updateCard(dir, 2, { priority: 'Low' }); // tags not part of the change
  const raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^tags: \[\]$/m, 'untouched field is not rewritten (only managed changes apply the rule)');
});

test('readCardFile defaults a card missing tags/waiting_for/priority/assignee entirely (reader regression guard)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir, '0001.min.card.md'),
    `---\nid: 1\nstatus: todo\nupdated: 2026-07-10T00:00:00\n---\n\n# Minimal\n\nbody\n`);
  const c = cs.readCardFile(path.join(dir, '0001.min.card.md'));
  assert.strictEqual(c.id, 1);
  assert.strictEqual(c.status, 'todo');
  assert.strictEqual(c.priority, 'Normal');
  assert.deepStrictEqual(c.tags, []);
  assert.deepStrictEqual(c.waiting_for, []);
  assert.strictEqual(c.assignee, null);
  assert.strictEqual(c.unparseable, false);
});

test('updateCard clearing priority (empty string or null) removes the line — no `priority: ` boilerplate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: High\n---\n\n# One\n\nbody\n`);
  const cleared = cs.updateCard(dir, 1, { priority: '' });
  assert.strictEqual(cleared.priority, 'Normal', 'reader defaults the missing line to Normal');
  let raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^priority:/m, 'blank priority writes NO line — the blank-clears rule the other managed fields follow');
  cs.updateCard(dir, 1, { priority: 'Low' });
  raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.match(raw, /^priority: Low$/m, 'a real value still writes');
  cs.updateCard(dir, 1, { priority: null });
  raw = fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^priority:/m, 'null clears too — never a literal `priority: null` line');
});

test('blank list entries are no data: tags [\'\'] / waiting_for [\'\', \' \'] write no line on create or update', () => {
  // the web form can't produce these (parseTags/parseIds filter) — this pins
  // the raw-API path, where the length gate alone would pass [''] through
  // formatList and serialize the exact `tags: []` boilerplate the card bans.
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Junk Lists', status: 'todo', tags: [''], waiting_for: ['', ' '] });
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.doesNotMatch(raw, /^tags:/m, 'no `tags: []` from [\'\']');
  assert.doesNotMatch(raw, /^waiting_for:/m, 'no malformed `waiting_for: [, ]` from [\'\', \' \']');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-lean-'));
  fs.writeFileSync(path.join(dir2, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nwaiting_for: [2]\ntags: [a]\n---\n\n# One\n\nbody\n`);
  cs.updateCard(dir2, 1, { tags: ['', '  '], waiting_for: [''] });
  const raw2 = fs.readFileSync(path.join(dir2, '0001.one.card.md'), 'utf8');
  assert.doesNotMatch(raw2, /^tags:/m, 'all-blank list clears the existing line');
  assert.doesNotMatch(raw2, /^waiting_for:/m);
  cs.updateCard(dir2, 1, { tags: ['x', ''], waiting_for: [3, ''] });
  const raw3 = fs.readFileSync(path.join(dir2, '0001.one.card.md'), 'utf8');
  assert.match(raw3, /^tags: \[x\]$/m, 'a mixed list keeps only its real entries');
  assert.match(raw3, /^waiting_for: \[3\]$/m);
});

test('whitespace-only assignee is no data — no empty `assignee: ` line on create or update', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Ghost Owner', status: 'todo', assignee: ' ' });
  assert.strictEqual(card.assignee, null);
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.doesNotMatch(raw, /^assignee:/m, 'quoteAssignee trims \' \' to \'\' — guard must see the trimmed value');
  cs.updateCard(dir, 1, { assignee: '   ' }); // card 1 carries assignee "@alex"
  const raw1 = fs.readFileSync(path.join(dir, '1.card.md'), 'utf8');
  assert.doesNotMatch(raw1, /^assignee:/m, 'whitespace clears, same as the empty string already does');
});

// --- a card LANDING in 'todo' stamps start_date, landing in 'done'
// stamps end_date — the working range builds itself from how cards flow across
// the board. Stamps only on a transition INTO the literal lowercase status
// (same literal pin as the 'doing' blocked-gate), date-only local YYYY-MM-DD,
// never clobbers an existing date, and other statuses never stamp anything.
// createCard directly into todo/done counts as a transition in. All
// status-changing write paths (form edit, drag, bulk edit, restore-into-column)
// funnel through updateCard/createCard, so testing here covers them all.

// No fake-clock precedent in this suite — sample local today before AND after
// the write so a run spanning midnight can't flake.
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('updateCard transitioning into todo stamps start_date with local today, date-only', () => {
  const dir = tmpBoard(); // card 1 is done, no start_date
  const before = localToday();
  const c = cs.updateCard(dir, 1, { status: 'todo' });
  const after = localToday();
  assert.ok([before, after].includes(c.start_date), `stamped ${c.start_date}`);
  assert.match(c.start_date, /^\d{4}-\d{2}-\d{2}$/, 'date-only, no time tail');
  // lean-rule interaction: a stamped date is real data — the line is written
  assert.match(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8'), /^start_date: \d{4}-\d{2}-\d{2}$/m);
});

test('updateCard transitioning into done stamps end_date, and only end_date', () => {
  const dir = tmpBoard(); // card 2 is todo, no dates
  const before = localToday();
  const c = cs.updateCard(dir, 2, { status: 'done' });
  const after = localToday();
  assert.ok([before, after].includes(c.end_date), `stamped ${c.end_date}`);
  assert.strictEqual(c.start_date, null, 'landing in done never back-fills start_date');
  assert.match(fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8'), /^end_date: \d{4}-\d{2}-\d{2}$/m);
});

test('updateCard never clobbers an existing start_date/end_date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stamp-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: backlog\npriority: Normal\nstart_date: 2001-01-01\nend_date: 2002-02-02\n---\n\n# One\n\nbody\n`);
  const toTodo = cs.updateCard(dir, 1, { status: 'todo' });
  assert.strictEqual(toTodo.start_date, '2001-01-01');
  const toDone = cs.updateCard(dir, 1, { status: 'done' });
  assert.strictEqual(toDone.end_date, '2002-02-02');
});

test('updateCard whose status is unchanged stamps nothing', () => {
  const dir = tmpBoard(); // card 2 is already todo
  const same = cs.updateCard(dir, 2, { status: 'todo' });
  assert.strictEqual(same.start_date, null, 'todo -> todo is not a transition in');
  const noStatus = cs.updateCard(dir, 2, { priority: 'Low' });
  assert.strictEqual(noStatus.start_date, null, 'a statusless write stamps nothing');
});

test('updateCard into other statuses never stamps', () => {
  const dir = tmpBoard();
  const toDoing = cs.updateCard(dir, 2, { status: 'doing' }); // gate passes while blocker #1 is still done
  assert.strictEqual(toDoing.start_date, null);
  assert.strictEqual(toDoing.end_date, null);
  const toBacklog = cs.updateCard(dir, 1, { status: 'backlog' }); // done -> backlog
  assert.strictEqual(toBacklog.start_date, null);
  assert.strictEqual(toBacklog.end_date, null);
});

test('stamping is pinned to the literal lowercase values — Todo/Done do not stamp', () => {
  const dir = tmpBoard();
  const c1 = cs.updateCard(dir, 1, { status: 'Todo' }); // free-text status
  assert.strictEqual(c1.start_date, null);
  const c2 = cs.updateCard(dir, 1, { status: 'Done' });
  assert.strictEqual(c2.end_date, null);
});

test('an explicit date in the same PATCH wins over the stamp', () => {
  const dir = tmpBoard();
  const c = cs.updateCard(dir, 1, { status: 'todo', start_date: '2001-01-01' });
  assert.strictEqual(c.start_date, '2001-01-01');
});

test('a form-style blank date field does not defeat the stamp on its own move into todo', () => {
  const dir = tmpBoard(); // card 1 is done, no dates — the modal sends '' for empty fields
  const before = localToday();
  const c = cs.updateCard(dir, 1, {
    title: 'One', status: 'todo', priority: 'Normal',
    tags: [], waiting_for: [], assignee: '', start_date: '', end_date: '', due_date: '', body: 'b',
  });
  const after = localToday();
  assert.ok([before, after].includes(c.start_date), 'the blank cleared, then the transition stamped');
});

test('createCard directly into todo stamps start_date; into done stamps end_date; backlog stamps nothing', () => {
  const dir = tmpBoard();
  const before = localToday();
  const born = cs.createCard(dir, { title: 'Born In Todo', status: 'todo' });
  const done = cs.createCard(dir, { title: 'Born In Done', status: 'done' });
  const idle = cs.createCard(dir, { title: 'Born In Backlog', status: 'backlog' });
  const after = localToday();
  assert.ok([before, after].includes(born.start_date));
  assert.strictEqual(born.end_date, null);
  assert.ok([before, after].includes(done.end_date));
  assert.strictEqual(done.start_date, null);
  assert.strictEqual(idle.start_date, null);
  assert.strictEqual(idle.end_date, null);
  // the stamp is real data and keeps the triad's natural line order
  assert.match(fs.readFileSync(cs.findCardFile(dir, born.id), 'utf8'), /^start_date: \d{4}-\d{2}-\d{2}$/m);
});

test('createCard with an explicit date is never clobbered by the stamp', () => {
  const dir = tmpBoard();
  const c = cs.createCard(dir, { title: 'Explicit', status: 'todo', start_date: '2001-01-01' });
  assert.strictEqual(c.start_date, '2001-01-01');
  const d = cs.createCard(dir, { title: 'Explicit End', status: 'done', end_date: '2002-02-02' });
  assert.strictEqual(d.end_date, '2002-02-02');
});

test('a compat range (start + due, no end) landing in done gains a real end_date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-stamp-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: doing\npriority: Normal\nstart_date: 2026-07-01\ndue_date: 2026-07-20\n---\n\n# One\n\nbody\n`);
  const before = localToday();
  const c = cs.updateCard(dir, 1, { status: 'done' });
  const after = localToday();
  assert.ok([before, after].includes(c.end_date), 'done IS the range\'s end — the stamp is intended');
  assert.strictEqual(c.start_date, '2026-07-01');
  assert.strictEqual(c.due_date, '2026-07-20');
});

// --- `epic: true` — the optional epic/wayfinder flag. A MANAGED
// boolean field under the lean rule: set writes exactly `epic: true`,
// unset writes NO line (never a literal `epic: false`). Never validated —
// the reader is tolerant (any-case 'true' reads epic; anything else doesn't),
// and the writer normalizes API-shaped junk ('true'/'false' strings) so a
// JSON string can't sneak a truthy-but-false line onto disk.

test('createCard with epic: true writes the `epic: true` line; reader and toJSON carry it', () => {
  const dir = tmpBoard();
  const card = cs.createCard(dir, { title: 'Wayfinder', status: 'todo', epic: true });
  assert.strictEqual(card.epic, true);
  assert.strictEqual(cs.toJSON(card).epic, true);
  const raw = fs.readFileSync(cs.findCardFile(dir, card.id), 'utf8');
  assert.match(raw, /^epic: true$/m);
});

test('createCard without epic (or epic: false) writes NO epic line — the lean rule', () => {
  const dir = tmpBoard();
  const plain = cs.createCard(dir, { title: 'Plain', status: 'todo' });
  const unchecked = cs.createCard(dir, { title: 'Unchecked', status: 'todo', epic: false });
  for (const c of [plain, unchecked]) {
    assert.strictEqual(c.epic, false);
    assert.strictEqual(cs.toJSON(c).epic, false);
    assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, c.id), 'utf8'), /^epic:/m,
      'unset epic is no data — no line, never `epic: false`');
  }
});

test('updateCard epic: true adds the line; epic: false removes it — round-trip', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { epic: true });
  let raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^epic: true$/m);
  const cleared = cs.updateCard(dir, 2, { epic: false });
  assert.strictEqual(cleared.epic, false);
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^epic:/m, 'unchecking on edit removes the line entirely');
});

test('updateCard leaves an existing epic line alone when epic is not in the patch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-'));
  fs.writeFileSync(path.join(dir, '0001.one.card.md'),
    `---\nid: 1\nstatus: todo\npriority: Normal\nepic: true\n---\n\n# One\n\nbody\n`);
  cs.updateCard(dir, 1, { priority: 'High' });
  assert.match(fs.readFileSync(path.join(dir, '0001.one.card.md'), 'utf8'), /^epic: true$/m,
    'only managed CHANGES apply the rule — an untouched field is not rewritten');
});

test('reader is tolerant: any-case `epic: True` reads epic; other values do not (never validated)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nepic: True\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\nepic: yes\n---\n\n# B\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0003.c.card.md'),
    `---\nid: 3\nstatus: todo\n---\n\n# C\n\nbody\n`);
  assert.strictEqual(cs.readCardFile(path.join(dir, '0001.a.card.md')).epic, true, 'hand-typed True still reads epic');
  assert.strictEqual(cs.readCardFile(path.join(dir, '0002.b.card.md')).epic, false, 'non-true free text is not epic — tolerated on READ (a write that includes epic rewrites it; see the PATCH-over-junk test below)');
  assert.strictEqual(cs.readCardFile(path.join(dir, '0003.c.card.md')).epic, false, 'missing line defaults false');
});

test('a form-style PATCH over a hand-typed non-true value REMOVES the line — deliberate: epic is managed, junk cannot round-trip the form', () => {
  // `epic: yes` reads as not-epic, so the edit form opens with the checkbox
  // unchecked and submits epic: false alongside any unrelated change — the
  // junk line is then cleared by the lean rule. That's the CHOSEN
  // behavior (unlike priority/dates, whose free-text inputs re-emit junk
  // verbatim, the checkbox has no way to carry it): pin it so the data-loss
  // edge stays a decision, not an accident. Documented in the web SKILL.md's
  // epic bullet.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-epic-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nepic: yes\n---\n\n# A\n\nbody\n`);
  cs.updateCard(dir, 1, { title: 'A retitled', epic: false }); // what submitModal sends for a title-only edit
  const raw = fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^epic:/m, 'the junk epic line is gone after an unrelated edit');
  assert.match(raw, /^# A retitled$/m, 'the unrelated edit itself landed');
});

test('API-shaped junk: string \'true\' sets, string \'false\'/empty/null clear — no truthy-string trap', () => {
  const dir = tmpBoard();
  const viaString = cs.createCard(dir, { title: 'Stringly', status: 'todo', epic: 'true' });
  assert.strictEqual(viaString.epic, true);
  const falseString = cs.createCard(dir, { title: 'False String', status: 'todo', epic: 'false' });
  assert.strictEqual(falseString.epic, false);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, falseString.id), 'utf8'), /^epic:/m,
    "a JSON 'false' string is unset — a plain truthy gate would have written `epic: true`");
  cs.updateCard(dir, viaString.id, { epic: 'false' });
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, viaString.id), 'utf8'), /^epic:/m);
  cs.updateCard(dir, falseString.id, { epic: 'true' });
  assert.match(fs.readFileSync(cs.findCardFile(dir, falseString.id), 'utf8'), /^epic: true$/m);
  cs.updateCard(dir, falseString.id, { epic: null });
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, falseString.id), 'utf8'), /^epic:/m, 'null clears too');
});

// --- the blocked sticker in the store — parse, serialize (lean
// rule judged by the shared predicate), and its half of the doing entry gate.

test('readCardFile parses the blocked sticker verbatim (quotes stripped) and defaults it to null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-blk-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nblocked: "legal sign-off pending"\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\n---\n\n# B\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0003.c.card.md'),
    `---\nid: 3\nstatus: todo\nblocked: false\n---\n\n# C\n\nbody\n`);
  const byId = new Map(cs.listActive(dir).map((c) => [c.id, c]));
  assert.strictEqual(byId.get(1).blocked, 'legal sign-off pending');
  assert.strictEqual(byId.get(2).blocked, null, 'no line = null, never an empty string');
  assert.strictEqual(byId.get(3).blocked, 'false', 'a hand-written false round-trips for display; the predicate says not blocked');
});

test('updateCard writes a valid blocked reason and strips an invalid/clear one — the lean rule via the predicate', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { blocked: '  vendor outage  ' });
  let raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^blocked: vendor outage$/m, 'trimmed reason written verbatim');
  cs.updateCard(dir, 2, { blocked: '' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^blocked:/m, 'a blank clears — the line is removed, never `blocked: ` boilerplate');
  cs.updateCard(dir, 2, { blocked: 'false' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^blocked:/m, 'the YAML-false special-case is "clear" — never written as `blocked: false`');
  cs.updateCard(dir, 2, { blocked: '!!!' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^blocked:/m, 'no-alphanumeric junk is not a valid sticker — stripped');
  cs.updateCard(dir, 2, { blocked: true });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^blocked: true$/m, 'an API boolean true writes the bare sticker — blocked, reason unspecified');
});

test('updateCard leaves an on-disk blocked line alone when the PATCH does not mention it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-blk-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nblocked: needs the grill\n---\n\n# A\n\nbody\n`);
  cs.updateCard(dir, 1, { priority: 'High' });
  assert.match(fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8'), /^blocked: needs the grill$/m);
});

test('createCard writes a valid blocked sticker and drops an invalid one', () => {
  const dir = tmpBoard();
  const stickered = cs.createCard(dir, { title: 'Stickered', status: 'todo', blocked: 'spec unclear' });
  assert.strictEqual(stickered.blocked, 'spec unclear');
  assert.match(fs.readFileSync(cs.findCardFile(dir, stickered.id), 'utf8'), /^blocked: spec unclear$/m);
  const clear = cs.createCard(dir, { title: 'Clear', status: 'todo', blocked: '   ' });
  assert.strictEqual(clear.blocked, null);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, clear.id), 'utf8'), /^blocked:/m);
});

test('updateCard to doing is refused while BLOCKED, naming the reason', () => {
  const dir = tmpBoard(); // card 1 is done — never waiting
  cs.updateCard(dir, 1, { blocked: 'legal sign-off pending' });
  assert.throws(() => cs.updateCard(dir, 1, { status: 'doing' }), (e) => {
    assert.strictEqual(e.name, 'BlockedError');
    assert.strictEqual(e.reason, 'legal sign-off pending');
    assert.strictEqual(e.message, 'blocked: legal sign-off pending');
    return true;
  });
});

test('a bare `blocked: true` refuses doing entry with the reason unspecified', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { blocked: true });
  assert.throws(() => cs.updateCard(dir, 1, { status: 'doing' }), (e) => {
    assert.strictEqual(e.name, 'BlockedError');
    assert.strictEqual(e.reason, '');
    assert.strictEqual(e.message, 'blocked');
    return true;
  });
});

test('blocked: false / whitespace-only / junk on disk never gate doing entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-blk-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nblocked: false\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\nblocked: !!!\n---\n\n# B\n\nbody\n`);
  assert.strictEqual(cs.updateCard(dir, 1, { status: 'doing' }).status, 'doing');
  assert.strictEqual(cs.updateCard(dir, 2, { status: 'doing' }).status, 'doing');
});

test('no eviction: blocking (or adding a dep to) a card already in doing goes through and keeps its column — entry-only gate', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { status: 'doing' }); // done card, no deps — enters freely
  // form-style same-status save carrying the new sticker AND status: 'doing'
  const blocked = cs.updateCard(dir, 1, { status: 'doing', blocked: 'vendor outage' });
  assert.strictEqual(blocked.status, 'doing', 'kept its column');
  assert.strictEqual(blocked.blocked, 'vendor outage');
  // adding a not-done dep to a doing card is not entry either
  const waiting = cs.updateCard(dir, 1, { status: 'doing', waiting_for: [2] });
  assert.strictEqual(waiting.status, 'doing');
  assert.deepStrictEqual(waiting.waiting_for, [2]);
});

test('the gate uses the EFFECTIVE blocked value — clearing the sticker in the same PATCH allows doing', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 1, { blocked: 'stale sticker' });
  const ok = cs.updateCard(dir, 1, { status: 'doing', blocked: '' });
  assert.strictEqual(ok.status, 'doing');
  // and the reverse: a PATCH that sets the sticker WHILE entering is refused
  // (waiting_for cleared in the same PATCH — card 1 just left done above, and
  // the waiting gate is checked first, so this isolates the blocked half)
  assert.throws(() => cs.updateCard(dir, 2, { status: 'doing', waiting_for: [], blocked: 'not yet' }),
    (e) => e.name === 'BlockedError');
});

test('hard cutover: a legacy blocked_by line carries no edges but survives verbatim as unmanaged frontmatter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-legacy-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nblocked_by: [2]\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\n---\n\n# B\n\nbody\n`);
  const card = cs.listActive(dir).find((c) => c.id === 1);
  assert.deepStrictEqual(card.waiting_for, [], 'no reader honors the old name');
  assert.strictEqual(cs.updateCard(dir, 1, { status: 'doing' }).status, 'doing', 'legacy edges never gate');
  assert.match(fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8'), /^blocked_by: \[2\]$/m,
    'the unmanaged line is preserved verbatim for a later migration');
});

// --- ADR 0009: the review sticker — blocked's sibling, no gate --

test('readCardFile parses the review sticker verbatim (quotes stripped) and defaults it to null (ADR 0009)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-rev-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nreview: "PR #6"\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'),
    `---\nid: 2\nstatus: todo\n---\n\n# B\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0003.c.card.md'),
    `---\nid: 3\nstatus: todo\nreview: false\n---\n\n# C\n\nbody\n`);
  const byId = new Map(cs.listActive(dir).map((c) => [c.id, c]));
  assert.strictEqual(byId.get(1).review, 'PR #6');
  assert.strictEqual(byId.get(2).review, null, 'no line = null, never an empty string');
  assert.strictEqual(byId.get(3).review, 'false', 'a hand-written false round-trips for display; the predicate says not in review');
});

test('updateCard writes a valid review value and strips an invalid/clear one — same lean rule as blocked (ADR 0009)', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { review: '  PR #6  ' });
  let raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^review: PR #6$/m, 'trimmed text written verbatim');
  cs.updateCard(dir, 2, { review: '' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^review:/m, 'a blank clears — the line is removed, never `review: ` boilerplate');
  cs.updateCard(dir, 2, { review: 'false' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^review:/m, 'the YAML-false special-case is "clear" — never written as `review: false`');
  cs.updateCard(dir, 2, { review: '!!!' });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.doesNotMatch(raw, /^review:/m, 'no-alphanumeric junk is not a valid sticker — stripped');
  cs.updateCard(dir, 2, { review: true });
  raw = fs.readFileSync(path.join(dir, 'two.card.md'), 'utf8');
  assert.match(raw, /^review: true$/m, 'an API boolean true writes the bare sticker — review, text unspecified');
});

test('updateCard leaves an on-disk review line alone when the PATCH does not mention it (ADR 0009)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-rev-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nreview: PR #6\n---\n\n# A\n\nbody\n`);
  cs.updateCard(dir, 1, { priority: 'High' });
  assert.match(fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8'), /^review: PR #6$/m);
});

test('createCard writes a valid review sticker and drops an invalid one (ADR 0009)', () => {
  const dir = tmpBoard();
  const stickered = cs.createCard(dir, { title: 'Stickered', status: 'todo', review: 'PR #6' });
  assert.strictEqual(stickered.review, 'PR #6');
  assert.match(fs.readFileSync(cs.findCardFile(dir, stickered.id), 'utf8'), /^review: PR #6$/m);
  const clear = cs.createCard(dir, { title: 'Clear', status: 'todo', review: '   ' });
  assert.strictEqual(clear.review, null);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, clear.id), 'utf8'), /^review:/m);
});

test('review does NOT gate doing entry, unlike blocked — updateCard and createCard both succeed straight into doing (ADR 0009)', () => {
  const dir = tmpBoard(); // card 1 is done — never waiting
  cs.updateCard(dir, 1, { review: 'PR #6' });
  const moved = cs.updateCard(dir, 1, { status: 'doing' });
  assert.strictEqual(moved.status, 'doing');
  assert.strictEqual(moved.review, 'PR #6', 'the sticker survives the move — no eviction, no clearing');
  const born = cs.createCard(dir, { title: 'In review at birth', status: 'doing', review: 'PR #9' });
  assert.strictEqual(born.status, 'doing');
  assert.strictEqual(born.review, 'PR #9');
});

// --- the `prompt` field — a signal FOR the AI, opposite --
// polarity to blocked/review (signals FROM the card TO a human). Joins their
// family in the store (same lean rule) but is not a sticker: no predicate, no
// doing-gate involvement. Always single-line-quoted, unlike blocked/review's
// bare verbatim write.

test('readCardFile parses a quoted prompt (quotes+escapes undone) and defaults it to null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'),
    `---\nid: 1\nstatus: todo\nprompt: "say \\"hi\\" — see #6: ok?"\n---\n\n# A\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '0002.b.card.md'), `---\nid: 2\nstatus: todo\n---\n\n# B\n\nbody\n`);
  const byId = new Map(cs.listActive(dir).map((c) => [c.id, c]));
  assert.strictEqual(byId.get(1).prompt, 'say "hi" — see #6: ok?', 'quotes stripped, escapes undone');
  assert.strictEqual(byId.get(2).prompt, null, 'no line = null, never an empty string');
});

test('readCardFile tolerates a hand-typed unquoted prompt line (never validated)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'), `---\nid: 1\nstatus: todo\nprompt: rerun the tests\n---\n\n# A\n\nbody\n`);
  assert.strictEqual(cs.listActive(dir)[0].prompt, 'rerun the tests');
});

test('updateCard writes a prompt quoted (colons/hashes/quotes survive) and a blank clears the line (lean rule)', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { prompt: '  investigate #6: is the fix "done"?  ' });
  let raw = fs.readFileSync(cs.findCardFile(dir, 2), 'utf8');
  assert.match(raw, /^prompt: "investigate #6: is the fix \\"done\\"\?"$/m, 'trimmed, quoted, internal quotes escaped');
  const reread = cs.readCardFile(cs.findCardFile(dir, 2));
  assert.strictEqual(reread.prompt, 'investigate #6: is the fix "done"?', 'round-trips exactly through write+read');
  cs.updateCard(dir, 2, { prompt: '' });
  raw = fs.readFileSync(cs.findCardFile(dir, 2), 'utf8');
  assert.doesNotMatch(raw, /^prompt:/m, 'a blank clears — the line is removed, never `prompt: ""` boilerplate');
  cs.updateCard(dir, 2, { prompt: '   ' });
  raw = fs.readFileSync(cs.findCardFile(dir, 2), 'utf8');
  assert.doesNotMatch(raw, /^prompt:/m, 'whitespace-only is no data either');
});

test('updateCard collapses an embedded newline in prompt to a space — frontmatter is one value per physical line', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { prompt: 'line one\nline two' });
  const raw = fs.readFileSync(cs.findCardFile(dir, 2), 'utf8');
  assert.match(raw, /^prompt: "line one line two"$/m);
  assert.strictEqual((raw.match(/^prompt:/gm) || []).length, 1, 'never splits into a second frontmatter line');
});

test('updateCard leaves an on-disk prompt line alone when the PATCH does not mention it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '0001.a.card.md'), `---\nid: 1\nstatus: todo\nprompt: "keep me"\n---\n\n# A\n\nbody\n`);
  cs.updateCard(dir, 1, { title: 'renamed' });
  assert.match(fs.readFileSync(path.join(dir, '0001.a.card.md'), 'utf8'), /^prompt: "keep me"$/m);
});

test('createCard writes a quoted prompt and omits the line when blank (lean rule)', () => {
  const dir = tmpBoard();
  const withPrompt = cs.createCard(dir, { title: 'Queued', status: 'todo', prompt: 'apply the review feedback' });
  assert.strictEqual(withPrompt.prompt, 'apply the review feedback');
  assert.match(fs.readFileSync(cs.findCardFile(dir, withPrompt.id), 'utf8'), /^prompt: "apply the review feedback"$/m);
  const clear = cs.createCard(dir, { title: 'No prompt', status: 'todo', prompt: '   ' });
  assert.strictEqual(clear.prompt, null);
  assert.doesNotMatch(fs.readFileSync(cs.findCardFile(dir, clear.id), 'utf8'), /^prompt:/m);
});

test('prompt never gates doing entry — unlike blocked, and unlike review it carries no predicate at all', () => {
  const dir = tmpBoard(); // card 1 is done — never waiting
  const born = cs.createCard(dir, { title: 'Straight into doing', status: 'doing', prompt: 'go' });
  assert.strictEqual(born.status, 'doing');
  const moved = cs.updateCard(dir, 1, { status: 'doing', prompt: 'still fine' });
  assert.strictEqual(moved.status, 'doing');
  assert.strictEqual(moved.prompt, 'still fine', 'the field survives the move — no eviction, no clearing');
});

test('toJSON carries prompt in the public card shape', () => {
  const dir = tmpBoard();
  cs.updateCard(dir, 2, { prompt: 'do the thing' });
  const j = cs.toJSON(cs.readCardFile(cs.findCardFile(dir, 2)));
  assert.strictEqual(j.prompt, 'do the thing');
});

// --- `parent` — epic membership id -------------------------------

test('readCardFile parses parent as a number, null when absent or non-numeric; toJSON carries it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '0001.child.card.md'), '---\nid: 1\nstatus: todo\nparent: 42\n---\n\n# Child\n');
  fs.writeFileSync(path.join(dir, '0002.plain.card.md'), '---\nid: 2\nstatus: todo\n---\n\n# Plain\n');
  fs.writeFileSync(path.join(dir, '0003.junk.card.md'), '---\nid: 3\nstatus: todo\nparent: soon\n---\n\n# Junk parent\n');
  const cards = cs.listActive(dir);
  const byId = new Map(cards.map((c) => [c.id, c]));
  assert.strictEqual(byId.get(1).parent, 42);
  assert.strictEqual(byId.get(2).parent, null);
  assert.strictEqual(byId.get(3).parent, null, 'tolerant read: non-numeric parent is no membership, never fatal');
  assert.strictEqual(cs.toJSON(byId.get(1)).parent, 42);
  assert.strictEqual(cs.toJSON(byId.get(2)).parent, null);
});

test('updateCard preserves a parent line verbatim — form-unmanaged frontmatter, lean rule untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-'));
  fs.writeFileSync(path.join(dir, '0001.child.card.md'), '---\nid: 1\nstatus: todo\nparent: 42\n---\n\n# Child\n');
  cs.updateCard(dir, 1, { priority: 'High' });
  const raw = fs.readFileSync(path.join(dir, '0001.child.card.md'), 'utf8');
  assert.match(raw, /^parent: 42$/m);
});

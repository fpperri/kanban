const { test } = require('node:test');
const assert = require('node:assert');
const n = require('../web/notes');

// The known targets of a fixture board: cards 7, 22 and G3; the board is called plan.
const KNOWN = { board: 'plan', isTarget: (id) => ['7', '22', 'G3'].includes(id) };
const CTX = { today: '2026-10-16', now: '16:40', lastNoted: '7' };
const field = (value, untimed = false) => ({ value, untimed });

// --- the line ---------------------------------------------------------------------------------

test('a leading HH:MM in the line is the note\'s time and is cut from its text', () => {
  const p = n.noteParseLine('10:30 renamed order_state', KNOWN);
  assert.deepStrictEqual([p.at, p.untimed, p.text, p.bad], ['10:30', false, 'renamed order_state', '']);
  assert.strictEqual(n.noteParseLine('9.05 early', KNOWN).at, '09:05');
  assert.strictEqual(n.noteParseLine('10:30', KNOWN).text, '');
});

test('a time that is not a time is reported and the text after it kept', () => {
  const p = n.noteParseLine('25:00 late', KNOWN);
  assert.match(p.bad, /25:00/);
  assert.strictEqual(p.at, null);
  assert.match(n.noteParseLine('10:75 x', KNOWN).bad, /10:75/);
});

test('a time in the middle of the text is only text', () => {
  const p = n.noteParseLine('moved the 10:30 call', KNOWN);
  assert.deepStrictEqual([p.at, p.untimed, p.text], [null, false, 'moved the 10:30 call']);
});

test('a leading - or the word untimed marks the note untimed', () => {
  assert.deepStrictEqual(n.noteParseLine('- ask ops', KNOWN).untimed, true);
  assert.strictEqual(n.noteParseLine('- ask ops', KNOWN).text, 'ask ops');
  assert.strictEqual(n.noteParseLine('untimed ask ops', KNOWN).untimed, true);
  assert.strictEqual(n.noteParseLine('Untimed ask ops', KNOWN).text, 'ask ops');
  assert.strictEqual(n.noteParseLine('-5 degrees', KNOWN).untimed, false);
  assert.strictEqual(n.noteParseLine('untimed-ish', KNOWN).untimed, false);
});

test('a leading mention of a known card aims the note and is cut from its text', () => {
  const p = n.noteParseLine('#22 mid check', KNOWN);
  assert.deepStrictEqual([p.mention, p.text, p.bare], ['22', 'mid check', false]);
  assert.strictEqual(n.noteParseLine('#22: mid check', KNOWN).text, 'mid check');
  assert.strictEqual(n.noteParseLine('plan#G3 reread', KNOWN).mention, 'G3');
});

test('a mention after the first word, or of a card the board lacks, or of another board, is text', () => {
  for (const line of ['blocked by #22', 'see #22 for more', '#99 nobody', 'other#22 elsewhere', '#a371f7 colour', '#g3 lower']) {
    const p = n.noteParseLine(line, KNOWN);
    assert.strictEqual(p.mention, null, line);
    assert.strictEqual(p.text, line, line);
  }
});

test('a time then a mention: both are read, in that order', () => {
  const p = n.noteParseLine('10:30 #22 mid check', KNOWN);
  assert.deepStrictEqual([p.at, p.mention, p.text], ['10:30', '22', 'mid check']);
});

test('a line that is only a mention is bare: Enter aims the palette instead of writing', () => {
  assert.strictEqual(n.noteParseLine('#22', KNOWN).bare, true);
  assert.strictEqual(n.noteParseLine('  #22  ', KNOWN).bare, true);
  assert.strictEqual(n.noteParseLine('#22 x', KNOWN).bare, false);
  assert.strictEqual(n.noteParseLine('10:30 #22', KNOWN).bare, false, 'a time with it is a note about to be written');
  assert.strictEqual(n.noteParseLine('', KNOWN).bare, false);
});

test('only the first line carries the time, the marker and the mention; later lines are text', () => {
  const p = n.noteParseLine('10:30 first\n#22 second\n- third', KNOWN);
  assert.deepStrictEqual([p.at, p.mention, p.text], ['10:30', null, 'first\n#22 second\n- third']);
});

// --- what Enter writes --------------------------------------------------------------------------

test('the time comes from the line, else the untimed tick, else the time field, else now', () => {
  const plan = (raw, f, subject = { kind: 'none', day: '2026-10-16' }) => n.noteWritePlan(n.noteParseLine(raw, KNOWN), subject, f, CTX);
  assert.strictEqual(plan('10:30 x', field('12:00')).at, '10:30');
  assert.strictEqual(plan('- x', field('12:00')).at, null);
  assert.strictEqual(plan('x', field('12:00', true)).at, null);
  assert.strictEqual(plan('x', field('12:00')).at, '12:00');
  assert.strictEqual(plan('x', field('1230')).at, '12:30');
  assert.strictEqual(plan('x', field('')).at, '16:40');
  assert.strictEqual(plan('x', field(''), { kind: 'untimed', day: '2026-10-15' }).at, null);
  assert.match(plan('x', field('9:7')).bad, /9:7/);
});

test('the target comes from a leading mention, else the chip, else the card last noted, else nothing', () => {
  const plan = (raw, subject) => n.noteWritePlan(n.noteParseLine(raw, KNOWN), subject, field('09:00'), CTX);
  const card = { kind: 'card', id: '22', day: '2026-10-16' };
  assert.deepStrictEqual([plan('#7 x', card).target, plan('#7 x', card).from], ['7', 'line']);
  assert.deepStrictEqual([plan('x', card).target, plan('x', card).from], ['22', 'chip']);
  assert.deepStrictEqual([plan('x', { kind: 'none', day: '2026-10-16' }).target, plan('x', { kind: 'none', day: '2026-10-16' }).from], ['7', 'last']);
  assert.deepStrictEqual([n.noteWritePlan(n.noteParseLine('x', KNOWN), { kind: 'none', day: '2026-10-16' }, field('09:00'), { ...CTX, lastNoted: '' }).target], ['']);
  assert.strictEqual(plan('x', { kind: 'slot', day: '2026-10-14', at: '08:00' }).day, '2026-10-14');
});

test('a bare mention is the scope to move to, not a note', () => {
  const plan = n.noteWritePlan(n.noteParseLine('#22', KNOWN), { kind: 'slot', day: '2026-10-14', at: '08:00' }, field('08:00'), CTX);
  assert.strictEqual(plan.scopeTo, '22');
  assert.strictEqual(n.noteWritePlan(n.noteParseLine('#22 x', KNOWN), { kind: 'none', day: '2026-10-16' }, field('08:00'), CTX).scopeTo, null);
});

test('the preview says what Enter will write', () => {
  const label = (id) => ({ 7: '#7 Port the zephyr schema', 22: '#22 Plan the cutover', '': 'no card' }[id]);
  const prev = (raw, subject, f = field('10:30')) => n.notePreview(n.noteWritePlan(n.noteParseLine(raw, KNOWN), subject, f, CTX), { label, dayName: (d) => `Day ${d.slice(8)}`, today: CTX.today });
  assert.strictEqual(prev('x', { kind: 'card', id: '7', day: CTX.today }), 'Note at 10:30 on #7 Port the zephyr schema');
  assert.strictEqual(prev('x', { kind: 'card', id: '7', day: CTX.today }, field('', true)), 'Untimed note on #7 Port the zephyr schema');
  assert.strictEqual(prev('#22 x', { kind: 'card', id: '7', day: CTX.today }), 'Note at 10:30 on #22 Plan the cutover');
  assert.strictEqual(prev('x', { kind: 'none', day: CTX.today }), 'Note at 10:30 on #7 Port the zephyr schema (last noted)');
  assert.strictEqual(prev('x', { kind: 'slot', day: '2026-10-14', at: '08:00' }), 'Note at 10:30, Day 14, on #7 Port the zephyr schema (last noted)');
  assert.strictEqual(prev('#22', { kind: 'none', day: CTX.today }), 'Open #22 Plan the cutover, then type the note');
  assert.strictEqual(prev('25:00 x', { kind: 'none', day: CTX.today }), '25:00 is not a time; a time reads HH:MM.');
  assert.strictEqual(prev('', { kind: 'card', id: '7', day: CTX.today }), 'Note at 10:30 on #7 Port the zephyr schema · type the note');
});

test('the time field reads H:MM, HH:MM, HH.MM and HMM', () => {
  assert.strictEqual(n.noteFieldTime('9:30'), '09:30');
  assert.strictEqual(n.noteFieldTime('09.30'), '09:30');
  assert.strictEqual(n.noteFieldTime('0930'), '09:30');
  assert.strictEqual(n.noteFieldTime('930'), '09:30');
  assert.strictEqual(n.noteFieldTime('24:00'), null);
  assert.strictEqual(n.noteFieldTime('9:7'), null);
  assert.strictEqual(n.noteFieldTime(''), null);
});

// --- the subject ---------------------------------------------------------------------------------

test('a subject is what the palette is about: a card, a group, a slot of a day, a day\'s untimed notes, or nothing', () => {
  const is = { today: CTX.today, isGroup: (id) => id === 'W2' };
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'card-notes', id: '7' }, is), { kind: 'card', id: '7', day: '2026-10-16' });
  assert.deepStrictEqual(n.noteSubjectFrom({ target: '22' }, is), { kind: 'card', id: '22', day: '2026-10-16' });
  assert.deepStrictEqual(n.noteSubjectFrom({ target: 'W2' }, is), { kind: 'group', id: 'W2', day: '2026-10-16' });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'group', gid: 'W2' }, is), { kind: 'group', id: 'W2', day: '2026-10-16' });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600 }, is), { kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600, at: '09:00' });
  assert.deepStrictEqual(n.noteSubjectFrom({ kind: 'untimed', day: '2026-10-14' }, is), { kind: 'untimed', day: '2026-10-14' });
  assert.deepStrictEqual(n.noteSubjectFrom({}, is), { kind: 'none', day: '2026-10-16' });
  assert.deepStrictEqual(n.noteSubjectFrom({ target: '' }, is), { kind: 'none', day: '2026-10-16' });
});

test('clearing the chip goes back to the slot it came from, else to nothing', () => {
  const slot = { kind: 'slot', day: '2026-10-14', fromMin: 540, toMin: 600, at: '09:00' };
  const aimed = n.noteSubjectAimed(slot, '22');
  assert.deepStrictEqual([aimed.kind, aimed.id, aimed.day, aimed.at, aimed.when], ['card', '22', '2026-10-14', '09:00', slot]);
  assert.deepStrictEqual(n.noteSubjectCleared(aimed, CTX.today), slot);
  assert.deepStrictEqual(n.noteSubjectCleared({ kind: 'card', id: '7', day: '2026-10-16' }, CTX.today), { kind: 'none', day: CTX.today });
  const untimedAim = n.noteSubjectAimed({ kind: 'untimed', day: '2026-10-14' }, '22');
  assert.deepStrictEqual([untimedAim.kind, untimedAim.untimed, untimedAim.when.kind], ['card', true, 'untimed']);
  const fromNone = n.noteSubjectAimed({ kind: 'none', day: CTX.today }, '22');
  assert.deepStrictEqual([fromNone.kind, fromNone.id, fromNone.when], ['card', '22', undefined]);
});

test('the notes a subject lists', () => {
  const note = (day, target, at, text) => ({ day, target, at, by: '@human', note: text, index: 0, file: 'f' });
  const all = [
    note('2026-10-16', '7', '09:10', 'a'), note('2026-10-15', '7', '10:00', 'b'), note('2026-10-16', '22', '09:40', 'c'),
    note('2026-10-16', '', null, 'd'), note('2026-10-16', '7', '10:20', 'e'),
  ];
  const texts = (subject) => n.noteSubjectNotes(all, subject).map((x) => x.note).sort();
  assert.deepStrictEqual(texts({ kind: 'card', id: '7', day: '2026-10-16' }), ['a', 'b', 'e']);
  assert.deepStrictEqual(texts({ kind: 'none', day: '2026-10-16' }), ['a', 'c', 'd', 'e']);
  assert.deepStrictEqual(texts({ kind: 'slot', day: '2026-10-16', fromMin: 540, toMin: 600 }), ['a', 'c']);
  assert.deepStrictEqual(texts({ kind: 'untimed', day: '2026-10-16' }), ['d']);
});

// --- the list ------------------------------------------------------------------------------------

test('the list groups notes by day then target, newest day first, the chip\'s target first, nothing last', () => {
  const note = (day, target, at, text) => ({ day, target, at, by: '@human', note: text, index: 0, file: 'f' });
  const groups = n.noteGroups([
    note('2026-10-15', '7', '10:00', 'old'), note('2026-10-16', '22', '09:40', 'c'), note('2026-10-16', '', null, 'free'),
    note('2026-10-16', '7', null, 'untimed'), note('2026-10-16', '7', '09:10', 'a'), note('2026-10-16', 'G3', '07:00', 'g'),
  ], { first: '22' });
  assert.deepStrictEqual(groups.map((g) => [g.day, g.target, g.notes.map((x) => x.note)]), [
    ['2026-10-16', '22', ['c']],
    ['2026-10-16', '7', ['a', 'untimed']],
    ['2026-10-16', 'G3', ['g']],
    ['2026-10-16', '', ['free']],
    ['2026-10-15', '7', ['old']],
  ]);
});

test('the timeline is one flat list per day, newest day first, the timed notes in time order and then the untimed ones', () => {
  const note = (day, target, at, text, index = 0) => ({ day, target, at, by: '@human', note: text, index, file: 'f' });
  const days = n.noteTimeline([
    note('2026-10-15', '7', '10:00', 'old'), note('2026-10-16', '22', '09:40', 'c'), note('2026-10-16', '', null, 'free'),
    note('2026-10-16', '7', null, 'untimed'), note('2026-10-16', '7', '09:10', 'a'), note('2026-10-16', 'G3', '07:00', 'g'),
  ]);
  assert.deepStrictEqual(days.map((d) => [d.day, d.notes.map((x) => x.note)]), [
    ['2026-10-16', ['g', 'a', 'c', 'untimed', 'free']],
    ['2026-10-15', ['old']],
  ]);
});

test('in the timeline two notes at one time keep the chip\'s target first, then the id order, then the file order', () => {
  const note = (target, text, index = 0) => ({ day: '2026-10-16', target, at: '09:00', by: '@human', note: text, index, file: 'f' });
  const order = (first) => n.noteTimeline([note('G3', 'g'), note('7', 'b', 1), note('7', 'a', 0), note('', 'none'), note('22', 'c')], { first })[0].notes.map((x) => x.note);
  assert.deepStrictEqual(order(null), ['a', 'b', 'c', 'g', 'none']);
  assert.deepStrictEqual(order('22'), ['c', 'a', 'b', 'g', 'none']);
});

test('the timeline of no notes is no days', () => {
  assert.deepStrictEqual(n.noteTimeline([]), []);
});

test('the filter narrows by every word, in the text or the card\'s label, without regard to case', () => {
  const note = (target, text) => ({ day: '2026-10-16', target, at: '09:00', by: '@human', note: text, index: 0, file: 'f' });
  const all = [note('7', 'Renamed ORDER_STATE'), note('22', 'order cutover'), note('', 'standup')];
  const label = (id) => ({ 7: '#7 Port the zephyr schema', 22: '#22 Plan', '': 'no card' }[id]);
  const find = (text) => n.noteFilter(all, text, label).map((x) => x.note);
  assert.deepStrictEqual(find(''), ['Renamed ORDER_STATE', 'order cutover', 'standup']);
  assert.deepStrictEqual(find('order'), ['Renamed ORDER_STATE', 'order cutover']);
  assert.deepStrictEqual(find('order state'), ['Renamed ORDER_STATE']);
  assert.deepStrictEqual(find('zephyr'), ['Renamed ORDER_STATE']);
  assert.deepStrictEqual(find('nothing like it'), []);
});

test('a card\'s notes are counted by target', () => {
  const counts = n.noteCounts([{ target: '7' }, { target: '7' }, { target: '' }, { target: 'G3' }]);
  assert.strictEqual(counts.get('7'), 2);
  assert.strictEqual(counts.get('G3'), 1);
  assert.strictEqual(counts.get('22'), undefined);
});

test('a note\'s ref carries what the server needs to find it again', () => {
  const note = { day: '2026-10-16', target: '7', index: 2, at: '09:10', by: '@human', note: 'a', file: '2026.10.16.0007.logbook.md' };
  assert.deepStrictEqual(n.noteRef(note), { day: '2026-10-16', target: '7', index: 2, file: '2026.10.16.0007.logbook.md', expect: { at: '09:10', by: '@human', note: 'a' } });
});

// --- the author switch ---------------------------------------------------------------------------

// The registry as the board has it; a handle it does not list counts as AI.
const REGISTRY = [
  { handle: '@human', kind: 'human' }, { handle: '@hitl', kind: 'ai-hitl' }, { handle: '@afk', kind: 'ai-afk' },
  { handle: '@ana', kind: 'human' }, { handle: '@odd' },
];
const byNote = (by, text) => ({ day: '2026-10-16', target: '7', at: '09:00', by, note: text, index: 0, file: 'f' });
const BY_ALL = [byNote('@human', 'one'), byNote('@afk', 'two'), byNote('@hitl', 'three'), byNote('@ana', 'four'), byNote('@stranger', 'five'), byNote('@odd', 'six'), byNote('', 'seven')];
const EVERY = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const byFind = (text, by) => n.noteFilter(BY_ALL, text, () => '#7 Port', { by, assignees: REGISTRY }).map((x) => x.note);

test('an author is human when the registry says kind human or the note has none, and AI otherwise, a handle it lacks included', () => {
  const kind = (by) => n.noteAuthorKind(by, REGISTRY);
  assert.deepStrictEqual(['@human', '@ana', '@afk', '@hitl', '@odd', '@stranger', '', undefined].map(kind), ['human', 'human', 'ai', 'ai', 'ai', 'ai', 'human', 'human']);
  assert.strictEqual(n.noteAuthorKind('@HUMAN', REGISTRY), 'human');
  assert.strictEqual(n.noteAuthorKind('@human', []), 'ai');
});

test('the author switch: All keeps every note, Human the human authors, AI the rest', () => {
  assert.deepStrictEqual(byFind('', 'all'), EVERY);
  assert.deepStrictEqual(byFind('', undefined), EVERY);
  assert.deepStrictEqual(byFind('', 'human'), ['one', 'four', 'seven']);
  assert.deepStrictEqual(byFind('', 'ai'), ['two', 'three', 'five', 'six']);
});

test('by:@handle in the filter field narrows to that author and is no search word', () => {
  assert.deepStrictEqual(byFind('by:@afk', 'all'), ['two']);
  assert.deepStrictEqual(byFind('BY:@AFK', 'all'), ['two']);
  assert.deepStrictEqual(byFind('by:afk', 'all'), ['two']);
  assert.deepStrictEqual(byFind('by:@stranger', 'all'), ['five']);
  assert.deepStrictEqual(byFind('by:@afk by:@hitl', 'all'), ['two', 'three']);
});

test('by:@handle works together with the switch and the other filter words', () => {
  assert.deepStrictEqual(byFind('by:@afk', 'human'), []);
  assert.deepStrictEqual(byFind('by:@afk', 'ai'), ['two']);
  assert.deepStrictEqual(byFind('by:@ana', 'human'), ['four']);
  assert.deepStrictEqual(byFind('by:@afk tw', 'all'), ['two']);
  assert.deepStrictEqual(byFind('by:@afk thr', 'all'), []);
  assert.deepStrictEqual(byFind('port by:@human', 'all'), ['one']);
});

test('a by: with no handle yet filters nothing', () => {
  assert.deepStrictEqual(byFind('by:', 'all'), EVERY);
  assert.deepStrictEqual(byFind('by:@', 'human'), ['one', 'four', 'seven']);
});

// --- small things --------------------------------------------------------------------------------

test('the time now reads HH:MM and a day reads as the weekday and the date', () => {
  assert.strictEqual(n.noteClock(new Date(2026, 9, 16, 9, 5)), '09:05');
  assert.strictEqual(n.noteDayName('2026-10-16'), 'Fri 16');
  assert.strictEqual(n.noteDayName('2026-10-05'), 'Mon 5');
});

test('the card last noted is kept in the browser per board and a bad value is no card', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.strictEqual(n.noteLastLoad(storage, 'plan'), '');
  n.noteLastSave(storage, 'plan', '22');
  assert.strictEqual(n.noteLastLoad(storage, 'plan'), '22');
  assert.strictEqual(n.noteLastLoad(storage, 'other'), '');
  store.set('kanban.plan.lastnoted', '../etc');
  assert.strictEqual(n.noteLastLoad(storage, 'plan'), '');
  assert.strictEqual(n.noteLastLoad({ getItem() { throw new Error('blocked'); } }, 'plan'), '');
  n.noteLastSave({ setItem() { throw new Error('full'); } }, 'plan', '22');
});

test('the palette\'s layout, Grouped or Timeline, is kept in the browser per board and anything else reads as Grouped', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  assert.strictEqual(n.noteLayoutLoad(storage, 'plan'), 'grouped');
  n.noteLayoutSave(storage, 'plan', 'timeline');
  assert.strictEqual(n.noteLayoutLoad(storage, 'plan'), 'timeline');
  assert.strictEqual(n.noteLayoutLoad(storage, 'other'), 'grouped');
  assert.strictEqual(store.get('kanban.plan.notes.layout'), 'timeline');
  n.noteLayoutSave(storage, 'plan', 'sideways');
  assert.strictEqual(n.noteLayoutLoad(storage, 'plan'), 'timeline', 'a layout that is not one is not saved');
  store.set('kanban.plan.notes.layout', 'sideways');
  assert.strictEqual(n.noteLayoutLoad(storage, 'plan'), 'grouped');
  assert.strictEqual(n.noteLayoutLoad({ getItem() { throw new Error('blocked'); } }, 'plan'), 'grouped');
  n.noteLayoutSave({ setItem() { throw new Error('full'); } }, 'plan', 'timeline');
});

// --- the note boxes ------------------------------------------------------------------------------

// `content` is the height the whole text needs, `line` one line, `chrome` the box's padding and border.
const size = (content, over = {}) => n.noteBoxSize({ content, line: 20, chrome: 14, windowHeight: 1000, ...over });

test('a note box is as high as its text, from one line up', () => {
  assert.deepStrictEqual(size(34), { height: 34, scroll: false });
  assert.deepStrictEqual(size(94), { height: 94, scroll: false }, 'four lines');
  assert.deepStrictEqual(size(34 + 20 * 6), { height: 154, scroll: false });
});

test('a note box stops growing at 12 lines and scrolls inside past them', () => {
  assert.deepStrictEqual(size(14 + 20 * 12), { height: 254, scroll: false }, 'twelve lines fit');
  assert.deepStrictEqual(size(14 + 20 * 13), { height: 254, scroll: true });
  assert.deepStrictEqual(size(5000), { height: 254, scroll: true });
});

test('a note box may be given more lines than 12, and the window still caps it', () => {
  assert.deepStrictEqual(size(5000, { lines: 30 }), { height: 400, scroll: true }, '40% of 1000 is less than 30 lines');
  assert.deepStrictEqual(size(5000, { lines: 30, windowHeight: 2000 }), { height: 614, scroll: true });
  assert.deepStrictEqual(size(14 + 20 * 20, { lines: 30, windowHeight: 2000 }), { height: 414, scroll: false }, 'twenty lines fit');
});

test('a note box may be given a bigger share of the window too', () => {
  assert.deepStrictEqual(size(5000, { lines: 30, share: 0.7 }), { height: 614, scroll: true }, '70% of 1000 is more than 30 lines');
  assert.deepStrictEqual(size(5000, { lines: 30, share: 0.7, windowHeight: 600 }), { height: 420, scroll: true });
  assert.deepStrictEqual(size(5000, { windowHeight: 600 }), { height: 240, scroll: true }, 'without a share it is 40%');
});

test('a note box stops at 40% of the window when that is less than 12 lines', () => {
  assert.deepStrictEqual(size(5000, { windowHeight: 500 }), { height: 200, scroll: true });
  assert.deepStrictEqual(size(150, { windowHeight: 500 }), { height: 150, scroll: false });
  assert.deepStrictEqual(size(5000, { windowHeight: 700 }), { height: 254, scroll: true }, '40% of 700 is 280: the 12 lines are less');
});

test('a note box takes whole pixels, and shrinks when its text does', () => {
  assert.deepStrictEqual(size(33.2), { height: 34, scroll: false });
  assert.ok(size(94).height < size(154).height);
  assert.deepStrictEqual(size(1), { height: 34, scroll: false }, 'never under one line');
});

// --- Alt+1, Alt+2, Alt+3 --------------------------------------------------------------------------

const alt = (key, over = {}) => ({ key, code: `Digit${key}`, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...over });

test('Alt+1, Alt+2 and Alt+3 are the first, second and third tab', () => {
  assert.deepStrictEqual(['1', '2', '3'].map((k) => n.noteTabKey(alt(k))), [0, 1, 2]);
});

test('the digit is found by its key or, where Alt changes the character, by its place on the keyboard', () => {
  assert.strictEqual(n.noteTabKey({ key: '¡', code: 'Digit1', altKey: true }), 0);
  assert.strictEqual(n.noteTabKey({ key: '™', code: 'Digit2', altKey: true }), 1);
});

test('any other key, a digit without Alt, or Alt with another modifier is no tab key', () => {
  assert.strictEqual(n.noteTabKey(alt('4')), -1);
  assert.strictEqual(n.noteTabKey(alt('0')), -1);
  assert.strictEqual(n.noteTabKey({ key: '1', code: 'Digit1', altKey: false }), -1);
  assert.strictEqual(n.noteTabKey(alt('1', { ctrlKey: true })), -1);
  assert.strictEqual(n.noteTabKey(alt('1', { metaKey: true })), -1);
  assert.strictEqual(n.noteTabKey(alt('1', { shiftKey: true })), -1);
  assert.strictEqual(n.noteTabKey({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }), -1, 'Alt+Left stays the browser\'s Back');
  assert.strictEqual(n.noteTabKey({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }), -1);
  assert.strictEqual(n.noteTabKey({ altKey: true }), -1);
});

test('a note about nothing has one name, in the palette and on the Calendar', () => {
  const c = require('../web/notes-calendar');
  assert.strictEqual(n.NOTE_NO_CARD, 'no card');
  assert.deepStrictEqual(c.noteSlotTargets([{ target: '' }, { target: '7' }]), ['#7', n.NOTE_NO_CARD]);
  assert.strictEqual(c.noteUntimedTip([{ target: '', note: 'x' }]), `${n.NOTE_NO_CARD}: x`);
});

test('a subject is a target when it is a card or a group, and about cards when it is also several of them', () => {
  assert.deepStrictEqual(['card', 'group', 'each', 'none', 'slot', 'untimed'].map((kind) => n.noteIsTarget({ kind })), [true, true, false, false, false, false]);
  assert.deepStrictEqual(['card', 'group', 'each', 'none', 'slot', 'untimed'].map((kind) => n.noteIsAboutCards({ kind })), [true, true, true, false, false, false]);
});

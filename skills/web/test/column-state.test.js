const { test } = require('node:test');
const assert = require('node:assert');
const {
  COLUMN_IDS, DEFAULT_COLLAPSED, storageKey, mergeCollapsedState,
  DEFAULT_STATUSES, columnIdsFor, columnLabel, columnForStatus, liveStatuses,
  showsColumnAdd, defaultMapStatusFilter, mergeMapStatusFilter,
  defaultGanttStatusFilter, mergeGanttStatusFilter,
  mapFilterColumn, mapFilterVisibleIds, ganttFilterVisibleIds, intersectVisibleIds,
  soloStatusFilter,
  MAP_SECTIONS, DEFAULT_MAP_SECTIONS_COLLAPSED, mergeMapSectionsCollapsed,
  ROLLUP_BAR_MODES, mergeRollupBar, mergeRollupCountArchived } = require('../web/column-state');

test('DEFAULT_COLLAPSED has the four live columns expanded and Archive collapsed', () => {
  assert.deepStrictEqual(DEFAULT_COLLAPSED, {
    backlog: false,
    todo: false,
    doing: false,
    done: false,
    archive: true,
  });
});

test('storageKey namespaces by project and feature', () => {
  assert.strictEqual(storageKey('my-project', 'collapsed-columns'), 'kanban.my-project.collapsed-columns');
});

test('storageKey falls back to "default" when projectName is missing/empty', () => {
  assert.strictEqual(storageKey(undefined, 'collapsed-columns'), 'kanban.default.collapsed-columns');
  assert.strictEqual(storageKey('', 'collapsed-columns'), 'kanban.default.collapsed-columns');
  assert.strictEqual(storageKey(null, 'collapsed-columns'), 'kanban.default.collapsed-columns');
});

test('mergeCollapsedState returns defaults for undefined/null saved value', () => {
  assert.deepStrictEqual(mergeCollapsedState(undefined), DEFAULT_COLLAPSED);
  assert.deepStrictEqual(mergeCollapsedState(null), DEFAULT_COLLAPSED);
});

test('mergeCollapsedState overrides only the known boolean keys from a partial object', () => {
  const result = mergeCollapsedState({ archive: false, done: true });
  assert.deepStrictEqual(result, {
    backlog: false,
    todo: false,
    doing: false,
    done: true,
    archive: false,
  });
});

test('mergeCollapsedState falls back to defaults for a non-object saved value (string/array/number)', () => {
  assert.deepStrictEqual(mergeCollapsedState('corrupt'), DEFAULT_COLLAPSED);
  assert.deepStrictEqual(mergeCollapsedState(['backlog', true]), DEFAULT_COLLAPSED);
  assert.deepStrictEqual(mergeCollapsedState(42), DEFAULT_COLLAPSED);
});

test('mergeCollapsedState ignores non-boolean values for a known key, keeping the default', () => {
  const result = mergeCollapsedState({ backlog: 'yes', todo: 1, doing: null });
  assert.deepStrictEqual(result, DEFAULT_COLLAPSED);
});

test('mergeCollapsedState drops unknown/stale keys from a prior column set', () => {
  const result = mergeCollapsedState({ archive: false, review: true, qa: false });
  assert.deepStrictEqual(result, Object.assign({}, DEFAULT_COLLAPSED, { archive: false }));
  assert.strictEqual('review' in result, false);
  assert.strictEqual('qa' in result, false);
});

test('COLUMN_IDS lists exactly the five columns in board order', () => {
  assert.deepStrictEqual(COLUMN_IDS, ['backlog', 'todo', 'doing', 'done', 'archive']);
});

// --- dynamic columns from the configured statuses list --------------

test('DEFAULT_STATUSES is the built-in four, in board order', () => {
  assert.deepStrictEqual(DEFAULT_STATUSES, ['backlog', 'todo', 'doing', 'done']);
});

test('columnIdsFor appends archive to the configured list; empty/absent falls back to the built-in five', () => {
  assert.deepStrictEqual(columnIdsFor(['triage', 'doing', 'review']), ['triage', 'doing', 'review', 'archive']);
  assert.deepStrictEqual(columnIdsFor([]), COLUMN_IDS);
  assert.deepStrictEqual(columnIdsFor(null), COLUMN_IDS);
});

test('columnIdsFor tolerates a mistaken "archive" list entry — archive is a location, never duplicated', () => {
  assert.deepStrictEqual(columnIdsFor(['triage', 'archive', 'done']), ['triage', 'done', 'archive']);
  assert.deepStrictEqual(columnIdsFor(['archive']), COLUMN_IDS); // nothing live left -> built-in four
});

test('columnForStatus maps a listed status to itself and anything else to the FIRST column (catch-all)', () => {
  const statuses = ['triage', 'doing', 'review'];
  assert.strictEqual(columnForStatus('review', statuses), 'review');
  assert.strictEqual(columnForStatus('todo', statuses), 'triage'); // even a built-in name is "unknown" when unlisted
  assert.strictEqual(columnForStatus('', statuses), 'triage');
  assert.strictEqual(columnForStatus('weird', null), 'backlog'); // default list: backlog IS the first column
  assert.strictEqual(columnForStatus('todo', null), 'todo');
});

test('columnLabel keeps the built-in labels and capitalizes custom ids', () => {
  assert.strictEqual(columnLabel('todo'), 'Todo');
  assert.strictEqual(columnLabel('archive'), 'Archive');
  assert.strictEqual(columnLabel('review'), 'Review');
  assert.strictEqual(columnLabel('in progress'), 'In progress');
  assert.strictEqual(columnLabel('constructor'), 'Constructor'); // never leaks Object.prototype
});

test('mergeCollapsedState with a custom column set derives defaults per column: live expanded, archive collapsed', () => {
  const ids = ['triage', 'doing', 'review', 'archive'];
  assert.deepStrictEqual(mergeCollapsedState(null, ids), { triage: false, doing: false, review: false, archive: true });
});

test('mergeCollapsedState honors saved booleans for custom columns and drops stale keys', () => {
  const ids = ['triage', 'doing', 'archive'];
  const merged = mergeCollapsedState({ triage: true, todo: true, archive: false }, ids);
  assert.deepStrictEqual(merged, { triage: true, doing: false, archive: false });
});

test('mergeCollapsedState tolerates arbitrary column names (dots/spaces) — plain object keys, storageKey unchanged', () => {
  const ids = ['a.b', 'c d', 'archive'];
  const merged = mergeCollapsedState({ 'a.b': true }, ids);
  assert.deepStrictEqual(merged, { 'a.b': true, 'c d': false, archive: true });
});

test('liveStatuses dedupes repeated config entries — no duplicate columns (regression)', () => {
  assert.deepStrictEqual(liveStatuses(['triage', 'triage', 'done']), ['triage', 'done']);
});

// --- per-column + quick-create button visibility ---------------------

test('showsColumnAdd: every live expanded column gets the +, built-in or custom', () => {
  assert.strictEqual(showsColumnAdd('backlog', false), true);
  assert.strictEqual(showsColumnAdd('done', false), true);
  assert.strictEqual(showsColumnAdd('review', false), true); // custom columns are live columns too
});

test('showsColumnAdd: archive never gets the + — you cannot create an archived card', () => {
  assert.strictEqual(showsColumnAdd('archive', false), false);
  assert.strictEqual(showsColumnAdd('archive', true), false);
});

test('showsColumnAdd: collapsed strips never get the +', () => {
  assert.strictEqual(showsColumnAdd('todo', true), false);
  assert.strictEqual(showsColumnAdd('review', true), false);
});

// --- map view status-filter (which columns' cards the map shows) ----

const ALL_ON = { backlog: true, todo: true, doing: true, done: true, archive: true };

test('defaultMapStatusFilter shows every column — statuses AND the archive pseudo-column — by default', () => {
  assert.deepStrictEqual(defaultMapStatusFilter(COLUMN_IDS), ALL_ON);
  assert.deepStrictEqual(defaultMapStatusFilter(['triage', 'review', 'archive']), { triage: true, review: true, archive: true });
});

test('mergeMapStatusFilter returns all-ON defaults for missing/corrupt saved values', () => {
  assert.deepStrictEqual(mergeMapStatusFilter(undefined), ALL_ON);
  assert.deepStrictEqual(mergeMapStatusFilter(null), ALL_ON);
  assert.deepStrictEqual(mergeMapStatusFilter('corrupt'), ALL_ON);
  assert.deepStrictEqual(mergeMapStatusFilter(42), ALL_ON);
});

test('mergeMapStatusFilter honors saved booleans, ignores junk values, drops stale keys', () => {
  const merged = mergeMapStatusFilter({ done: false, archive: false, todo: 'yes', review: false });
  assert.deepStrictEqual(merged, Object.assign({}, ALL_ON, { done: false, archive: false }));
  assert.strictEqual('review' in merged, false);
});

test('mergeMapStatusFilter merges against a custom column set', () => {
  const ids = ['triage', 'review', 'archive'];
  assert.deepStrictEqual(mergeMapStatusFilter({ review: false, todo: false }, ids),
    { triage: true, review: false, archive: true });
});

test('mapFilterColumn: archive is a LOCATION — an archived card filters under archive regardless of its parked status', () => {
  assert.strictEqual(mapFilterColumn({ status: 'done', archived: true }, null), 'archive');
  assert.strictEqual(mapFilterColumn({ status: 'weird', archived: true }, ['triage', 'review']), 'archive');
});

test('mapFilterColumn: live cards follow the board column rules — listed status is itself, unlisted lands in the FIRST column', () => {
  assert.strictEqual(mapFilterColumn({ status: 'doing', archived: false }, null), 'doing');
  assert.strictEqual(mapFilterColumn({ status: 'weird', archived: false }, null), 'backlog');
  assert.strictEqual(mapFilterColumn({ status: 'todo', archived: false }, ['triage', 'review']), 'triage');
});

test('mapFilterVisibleIds returns null when every toggle is ON — mirrors search\'s "no query = everything visible"', () => {
  const cards = [{ id: 1, status: 'todo', archived: false }];
  assert.strictEqual(mapFilterVisibleIds(cards, defaultMapStatusFilter(COLUMN_IDS), null), null);
  assert.strictEqual(mapFilterVisibleIds(cards, mergeMapStatusFilter(null), []), null);
});

test('mapFilterVisibleIds hides exactly the cards whose column is toggled OFF — catch-all statuses follow the first column', () => {
  const cards = [
    { id: 1, status: 'backlog', archived: false },
    { id: 2, status: 'todo', archived: false },
    { id: 3, status: 'weird', archived: false }, // unlisted -> backlog catch-all
    { id: 4, status: 'done', archived: true },   // location -> archive
  ];
  const visible = mapFilterVisibleIds(cards, mergeMapStatusFilter({ backlog: false }), null);
  assert.deepStrictEqual([...visible].sort((a, b) => a - b), [2, 4]);
});

test('mapFilterVisibleIds: archive OFF hides archived cards even when their parked status column is ON', () => {
  const cards = [
    { id: 1, status: 'done', archived: false },
    { id: 2, status: 'done', archived: true },
  ];
  const visible = mapFilterVisibleIds(cards, mergeMapStatusFilter({ archive: false }), null);
  assert.deepStrictEqual([...visible], [1]);
});

test('mapFilterVisibleIds with custom columns: toggling the FIRST column also hides unlisted-status cards', () => {
  const statuses = ['triage', 'review'];
  const cards = [
    { id: 1, status: 'triage', archived: false },
    { id: 2, status: 'todo', archived: false }, // unlisted -> triage catch-all
    { id: 3, status: 'review', archived: false },
  ];
  const filter = mergeMapStatusFilter({ triage: false }, columnIdsFor(statuses));
  const visible = mapFilterVisibleIds(cards, filter, statuses);
  assert.deepStrictEqual([...visible], [3]);
});

test('mapFilterVisibleIds treats a missing filter key as ON — defensive merging, never hide by accident', () => {
  const cards = [{ id: 1, status: 'todo', archived: false }, { id: 2, status: 'doing', archived: false }];
  const visible = mapFilterVisibleIds(cards, { doing: false }, null);
  assert.deepStrictEqual([...visible], [1]);
});

// --- search ∩ status-filter composition ------------------------------
// The combining rule lives here as a pure helper (renderMapView is DOM glue no
// unit test executes — a combiner regressed to union passed the whole suite).

test('intersectVisibleIds: null means "not filtering" — both null stays null, a lone set passes through untouched', () => {
  assert.strictEqual(intersectVisibleIds(null, null), null);
  const only = new Set([1, 2]);
  assert.strictEqual(intersectVisibleIds(only, null), only);
  assert.strictEqual(intersectVisibleIds(null, only), only);
});

test('intersectVisibleIds intersects two real sets — a card is visible only when BOTH filters say so', () => {
  const out = intersectVisibleIds(new Set([1, 2, 3]), new Set([2, 3, 4]));
  assert.deepStrictEqual([...out].sort((a, b) => a - b), [2, 3]);
  assert.deepStrictEqual([...intersectVisibleIds(new Set([1]), new Set([2]))], [],
    'disjoint sets yield the empty set, not a union');
});

// --- map view section collapse (graph + no-dependencies list) -------
// A fixed small key set (not a dynamic column set, unlike collapse/status-filter
// above), same shape/merge discipline as modal-fullscreen.js's per-modal-type
// state — no `ids` param needed.

test('MAP_SECTIONS names exactly the two collapsible map sections', () => {
  assert.deepStrictEqual(MAP_SECTIONS, ['graph', 'isolated']);
});

test('DEFAULT_MAP_SECTIONS_COLLAPSED starts both sections expanded', () => {
  assert.deepStrictEqual(DEFAULT_MAP_SECTIONS_COLLAPSED, { graph: false, isolated: false });
});

test('mergeMapSectionsCollapsed returns all-expanded defaults for missing/corrupt saved values', () => {
  assert.deepStrictEqual(mergeMapSectionsCollapsed(undefined), { graph: false, isolated: false });
  assert.deepStrictEqual(mergeMapSectionsCollapsed(null), { graph: false, isolated: false });
  assert.deepStrictEqual(mergeMapSectionsCollapsed('corrupt'), { graph: false, isolated: false });
  assert.deepStrictEqual(mergeMapSectionsCollapsed(42), { graph: false, isolated: false });
});

test('mergeMapSectionsCollapsed honors saved booleans, ignores junk values, drops stale keys', () => {
  assert.deepStrictEqual(mergeMapSectionsCollapsed({ graph: true }), { graph: true, isolated: false });
  assert.deepStrictEqual(mergeMapSectionsCollapsed({ isolated: true, graph: 'yes' }), { graph: false, isolated: true });
  assert.deepStrictEqual(mergeMapSectionsCollapsed({ graph: true, isolated: true, bogus: true }),
    { graph: true, isolated: true });
});

// --- the gantt's Archive pill — every LIVE status pill defaults ON;
// the Archive pill defaults OFF so an unconfigured/fresh board's gantt
// renders live cards only until a human opts in. Unlike the
// map's Archive pill (always ON by default — the map has always
// included archived cards), the gantt's default must stay live-only.

test('defaultGanttStatusFilter: every live status defaults ON, Archive defaults OFF', () => {
  assert.deepStrictEqual(defaultGanttStatusFilter(COLUMN_IDS),
    { backlog: true, todo: true, doing: true, done: true, archive: false });
  assert.deepStrictEqual(defaultGanttStatusFilter(['triage', 'review', 'archive']),
    { triage: true, review: true, archive: false });
});

test('mergeGanttStatusFilter returns the archive-off defaults for missing/corrupt saved values', () => {
  const expected = { backlog: true, todo: true, doing: true, done: true, archive: false };
  assert.deepStrictEqual(mergeGanttStatusFilter(undefined), expected);
  assert.deepStrictEqual(mergeGanttStatusFilter(null), expected);
  assert.deepStrictEqual(mergeGanttStatusFilter('corrupt'), expected);
  assert.deepStrictEqual(mergeGanttStatusFilter(42), expected);
});

test('mergeGanttStatusFilter: a STALE saved value predating the Archive pill (no archive key at all) loads archive OFF, never throwing or flipping a live status', () => {
  // Exactly the shape an older gantt.statusFilter held in localStorage:
  // the four live keys, no 'archive' entry — the merge must fill it with the
  // NEW default (off), not crash, and leave the live keys exactly as saved.
  const stale = { backlog: true, todo: false, doing: true, done: true };
  const merged = mergeGanttStatusFilter(stale);
  assert.strictEqual(merged.archive, false, 'archive key absent from stale storage merges to the new default (off), never true');
  assert.deepStrictEqual(merged, { backlog: true, todo: false, doing: true, done: true, archive: false });
});

test('mergeGanttStatusFilter honors an explicit saved archive:true — a user who already opted in keeps it on across reloads', () => {
  const merged = mergeGanttStatusFilter({ archive: true, todo: false });
  assert.deepStrictEqual(merged, { backlog: true, todo: false, doing: true, done: true, archive: true });
});

test('mergeGanttStatusFilter ignores a junk archive value, keeping the off default', () => {
  assert.strictEqual(mergeGanttStatusFilter({ archive: 'yes' }).archive, false);
  assert.strictEqual(mergeGanttStatusFilter({ archive: 1 }).archive, false);
});

test('mergeGanttStatusFilter merges against a custom column set the same way mergeMapStatusFilter does, archive default aside', () => {
  const ids = ['triage', 'review', 'archive'];
  assert.deepStrictEqual(mergeGanttStatusFilter({ review: false }, ids), { triage: true, review: false, archive: false });
});

// --- solo interplay — soloStatusFilter (pinned exhaustively
// above against COLUMN_IDS/all-ON) is already fully generic over its id list,
// so the gantt's Archive pill joins the solo grammar for free; these tests
// exercise it specifically starting from the gantt's OWN default shape
// (archive OFF).

const GANTT_IDS = columnIdsFor(null); // ['backlog', 'todo', 'doing', 'done', 'archive']

test('soloStatusFilter: soloing a live status on the gantt turns Archive off too — "every other off" includes the Archive pill', () => {
  const filter = mergeGanttStatusFilter(null, GANTT_IDS); // archive:false, rest true
  const soloed = soloStatusFilter(filter, GANTT_IDS, 'doing');
  assert.deepStrictEqual(soloed, { backlog: false, todo: false, doing: true, done: false, archive: false });
});

test('soloStatusFilter: soloing Archive on the gantt shows archived cards only — every live status goes off', () => {
  const filter = mergeGanttStatusFilter(null, GANTT_IDS);
  const soloed = soloStatusFilter(filter, GANTT_IDS, 'archive');
  assert.deepStrictEqual(soloed, { backlog: false, todo: false, doing: false, done: false, archive: true });
});

test('soloStatusFilter: right-click on an already-soloed Archive pill restores ALL pills on, Archive included — "viceversa"', () => {
  const soloed = { backlog: false, todo: false, doing: false, done: false, archive: true };
  assert.deepStrictEqual(soloStatusFilter(soloed, GANTT_IDS, 'archive'),
    GANTT_IDS.reduce((o, id) => (o[id] = true, o), {}));
});

// --- the gantt groups cards by their RAW on-disk
// status (gantt-model.js's ganttGroups gives an unlisted status its OWN
// labeled group row), unlike the map/board which fold an unlisted status
// into the first column's bucket (mapFilterColumn/columnForStatus). Reusing
// mapFilterVisibleIds for the gantt let an unrelated pill (e.g. the first
// column's) silently hide a status group it doesn't actually represent, with
// no pill of its own to control it. ganttFilterVisibleIds fixes the mismatch:
// a status with no pill (not in the board's live statuses) is NEVER governed
// by any toggle — it stays visible regardless, matching ganttGroups' own
// always-render-its-own-group treatment.

test('ganttFilterVisibleIds: an on-disk status not in the board list is never governed by any pill (regression)', () => {
  const cards = [
    { id: 1, status: 'backlog' },
    { id: 2, status: 'review' }, // unlisted — its own gantt group, no pill represents it
  ];
  const filter = { backlog: false, todo: true, doing: true, done: true };
  const visible = ganttFilterVisibleIds(cards, filter, ['backlog', 'todo', 'doing', 'done']);
  assert.deepStrictEqual([...visible], [2], 'backlog pill hides #1; the unlisted status stays visible regardless of any pill');
});

test('ganttFilterVisibleIds returns null (no filtering) when every board-status pill is ON, even with unlisted cards present (regression)', () => {
  const cards = [{ id: 1, status: 'review' }];
  const filter = { backlog: true, todo: true, doing: true, done: true };
  assert.strictEqual(ganttFilterVisibleIds(cards, filter, ['backlog', 'todo', 'doing', 'done']), null);
});

test('ganttFilterVisibleIds hides exactly the listed-status cards whose own pill is OFF (regression)', () => {
  const cards = [
    { id: 1, status: 'todo' },
    { id: 2, status: 'doing' },
  ];
  const visible = ganttFilterVisibleIds(cards, { backlog: true, todo: false, doing: true, done: true }, ['backlog', 'todo', 'doing', 'done']);
  assert.deepStrictEqual([...visible], [2]);
});

// --- pill interaction grammar — left toggle (unchanged, above),
// right SOLO/viceversa. soloStatusFilter is the one pure rule shared by all
// three status-filter rows (map, gantt, calendar) — each view's
// solo*StatusFilter wrapper in app.js just feeds it its own filter/id-list
// pair, same as the toggle wrappers already do.

test('soloStatusFilter: right-click solos that pill on, every other off', () => {
  const filter = { backlog: true, todo: true, doing: true, done: true, archive: true };
  assert.deepStrictEqual(soloStatusFilter(filter, COLUMN_IDS, 'doing'),
    { backlog: false, todo: false, doing: true, done: false, archive: false });
});

test('soloStatusFilter: right-click again on the ALREADY-soloed pill restores all ON — "viceversa"', () => {
  const soloed = { backlog: false, todo: false, doing: true, done: false, archive: false };
  assert.deepStrictEqual(soloStatusFilter(soloed, COLUMN_IDS, 'doing'), COLUMN_IDS.reduce((o, id) => (o[id] = true, o), {}));
});

test('soloStatusFilter: right-clicking a DIFFERENT pill while one is soloed re-solos onto the new one, not a restore', () => {
  const soloed = { backlog: false, todo: false, doing: true, done: false, archive: false };
  assert.deepStrictEqual(soloStatusFilter(soloed, COLUMN_IDS, 'done'),
    { backlog: false, todo: false, doing: false, done: true, archive: false });
});

test('soloStatusFilter: an arbitrary partial state (several off, none soloed) right-clicked solos onto that pill outright', () => {
  const filter = { backlog: false, todo: true, doing: true, done: false, archive: true };
  assert.deepStrictEqual(soloStatusFilter(filter, COLUMN_IDS, 'todo'),
    { backlog: false, todo: true, doing: false, done: false, archive: false });
});

test('soloStatusFilter: a stale/unknown data-col (column set changed under the row) is a no-op, same guard as the toggle', () => {
  const filter = { backlog: true, todo: true, doing: true, done: true, archive: true };
  assert.strictEqual(soloStatusFilter(filter, COLUMN_IDS, 'nope'), filter);
});

test('soloStatusFilter works against a custom/dynamic column set, not just the built-in five', () => {
  const ids = ['triage', 'review', 'archive'];
  const filter = { triage: true, review: true, archive: true };
  assert.deepStrictEqual(soloStatusFilter(filter, ids, 'review'), { triage: false, review: true, archive: false });
});

test('soloStatusFilter treats a missing filter key as ON, same defensive convention as mapFilterVisibleIds', () => {
  // col itself missing (never merged in) still counts as "on" when checking whether it's already soloed alone.
  const filter = { backlog: false, todo: false, doing: false, done: false }; // 'archive' key absent -> defensively ON
  assert.deepStrictEqual(soloStatusFilter(filter, COLUMN_IDS, 'archive'), COLUMN_IDS.reduce((o, id) => (o[id] = true, o), {}));
});

test('mergeRollupBar keeps one of open, collapsed or off and falls back to collapsed', () => {
  assert.deepStrictEqual(ROLLUP_BAR_MODES, ['open', 'collapsed', 'off']);
  for (const mode of ROLLUP_BAR_MODES) assert.strictEqual(mergeRollupBar(mode), mode);
  for (const junk of [undefined, null, '', 'thin', 'OPEN', 'on', 7, true, {}, ['open']]) {
    assert.strictEqual(mergeRollupBar(junk), 'collapsed', `${JSON.stringify(junk)} reads as the default`);
  }
});

test('mergeRollupCountArchived counts archived leaves unless the saved choice is exactly "false"', () => {
  assert.strictEqual(mergeRollupCountArchived('true'), true);
  assert.strictEqual(mergeRollupCountArchived('false'), false);
  for (const junk of [undefined, null, '', 'no', '0', 'FALSE', 0, {}]) {
    assert.strictEqual(mergeRollupCountArchived(junk), true, `${JSON.stringify(junk)} reads as the default`);
  }
});

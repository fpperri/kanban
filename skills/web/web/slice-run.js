'use strict';
// Pure run of slices for the search panel's slice section: which slices the section
// lists, which of them are in the run, and what a click or a key does to the run.
// No DOM, no storage, and no other module on purpose: the snapshot embeds this
// file's source verbatim, where nothing else is loaded. Same dual-environment
// pattern as slices.js and pills.js.
//
// The run is the slice: term the search box holds at the top level of its query, so
// it is read off the box and written back to it, and nothing about it is kept here.
// The slices module's axis is the tiers of the hierarchy top first, then the depths
// of the cards with no tier. The section lists that axis without the tiers no card
// on the board is in, and a run is { from, to }: positions in that list, `from` above
// `to`, a run of one slice having the two equal. `null` is a run with no slice in it,
// which a hand-typed term can make (it names only a tier no card is in).
//
// `sliced` is what sliceCards gave for every card of the board, live and archived.
// It fixes which tiers are listed and where each entry sits on the axis; the counts
// come from the ids the caller passes, so the caller picks the basis (the page passes
// the view's cards after its status pills and Archive, before the box and the run).

const SLICE_RUN_KEYS = ['[', ']', '{', '}'];

// What an end of a slice: value names, as the search module reads it: a tier by name
// without regard to letter case, or a depth by number. -1 when the axis has no such
// slice or the end is empty.
function sliceRunEnd(axis, text) {
  const key = String(text).trim().toLowerCase();
  const at = axis.find((s) => (s.kind === 'tier' ? s.key === key : String(s.depth) === key));
  return at ? at.index : -1;
}

// The axis positions a slice: value cuts to, { from, to }: either end may be left
// open or name no slice, which leaves that end of the axis; a reversed pair is
// swapped. A value with no end the axis has runs the whole axis, the way
// `slice:nosuch` and `slice:..` cut nothing. The search module's own rule, held to it
// by a test.
function sliceRunBounds(axis, value) {
  const text = String(value);
  const dots = text.indexOf('..');
  let from = sliceRunEnd(axis, dots < 0 ? text : text.slice(0, dots));
  let to = sliceRunEnd(axis, dots < 0 ? text : text.slice(dots + 2));
  if (from >= 0 && to >= 0 && from > to) [from, to] = [to, from];
  return { from: from < 0 ? 0 : from, to: to < 0 ? axis.length - 1 : to };
}

// The entries the section lists, top first: { index, kind, name, depth, label, count }.
// `index` is the slice's place on the full axis. A tier is listed only when some card
// of the board is in it; every depth the axis has is listed. A card is counted in the
// slice the board puts it in, whichever cards `viewIds` holds.
function sliceListOf(sliced, viewIds) {
  const counts = new Map();
  for (const id of viewIds) {
    const slice = sliced.byId.get(id);
    if (slice) counts.set(slice.index, (counts.get(slice.index) || 0) + 1);
  }
  return sliced.axis
    .filter((s) => s.kind === 'depth' || s.count > 0)
    .map((s) => ({
      index: s.index,
      kind: s.kind,
      name: s.kind === 'tier' ? s.name : undefined,
      depth: s.kind === 'depth' ? s.depth : undefined,
      label: s.kind === 'tier' ? s.name : `depth ${s.depth}`,
      count: counts.get(s.index) || 0,
    }));
}

// The run that the box's top-level slice: terms (their values) leave: the entries in
// every one of them. No term is every entry. null when none is left.
function sliceRunOf(sliced, list, values) {
  const bounds = values.map((value) => sliceRunBounds(sliced.axis, value));
  const inRun = list.map((entry) => bounds.every((b) => entry.index >= b.from && entry.index <= b.to));
  const from = inRun.indexOf(true);
  return from < 0 ? null : { from, to: inRun.lastIndexOf(true) };
}

// A click on the entry at `at`: outside the run it grows the run to that entry; on an
// end it drops that end; on the one entry of a run of one it brings back every
// entry; inside the run and not an end it changes nothing. With no entry in the run
// it starts a run of that one.
function sliceRunClick(list, run, at) {
  if (!run) return { from: at, to: at };
  if (at < run.from || at > run.to) return { from: Math.min(at, run.from), to: Math.max(at, run.to) };
  if (run.from === run.to) return { from: 0, to: list.length - 1 };
  if (at === run.from) return { from: run.from + 1, to: run.to };
  if (at === run.to) return { from: run.from, to: run.to - 1 };
  return run;
}

// A right-click, or the context-menu key: only that entry.
function sliceRunKeep(at) {
  return { from: at, to: at };
}

// One of [ ] { }: [ moves the bottom of the run up and ] moves it down; { moves its
// top up and } moves it down. Each stops at the ends of the list, and the top never
// passes the bottom. Any other key, or no run, leaves the run as it was.
function sliceRunStep(list, run, key) {
  if (!run) return run;
  const last = list.length - 1;
  if (key === '[') return { from: run.from, to: Math.max(run.from, run.to - 1) };
  if (key === ']') return { from: run.from, to: Math.min(last, run.to + 1) };
  if (key === '{') return { from: Math.max(0, run.from - 1), to: run.to };
  if (key === '}') return { from: Math.min(run.to, run.from + 1), to: run.to };
  return run;
}

// The value of the slice: term that writes a run, '' when the run covers every entry
// (or none is in it): no term. A run of one is its name; a run that reaches an end
// of the list leaves that end open, so it reads the same whatever is added beyond it;
// any other end is named, a tier as the hierarchy wrote it and a depth by number.
function sliceRunValue(list, run) {
  if (!run || (run.from === 0 && run.to === list.length - 1)) return '';
  const end = (entry) => (entry.kind === 'tier' ? entry.name : String(entry.depth));
  if (run.from === run.to) return end(list[run.from]);
  if (run.from === 0) return `..${end(list[run.to])}`;
  if (run.to === list.length - 1) return `${end(list[run.from])}..`;
  return `${end(list[run.from])}..${end(list[run.to])}`;
}

// Whether the run is a cut: some entry the section lists is out of it.
function sliceRunCuts(list, run) {
  if (!list.length) return false;
  return !run || run.from > 0 || run.to < list.length - 1;
}

// A key that is the entry's own, whatever the list holds around it: the same after a
// tier joins or leaves, so a button built for it is found again and updated where it
// stands.
function sliceEntryKey(entry) {
  return entry.kind === 'tier' ? `t:${entry.name.toLowerCase()}` : `d:${entry.depth}`;
}

// What a screen reader is told of an entry: its label, its count and whether it is in
// the run.
function sliceEntryName(entry, inRun) {
  return `${entry.label}, ${entry.count} ${entry.count === 1 ? 'card' : 'cards'}, ${inRun ? 'in the run' : 'not in the run'}`;
}

// A chord (Ctrl, Cmd, Alt held with a key). AltGr is not one: on a layout with no brackets of its
// own it is how they are typed, and the browser reports it as Ctrl and Alt together, with the
// AltGraph modifier on.
function sliceKeyIsChord(e) {
  const altGraph = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
  return !!e.metaKey || ((!!e.ctrlKey || !!e.altKey) && !altGraph);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SLICE_RUN_KEYS, sliceKeyIsChord, sliceRunBounds, sliceListOf, sliceRunOf, sliceRunClick, sliceRunKeep, sliceRunStep, sliceRunValue, sliceRunCuts, sliceEntryName, sliceEntryKey };
} else {
  window.SLICE_RUN_KEYS = SLICE_RUN_KEYS;
  window.sliceKeyIsChord = sliceKeyIsChord;
  window.sliceRunBounds = sliceRunBounds;
  window.sliceListOf = sliceListOf;
  window.sliceRunOf = sliceRunOf;
  window.sliceRunClick = sliceRunClick;
  window.sliceRunKeep = sliceRunKeep;
  window.sliceRunStep = sliceRunStep;
  window.sliceRunValue = sliceRunValue;
  window.sliceRunCuts = sliceRunCuts;
  window.sliceEntryName = sliceEntryName;
  window.sliceEntryKey = sliceEntryKey;
}

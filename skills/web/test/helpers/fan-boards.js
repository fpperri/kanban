'use strict';
// What the tier fan's tests stand on: the browser runner's own fixture boards,
// read the way the page reads them, and a small card builder for boards written
// by hand. Not a test file (the suite runs *.test.js only).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listActive, listArchived, toJSON } = require('../../scripts/card-store');
const { readConfig } = require('../../scripts/config-store');
const { materialize } = require('../browser/boards');
const { graphBuild, graphFit, graphFanNames } = require('../../web/graph-model');
const { GRAPH_NAME_ROW, graphNamesPlace, graphNamesRim } = require('../../web/graph-names');

const STATUSES = ['backlog', 'todo', 'doing', 'done'];
const HIERARCHY = ['goal', 'strategy', 'objective', 'epic'];
const CTX = { board: 'kanban', priorities: ['High', 'Normal', 'Low'] };

const roots = [];

// A fixture board: its live and archived cards and its config, with the context
// the page builds the Graph in.
function loadBoard(key) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kanban-fan-${key}-`));
  roots.push(root);
  const dir = path.join(root, 'board');
  materialize(key, dir);
  const live = listActive(dir).map(toJSON);
  const config = readConfig(dir);
  return { name: config.name, config, live, all: live.concat(listArchived(dir).map(toJSON)), ctx: { board: config.name, priorities: config.priorities } };
}

function cleanUp() {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
}

const card = (id, extra = {}) => ({
  id, title: `card ${id}`, status: 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false, ...extra,
});

// The model the page draws: every live card, or `visible` of them, with the board's hierarchy.
const drawnModel = (board, { visible = null, hierarchy = board.config.hierarchy } = {}) => graphBuild(board.all, {
  ctx: board.ctx, hierarchy, visibleIds: new Set(visible || board.live.map((c) => c.id)),
});

// A model of cards written by hand.
const buildOf = (cards, hierarchy = HIERARCHY, visible = null) => graphBuild(cards, {
  ctx: CTX, hierarchy, visibleIds: visible ? new Set(visible) : null,
});

// A board of the size and shape of a real shop board: two goals, three strategies,
// twelve objectives and twenty-four epics, stories and sub-tasks under them (some
// with no type, at every depth), forty loose cards and three loose epics.
function rootShapedCards() {
  const cards = [];
  let id = 1;
  const add = (extra) => {
    const c = card(id, { status: STATUSES[id % STATUSES.length], ...extra });
    id++;
    cards.push(c);
    return c.id;
  };
  for (let g = 0; g < 2; g++) {
    const goal = add({ type: 'goal' });
    for (let s = 0; s < 1 + g; s++) {
      const strategy = add({ type: 'strategy', parent: goal });
      for (let o = 0; o < 4; o++) {
        const objective = add({ type: 'objective', parent: o % 3 ? strategy : goal });
        for (let e = 0; e < 2; e++) {
          const epic = add({ type: 'epic', parent: objective });
          for (let t = 0; t < 3; t++) {
            const story = add({ parent: epic });
            for (let u = 0; u < (t + e + o) % 3; u++) add({ parent: story });
          }
        }
      }
    }
  }
  for (let i = 0; i < 40; i++) add({});
  for (let i = 0; i < 3; i++) add({ type: 'epic' });
  return cards;
}

// Where the page puts the fan's captions on screen once `fit` ({ x, y, k }) has framed
// it, measured without the model's own text sizes: the page's font is about 6.2px a
// character at 11px (13px for the block's title), a line is 1.25 times its size, and
// `dy` and the anchor move a text the way SVG does. A caption is its name; its count
// is in its tip.
const CHAR_PX = 6.2;
function captionRects(plan, fit) {
  const rects = [];
  const put = (c, size) => {
    const w = String(c.name).length * CHAR_PX * (size / 11);
    const base = c.y * fit.k + fit.y + parseFloat(c.dy || '0') * size;
    const x = c.x * fit.k + fit.x;
    const l = c.anchor === 'middle' ? x - w / 2 : c.anchor === 'end' ? x - w : x;
    rects.push({ name: c.name, l, r: l + w, t: base - 0.95 * size, b: base + 0.3 * size });
  };
  for (const c of plan.captions) put(c, 11);
  if (plan.looseCaption) put(plan.looseCaption, 11);
  if (plan.block) {
    put(plan.block.title, 13);
    for (const col of plan.block.columns) put(col.caption, 11);
  }
  return rects;
}

// The pairs of rects that overlap, by name.
function clashes(rects) {
  const out = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) out.push(`${a.name} and ${b.name}`);
    }
  }
  return out;
}

// How wide a name comes out on screen, in px, by the same reading as the captions above.
const nameMeasure = (text, size = 11) => Array.from(String(text)).length * CHAR_PX * (size / 11);

// Points every `step` or closer along a path the plan draws, read here without the
// placement's own flattener: M, L, Q and A, the commands the plan's lines use. Every arc the
// plan draws is round and centred on the apex, so an arc is walked round the origin, and one
// that is not throws.
const PATH_NUM = /[MLQA]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
function pathPoints(d, step = 0.5) {
  const tokens = String(d).match(PATH_NUM) || [];
  const points = [];
  let pen = null;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const walk = (n, at) => { for (let s = 1; s <= n; s++) points.push(at(s / n)); };
  let cmd = null;
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M') {
      pen = { x: num(), y: num() };
      points.push(pen);
      cmd = 'L';
    } else if (cmd === 'L') {
      const to = { x: num(), y: num() };
      const from = pen;
      walk(Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step)), (t) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
      pen = to;
    } else if (cmd === 'Q') {
      const c = { x: num(), y: num() };
      const to = { x: num(), y: num() };
      const from = pen;
      const long = Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(to.x - c.x, to.y - c.y);
      walk(Math.max(1, Math.ceil(long / step)), (t) => ({
        x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * c.x + t * t * to.x,
        y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * c.y + t * t * to.y,
      }));
      pen = to;
    } else if (cmd === 'A') {
      const r = num();
      num();
      num();
      const large = num();
      const sweep = num();
      const to = { x: num(), y: num() };
      const from = pen;
      if (Math.abs(Math.hypot(from.x, from.y) - r) > 0.05 || Math.abs(Math.hypot(to.x, to.y) - r) > 0.05) throw new Error(`an arc not centred on the apex: ${d}`);
      const a0 = Math.atan2(from.y, from.x);
      let turn = Math.atan2(to.y, to.x) - a0;
      if (sweep) while (turn <= 0) turn += 2 * Math.PI;
      else while (turn >= 0) turn -= 2 * Math.PI;
      if ((Math.abs(turn) > Math.PI) !== (large === 1)) throw new Error(`an arc whose flags disagree with its ends: ${d}`);
      walk(Math.max(1, Math.ceil(Math.abs(turn) * r / step)), (t) => ({ x: Math.cos(a0 + turn * t) * r, y: Math.sin(a0 + turn * t) * r }));
      pen = to;
    } else {
      throw new Error(`a path command the plan does not draw: ${tokens[i - 1]} in ${d}`);
    }
  }
  return points;
}

// A leader in the world, read without the placement's own flattener: where it starts and its
// pieces in order, each straight ({ a, b }) or round the apex ({ a, b, r, sweep }). The path is
// drawn in its card's group, so every point is less the card's `at`. Every arc a leader draws
// is round the apex, so one that is not throws, as does a command a leader never draws.
function leaderPieces(d, at) {
  const tokens = String(d).match(PATH_NUM) || [];
  const pieces = [];
  let i = 0;
  let start = null;
  let pen = null;
  let cmd = null;
  const point = () => ({ x: Number(tokens[i++]) + at.x, y: Number(tokens[i++]) + at.y });
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M' && !pen) {
      start = point();
      pen = start;
      cmd = 'L';
    } else if (cmd === 'L') {
      const b = point();
      pieces.push({ a: pen, b });
      pen = b;
    } else if (cmd === 'A') {
      const r = Number(tokens[i++]);
      i += 2;
      const large = Number(tokens[i++]);
      const sweep = Number(tokens[i++]);
      const b = point();
      // An arc to where it starts draws nothing, as in SVG.
      if (b.x === pen.x && b.y === pen.y) continue;
      if (Math.abs(Math.hypot(pen.x, pen.y) - r) > 0.05 || Math.abs(Math.hypot(b.x, b.y) - r) > 0.05) throw new Error(`a leader's arc not round the apex: ${d}`);
      let turn = Math.atan2(b.y, b.x) - Math.atan2(pen.y, pen.x);
      if (sweep) while (turn <= 0) turn += 2 * Math.PI;
      else while (turn >= 0) turn -= 2 * Math.PI;
      if ((Math.abs(turn) > Math.PI) !== (large === 1)) throw new Error(`a leader's arc whose flags disagree with its ends: ${d}`);
      pieces.push({ a: pen, b, r, sweep });
      pen = b;
    } else {
      throw new Error(`a path command a leader does not draw: ${tokens[i - 1]} in ${d}`);
    }
  }
  return { start, pieces };
}

// The pairs of leaders, given as [id, pieces], whose paths cross: a straight piece of one
// through a straight piece or an arc of the other, clear of both pieces' ends by `clear`. Arcs
// round the apex never cross each other (they share the rail or lie one inside the other), and
// two pieces along one line, or one that runs up to another's path and stops there, do not
// cross either: so leaders that share the rail or a ray, or join it, are not counted.
function leaderCrossings(leaders, clear = 0.05) {
  const turnOf = (p) => {
    const a0 = Math.atan2(p.a.y, p.a.x);
    let t = Math.atan2(p.b.y, p.b.x) - a0;
    if (p.sweep) while (t <= 0) t += 2 * Math.PI;
    else while (t >= 0) t -= 2 * Math.PI;
    return { a0, t };
  };
  const off = (q, a, b) => ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
  const parts = (p, q, a, b) => {
    const s = off(p, a, b);
    const t = off(q, a, b);
    return (s > clear && t < -clear) || (s < -clear && t > clear);
  };
  const lineLine = (s, o) => parts(o.a, o.b, s.a, s.b) && parts(s.a, s.b, o.a, o.b);
  const lineArc = (s, arc) => {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    const A = dx * dx + dy * dy;
    const B = 2 * (s.a.x * dx + s.a.y * dy);
    const C = s.a.x * s.a.x + s.a.y * s.a.y - arc.r * arc.r;
    const disc = B * B - 4 * A * C;
    if (!A || disc <= 0) return false;
    const { a0, t: turn } = turnOf(arc);
    return [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].some((t) => {
      if (t * len <= clear || (1 - t) * len <= clear) return false;
      let at = Math.atan2(s.a.y + dy * t, s.a.x + dx * t) - a0;
      at -= 2 * Math.PI * Math.floor(at / (2 * Math.PI));
      if (turn < 0 && at > 0) at -= 2 * Math.PI;
      const m = clear / arc.r;
      return turn > 0 ? at > m && at < turn - m : at < -m && at > turn + m;
    });
  };
  const out = new Set();
  for (let i = 0; i < leaders.length; i++) {
    for (let j = i + 1; j < leaders.length; j++) {
      const [ia, pa] = leaders[i];
      const [ib, pb] = leaders[j];
      const meets = pa.some((s) => pb.some((o) => {
        if (s.r && o.r) return false;
        if (s.r) return lineArc(o, s);
        if (o.r) return lineArc(s, o);
        return lineLine(s, o);
      }));
      if (meets) out.add(`${Math.min(ia, ib)}>${Math.max(ia, ib)}`);
    }
  }
  return [...out];
}

// The names placed on `plan` once Fit has framed the fan on a `w` by `h` stage and the view is
// zoomed by `zoom`, with `names` the Names setting and the widths measured as above. The id
// labels all show on a fan of 60 cards or fewer, or zoomed in to 1.4, as on the page.
function placeOn(model, layout, plan, { names = 'all', w = 1600, h = 800, zoom = 1, keep = new Set(), measure = nameMeasure } = {}) {
  const k = graphFit(layout.bounds, w, h).k * zoom;
  const input = {
    plan, rim: graphNamesRim(layout), named: graphFanNames(model, names), keep, k, labelsAll: k >= 1.4 || plan.nodes.length <= 60, measure, font: '',
  };
  return { input, k, result: graphNamesPlace(input) };
}

// Where a placed name's text comes out as the page draws it, in the world: from its anchor
// point as wide as `measure` reads its text, one row high round its middle line. A test that
// checks the box a placement reports checks the text only once the text lies inside that box.
function drawnBox(p, k, measure = nameMeasure) {
  const w = measure(p.text) / k;
  const h = GRAPH_NAME_ROW / k;
  const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
  return { x0, x1: x0 + w, y0: p.y - h / 2, y1: p.y + h / 2 };
}
const within = (inner, outer, slack = 1e-9) => inner.x0 >= outer.x0 - slack && inner.x1 <= outer.x1 + slack
  && inner.y0 >= outer.y0 - slack && inner.y1 <= outer.y1 + slack;

module.exports = {
  STATUSES, HIERARCHY, CTX, loadBoard, cleanUp, card, drawnModel, buildOf, rootShapedCards, captionRects, clashes,
  nameMeasure, pathPoints, placeOn, drawnBox, within, leaderPieces, leaderCrossings,
};

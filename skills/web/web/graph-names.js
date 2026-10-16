'use strict';
// Where the tier fan's names sit. The Names option says which cards are named
// (graphFanNames); this says where each of those names goes, from the plan graphPlan
// gives and the zoom, or that a card has no room and is left unnamed. Pure geometry: no
// page, no canvas, no clock, no randomness. Text widths come in through `measure`, in
// screen pixels, so a test places names with a measure of its own. A name keeps its size
// on screen at any zoom, so every size given here in px is divided by the zoom k to
// become the world's units; the marks themselves are in world units already.
//   A parent, a card with a child drawn, is named beside its ring, inside the rim.
// A name keeps off every dot, caption, id label, the Unnested block and every other
// name, and never crosses a line the plan draws. Same dual-environment pattern as
// graph-model.js; it needs nothing from it, since every input comes in the plan.

const GRAPH_NAME_PX = 11;
const GRAPH_NAME_ROW = 13;
const GRAPH_NAME_PAD = 2;
const GRAPH_NAME_MIN_W = 64;
const GRAPH_NAME_RAIL = 7;
const GRAPH_NAME_EDGE = 14;
const GRAPH_NAME_FLOOR = 10;
const GRAPH_NAME_GAP = 3;
const GRAPH_NAME_ROWS_BEYOND = 3;
const GRAPH_NAME_BLOCK_UP = 0.9;
const GRAPH_NAME_POLE = 3;
const GRAPH_NAME_BESIDE = 5;
const GRAPH_NAME_FAR = [22, 44];
const GRAPH_NAME_MARK_PAD = 1.5;
const GRAPH_NAME_LEADER_OUT = 2.5;
const GRAPH_NAME_DETOUR = 4;
const GRAPH_NAME_SHORT = 22;
const GRAPH_NAME_FLAT = 0.25;
const GRAPH_NAME_CELL = 40;
const GRAPH_NAME_CHAR_PX = 6.4;

function graphNameRound(v) {
  return Math.round(v * 100) / 100;
}

// The rim of the fan: the outer edge of its last band (the outermost ring's, when the
// Unnested cards are drawn on one); 0 for a fan with no band.
function graphNamesRim(layout) {
  const bands = (layout && layout.bands) || [];
  return bands.length ? bands[bands.length - 1].r1 : 0;
}

function graphNameMeets(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function graphNameDiscHits(box, disc) {
  const dx = Math.max(box.x0 - disc.x, 0, disc.x - box.x1);
  const dy = Math.max(box.y0 - disc.y, 0, disc.y - box.y1);
  return dx * dx + dy * dy < disc.r * disc.r;
}

// Whether a segment runs through the inside of `box` grown by `inflate` on every side: a
// segment along an edge or through a corner only touches it. The segment is clipped to the
// box (Liang-Barsky); a clipped piece of some length runs inside exactly when its middle does.
function graphNameSegHits(box, seg, inflate = 0) {
  const x0 = box.x0 - inflate;
  const y0 = box.y0 - inflate;
  const x1 = box.x1 + inflate;
  const y1 = box.y1 + inflate;
  const dx = seg.x1 - seg.x0;
  const dy = seg.y1 - seg.y0;
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, seg.x0 - x0) || !clip(dx, x1 - seg.x0) || !clip(-dy, seg.y0 - y0) || !clip(dy, y1 - seg.y0)) return false;
  const t = (t0 + t1) / 2;
  const mx = seg.x0 + dx * t;
  const my = seg.y0 + dy * t;
  return mx > x0 && mx < x1 && my > y0 && my < y1;
}

// A path as straight segments [{ x0, y0, x1, y1 }], none further from the path than `tol`:
// the absolute M, L, H, V, Q, A and Z the plan's lines are drawn with. A quadratic is cut
// into chords evenly in its parameter, enough that the bulge of each (a quarter of its second
// difference over the square of their number) stays within `tol`; an arc into chords whose
// sagitta does. Any other command moves the pen to its last point, drawing nothing.
const GRAPH_NAME_ARITY = { M: 2, L: 2, H: 1, V: 1, Q: 4, A: 7, Z: 0, C: 6, S: 4, T: 2 };
function graphNameFlatten(d, tol) {
  const tokens = String(d === null || d === undefined ? '' : d).match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const segs = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const line = (x1, y1) => {
    if (x1 !== x || y1 !== y) segs.push({ x0: x, y0: y, x1, y1 });
    x = x1;
    y = y1;
  };
  let i = 0;
  let cmd = null;
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd.toUpperCase() === 'Z') {
        line(sx, sy);
        continue;
      }
    }
    const up = cmd ? cmd.toUpperCase() : null;
    const arity = up && GRAPH_NAME_ARITY[up];
    if (!arity || i + arity > tokens.length) break;
    const v = tokens.slice(i, i + arity).map(Number);
    i += arity;
    if (v.some((n) => !Number.isFinite(n))) break;
    if (cmd !== up) {
      // A relative command, which the plan never draws: only the pen moves.
      if (arity >= 2) { x += v[arity - 2]; y += v[arity - 1]; }
      continue;
    }
    if (up === 'M') {
      x = v[0];
      y = v[1];
      sx = x;
      sy = y;
      cmd = 'L';
    } else if (up === 'L') line(v[0], v[1]);
    else if (up === 'H') line(v[0], y);
    else if (up === 'V') line(x, v[0]);
    else if (up === 'Q') {
      const ddx = x - 2 * v[0] + v[2];
      const ddy = y - 2 * v[1] + v[3];
      const n = Math.min(256, Math.max(2, Math.ceil(Math.sqrt(Math.hypot(ddx, ddy) / (4 * tol)))));
      const px = x;
      const py = y;
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const u = 1 - t;
        if (s === n) line(v[2], v[3]);
        else line(u * u * px + 2 * u * t * v[0] + t * t * v[2], u * u * py + 2 * u * t * v[1] + t * t * v[3]);
      }
    } else if (up === 'A') graphNameArc(x, y, v, tol, line);
    else {
      x = v[arity - 2];
      y = v[arity - 1];
    }
  }
  return segs;
}

// An SVG arc from (x, y) as chords, through `line`: the endpoint form turned into its centre
// and angles (SVG's own conversion, for a round arc; a radius too short to reach is grown).
function graphNameArc(x, y, v, tol, line) {
  const [rx, , , large, sweep, x2, y2] = v;
  if (x === x2 && y === y2) return;
  let r = Math.abs(rx);
  const hx = (x - x2) / 2;
  const hy = (y - y2) / 2;
  const half = hx * hx + hy * hy;
  if (!r) { line(x2, y2); return; }
  if (half > r * r) r = Math.sqrt(half);
  const sign = (large ? 1 : 0) === (sweep ? 1 : 0) ? -1 : 1;
  const coef = sign * Math.sqrt(Math.max(0, (r * r - half) / half));
  const cx = coef * hy + (x + x2) / 2;
  const cy = -coef * hx + (y + y2) / 2;
  const a0 = Math.atan2(y - cy, x - cx);
  let turn = Math.atan2(y2 - cy, x2 - cx) - a0;
  if (sweep) { while (turn <= 0) turn += 2 * Math.PI; } else { while (turn >= 0) turn -= 2 * Math.PI; }
  const most = tol < r ? 2 * Math.acos(1 - tol / r) : Math.PI;
  const n = Math.min(1024, Math.max(1, Math.ceil(Math.abs(turn) / most)));
  for (let s = 1; s <= n; s++) {
    if (s === n) line(x2, y2);
    else line(cx + Math.cos(a0 + (turn * s) / n) * r, cy + Math.sin(a0 + (turn * s) / n) * r);
  }
}

// A uniform grid of the things a name keeps off, each with its box (`box`), so a test of a
// place looks only at what is near it. `each(box, visit)` calls `visit` once for each thing
// whose cells meet `box`, and stops at the first that answers true.
function graphNameIndex(cell) {
  const size = cell > 0 && Number.isFinite(cell) ? cell : GRAPH_NAME_CELL;
  const cells = new Map();
  let stamp = 0;
  const span = (box, at) => {
    const i0 = Math.floor(box.x0 / size);
    const i1 = Math.floor(box.x1 / size);
    const j0 = Math.floor(box.y0 / size);
    const j1 = Math.floor(box.y1 / size);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) if (at(`${i} ${j}`)) return true;
    }
    return false;
  };
  return {
    add(item) {
      item.seen = 0;
      span(item.box, (key) => {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
        return false;
      });
    },
    each(box, visit) {
      stamp++;
      return span(box, (key) => {
        const list = cells.get(key);
        if (!list) return false;
        for (const item of list) {
          if (item.seen === stamp) continue;
          item.seen = stamp;
          if (visit(item)) return true;
        }
        return false;
      });
    },
  };
}

// Rows of one side, top to bottom, to the names in the same order: the least total cost, a
// name never in a row it cannot take (an infinite cost), never two in one row. The row of each
// name, or null when they cannot all be placed. Ties go to the earlier rows.
function graphNameAssign(labels, rows, cost) {
  const n = labels.length;
  const m = rows.length;
  if (n > m) return null;
  const f = [];
  const take = [];
  for (let i = 0; i <= n; i++) {
    f.push(new Array(m + 1).fill(i ? Infinity : 0));
    take.push(new Array(m + 1).fill(false));
  }
  for (let i = 1; i <= n; i++) {
    for (let j = i; j <= m; j++) {
      const skip = f[i][j - 1];
      const use = f[i - 1][j - 1] + cost(labels[i - 1], rows[j - 1]);
      if (use < skip) {
        f[i][j] = use;
        take[i][j] = true;
      } else f[i][j] = skip;
    }
  }
  if (!Number.isFinite(f[n][m])) return null;
  const out = new Array(n);
  let j = m;
  for (let i = n; i >= 1; i--) {
    while (!take[i][j]) j--;
    out[i - 1] = rows[j - 1];
    j--;
  }
  return out;
}

// The longest start of `text` that, with an ellipsis, is no wider than `px` by `measure`; the
// whole text when it fits, and '' when not even one character does. Cut between characters.
function graphNameFit(text, px, measure) {
  const s = String(text === null || text === undefined ? '' : text);
  if (measure(s) <= px) return s;
  const chars = Array.from(s);
  const cut = (n) => `${chars.slice(0, n).join('').trimEnd()}…`;
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(cut(mid)) <= px) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? cut(lo) : '';
}

function graphNameClip(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
}

// What the placement reads of a node's classes: whether it has children drawn, wears a
// sticker ring, or is a hub (its id label always shows). Selection and hover are not read.
function graphNameFlags(cls) {
  const c = ` ${cls || ''} `;
  return {
    kids: c.includes(' has-kids '),
    flagged: / is-(blocked|waiting|review) /.test(c),
    hub: c.includes(' graph-hub '),
  };
}

// A string that changes whenever anything graphNamesPlace reads changes, and only then: the
// page places again only on a new key. The measure is read through the font it measures in.
function graphNamesKey(input) {
  const o = input || {};
  const plan = o.plan || {};
  const ids = (s) => [...(s || [])].sort((a, b) => a - b);
  const text = (c) => (c ? [c.name, c.x, c.y, c.dy || '', c.anchor || ''] : null);
  const nodes = (plan.nodes || []).map((n) => {
    const f = graphNameFlags(n.cls);
    return [n.id, n.x, n.y, n.reach, n.kidsRing, n.flagRing, f.kids, f.flagged, f.hub, n.name];
  });
  const links = (plan.links || []).map((l) => [l.d, l.label ? [l.label.x, l.label.y, l.label.text] : null]);
  const b = plan.block;
  const block = b ? [b.x, b.y, b.w, b.h, b.pitch, text(b.title), (b.columns || []).map((c) => [c.x, c.w, c.ids, text(c.caption)])] : null;
  return JSON.stringify([o.k, o.rim, !!o.labelsAll, String(o.font || ''), ids(o.named), ids(o.keep), nodes, links, (plan.captions || []).map(text), text(plan.looseCaption), block]);
}

// Where each named card's name goes. `input`:
//   plan       what graphPlan gives the fan (its nodes, links, captions, loose caption, block)
//   rim        graphNamesRim(layout)
//   named      the ids named (graphFanNames)
//   keep       the ids lit at rest (the selection and what it lights): the last to lose a name
//   k          the zoom, screen px for one world unit
//   labelsAll  whether every card's id label shows
//   measure    (text, size px, bold) -> its width on screen in px; anything but a number of 0
//              or more is read as GRAPH_NAME_CHAR_PX a character at 11px
//   font       the font measured in; read by the key alone
// The answer: `placed`, a Map from id to { kind ('beside'), side, text, x, y, anchor, box,
// leader }, where `text` is what shows (a name cut to its room ends in an ellipsis), (x, y) its
// anchor point in the world, y the middle of the line, and `box` the room it takes, padded;
// `unnamed`, the named ids with no room, in order; and `stats`, the work done (`tests`, the
// exact tests of a place against what it keeps off).
function graphNamesPlace(input) {
  const o = input || {};
  const named = new Set(o.named || []);
  const rim = Number.isFinite(o.rim) && o.rim > 0 ? o.rim : 0;
  const k = o.k;
  const stats = { tests: 0, rows: { L: 0, R: 0 }, dropped: 0 };
  const placed = new Map();
  const done = () => ({
    k, rim, placed, unnamed: [...named].filter((id) => !placed.has(id)).sort((a, b) => a - b), stats,
  });
  const plan = o.plan;
  if (!(k > 0 && Number.isFinite(k)) || !named.size || !plan || !Array.isArray(plan.nodes)) return done();
  const keep = new Set(o.keep || []);
  const measure = typeof o.measure === 'function' ? o.measure : null;
  const px = (t, size = GRAPH_NAME_PX, bold = false) => {
    const v = measure ? measure(t, size, bold) : NaN;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : (Array.from(String(t)).length * GRAPH_NAME_CHAR_PX * size) / GRAPH_NAME_PX;
  };
  const rowH = GRAPH_NAME_ROW / k;
  const pad = GRAPH_NAME_PAD / k;
  const bend = rim + GRAPH_NAME_RAIL / k;

  // What a name keeps off, in one grid: a disc for each mark, the box of each text the fan
  // shows, the block's frame, and the segments of every line drawn.
  const idx = graphNameIndex(Math.max(GRAPH_NAME_CELL, 4 * rowH));
  const nodes = plan.nodes.map((n) => {
    const f = graphNameFlags(n.cls);
    const node = {
      id: n.id, x: n.x, y: n.y, reach: n.reach, kidsRing: n.kidsRing, flagRing: n.flagRing, ...f,
      name: typeof n.name === 'string' ? n.name : `#${n.id}`,
    };
    node.disc = { x: n.x, y: n.y, r: (f.flagged ? n.flagRing : f.kids ? n.kidsRing : n.reach) + GRAPH_NAME_MARK_PAD };
    return node;
  });
  for (const n of nodes) {
    const r = n.disc.r;
    idx.add({ t: 'disc', owner: n.id, ...n.disc, box: { x0: n.x - r, y0: n.y - r, x1: n.x + r, y1: n.y + r } });
  }
  const textBox = (c, size, bold) => {
    if (!c) return;
    const name = String(c.name);
    const tw = px(name, size, bold) / k;
    const base = c.y + (parseFloat(c.dy || '0') * size) / k;
    const x0 = c.anchor === 'middle' ? c.x - tw / 2 : c.anchor === 'end' ? c.x - tw : c.x;
    idx.add({ t: 'box', owner: null, box: { x0: x0 - pad, x1: x0 + tw + pad, y0: base - (0.95 * size) / k, y1: base + (0.3 * size) / k } });
  };
  for (const c of plan.captions || []) textBox(c, GRAPH_NAME_PX, false);
  textBox(plan.looseCaption, GRAPH_NAME_PX, false);
  const block = plan.block || null;
  if (block) {
    textBox(block.title, 13, true);
    for (const col of block.columns || []) textBox(col.caption, GRAPH_NAME_PX, false);
    idx.add({ t: 'box', owner: null, box: { x0: block.x - 8 / k, y0: block.y - 2 / k, x1: block.x + block.w, y1: block.y + block.h + 4 / k } });
  }
  for (const n of nodes) {
    if (!o.labelsAll && !n.hub) continue;
    const x0 = n.x + n.reach + 3;
    idx.add({ t: 'box', owner: n.id, box: { x0: x0 - pad, x1: x0 + px(String(n.id)) / k + pad, y0: n.y - rowH / 2, y1: n.y + rowH / 2 } });
  }
  for (const l of plan.links || []) {
    for (const s of graphNameFlatten(l.d, GRAPH_NAME_FLAT)) {
      const f = GRAPH_NAME_FLAT;
      idx.add({
        t: 'seg', owner: null, ...s, box: { x0: Math.min(s.x0, s.x1) - f, y0: Math.min(s.y0, s.y1) - f, x1: Math.max(s.x0, s.x1) + f, y1: Math.max(s.y0, s.y1) + f },
      });
    }
    if (l.label) textBox({ name: l.label.text, x: l.label.x, y: l.label.y, dy: '0.35em', anchor: 'middle' }, GRAPH_NAME_PX, false);
  }
  const hits = (it, box) => {
    stats.tests++;
    if (it.t === 'disc') return graphNameDiscHits(box, it);
    if (it.t === 'seg') return graphNameSegHits(box, it, GRAPH_NAME_FLAT);
    return graphNameMeets(box, it.box);
  };
  // Whether a place is taken: by any mark or text but its own card's, any line, any name.
  const taken = (box, own) => idx.each(box, (it) => (it.owner === own && it.t !== 'seg' ? false : hits(it, box)));
  const claim = (id, p) => {
    placed.set(id, p);
    idx.add({ t: 'box', owner: id, box: p.box });
  };

  const blockIds = new Set(block ? (block.columns || []).flatMap((c) => c.ids || []) : []);
  const parents = [];
  const fanCards = [];
  for (const n of nodes) {
    if (!named.has(n.id)) continue;
    n.prio = keep.has(n.id) ? 0 : 1;
    if (blockIds.has(n.id)) continue;
    (n.kids ? parents : fanCards).push(n);
  }

  // The rays the other names' leaders will run out along, from their dots to the rail: a
  // parent's name keeps off them where it can, so a leader seldom runs under a name.
  const rays = graphNameIndex(Math.max(GRAPH_NAME_CELL, 4 * rowH));
  for (const n of fanCards) {
    const a = Math.atan2(n.y, n.x);
    const r0 = Math.hypot(n.x, n.y) + n.reach + GRAPH_NAME_LEADER_OUT;
    if (r0 >= bend) continue;
    const s = { x0: Math.cos(a) * r0, y0: Math.sin(a) * r0, x1: Math.cos(a) * bend, y1: Math.sin(a) * bend };
    rays.add({ t: 'seg', owner: n.id, ...s, box: { x0: Math.min(s.x0, s.x1), y0: Math.min(s.y0, s.y1), x1: Math.max(s.x0, s.x1), y1: Math.max(s.y0, s.y1) } });
  }
  const across = (box) => {
    let count = 0;
    rays.each(box, (it) => {
      stats.tests++;
      if (graphNameSegHits(box, it)) count++;
      return false;
    });
    return count;
  };

  // A parent's name: beside its ring, inside the rim, in the first free place of eighteen in
  // order of liking (outward first, then the other side, under and over, the diagonals, then
  // a little up and down), its whole title or a shorter one; clear of the other names' rays
  // where any place is, else across the fewest. Inner parents choose first.
  const inRim = (b) => {
    const fx = Math.max(Math.abs(b.x0), Math.abs(b.x1));
    const fy = Math.max(Math.abs(b.y0), Math.abs(b.y1));
    return fx * fx + fy * fy <= rim * rim;
  };
  parents.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y) || p.id - q.id);
  for (const n of parents) {
    const h = rowH;
    const off = (n.flagged ? n.flagRing : n.kidsRing) + GRAPH_NAME_BESIDE;
    const away = n.x < 0 ? -1 : 1;
    const side = (dir, d, dy) => ({ anchor: dir < 0 ? 'end' : 'start', x: n.x + dir * d, top: n.y + dy - h / 2 });
    const mid = (d, up) => ({ anchor: 'middle', x: n.x, top: up ? n.y - d - h : n.y + d });
    const diag = (dir, up) => ({ anchor: dir < 0 ? 'end' : 'start', x: n.x + dir * off * 0.75, top: up ? n.y - off * 0.7 - h : n.y + off * 0.7 });
    const spots = [
      side(away, off, 0), side(-away, off, 0), mid(off - 1, false), mid(off - 1, true),
      diag(away, false), diag(away, true), diag(-away, false), diag(-away, true),
      side(away, off, h * 0.6), side(away, off, -h * 0.6), side(-away, off, h * 0.6), side(-away, off, -h * 0.6),
      mid(off + h * 0.7, false), mid(off + h * 0.7, true),
      side(away, off, h * 1.2), side(away, off, -h * 1.2), side(-away, off, h * 1.2), side(-away, off, -h * 1.2),
    ];
    for (const far of GRAPH_NAME_FAR) {
      for (const dir of [away, -away]) {
        for (const dy of [0, h, -h, 2 * h, -2 * h]) spots.push(side(dir, off + far / k, dy));
      }
    }
    const texts = [...new Set([n.name, graphNameClip(n.name, GRAPH_NAME_SHORT)])];
    let got = null;
    for (const clean of [true, false]) {
      for (const text of texts) {
        const tw = px(text) / k;
        let least = null;
        for (const c of spots) {
          const x0 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - tw : c.x - tw / 2;
          const box = { x0: x0 - pad, x1: x0 + tw + pad, y0: c.top, y1: c.top + h };
          if (!inRim(box) || taken(box, n.id)) continue;
          const count = across(box);
          if (!count) { least = { c, box, count }; break; }
          if (!clean && (!least || count < least.count)) least = { c, box, count };
        }
        if (least && (!clean || !least.count)) {
          got = {
            kind: 'beside', side: null, text, x: least.c.x, y: least.c.top + h / 2, anchor: least.c.anchor, box: least.box, leader: null,
          };
          break;
        }
      }
      if (got) break;
    }
    if (got) claim(n.id, got);
  }
  return done();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_NAME_PX, GRAPH_NAME_ROW, GRAPH_NAME_PAD, GRAPH_NAME_MIN_W, GRAPH_NAME_RAIL, GRAPH_NAME_EDGE, GRAPH_NAME_GAP, GRAPH_NAME_BLOCK_UP, GRAPH_NAME_POLE, GRAPH_NAME_LEADER_OUT,
    graphNamesRim, graphNamesKey, graphNamesPlace,
    graphNameAssign, graphNameFit, graphNameFlatten, graphNameSegHits, graphNameDiscHits, graphNameMeets, graphNameIndex,
  };
} else {
  window.graphNamesRim = graphNamesRim;
  window.graphNamesKey = graphNamesKey;
  window.graphNamesPlace = graphNamesPlace;
}

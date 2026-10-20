'use strict';
// Where the tier fan's names sit. The Names option says which cards are named
// (graphFanNames); this says where each of those names goes, from the plan graphPlan
// gives and the zoom, or that a card has no room and is left unnamed. Pure geometry: no
// page, no canvas, no clock, no randomness. Text widths come in through `measure`, in
// screen pixels, so a test places names with a measure of its own. A name keeps its size
// on screen at any zoom, so every size given here in px is divided by the zoom k to
// become the world's units; the marks themselves are in world units already.
//   A parent, a card with a child drawn, is named beside its ring, inside the rim.
//   Every other card of the fan is named in a row outside the rim on its own side, joined
//   to its dot by a leader that runs out along the card's own ray, round a rail just outside
//   the rim and out to the name.
//   The Unnested block's named cards are listed above the block, the column furthest right
//   nearest it, each joined to its dot by a line up its column's left side.
// A name keeps off every dot, caption, id label, the Unnested block and every other
// name, and never crosses a line the plan draws: a parent line, a dependency line or a
// divider between sectors. Same dual-environment pattern as graph-model.js; it needs
// nothing from it, since every input comes in the plan.

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

// How many leading characters of a name are its card's number, `#7 ` or the whole `#7`: the
// part a cut never reaches.
function graphNameLead(name, id) {
  const lead = `#${id}`;
  if (name === lead) return lead.length;
  return String(name).startsWith(`${lead} `) ? lead.length + 1 : 0;
}

// The longest start of `text` that, with an ellipsis, is no wider than `px` by `measure`; the
// whole text when it fits, and '' when not even one character does. Cut between characters.
// The first `keep` characters are never cut: the cut falls in what follows, and when none of
// that fits the start alone stays if it does, else ''.
function graphNameFit(text, px, measure, keep = 0) {
  const s = String(text === null || text === undefined ? '' : text);
  if (measure(s) <= px) return s;
  const chars = Array.from(s);
  const lead = chars.slice(0, keep).join('').trimEnd();
  const cut = (n) => (n > 0 ? `${chars.slice(0, keep + n).join('').trimEnd()}…` : lead);
  let lo = 0;
  let hi = chars.length - keep;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(cut(mid)) <= px) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 || (lead && measure(lead) <= px) ? cut(lo) : '';
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
  const dividers = (plan.dividers || []).map((v) => [v.x1, v.y1, v.x2, v.y2]);
  const b = plan.block;
  const block = b ? [b.x, b.y, b.w, b.h, b.pitch, text(b.title), (b.columns || []).map((c) => [c.x, c.w, c.ids, text(c.caption)])] : null;
  return JSON.stringify([o.k, o.rim, !!o.labelsAll, String(o.font || ''), ids(o.named), ids(o.keep), nodes, links, dividers, (plan.captions || []).map(text), text(plan.looseCaption), block]);
}

// Where each named card's name goes. `input`:
//   plan       what graphPlan gives the fan (its nodes, links, dividers, captions, loose caption,
//              block)
//   rim        graphNamesRim(layout)
//   named      the ids named (graphFanNames)
//   keep       the ids lit at rest (the selection and what it lights): the last to lose a name
//   k          the zoom, screen px for one world unit
//   labelsAll  whether every card's id label shows
//   measure    (text, size px, bold) -> its width on screen in px; anything but a number of 0
//              or more is read as GRAPH_NAME_CHAR_PX a character at 11px
//   font       the font measured in; read by the key alone
// The answer: `placed`, a Map from id to { kind ('beside', 'row' or 'list'), side ('L' or 'R'
// for a row, else null), text, x, y, anchor, box, leader }, where `text` is what shows (a
// name cut to its room ends in an ellipsis), (x, y) its anchor point in the world, y the middle
// of the line, `box` the room it takes, padded, and `leader` null beside a ring, else { from,
// to, d }: where it leaves the dot and stops short of the name, in the world, and its path,
// drawn in the card's own group (every point less the card's);
// `unnamed`, the named ids with no room, in order; and `stats`, the work done: `tests`, the
// exact tests of a place against what it keeps off; `rays`, the marks looked at for the
// leaders' runs; `cells`, the cells of the tables that give a side's rows out.
function graphNamesPlace(input) {
  const o = input || {};
  const named = new Set(o.named || []);
  const rim = Number.isFinite(o.rim) && o.rim > 0 ? o.rim : 0;
  const k = o.k;
  const stats = {
    tests: 0, rays: 0, cells: 0, rows: { L: 0, R: 0 }, dropped: 0,
  };
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
  // shows, the block's frame, and the segments of every line drawn and every divider.
  const idx = graphNameIndex(Math.max(GRAPH_NAME_CELL, 4 * rowH));
  // A card with no place or size to read is left unnamed and keeps nothing off: a number that
  // is not one would make every cost on its side not one either, and the side lose its names.
  const nodes = plan.nodes.map((n) => {
    const f = graphNameFlags(n.cls);
    const node = {
      id: n.id, x: n.x, y: n.y, reach: n.reach, kidsRing: n.kidsRing, flagRing: n.flagRing, ...f,
      name: typeof n.name === 'string' ? n.name : `#${n.id}`,
    };
    node.disc = { x: n.x, y: n.y, r: (f.flagged ? n.flagRing : f.kids ? n.kidsRing : n.reach) + GRAPH_NAME_MARK_PAD };
    return node;
  }).filter((n) => [n.x, n.y, n.reach, n.disc.r].every(Number.isFinite));
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
  const segment = (s) => {
    const f = GRAPH_NAME_FLAT;
    idx.add({
      t: 'seg', owner: null, ...s, box: { x0: Math.min(s.x0, s.x1) - f, y0: Math.min(s.y0, s.y1) - f, x1: Math.max(s.x0, s.x1) + f, y1: Math.max(s.y0, s.y1) + f },
    });
  };
  for (const l of plan.links || []) {
    for (const s of graphNameFlatten(l.d, GRAPH_NAME_FLAT)) segment(s);
    if (l.label) textBox({ name: l.label.text, x: l.label.x, y: l.label.y, dy: '0.35em', anchor: 'middle' }, GRAPH_NAME_PX, false);
  }
  for (const v of plan.dividers || []) {
    if ([v.x1, v.y1, v.x2, v.y2].every(Number.isFinite)) segment({ x0: v.x1, y0: v.y1, x1: v.x2, y1: v.y2 });
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
  // a little up and down), else beside it further out (GRAPH_NAME_FAR, up to two lines up or
  // down), its whole title or a shorter one; clear of the other names' rays where any place
  // is, else across the fewest. Inner parents choose first.
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

  // How far a name starting `a` out from the middle of the fan, in the row at y, may run on
  // `side` before it meets something, keeping GRAPH_NAME_GAP off it: every box, disc and
  // line piece in the row's band counts. Looked at up to `reach` further; Infinity when the
  // way is clear that far.
  const gap = GRAPH_NAME_GAP / k;
  const roomAt = (side, a, y, reach) => {
    const lo = y - rowH / 2;
    const hi = y + rowH / 2;
    const q = side === 'L' ? { x0: -(a + reach + gap), x1: -a, y0: lo, y1: hi } : { x0: a, x1: a + reach + gap, y0: lo, y1: hi };
    let end = Infinity;
    idx.each(q, (it) => {
      stats.tests++;
      const ext = graphNameExtent(it, lo, hi);
      if (!ext) return false;
      const o0 = side === 'L' ? -ext[1] : ext[0];
      const o1 = side === 'L' ? -ext[0] : ext[1];
      if (o1 > a) end = Math.min(end, o0 - gap);
      return false;
    });
    return end - a;
  };
  const discs = nodes.filter((n) => !blockIds.has(n.id)).map((n) => ({ owner: n.id, ...n.disc }));
  const minW = GRAPH_NAME_MIN_W / k;
  const edge = rim + GRAPH_NAME_EDGE / k;
  const top = -(edge + GRAPH_NAME_ROWS_BEYOND * rowH);

  // The Unnested block's named cards: one list above the block, a name to a row, the rows
  // counted up from the block. Each name starts just right of its column's line, which runs up
  // the column's left side from the block to the name's row, and the columns further right
  // take the rows nearer the block, so a line only passes rows whose names start to its right.
  // A card whose line would run inside the rim (GRAPH_NAME_EDGE beyond it), or across a name
  // or a caption on the way up, is left unnamed and the next card tries the same row; when the
  // list would run past the rows over the fan, the least wanted card is left out instead. The
  // leader runs from the dot up and left between the rows of dots to the column's line, up it
  // and out to the name.
  const listed = [];
  if (block) {
    (block.columns || []).forEach((col, ci) => (col.ids || []).forEach((id, order) => {
      const n = nodes.find((m) => m.id === id);
      if (n && named.has(id)) listed.push({ n, ci, order, pole: col.x + GRAPH_NAME_POLE, w: px(n.name) / k + pad });
    }));
  }
  if (listed.length) {
    const reach = Math.max(...listed.map((c) => c.w)) + 7 / k;
    const rowAt = (j) => block.y - (j + GRAPH_NAME_BLOCK_UP) * rowH;
    const edgeAt = (j) => block.y - (j + GRAPH_NAME_BLOCK_UP - 0.5) * rowH;
    const barred = (c, y) => {
      const near = y <= 0 && block.y >= 0 ? 0 : Math.min(Math.abs(y), Math.abs(block.y));
      if (rim > 0 && near < edge && c.pole - 3 / k < Math.sqrt(edge * edge - near * near)) return true;
      const line = { x0: c.pole - 2 / k, x1: c.pole + 2 / k, y0: y, y1: block.y - 3 / k };
      return idx.each(line, (it) => {
        if (it.t !== 'box') return false;
        stats.tests++;
        return graphNameMeets(it.box, line);
      });
    };
    const place = (list) => {
      const out = [];
      const left = [];
      let j = 0;
      for (const c of list) {
        let got = null;
        for (; !got; j++) {
          const y = rowAt(j);
          if (y < top) return { out, left, full: true };
          if (barred(c, y)) { left.push(c); break; }
          const room = roomAt('R', c.pole - 3 / k, y, reach) - 7 / k;
          if (room >= minW) got = { c, j, y, room };
        }
        if (got) out.push(got);
      }
      return { out, left, full: false };
    };
    let wanted = listed.slice().sort((p, q) => p.n.prio - q.n.prio || p.ci - q.ci || p.order - q.order);
    let rows = [];
    while (wanted.length) {
      const res = place(wanted.slice().sort((p, q) => q.ci - p.ci || q.order - p.order));
      stats.dropped += res.left.length;
      wanted = wanted.filter((c) => !res.left.includes(c));
      if (!res.full) { rows = res.out; break; }
      if (!res.left.length) { wanted.pop(); stats.dropped++; }
    }
    const tops = new Map();
    for (const { c, j, y, room } of rows) {
      const { n, pole } = c;
      const text = graphNameFit(n.name, (room - pad) * k, (t) => px(t), graphNameLead(n.name, n.id));
      if (!text) continue;
      const a = pole + 4 / k;
      const half = (block.pitch || 0) / 2;
      const local = (x, yy) => `${graphNameRound(x - n.x)} ${graphNameRound(yy - n.y)}`;
      const to = { x: pole + 2 / k, y };
      const d = `M0 0L${graphNameRound(-half)} ${graphNameRound(-half)}H${graphNameRound(pole - n.x)}V${graphNameRound(y - n.y)}L${local(to.x, to.y)}`;
      claim(n.id, {
        kind: 'list', side: null, text, x: a, y, anchor: 'start',
        box: { x0: pole - 3 / k, x1: a + px(text) / k + pad, y0: edgeAt(j + 1), y1: edgeAt(j) },
        leader: { from: { x: n.x, y: n.y }, to, d },
      });
      tops.set(pole, Math.min(tops.has(pole) ? tops.get(pole) : Infinity, edgeAt(j + 1)));
    }
    for (const [pole, y] of tops) idx.add({ t: 'box', owner: null, box: { x0: pole - 3 / k, x1: pole + 3 / k, y0: y, y1: block.y } });
  }

  // Every other card of the fan: in a row outside the rim, on its own side (left or right of
  // the apex), the rows one name high and level with each other on a side, from three rows over
  // the rim to three under it. A row starts just outside the rim (GRAPH_NAME_EDGE beyond it)
  // and holds at least GRAPH_NAME_MIN_W of room. The cards of a side, in their order down it,
  // take rows in the same order, each as near level with where its leader meets the rail
  // (GRAPH_NAME_RAIL outside the rim) as the others allow; when there are more cards than
  // rows the least wanted go first (not lit at rest), then the one with the closest neighbour.
  // The leader runs from the dot's edge out along the card's own ray, round any mark in the
  // way, to the rail, round the rail to the ray through where it stops, GRAPH_NAME_GAP short of
  // the name, and straight out along that ray; the rows keep the order down the side and each
  // leader leaves the rail along a ray of its own, so leaders sharing the rail never cross.
  const last = Math.floor(-top / rowH);
  for (const side of ['L', 'R']) {
    const dir = side === 'L' ? -1 : 1;
    const cards = fanCards.filter((n) => (n.x < 0 ? 'L' : 'R') === side).map((n) => {
      let ray = Math.atan2(n.y, n.x);
      if (side === 'L' && ray < 0) ray += 2 * Math.PI;
      return { n, ray, yd: bend * Math.sin(ray), w: px(n.name) / k + pad };
    }).sort((p, q) => p.yd - q.yd || p.n.id - q.n.id);
    if (!cards.length) continue;
    const reach = Math.max(...cards.map((c) => c.w));
    const rows = [];
    for (let j = -last; j <= last; j++) {
      const y = j * rowH;
      const a = Math.max(Math.abs(y) < edge ? Math.sqrt(edge * edge - y * y) : 0, GRAPH_NAME_FLOOR / k);
      const room = roomAt(side, a, y, reach);
      if (room >= minW) rows.push({ j, y, a, room });
    }
    stats.rows[side] = rows.length;
    const cost = (c, row) => {
      if (row.room < Math.min(c.w, minW)) return Infinity;
      const move = (row.y - c.yd) / rowH;
      return move * move + (row.room < c.w ? 0.5 : 0);
    };
    let list = cards;
    const dropWorst = () => {
      let at = 0;
      let worst = -Infinity;
      list.forEach((c, i) => {
        const near = Math.min(i ? c.yd - list[i - 1].yd : Infinity, i < list.length - 1 ? list[i + 1].yd - c.yd : Infinity);
        const score = c.n.prio * 1e6 - near;
        if (score > worst || !i) { worst = score; at = i; }
      });
      stats.dropped++;
      list = list.slice(0, at).concat(list.slice(at + 1));
    };
    const assign = () => {
      stats.cells += list.length * rows.length;
      return graphNameAssign(list, rows, cost);
    };
    while (list.length > rows.length) dropWorst();
    let got = assign();
    while (!got && list.length) {
      dropWorst();
      got = assign();
    }
    if (!got) continue;
    list.forEach((c, i) => {
      const { n, ray } = c;
      const row = got[i];
      const text = graphNameFit(n.name, (row.room - pad) * k, (t) => px(t), graphNameLead(n.name, n.id));
      if (!text) return;
      const tw = px(text) / k;
      const x = dir * row.a;
      // From the row's number, so neighbouring rows share one edge to the last bit.
      const y0 = (row.j - 0.5) * rowH;
      const y1 = (row.j + 0.5) * rowH;
      const box = dir > 0 ? { x0: x, x1: x + tw + pad, y0, y1 } : { x0: x - tw - pad, x1: x, y0, y1 };
      const out = n.reach + GRAPH_NAME_LEADER_OUT;
      const from = { x: n.x + Math.cos(ray) * out, y: n.y + Math.sin(ray) * out };
      const to = { x: dir * (row.a - gap), y: row.y };
      let turn = Math.atan2(to.y, to.x);
      if (side === 'L' && turn < 0) turn += 2 * Math.PI;
      const local = (p) => `${graphNameRound(p.x - n.x)} ${graphNameRound(p.y - n.y)}`;
      const rail = { x: Math.cos(turn) * bend, y: Math.sin(turn) * bend };
      const d = `M${local(from)}${graphNameRun(ray, Math.hypot(n.x, n.y) + out, bend, discs, n.id, local, stats)}`
        + `A${graphNameRound(bend)} ${graphNameRound(bend)} 0 0 ${turn > ray ? 1 : 0} ${local(rail)}L${local(to)}`;
      claim(n.id, {
        kind: 'row', side, text, x, y: row.y, anchor: dir > 0 ? 'start' : 'end', box, leader: { from, to, d },
      });
    });
  }
  return done();
}

// The stretch of x a thing in the index takes in the band of y from `lo` to `hi`, or null
// when it is not in it: a box's own, a disc's chord, a line piece's run inside the band.
function graphNameExtent(it, lo, hi) {
  if (it.t === 'disc') {
    const dy = Math.max(lo - it.y, 0, it.y - hi);
    if (dy >= it.r) return null;
    const half = Math.sqrt(it.r * it.r - dy * dy);
    return [it.x - half, it.x + half];
  }
  if (it.t === 'seg') {
    const f = GRAPH_NAME_FLAT;
    const l = lo - f;
    const h = hi + f;
    const dy = it.y1 - it.y0;
    let t0 = 0;
    let t1 = 1;
    if (dy === 0) {
      if (it.y0 < l || it.y0 > h) return null;
    } else {
      const ta = (l - it.y0) / dy;
      const tb = (h - it.y0) / dy;
      t0 = Math.max(0, Math.min(ta, tb));
      t1 = Math.min(1, Math.max(ta, tb));
      if (t0 > t1) return null;
    }
    const xa = it.x0 + (it.x1 - it.x0) * t0;
    const xb = it.x0 + (it.x1 - it.x0) * t1;
    return [Math.min(xa, xb) - f, Math.max(xa, xb) + f];
  }
  return it.box.y1 > lo && it.box.y0 < hi ? [it.box.x0, it.box.x1] : null;
}

// The run of a leader out along the ray at `ray` from radius r0 to r1, as path text after its
// start: straight, but round any mark on the ray (GRAPH_NAME_DETOUR clear of its disc) on the
// side of the mark the ray already lies, back onto the ray beyond it. `local` writes a point
// relative to the card the leader is drawn in.
function graphNameRun(ray, r0, r1, discs, own, local, stats) {
  const s = r1 > r0 ? 1 : -1;
  const at = (r, a) => local({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  const arc = (r, a0, a1) => `A${graphNameRound(r)} ${graphNameRound(r)} 0 0 ${a1 > a0 ? 1 : 0} ${at(r, a1)}`;
  const hits = [];
  for (const m of discs) {
    if (m.owner === own) continue;
    stats.rays++;
    const mr = Math.hypot(m.x, m.y);
    if ((mr - r0) * s <= 0 || (r1 - mr) * s <= 0) continue;
    const reach = m.r + GRAPH_NAME_DETOUR;
    let off = ray - Math.atan2(m.y, m.x);
    off -= 2 * Math.PI * Math.round(off / (2 * Math.PI));
    if (Math.abs(off * mr) < reach) hits.push({ mr, ma: ray - off, reach, way: off >= 0 ? 1 : -1 });
  }
  hits.sort((p, q) => (p.mr - q.mr) * s);
  let d = '';
  let r = r0;
  for (const h of hits) {
    const a2 = h.ma + (h.way * h.reach) / h.mr;
    const rin = s > 0 ? Math.max(r, h.mr - h.reach) : Math.min(r, h.mr + h.reach);
    const rout = h.mr + s * h.reach;
    if ((rout - r1) * s >= 0) break;
    d += `L${at(rin, ray)}${arc(rin, ray, a2)}L${at(rout, a2)}${arc(rout, a2, ray)}`;
    r = rout;
  }
  return `${d}L${at(r1, ray)}`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GRAPH_NAME_PX, GRAPH_NAME_ROW, GRAPH_NAME_PAD, GRAPH_NAME_MIN_W, GRAPH_NAME_RAIL, GRAPH_NAME_EDGE, GRAPH_NAME_GAP, GRAPH_NAME_BLOCK_UP, GRAPH_NAME_POLE, GRAPH_NAME_LEADER_OUT,
    GRAPH_NAME_MARK_PAD, GRAPH_NAME_DETOUR,
    graphNamesRim, graphNamesKey, graphNamesPlace,
    graphNameAssign, graphNameLead, graphNameFit, graphNameFlatten, graphNameSegHits, graphNameDiscHits, graphNameMeets, graphNameIndex,
  };
} else {
  window.graphNamesRim = graphNamesRim;
  window.graphNamesKey = graphNamesKey;
  window.graphNamesPlace = graphNamesPlace;
}

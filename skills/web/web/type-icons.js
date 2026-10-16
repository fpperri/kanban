'use strict';
// A type in the board's config (`types:` in config.yaml) may carry an `icon:`, one
// of six names. This module is the closed table behind that name: the glyph a
// type chip wears and the outline a Graph dot is drawn in. It has no
// dependencies, so the page loads it before the type chip and the Graph and the
// snapshot can embed it on its own.
//
// An icon name is human text. It is only ever looked up in the table below;
// it never becomes markup, a class name or a path. A name the table does not
// hold (unknown, blank, mis-cased, not even a string) answers nothing, and the
// caller draws a chip with no glyph and a round dot.

// Each shape is a polygon: `sides` corners (twice that for a star, which
// alternates `outer` and `inner`), the first one at `turn` degrees, at `outer`
// times the dot radius from the centre. The circle is the plain dot. The glyphs are the
// filled forms, because the Graph fills the dot in the same shape: a chip's mark and its dot read as one.
const TYPE_ICON_SHAPES = new Map([
  ['circle', { glyph: '\u25cf', round: true }],
  ['square', { glyph: '\u25a0', sides: 4, turn: 45, outer: 1.2 }],
  ['diamond', { glyph: '\u25c6', sides: 4, turn: 0, outer: 1.3 }],
  ['triangle', { glyph: '\u25b2', sides: 3, turn: -90, outer: 1.35 }],
  ['hexagon', { glyph: '\u2b22', sides: 6, turn: 0, outer: 1.15 }],
  ['star', { glyph: '\u2605', sides: 5, turn: -90, outer: 1.4, inner: 0.6 }],
]);

const TYPE_ICON_NAMES = Object.freeze([...TYPE_ICON_SHAPES.keys()]);

function typeIconShape(name) {
  return typeof name === 'string' ? TYPE_ICON_SHAPES.get(name) : undefined;
}

function typeIconRadiusUsable(r) {
  return typeof r === 'number' && Number.isFinite(r) && r > 0;
}

function typeIconRound(v) {
  return Math.round(v * 100) / 100;
}

// The character a type chip shows before the type's name, or '' for no icon.
function typeIconGlyph(name) {
  const shape = typeIconShape(name);
  return shape ? shape.glyph : '';
}

// A closed path around 0,0 for a dot of radius r, or '' for no icon or no radius.
function typeIconOutline(name, r) {
  const shape = typeIconShape(name);
  if (!shape || !typeIconRadiusUsable(r)) return '';
  if (shape.round) {
    const d = typeIconRound(r);
    return `M${d} 0A${d} ${d} 0 1 1 ${-d} 0A${d} ${d} 0 1 1 ${d} 0Z`;
  }
  const count = shape.inner ? shape.sides * 2 : shape.sides;
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (shape.turn + (i * 360) / count) * Math.PI / 180;
    const radius = r * (shape.inner && i % 2 ? shape.inner : shape.outer);
    points.push(`${typeIconRound(radius * Math.cos(angle))} ${typeIconRound(radius * Math.sin(angle))}`);
  }
  return `M${points.join('L')}Z`;
}

// How far from the dot's centre the shape reaches, so a ring drawn around it
// clears every corner; 0 for no icon or no radius.
function typeIconReach(name, r) {
  const shape = typeIconShape(name);
  if (!shape || !typeIconRadiusUsable(r)) return 0;
  return typeIconRound(shape.round ? r : r * shape.outer);
}

// The icon the board's `types:` list gives a card's type: the name when the list
// holds the type with an icon the table knows, otherwise ''. Names match without
// regard to case or surrounding space, and the first entry of a name decides,
// as it does for the chip's colour.
function typeIconOf(type, types) {
  const key = String(type == null ? '' : type).trim().toLowerCase();
  if (!key || !Array.isArray(types)) return '';
  for (const t of types) {
    if (!t || typeof t !== 'object') continue;
    if (String(t.name == null ? '' : t.name).trim().toLowerCase() !== key) continue;
    return typeIconShape(t.icon) ? t.icon : '';
  }
  return '';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TYPE_ICON_NAMES, typeIconGlyph, typeIconOutline, typeIconReach, typeIconOf };
} else {
  window.TYPE_ICON_NAMES = TYPE_ICON_NAMES;
  window.typeIconGlyph = typeIconGlyph;
  window.typeIconOutline = typeIconOutline;
  window.typeIconReach = typeIconReach;
  window.typeIconOf = typeIconOf;
}

'use strict';
// A type's icon, drawn. On the plan board each type carries one of the six
// icons (or, for bug, a name that is not one); the Graph draws a card's dot in
// its type's outline, and the Board's tiles, the Map's rich rows and the card
// details start the type chip with the glyph, in the chip's own colour. The
// malformed board has a type whose icon name is unknown (goal): it draws as it
// did before icons, in every view. The harness closes the scenario with the
// console-error check, which covers both boards.
//
// A dot is read as the shape it was drawn: a circle element is a round dot; a
// path is told apart by its corners (ten for a star, six for a hexagon, three
// for a triangle, four for a square or a diamond, and a diamond has a corner on
// an axis). The chips are read from the page's own tiles and rows.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// none.

const GLYPH = { circle: '\u25cf', square: '\u25a0', diamond: '\u25c6', triangle: '\u25b2', hexagon: '\u2b22', star: '\u2605' };

// What each board's config.yaml and cards say, written out by hand from the
// fixtures (test/web/browser-fixtures.test.js pins them). `chips` are
// the glyph the chip of that card starts with, '' for none; `dots` the shape of
// that card's Graph dot; `map` and `detail` the cards read in those views.
const EXPECTED = {
  plan: {
    chips: { 1: GLYPH.star, 2: GLYPH.hexagon, 7: GLYPH.diamond, 22: GLYPH.square, 15: GLYPH.triangle, 11: GLYPH.circle, 14: '' },
    dots: { 1: 'star', 2: 'hexagon', 7: 'diamond', 22: 'square', 15: 'triangle', 11: 'circle', 14: 'circle', 3: 'circle' },
    map: { 1: GLYPH.star, 2: GLYPH.hexagon, 7: GLYPH.diamond, 22: GLYPH.square, 23: GLYPH.circle, 24: GLYPH.triangle },
    detail: { 1: GLYPH.star, 14: '' },
    colours: { 1: 'rgb(163, 113, 247)' },
  },
  malformed: {
    chips: { 1: '', 2: GLYPH.star, 3: '' },
    dots: { 1: 'circle', 2: 'star', 3: 'circle' },
    map: { 1: '', 2: GLYPH.star, 3: '' },
    detail: { 1: '', 2: GLYPH.star },
    colours: {},
  },
};

const SHAPE_OF = `(d)=>{const pts=[...d.matchAll(/[ML](-?[\\d.]+) (-?[\\d.]+)/g)].map((m)=>({x:+m[1],y:+m[2]}));const n=pts.length;if(n===10)return 'star';if(n===6)return 'hexagon';if(n===3)return 'triangle';if(n===4)return pts.some((p)=>Math.abs(p.x)<0.01||Math.abs(p.y)<0.01)?'diamond':'square';return 'other'}`;

// id -> the shape of that card's dot, for every dot in the Graph.
const DOT_SHAPES = `(()=>{const shapeOf=${SHAPE_OF};const out={};for(const n of document.querySelectorAll('#graph-view .graph-node')){const dot=n.querySelector('.graph-dot');out[n.dataset.id]=!dot?'none':dot.tagName.toLowerCase()==='path'?shapeOf(dot.getAttribute('d')):dot.tagName.toLowerCase()}return out})()`;

// Every ring around a shaped dot sits farther out than the dot's farthest corner.
const RINGS_CLEAR = `(()=>{let checked=0;for(const n of document.querySelectorAll('#graph-view .graph-node')){const dot=n.querySelector('path.graph-dot');if(!dot)continue;const far=Math.max(...[...dot.getAttribute('d').matchAll(/[ML](-?[\\d.]+) (-?[\\d.]+)/g)].map((m)=>Math.hypot(+m[1],+m[2])));for(const sel of ['.graph-kids-ring','.graph-flag-ring']){const ring=n.querySelector(sel);if(!ring)continue;checked++;if(!(+ring.getAttribute('r')>far))return {ok:false,id:n.dataset.id,sel,far,r:ring.getAttribute('r')}}}return {ok:checked>0,checked}})()`;

// The chip of card `id` inside `container`: its text, the glyph it starts with
// ('' when it has none) and the colours of the chip and of the glyph.
const chipOf = (container, id) => `(()=>{const chip=document.querySelector('${container} .card-el[data-id="${id}"] .type-chip');if(!chip)return null;const icon=chip.querySelector('.type-icon');return {text:chip.textContent,glyph:icon?icon.textContent:'',iconColor:icon?getComputedStyle(icon).color:'',chipColor:getComputedStyle(chip).color}})()`;
const detailChip = `(()=>{const chip=document.querySelector('#detail-frontmatter .type-chip');if(!chip)return null;const icon=chip.querySelector('.type-icon');return {text:chip.textContent,glyph:icon?icon.textContent:'',iconColor:icon?getComputedStyle(icon).color:'',chipColor:getComputedStyle(chip).color}})()`;

// Every Board tile that wears a glyph keeps its chip inside the text column and
// off the date stack beside it.
const TILES_CLEAR = `(()=>{let checked=0;for(const tile of document.querySelectorAll('#board .card-el')){if(!tile.querySelector('.type-chip .type-icon'))continue;const chip=tile.querySelector('.type-chip').getBoundingClientRect();const main=tile.querySelector('.card-main').getBoundingClientRect();const sched=tile.querySelector('.card-schedule');const s=sched&&sched.getBoundingClientRect();checked++;if(chip.right>main.right+0.5)return {ok:false,id:tile.dataset.id,why:'past the text column'};if(s&&!(chip.right<=s.left+0.5||chip.left>=s.right-0.5||chip.bottom<=s.top+0.5||chip.top>=s.bottom-0.5))return {ok:false,id:tile.dataset.id,why:'over the date stack'}}return {ok:checked>0,checked}})()`;

module.exports = {
  name: 'type-icons',
  board: 'plan',
  alsoBoards: ['malformed'],
  timeoutMs: 60000,
  EXPECTED,
  SHAPE_OF,
  DOT_SHAPES,
  RINGS_CLEAR,
  TILES_CLEAR,
  chipOf,
  detailChip,
  async run(page) {
    const { ev, open, waitFor, check } = page;

    for (const key of ['plan', 'malformed']) {
      const want = EXPECTED[key];

      await open('/?view=graph', key);
      const drawn = await waitFor(`document.querySelectorAll('#graph-view .graph-node').length>0`, 10000);
      check(`${key}: the Graph draws`, drawn);
      const shapes = await ev(DOT_SHAPES);
      for (const [id, shape] of Object.entries(want.dots)) {
        check(`${key}: card ${id}'s Graph dot is ${shape === 'circle' ? 'round' : `a ${shape}`}`, shapes[id] === shape, shapes[id]);
      }
      const rings = await ev(RINGS_CLEAR);
      check(`${key}: the child and flag rings sit outside every shaped dot`, rings.ok, rings);
      check(`${key}: a shaped dot is still the one graph-dot of a status-coloured node`, await ev(`(()=>{const dots=[...document.querySelectorAll('#graph-view .graph-node path.graph-dot')];return dots.length>0&&dots.every((d)=>d.parentNode.querySelectorAll('.graph-dot').length===1&&[...d.parentNode.classList].some((c)=>/^status-/.test(c)))})()`));

      await open('/', key);
      check(`${key}: the Board draws`, await waitFor(`document.querySelectorAll('#board .card-el .type-chip').length>0`, 10000));
      for (const [id, glyph] of Object.entries(want.chips)) {
        const chip = await ev(chipOf('#board', id));
        check(`${key}: the Board tile of card ${id} ${glyph ? `starts its chip with ${glyph}` : 'has a chip with no glyph'}`, !!chip && chip.glyph === glyph && chip.text.startsWith(glyph), chip);
        if (glyph && chip) {
          check(`${key}: the glyph on card ${id} wears the chip's colour`, chip.iconColor === chip.chipColor && chip.iconColor !== '', chip);
          if (want.colours[id]) check(`${key}: and that colour is the type's configured one`, chip.chipColor === want.colours[id], chip);
        }
      }
      const tiles = await ev(TILES_CLEAR);
      check(`${key}: a tile's chip with a glyph stays in its text column and off the date stack`, tiles.ok, tiles);

      await open('/?view=map', key);
      check(`${key}: the Map draws its rich rows`, await waitFor(`document.querySelectorAll('#map-view .card-el .map-rich-meta .type-chip').length>0`, 10000));
      for (const [id, glyph] of Object.entries(want.map)) {
        const chip = await ev(chipOf('#map-view', id));
        check(`${key}: the Map row of card ${id} ${glyph ? `starts its chip with ${glyph}` : 'has a chip with no glyph'}`, !!chip && chip.glyph === glyph && chip.text.startsWith(glyph), chip);
        if (glyph && chip) check(`${key}: the glyph on the Map row of card ${id} wears the chip's colour`, chip.iconColor === chip.chipColor && chip.iconColor !== '', chip);
      }

      for (const [id, glyph] of Object.entries(want.detail)) {
        await open(`/?card=${id}`, key);
        check(`${key}: the details of card ${id} open with a type chip`, await waitFor(`!!document.querySelector('#detail-frontmatter .type-chip')`, 10000));
        const chip = await ev(detailChip);
        check(`${key}: the details of card ${id} ${glyph ? `start the chip with ${glyph}` : 'show a chip with no glyph'}`, !!chip && chip.glyph === glyph && chip.text.startsWith(glyph), chip);
        if (glyph && chip) check(`${key}: the glyph in the details of card ${id} wears the chip's colour`, chip.iconColor === chip.chipColor && chip.iconColor !== '', chip);
      }
    }
  },
};

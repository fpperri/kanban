'use strict';
// The done dot's fade as the page paints it, for the graph, graph-flow and graph-3d scenarios: a done
// card's dot is filled from a gradient of its own, its centre stop the ground (--surface) and its rim
// stop the colour its ring is drawn in at 55%, and a card of another status has a plain dot, filled in
// its own colour, with no fade. Read from the computed styles, so the stylesheet's rules are what is
// checked. Answers null when the Graph shows no done card beside another.
const DONE_FADE_PROBE = `(()=>{
  const nodes=[...document.querySelectorAll('.graph-node:not(.graph-3d-off):not(.graph-flow-lane-head)')];
  const done=nodes.find(n=>n.classList.contains('is-done')&&!n.classList.contains('archived'));
  const other=nodes.find(n=>!n.classList.contains('is-done'));
  if(!done||!other)return null;
  const cs=(e)=>getComputedStyle(e);
  const hex=cs(document.documentElement).getPropertyValue('--surface').trim();
  const surface='rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';
  const dot=done.querySelector('.graph-dot');
  const fade=done.querySelector('.graph-done-fade');
  const m=/url\\("?#([\\w-]+)"?\\)/.exec(cs(dot).fill);
  const stops=fade?[...fade.querySelectorAll('stop')].map(s=>({offset:s.getAttribute('offset'),colour:cs(s).stopColor,opacity:cs(s).stopOpacity})):[];
  const odot=other.querySelector('.graph-dot');
  return {
    id:done.dataset.id, otherId:other.dataset.id, fill:cs(dot).fill, ring:cs(dot).stroke, surface, stops,
    own:!!fade&&!!m&&document.getElementById(m[1])===fade,
    centreIsGround:stops.length===2&&stops[0].offset==='0.45'&&stops[0].colour===surface&&stops[0].opacity==='1',
    rimIsRing:stops.length===2&&stops[1].offset==='1'&&stops[1].colour===cs(dot).stroke&&stops[1].opacity==='0.55',
    otherFill:cs(odot).fill, otherColour:cs(odot).color,
    otherPlain:!other.querySelector('.graph-done-fade')&&!/url/.test(cs(odot).fill)&&cs(odot).fill===cs(odot).color,
  };
})()`;

// The scenario's checks of the fade, under `label`.
async function checkDoneFade(page, label) {
  const f = await page.ev(DONE_FADE_PROBE);
  page.check(`${label}: a done dot and a dot of another status are drawn`, !!f, f);
  if (!f) return f;
  page.check(`${label}: a done dot is filled from its own fade`, f.own, f);
  page.check(`${label}: the fade keeps the ground to 45% of the radius`, f.centreIsGround, f);
  page.check(`${label}: the fade reaches the ring's colour at 55% at the rim`, f.rimIsRing, f);
  page.check(`${label}: a dot of another status is filled in its own colour, with no fade`, f.otherPlain, f);
  return f;
}

module.exports = { DONE_FADE_PROBE, checkDoneFade };

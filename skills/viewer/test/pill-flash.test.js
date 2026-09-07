const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Pill flash (kanban.proj #250): the "N pending" pill turns red (--high,
// never the calmer --accent blue) and flashes red -> white -> red on an
// IRREGULAR, lightning-like cadence -- CSS @keyframes only, no JS timers.
// Same source-as-text technique format-body.test.js, stack-mode.test.js,
// pointer-drag.test.js and pill-copy.test.js use (no build step, no DOM) --
// extract the relevant CSS/expressions from build_editor.py by marker +
// brace-balanced scan and assert on their text.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');

function extractStyleBlock() {
  const start = src.indexOf('<style>');
  const end = src.indexOf('</style>');
  assert.ok(start !== -1 && end !== -1, '<style> block not found');
  return src.slice(start + '<style>'.length, end);
}

function extractMediaBlocks(css) {
  const blocks = [];
  let idx = 0;
  while ((idx = css.indexOf('@media', idx)) !== -1) {
    const braceStart = css.indexOf('{', idx);
    let depth = 0, i = braceStart;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    blocks.push(css.slice(idx, i));
    idx = i;
  }
  return blocks;
}

const css = extractStyleBlock();
const mediaBlocks = extractMediaBlocks(css);
const nonMediaCss = mediaBlocks.reduce((acc, b) => acc.split(b).join(''), css);

function extractKeyframes(name) {
  const marker = `@keyframes ${name}`;
  const start = css.indexOf(marker);
  assert.ok(start !== -1, `${marker} not found in the <style> block`);
  const braceStart = css.indexOf('{', start);
  let depth = 0, i = braceStart;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return css.slice(start, i);
}

test('.pill is red (--high), not the calmer --accent blue', () => {
  assert.match(nonMediaCss, /\.pill\{[^}]*background:var\(--high\)[^}]*\}/, 'the base pill fill must be --high');
  assert.ok(!/\.pill\{[^}]*background:var\(--accent\)/.test(nonMediaCss), 'the old --accent fill must be gone');
});

test('.pill runs an infinite CSS-only pillFlash animation, no JS timers involved', () => {
  assert.match(nonMediaCss, /\.pill\{[^}]*animation:pillFlash [\d.]+s [\w-]+ infinite[^}]*\}/, '.pill must declare the pillFlash animation as infinite');
  assert.ok(!/setInterval|setTimeout|requestAnimationFrame/.test(src), 'the flash must be CSS-only -- no JS timers anywhere in the file');
});

test('pillFlash keyframes are an IRREGULAR cadence: a fast double strike then one long pause, not an even pulse', () => {
  const kf = extractKeyframes('pillFlash');
  const stops = [...kf.matchAll(/([\d%,\s]+)\{/g)].flatMap(m => m[1].split(',').map(s => parseInt(s, 10))).sort((a, b) => a - b);
  assert.ok(stops.length >= 5, 'expects at least 5 percentage stops to encode a double-strike-then-pause shape');
  assert.strictEqual(stops[0], 0, 'must start at 0%');
  assert.strictEqual(stops[stops.length - 1], 100, 'must end at 100%');
  const gaps = stops.slice(1).map((s, i) => s - stops[i]);
  const uniqueGaps = new Set(gaps);
  assert.ok(uniqueGaps.size > 1, 'gaps between stops must be UNEVEN (not a regular sine-like pulse): ' + JSON.stringify(gaps));
  const lastGap = gaps[gaps.length - 1];
  assert.ok(lastGap > Math.max(...gaps.slice(0, -1)) * 2, 'the final gap (the dark pause) must be much longer than the earlier strike gaps: ' + JSON.stringify(gaps));
  const earlyStops = stops.filter(s => s > 0 && s < 20);
  assert.ok(earlyStops.length >= 2, 'the double strike must land as at least two intermediate stops early in the cycle');
});

test('pillFlash toggles background between --high and white, keeping the base color state at 0%/100%', () => {
  const kf = extractKeyframes('pillFlash');
  assert.match(kf, /0%,100%\{background:var\(--high\);color:#fff\}|0%\{background:var\(--high\);color:#fff\}[\s\S]*100%\{background:var\(--high\);color:#fff\}/, 'the cycle must start and end on the red/white-text base state');
  assert.match(kf, /background:#fff/, 'the flash must animate the background to white at some stop');
  assert.match(kf, /background:var\(--high\)/, 'the flash must return the background to --high at some stop');
});

test('the white flash stop pairs with a fixed dark text color, not var(--ink) (which is white in dark mode and would vanish)', () => {
  const kf = extractKeyframes('pillFlash');
  const whiteStops = [...kf.matchAll(/\{background:#fff;color:([^}]+)\}/g)];
  assert.ok(whiteStops.length > 0, 'at least one white-background stop must declare its own color');
  whiteStops.forEach(m => {
    assert.notStrictEqual(m[1], 'var(--ink)', 'the white flash stop must not rely on var(--ink) -- it flips to white in dark mode');
    assert.match(m[1], /^#[0-9a-fA-F]{3,6}$/, 'the white flash stop must pin a fixed dark hex color: ' + m[1]);
  });
});

test('an empty pill (no ops queued) stops the animation outright, not just visually via :empty padding/background', () => {
  assert.match(nonMediaCss, /\.pill:empty\{[^}]*animation:none[^}]*\}/, ':empty must explicitly kill the animation so nothing paints/runs behind the invisible pill');
});

test('prefers-reduced-motion forces a static red pill with no animation', () => {
  const reducedBlock = mediaBlocks.find(b => /^@media\(prefers-reduced-motion:reduce\)/.test(b));
  assert.ok(reducedBlock, 'a @media(prefers-reduced-motion:reduce) block must exist');
  assert.match(reducedBlock, /\.pill\{[^}]*animation:none[^}]*\}/, 'reduced motion must disable the animation');
  assert.match(reducedBlock, /\.pill\{[^}]*background:var\(--high\)[^}]*\}/, 'reduced motion must still show the red pill statically');
});

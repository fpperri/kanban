const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Status/assignee colors through CSS variables (kanban.proj #274 goal 2):
// ccol()/acol() no longer return hex — they return `var(--st-*)` /
// `var(--hash-*)` strings, resolved against the theme tokens.test.js already
// pins. Both hash into the SAME djb2-xor algorithm skills/web/web/
// status-colors.js's statusHash() uses, so a handle/status colors
// identically on both surfaces. ccol/acol/shash carry no regex/backslashes,
// so — unlike the markdown/notification functions — they can be extracted
// straight from the .py source text (no python build needed), same
// technique format-body.test.js uses for fmtBodySegs.

const srcPath = path.join(__dirname, '..', 'scripts', 'build_editor.py');
const src = fs.readFileSync(srcPath, 'utf8');
const statusColorsPath = path.join(__dirname, '..', '..', 'web', 'web', 'status-colors.js');
const { statusHash } = require(statusColorsPath);

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in build_editor.py`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}
function extractConst(name) {
  const marker = `const ${name}=`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${name} not found in build_editor.py`);
  const end = src.indexOf('\n', start);
  return src.slice(start, end);
}

const harness = [
  extractFunction('shash'),
  extractConst('HASH_SLOTS'),
  extractFunction('ccol'),
  'const ASGCOL = {};',
  extractFunction('acol'),
  'module.exports = { shash, ccol, acol, HASH_SLOTS };',
].join('\n');
const mod = new Function('module', 'exports', harness + '\nreturn module.exports;')({ exports: {} }, {});

test('shash() is byte-for-byte the same djb2-xor hash skills/web/web/status-colors.js exports as statusHash()', () => {
  ['needs-triage', 'ready-for-agent', 'wontfix', 'icebox', 'review', ''].forEach((s) => {
    assert.strictEqual(mod.shash(s), statusHash(s), `shash(${JSON.stringify(s)}) disagrees with statusHash()`);
  });
});

test('ccol(): the four built-in statuses map to their own --st-* token', () => {
  assert.strictEqual(mod.ccol('backlog'), 'var(--st-backlog)');
  assert.strictEqual(mod.ccol('todo'), 'var(--st-todo)');
  assert.strictEqual(mod.ccol('doing'), 'var(--st-doing)');
  assert.strictEqual(mod.ccol('done'), 'var(--st-done)');
});

test('ccol(): archive and archived (either case) both map to --st-archive', () => {
  assert.strictEqual(mod.ccol('archive'), 'var(--st-archive)');
  assert.strictEqual(mod.ccol('archived'), 'var(--st-archive)');
  assert.strictEqual(mod.ccol('Archived'), 'var(--st-archive)');
});

test('ccol(): any other status hashes (trimmed, lowercased) into --hash-a.."h", matching statusHash()%8', () => {
  ['needs-triage', 'ready-for-agent', ' Ready-For-Human ', 'wontfix'].forEach((s) => {
    const norm = s.trim().toLowerCase();
    const expectedSlot = 'abcdefgh'[statusHash(norm) % 8];
    assert.strictEqual(mod.ccol(s), `var(--hash-${expectedSlot})`);
  });
});

test('acol(): an empty/blank handle returns null (no color)', () => {
  assert.strictEqual(mod.acol(''), null);
  assert.strictEqual(mod.acol('   '), null);
  assert.strictEqual(mod.acol(undefined), null);
});

test('acol(): an unregistered handle hashes (lowercased) into the SAME --hash-a.."h" family ccol() uses', () => {
  ['@human', '@hitl', '@afk', 'someone'].forEach((h) => {
    const expectedSlot = 'abcdefgh'[statusHash(h.toLowerCase()) % 8];
    assert.strictEqual(mod.acol(h), `var(--hash-${expectedSlot})`);
  });
});

test('acol(): a config.yaml assignees[].color reservation wins outright, painted exactly as given', () => {
  const harness2 = [
    extractFunction('shash'),
    extractConst('HASH_SLOTS'),
    'const ASGCOL = {"@human": "#123456"};',
    extractFunction('acol'),
    'module.exports = { acol };',
  ].join('\n');
  const mod2 = new Function('module', 'exports', harness2 + '\nreturn module.exports;')({ exports: {} }, {});
  assert.strictEqual(mod2.acol('@human'), '#123456');
});

// --- ccol()/acol() call sites paint through .style properties, never SVG attributes ---

test('every ccol()/acol()/ARCHC call site assigns through a .style.* PROPERTY, never a raw SVG presentation attribute (var() does not resolve in attributes)', () => {
  // Scope to the <script> block only — the Python side's docstrings/comments
  // mention "acol()" in prose too, and aren't JS call sites at all.
  const scriptStart = src.indexOf('<script>');
  const jsSrc = src.slice(scriptStart);
  const calls = [...jsSrc.matchAll(/\b(ccol|acol)\([^)]*\)/g)];
  let realCallSites = 0;
  calls.forEach((m) => {
    const lineStart = jsSrc.lastIndexOf('\n', m.index) + 1;
    const line = jsSrc.slice(lineStart, jsSrc.indexOf('\n', m.index));
    if (line.trim().startsWith('//')) return; // a prose mention in a comment, not an actual call site
    if (jsSrc.slice(Math.max(0, m.index - 9), m.index) === 'function ') return; // the "function ccol(" / "function acol(" declaration itself
    realCallSites++;
    // Widen to the whole enclosing statement (back to the previous `;`/`{`/
    // `}`, forward to the next `;`) rather than a fixed lookback window, so
    // ternaries and nested calls (e.g. `k==="archive"?ARCHC:ccol(k)`,
    // `mk(cname(c.s),ccol(c.s))`) don't produce false positives. Either the
    // statement itself sets `.style.<prop>=`, or it routes the value through
    // mk() — the read-only archived-pill helper, which itself only ever does
    // `.style.background=color` (checked below), never a raw attribute.
    const stmtStart = Math.max(
      jsSrc.lastIndexOf(';', m.index),
      jsSrc.lastIndexOf('{', m.index),
      jsSrc.lastIndexOf('}', m.index),
    ) + 1;
    const stmtEndCandidate = jsSrc.indexOf(';', m.index);
    const stmtEnd = stmtEndCandidate === -1 ? m.index + m[0].length : stmtEndCandidate;
    const statement = jsSrc.slice(stmtStart, stmtEnd);
    const direct = /\.style\.(background|color|fill|stroke)=/.test(statement);
    const viaMk = /\bmk\(/.test(statement);
    assert.ok(direct || viaMk, `call site's statement neither sets .style.* nor routes through mk(): ${JSON.stringify(statement)}`);
  });
  assert.ok(realCallSites > 5, `expected several real (non-comment) call sites, found ${realCallSites}`);
});

test('mk() — the archived read-only pill helper ccol()/ARCHC/acol() route through — paints via .style.background, never a raw attribute', () => {
  assert.match(src, /const mk=\(txt,color\)=>\{[\s\S]{0,80}?dt\.style\.background=color/);
});

test('ARCHC is itself a var() string (an --st-archive token), not a literal hex', () => {
  assert.match(src, /const ARCHC="var\(--st-archive\)";/);
});

// --- priority/blocked/review/waiting repainted through the new pill vocabulary ---

test('priority High renders as an uppercase TEXT LABEL (.hitag, var(--id-high)), not a filled badge', () => {
  assert.match(src, /if\(c\.p==="High"\)d\.appendChild\(el\("span","hitag","HIGH"\)\);/);
  assert.match(src, /\.hitag\{[^}]*color:var\(--id-high\)[^}]*\}/);
  assert.ok(!/\.hitag\{[^}]*background/.test(src), '.hitag must not carry a fill — it is a plain text label');
});

test('the blocked/waiting/review pills paint through --blocked-*/--warn-soft+--id-waiting/--review-* tokens', () => {
  assert.match(src, /\.badge\{[^}]*background:var\(--blocked-bg\)[^}]*color:var\(--blocked-ink\)[^}]*\}/);
  assert.match(src, /\.wbadge\{background:var\(--warn-soft\);color:var\(--id-waiting\)\}/);
  assert.match(src, /\.rbadge\{background:var\(--review-bg\);color:var\(--review-ink\)\}/);
});

test('the pills are monospace, small, and border-radius:.15rem (no border) per the shop\'s pill vocabulary', () => {
  assert.match(src, /\.badge\{[^}]*font-family:ui-monospace[^}]*border-radius:\.15rem[^}]*\}/);
  assert.ok(!/\.badge\{[^}]*border:/.test(src), 'pills must not declare a border');
});

test('epic cues (map edges, epic chip) paint through --id-epic / --epic-wash, not an inline literal hex', () => {
  assert.match(src, /\.medge\.epicedge\{stroke:var\(--id-epic\)/);
  assert.match(src, /\.map-arrow-epic-head\{fill:var\(--id-epic\)\}/);
  assert.match(src, /\.epicchip\.on\{border-color:var\(--id-epic\);color:var\(--id-epic\);background:var\(--epic-wash\)\}/);
  // #f0883e legitimately still appears as the DARK-theme --id-epic/--hash-g
  // token VALUE itself (theme-tokens.test.js pins that) — this only checks
  // the three consuming rules above no longer paint it as an inline literal.
  assert.ok(!/stroke:#f0883e/.test(src));
  assert.ok(!/fill:#f0883e/.test(src));
  assert.ok(!/border-color:#f0883e/.test(src));
});

// --- SVG rx small (2-3) per the shop's vocabulary ---

test('SVG rect corner radii (map node, blocked pill, gantt bar) are small (2-3), not the old 8/6/4', () => {
  assert.match(src, /svgEl\("rect",\{width:MW,height:MH,rx:[23]\}\)/);
  assert.match(src, /rx:[23],class:"mblk"/);
  assert.match(src, /rx:[23],class:"gbar"/);
});

// --- numbers (ids, counts, the bell count) use the mono stack + tabular-nums ---

test('ids/counts/the bell count use the mono stack with font-variant-numeric:tabular-nums', () => {
  assert.match(src, /\.cid\{[^}]*font-family:ui-monospace[^}]*font-variant-numeric:tabular-nums[^}]*\}/);
  assert.match(src, /\.cnt\{[^}]*font-family:ui-monospace[^}]*font-variant-numeric:tabular-nums[^}]*\}/);
  assert.match(src, /#bellcnt\{[^}]*font-family:ui-monospace[^}]*font-variant-numeric:tabular-nums[^}]*\}/);
});

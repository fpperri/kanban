const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createServer, start, originAllowed, resolveDefaultBoardDir } = require('../scripts/server');

function tmpBoard() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-srv-'));
  fs.writeFileSync(path.join(dir, '1.card.md'),
    `---\nid: 1\nstatus: done\npriority: Normal\nwaiting_for: []\ntags: []\n---\n\n# One\n\nbody\n`);
  fs.writeFileSync(path.join(dir, '2.card.md'),
    `---\nid: 2\nstatus: todo\npriority: High\nwaiting_for: [1]\ntags: []\n---\n\n# Two\n\nbody2\n`);
  return dir;
}

async function withServer(dir, fn) {
  const srv = createServer(dir);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { return await fn(base); } finally { srv.close(); }
}

// --- board-directory discovery: .kanban/ preferred, kanban/ legacy fallback ---

test('resolveDefaultBoardDir prefers .kanban over kanban when both exist', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-discover-'));
  fs.mkdirSync(path.join(base, '.kanban'));
  fs.mkdirSync(path.join(base, 'kanban'));
  assert.strictEqual(resolveDefaultBoardDir(base), '.kanban');
});

test('resolveDefaultBoardDir falls back to kanban when only the legacy dir exists', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-discover-'));
  fs.mkdirSync(path.join(base, 'kanban'));
  assert.strictEqual(resolveDefaultBoardDir(base), 'kanban');
});

test('resolveDefaultBoardDir returns .kanban when only it exists', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-discover-'));
  fs.mkdirSync(path.join(base, '.kanban'));
  assert.strictEqual(resolveDefaultBoardDir(base), '.kanban');
});

test('resolveDefaultBoardDir falls back to the preferred name when neither directory exists', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-discover-'));
  assert.strictEqual(resolveDefaultBoardDir(base), '.kanban');
});

test('resolveDefaultBoardDir defaults baseDir to the current working directory', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-discover-'));
  fs.mkdirSync(path.join(base, 'kanban'));
  const cwd = process.cwd();
  process.chdir(base);
  try {
    assert.strictEqual(resolveDefaultBoardDir(), 'kanban');
  } finally {
    process.chdir(cwd);
  }
});

test('GET /api/board returns active + archived', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.active.length, 2);
    assert.deepStrictEqual(data.archived, []);
    assert.strictEqual(data.active[0]._order, undefined); // public shape only
  });
});

test('GET /api/board falls back to the folder above the board dir when no name: is declared', async () => {
  const dir = tmpBoard();
  const expected = path.basename(path.dirname(dir));
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    const data = await res.json();
    assert.strictEqual(data.projectName, expected);
  });
});

test("GET /api/board exposes the board name — config.yaml's declared name: wins over the parent folder", async () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: webapp   # board name for card mentions\nnextId: 3\n');
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    const data = await res.json();
    assert.strictEqual(data.projectName, 'webapp');
    assert.notStrictEqual(data.projectName, path.basename(path.dirname(dir)));
  });
});

test('GET /api/board exposes boardDir — the board directory\'s ABSOLUTE path', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    const data = await res.json();
    // resolve()d server-side: the CLI defaults dir to the relative 'kanban',
    // and a relative path is useless to paste into another terminal/editor.
    assert.ok(path.isAbsolute(data.boardDir), `boardDir must be absolute, got: ${data.boardDir}`);
    assert.strictEqual(data.boardDir, path.resolve(dir));
  });
});

test('GET /api/board exposes each active card\'s file as its basename (file: search)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/board`);
    const data = await res.json();
    const files = data.active.map((c) => c.file).sort();
    assert.deepStrictEqual(files, ['1.card.md', '2.card.md']);
  });
});

test('GET / serves the SPA html', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<!DOCTYPE html>/i);
  });
});

test('GET /refresh-policy.js serves the auto-refresh skip predicate', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/refresh-policy.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.match(await res.text(), /shouldSkipAutoRefresh/);
  });
});

test('index html loads refresh-policy.js, column-state.js, column-sort.js, and search.js before app.js (app.js calls all four as bare globals)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const policyIdx = html.indexOf('/refresh-policy.js');
    const columnStateIdx = html.indexOf('/column-state.js');
    const columnSortIdx = html.indexOf('/column-sort.js');
    const searchIdx = html.indexOf('/search.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(policyIdx > -1 && columnStateIdx > -1 && columnSortIdx > -1 && searchIdx > -1 && appIdx > -1, 'all five scripts referenced');
    assert.ok(policyIdx < appIdx, 'refresh-policy.js loads before app.js');
    assert.ok(columnStateIdx < appIdx, 'column-state.js loads before app.js');
    assert.ok(columnSortIdx < appIdx, 'column-sort.js loads before app.js');
    assert.ok(searchIdx < appIdx, 'search.js loads before app.js');
  });
});

test('GET /column-state.js serves the per-column collapse-state helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/column-state.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    assert.match(await res.text(), /mergeCollapsedState/);
  });
});

test('GET /column-sort.js serves the per-column sort comparator/state helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/column-sort.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /compareCards/);
    assert.match(body, /mergeSortState/);
  });
});

test('GET /search.js serves the query parser/matcher', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/search.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /parseSearchQuery/);
    assert.match(body, /filterCards/);
  });
});

test('GET /dependency-graph.js serves the graph-builder/layout helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/dependency-graph.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /buildDependencyGraph/);
    assert.match(body, /layerNodes/);
  });
});

test('GET /waiting-blocked.js serves the shared waiting/blocked predicates', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/waiting-blocked.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /isBlockedValue/);
    assert.match(body, /unresolvedWaits/);
  });
});

test('index html loads waiting-blocked.js before dependency-graph.js and app.js (both read its predicates; dependency-graph\'s WB namespace binds at load)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const wbIdx = html.indexOf('/waiting-blocked.js');
    const graphIdx = html.indexOf('/dependency-graph.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(wbIdx > -1 && graphIdx > -1 && appIdx > -1, 'all three scripts referenced');
    assert.ok(wbIdx < graphIdx, 'waiting-blocked.js loads before dependency-graph.js');
    assert.ok(wbIdx < appIdx, 'waiting-blocked.js loads before app.js');
  });
});

test('the edit form carries the waiting_for ids input AND the blocked reason input, wired to the red-border predicate', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Waiting for \(ids, comma-sep\) <input id="f-waiting">/, 'the dependency-edges input renamed off "Blocked by"');
    assert.match(html, /Blocked \(reason\) <input id="f-blocked"/, 'the sticker input, reason as free text');
    assert.ok(!html.includes('Blocked by (ids'), 'the retired blocked_by label is gone');
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /waiting_for: parseIds\(\$\('#f-waiting'\)\.value\)/, 'submit sends waiting_for from the ids input');
    assert.match(js, /blocked: \$\('#f-blocked'\)\.value\.trim\(\)/, 'submit sends the raw sticker text — the store\'s lean rule judges it');
    assert.match(js, /classList\.toggle\('blocked-active', isBlockedValue\(\$\('#f-blocked'\)\.value\)\)/,
      'the red border tracks the SHARED predicate, not a local re-implementation');
    assert.match(js, /\$\('#f-blocked'\)\.addEventListener\('input', syncBlockedInputStyle\)/, 'live while typing');
  });
});

test('the edit form carries the review text input, wired to the gold-border predicate (ADR 0009)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /Review \(text\) <input id="f-review"/, 'the review sticker input, text as free text');
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /review: \$\('#f-review'\)\.value\.trim\(\)/, 'submit sends the raw sticker text — the store\'s lean rule judges it');
    assert.match(js, /classList\.toggle\('review-active', isReviewValue\(\$\('#f-review'\)\.value\)\)/,
      'the gold border tracks the SHARED predicate, not a local re-implementation');
    assert.match(js, /\$\('#f-review'\)\.addEventListener\('input', syncReviewInputStyle\)/, 'live while typing');
  });
});

test('the board tile renders the waiting badge with UNRESOLVED ids only, and the blocked pill via textContent/title only', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function cardEl\([\s\S]*?\nfunction /)[0];
    assert.match(fn, /waitingOn\(card\)/, 'the badge derives from the unresolved-only helper');
    assert.match(fn, /waiting-badge/);
    assert.ok(!fn.includes('card.waiting_for.join'), 'never lists the raw full id list — unresolved only');
    // XSS rule: the blocked reason is user data — textContent/title property
    // assignment only, never interpolated into innerHTML.
    assert.match(fn, /pill\.textContent = 'blocked'/);
    assert.match(fn, /pill\.title = blockedLabel\(card\.blocked\)/);
    const innerHtmlStmt = fn.match(/el\.innerHTML =[\s\S]*?;\r?\n/)[0]; // CRLF-tolerant (core.autocrlf)
    assert.ok(!innerHtmlStmt.includes('card.blocked') && !innerHtmlStmt.includes('blockedLabel'),
      'the reason never rides the innerHTML write — pill is appended via DOM property assignment after it');
  });
});

test('the board tile renders the review pill via textContent/title only, same XSS discipline as blocked (ADR 0009)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function cardEl\([\s\S]*?\nfunction /)[0];
    assert.match(fn, /pill\.textContent = 'review'/);
    assert.match(fn, /pill\.title = reviewLabel\(card\.review\)/);
    const innerHtmlStmt = fn.match(/el\.innerHTML =[\s\S]*?;\r?\n/)[0];
    assert.ok(!innerHtmlStmt.includes('card.review') && !innerHtmlStmt.includes('reviewLabel'),
      'the text never rides the innerHTML write — pill is appended via DOM property assignment after it');
  });
});

test('clicking the blocked or review pill appends the bare presence term to the search box (the click-to-filter mechanism)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /closest\('\.card-assignee, \.tag, \.blocked-pill, \.review-pill'\)/, 'the pills join the existing click-to-filter cue selector');
    assert.match(js, /cue\.classList\.contains\('blocked-pill'\)\) addSearchTerm\('blocked:'\)/);
    assert.match(js, /cue\.classList\.contains\('review-pill'\)\) addSearchTerm\('review:'\)/);
  });
});

test('index html loads dependency-graph.js before app.js (app.js calls it as a bare global)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const graphIdx = html.indexOf('/dependency-graph.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(graphIdx > -1, 'dependency-graph.js referenced');
    assert.ok(graphIdx < appIdx, 'dependency-graph.js loads before app.js');
  });
});

test('GET /calendar-model.js serves the calendar date-math/grid helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/calendar-model.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /monthGrid/);
    assert.match(body, /rescheduleChanges/);
    assert.match(body, /mergeViewMode/);
  });
});

test('index html loads calendar-model.js before app.js (app.js calls it as a bare global)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const calIdx = html.indexOf('/calendar-model.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(calIdx > -1, 'calendar-model.js referenced');
    assert.ok(calIdx < appIdx, 'calendar-model.js loads before app.js');
  });
});

test('GET /gantt-model.js serves the gantt window/row/drag math', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/gantt-model.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /ganttWindow/);
    assert.match(body, /barShiftChanges/);
    assert.match(body, /barResizeChanges/);
  });
});

test('index html loads gantt-model.js before app.js (app.js calls it as a bare global)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const ganttIdx = html.indexOf('/gantt-model.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(ganttIdx > -1, 'gantt-model.js referenced');
    assert.ok(ganttIdx < appIdx, 'gantt-model.js loads before app.js');
  });
});

test('index html has a top-bar gantt toggle button and a gantt view container', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<button id="gantt-toggle-btn"/);
    assert.match(html, /<div id="gantt-view" class="gantt-view hidden"/);
  });
});

test('GET /modal-fullscreen.js serves the per-modal-type fullscreen state helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/modal-fullscreen.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /mergeFullscreenState/);
    assert.match(body, /MODAL_TYPES/);
  });
});

test('index html loads modal-fullscreen.js before app.js (app.js calls it as a bare global)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const fsIdx = html.indexOf('/modal-fullscreen.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(fsIdx > -1, 'modal-fullscreen.js referenced');
    assert.ok(fsIdx < appIdx, 'modal-fullscreen.js loads before app.js');
  });
});

test('GET /assignee-badge.js serves the assignee badge/escapeHtml helpers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/assignee-badge.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /assigneeBadge/);
    assert.match(body, /escapeHtml/);
  });
});

test('index html loads assignee-badge.js before app.js (app.js calls assigneeBadge/escapeHtml as bare globals)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const badgeIdx = html.indexOf('/assignee-badge.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(badgeIdx > -1, 'assignee-badge.js referenced');
    assert.ok(badgeIdx < appIdx, 'assignee-badge.js loads before app.js');
  });
});

test('index html has a fullscreen toggle button in the edit/create modal header', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // class list loosened for the shared .popup-header (added
    // alongside .modal-header, not instead of it) — the exact class STRING
    // isn't the contract here, .modal-header being present is
    assert.match(html, /<div class="modal-header[^"]*">[\s\S]*?<h2 id="modal-title">New card<\/h2>[\s\S]*?<button type="button" id="modal-fullscreen-btn"/);
  });
});

test('index html has a fullscreen toggle button in the detail popup\'s action row', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<button type="button" id="detail-fullscreen-btn" class="icon-btn"/);
  });
});

test('both fullscreen toggle buttons start with the "Expand to full screen" tooltip/aria-label and aria-pressed=false', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    for (const id of ['modal-fullscreen-btn', 'detail-fullscreen-btn']) {
      const re = new RegExp(`<button type="button" id="${id}"[^>]*title="Expand to full screen"[^>]*aria-label="Expand to full screen"[^>]*aria-pressed="false"`);
      assert.match(html, re, `${id} missing the expected tooltip/aria-label/aria-pressed`);
    }
  });
});

test('app.css fills the viewport for a fullscreen modal (fixed + inset:0, not the browser Fullscreen API) and hands the description the leftover height', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.modal\.fullscreen\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
    // flex-grow down the form → .modal-desc label → textarea chain
    // gives the description the REAL remaining height at any viewport size
    // (a static 60vh share dead-spaced tall viewports, overflowed short ones)
    assert.match(css, /\.modal\.fullscreen\s+\.modal-desc\s*\{[^}]*flex:\s*1 1 auto/);
    assert.match(css, /\.modal\.fullscreen\s+\.modal-desc\s+textarea\s*\{[^}]*flex:\s*1 1 auto/);
  });
});

test('edit form fields track the modal width: rows wrap and the intrinsic min-width floors are lifted', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const css = await (await fetch(`${base}/app.css`)).text();
    // without min-width:0 an <input>'s automatic minimum (~170px) beats both
    // flex-shrink and align-items:stretch — the assignee+dates row rendered
    // as a fixed ~790px strip regardless of the modal's actual size
    assert.match(css, /#card-form\s+\.row\s*\{[^}]*flex-wrap:\s*wrap/);
    assert.match(css, /#card-form\s+\.row\s+label\s*\{[^}]*flex:\s*1 1 170px[^}]*min-width:\s*0/);
    assert.match(css, /#card-form input, #card-form select, #card-form textarea, #card-form \.date-field\s*\{[^}]*min-width:\s*0/);
    // the description label carries the class the fullscreen flex chain
    // targets (modal-extra is stacked alongside it — match the class,
    // not the whole attribute)
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<label class="modal-desc[^"]*">Description \(markdown\)/);
  });
});

// An earlier cut shared the title's row, icons merely reordered to
// lead it via order:-1. The shared popup-header keeps that order:-1 mechanism (it still
// moves each icon group first without touching DOM/tab order) but the
// container is no longer a single row — see the next test for the two-row
// contract that replaced "headers drop space-between".
test('popup header control icons still ride order:-1 (the mechanism the shared popup-header reuses below)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.modal-header-actions\s*\{[^}]*order:\s*-1/);
    assert.match(css, /\.detail-actions\s*\{[^}]*order:\s*-1/);
    // every popup's header controls ride one of the two moved classes —
    // edit form + the three bulk popups + the archive popup vs. detail popup
    // + notifications
    const html = await (await fetch(`${base}/`)).text();
    assert.strictEqual((html.match(/class="modal-header-actions"/g) || []).length, 5);
    assert.strictEqual((html.match(/class="detail-actions"/g) || []).length, 2);
  });
});

test('every popup header is its OWN two rows — icons alone on row 1, title/content on row 2, one shared .popup-header class, not per-popup one-offs', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const css = await (await fetch(`${base}/app.css`)).text();
    // flex-direction:column is what turns order:-1's "leads the row"
    // into "owns row 1": the action group and the title/content
    // block become two stacked flex lines instead of two items on one line.
    assert.match(css, /\.popup-header\s*\{[^}]*flex-direction:\s*column/);
    const popupHeader = css.match(/\.popup-header\s*\{[^}]*\}/s);
    assert.ok(popupHeader && !/space-between/.test(popupHeader[0]),
      '.popup-header must not keep space-between — it would shove row 2 to the bottom of the container instead of snug under row 1');
    // full-width row 2 (the "heading and fields start on the next
    // row, full width"): align-items:stretch (explicit, not just the flex
    // default) is what makes the title/content block span the container.
    assert.match(css, /\.popup-header\s*\{[^}]*align-items:\s*stretch/);
    // The fullscreen half of the criterion (must hold in compact, fullscreen,
    // minimal, and expanded modes) holds only because NO .modal.fullscreen-
    // scoped rule re-aims .popup-header or the action groups — the base
    // rules are the whole story in every mode. Pin the absence: a later
    // fullscreen restyle adding e.g. `.modal.fullscreen .popup-header
    // { flex-direction: row }` would undo the two-row layout in fullscreen
    // only while every match above stayed green.
    assert.ok(!/\.modal\.fullscreen[^{]*(popup-header|modal-header|detail-header|-actions)/.test(css),
      'a .modal.fullscreen-scoped header/popup-header/actions rule would silently undo the two-row layout in fullscreen only');
    // one shared class, not per-popup one-offs: all seven header containers —
    // the edit/create form, the three bulk popups (single/tags/schedule), the
    // archive popup, the detail popup, and notifications — carry
    // .popup-header. The right-click context menu has no header controls and
    // carries neither this class nor an action group ("stays as-is").
    const html = await (await fetch(`${base}/`)).text();
    assert.strictEqual((html.match(/class="[^"]*\bpopup-header\b[^"]*"/g) || []).length, 7);
    assert.doesNotMatch(html, /<div id="context-menu"[^>]*class="[^"]*popup-header/);
    // position only: DOM stays title/content-before-actions everywhere (the
    // order:-1 CSS flip is what visually leads with the icons) — the same
    // tab-order contract, re-checked against the .popup-header wrapper.
    assert.match(html, /<div class="modal-header popup-header">\s*<h2 id="modal-title">New card<\/h2>[\s\S]*?<div class="modal-header-actions">/);
    assert.match(html, /<div class="detail-header popup-header">\s*<div>[\s\S]*?<div class="detail-actions">/);
  });
});

test('detail popup title never hops between opens: archived cards RESERVE the hidden Edit/Archive slots', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    // With the icons leading (order:-1 above), the title's x-position IS the
    // icon group's width — .hidden (display:none) on an archived card's
    // Edit/Archive buttons would shrink the group by two slots and hop the
    // title ~72px left relative to an active card's popup. visibility keeps
    // the slots (and drops the buttons from hit-testing and tab order).
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/async function openDetailModal\([\s\S]*?\n\}/);
    assert.ok(fn, 'openDetailModal found in app.js');
    assert.match(fn[0], /\$\('#detail-edit-btn'\)\.style\.visibility/, 'Edit hides via visibility, keeping its slot');
    assert.match(fn[0], /\$\('#detail-archive-btn'\)\.style\.visibility/, 'Archive hides via visibility, keeping its slot');
    assert.doesNotMatch(fn[0], /detail-(?:edit|archive)-btn'\)\.classList/,
      'classList .hidden would collapse the slot and shift the title between opens');
  });
});

test('openDetailModal washes the popup panel for an epic card — the board tile\'s wash treatment mirrored on the detail modal', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/async function openDetailModal\([\s\S]*?\n\}/);
    assert.ok(fn, 'openDetailModal found in app.js');
    assert.match(fn[0], /\$\('#detail-modal'\)\.querySelector\('\.modal'\)\.classList\.toggle\('epic', !!data\.epic\)/,
      'toggles .epic on the popup panel from the fetched detail\'s own epic flag');
  });
});

test('create form ships the minimal-first pieces: show-more button, .modal-extra groups, and the .minimal hide rule', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // type="button" so Enter in the Title input submits instead of expanding
    assert.match(html, /<button type="button" id="show-more-btn">Show more fields<\/button>/);
    // three groups still hide wholesale: status/priority/epic,
    // tags/waiting/blocked, description. The fourth (assignee+dates) no longer wholesale-hides —
    // Assignee was pulled out of it (see the minimal-form test below), and
    // the modal-desc regex is deliberately loose.
    assert.strictEqual((html.match(/class="row modal-extra"/g) || []).length, 2);
    assert.match(html, /<label class="modal-desc modal-extra">/);
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /#card-form\.minimal\s+\.modal-extra\s*\{[^}]*display:\s*none/);
    // the button only exists visually inside a minimal create form — edit never sees it
    assert.match(css, /#show-more-btn\s*\{[^}]*display:\s*none/);
    assert.match(css, /#card-form\.minimal\s+#show-more-btn\s*\{[^}]*display:\s*block/);
  });
});

test('Assignee joins Title in the minimal create form', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // the row itself no longer carries modal-extra (it must stay visible in
    // minimal mode) — only the three DATE labels inside it hide individually
    const row = html.match(/<div class="row" id="row-assignee-dates">([\s\S]*?)<\/div>/);
    assert.ok(row, 'assignee+dates row present, un-hidden as a whole');
    assert.match(row[1], /<label>Assignee <input id="f-assignee">/, 'Assignee itself carries no modal-extra — visible in minimal mode');
    assert.strictEqual((row[1].match(/<label class="modal-extra">/g) || []).length, 3,
      'Start/End/Due each hide individually now instead of the row hiding as a block');
    for (const id of ['f-start', 'f-end', 'f-due']) {
      assert.ok(row[1].includes(`id="${id}"`), `${id} still lives in the row`);
    }
  });
});

test('Assignee is the DOM/tab order\'s second focusable field after Title, in EVERY form state', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // the assignee+dates row now sits right after Title as its one
    // static position — before "Show more fields" and before the two
    // .modal-extra rows and Description. This alone makes Assignee the
    // second focusable field after Title in BOTH the minimal create form
    // (dates hidden, so Assignee is visually adjacent to
    // Title too) and the expanded/edit form (dates tag along, but
    // Assignee — the row's first field — is still tab stop #2).
    const titleIdx = html.indexOf('id="f-title"');
    const rowIdx = html.indexOf('id="row-assignee-dates"');
    const assigneeIdx = html.indexOf('id="f-assignee"');
    const showMoreIdx = html.indexOf('id="show-more-btn"');
    const statusRowIdx = html.indexOf('id="f-status"');
    assert.ok(titleIdx > -1 && rowIdx > -1 && assigneeIdx > -1 && showMoreIdx > -1 && statusRowIdx > -1,
      'all anchor elements present');
    assert.ok(titleIdx < rowIdx, 'Title precedes the assignee+dates row');
    assert.ok(rowIdx < assigneeIdx, 'the row wraps the Assignee input');
    assert.ok(assigneeIdx < showMoreIdx, 'Assignee precedes "Show more fields" — no field sits between Title and Assignee');
    assert.ok(showMoreIdx < statusRowIdx, 'Status/Priority/Epic (and everything else) still follows "Show more fields"');
    // Fixed defect: flex `order` used to fake a visual position
    // while leaving real DOM/tab order pointed elsewhere — a WCAG 2.4.3
    // focus-order violation. Still true: no `order` hack anywhere for this
    // row or the button, in any state — the row's one static source position
    // IS its tab position now, so there is nothing left to fake.
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.doesNotMatch(css, /#row-assignee-dates\s*\{[^}]*order:/, 'no order hack positions the row');
    assert.doesNotMatch(css, /#show-more-btn\s*\{[^}]*order:/, 'no order hack positions the button');
    // the tab-order rework removed the placeAssigneeRow() runtime DOM move entirely —
    // the static position above now serves every state, so there is no
    // script left to do that job. Assert it's actually gone (regression
    // guard: a reviewer re-adding a JS-side move would defeat the point of
    // making the position static and no-JS-required).
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.doesNotMatch(js, /placeAssigneeRow/, 'no runtime row-move helper survives — the row\'s position is static now');
    // Fixed defect: the assignee combobox menu opens with the
    // FULL registry list below a modal that, in minimal mode, is only
    // Title+Assignee+button tall — position:absolute clipped it against the
    // modal's overflow:auto edge (e.g. "@afk" hidden behind a tiny inner
    // scrollbar). Scoped to .minimal like .bulk-modal's own popups: the menu
    // renders in flow and grows the modal instead of floating past its edge.
    assert.match(css, /#card-form\.minimal\s+\.combobox-menu\s*\{[^}]*position:\s*static/,
      'minimal-mode combobox menu renders in flow — no clipping past the short modal\'s edge');
  });
});

test('edit opens the SAME card-form markup as create — Assignee is Tab stop #2 there too (no separate edit template)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // create and edit share one <form id="card-form"> (openModal() just
    // toggles .minimal and fills values — see app.js) — a single served
    // page has exactly one card-form, so the static reorder covers
    // both without any edit-specific markup to keep in sync.
    assert.strictEqual((html.match(/id="card-form"/g) || []).length, 1,
      'create and edit share one form element — one reorder fixes both');
    const js = await (await fetch(`${base}/app.js`)).text();
    const open = js.match(/function openModal\([\s\S]*?\n\}/);
    assert.ok(open, 'openModal found in app.js');
    // edit (a card is passed) opens full/expanded, never minimal
    assert.match(open[0], /isMinimalCreate\(Boolean\(card\)/, 'edit (card present) never opens minimal — the expanded order is what edit sees');
  });
});

test('the AI prompt button matches the modal\'s icon-btn styling, sits in the header actions, and carries the "AI prompt" tooltip', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // inline-SVG icon button, ADR 0003's hand-rolled-widget convention — same
    // shape as its Save/Fullscreen/Close siblings, not a native/emoji control.
    assert.match(html, /<button type="button" id="modal-ai-btn" class="icon-btn" title="AI prompt" aria-label="AI prompt" aria-pressed="false">\s*<svg[\s\S]*?<\/svg>\s*<\/button>/);
    const saveIdx = html.indexOf('id="modal-save"');
    const aiIdx = html.indexOf('id="modal-ai-btn"');
    const fsIdx = html.indexOf('id="modal-fullscreen-btn"');
    assert.ok(saveIdx > -1 && aiIdx > -1 && fsIdx > -1, 'all three header buttons present');
    assert.ok(saveIdx < aiIdx && aiIdx < fsIdx, 'AI button sits between Save and Fullscreen in the header actions group');
  });
});

test('#row-prompt starts hidden, sits after the Assignee row and before "Show more fields" (never ahead of Assignee)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<div class="row hidden" id="row-prompt">\s*<label>AI prompt <input id="f-prompt"[^>]*><\/label>\s*<\/div>/,
      'collapsed by default (the .hidden utility class, not the #50 .modal-extra family — it must stay reachable while the form is minimal)');
    const assigneeIdx = html.indexOf('id="f-assignee"');
    const promptRowIdx = html.indexOf('id="row-prompt"');
    const showMoreIdx = html.indexOf('id="show-more-btn"');
    assert.ok(assigneeIdx > -1 && promptRowIdx > -1 && showMoreIdx > -1, 'all anchor elements present');
    assert.ok(assigneeIdx < promptRowIdx && promptRowIdx < showMoreIdx,
      'the prompt row lands after Assignee (never between Title and Assignee) and before "Show more fields"');
  });
});

test('app.js wires the prompt field through open/snapshot/submit and the AI button toggles #row-prompt', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const open = js.match(/function openModal\([\s\S]*?\n\}/)[0];
    assert.match(open, /f-prompt'\)\.value = card && card\.prompt \? card\.prompt : ''/, 'prefills the saved prompt on edit, blank on create');
    assert.match(open, /setPromptRowVisible\(Boolean\(card && card\.prompt\)\)/, 'auto-reveals only when the card already carries one — never hides existing data');
    const snapshot = js.match(/function snapshotFormFields\([\s\S]*?\n\}/)[0];
    assert.match(snapshot, /prompt: \$\('#f-prompt'\)\.value/, 'prompt joins the #26 dirty-check baseline');
    const submit = js.match(/async function submitModal\([\s\S]*?\n\}/)[0];
    assert.match(submit, /prompt: \$\('#f-prompt'\)\.value\.trim\(\)/, 'the save payload carries the trimmed prompt — the store applies the #51 lean rule');
    assert.match(js, /function setPromptRowVisible\(show\) \{[\s\S]*?row-prompt[\s\S]*?modal-ai-btn[\s\S]*?\n\}/, 'one helper owns both the row visibility and the button\'s aria-pressed state');
    assert.match(js, /modal-ai-btn'\)\.addEventListener\('click', \(\) => \{[\s\S]*?row-prompt[\s\S]*?setPromptRowVisible/, 'the header button toggles the row via the shared helper');
  });
});

test('setPromptRowVisible relocates #row-prompt to be the form\'s first field when shown, and back to its resting slot when hidden', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function setPromptRowVisible\(show\) \{[\s\S]*?\n\}/)[0];
    // Real DOM move, not a CSS `order` fake-out (Tab follows DOM order, not
    // paint order — see the assignee-row precedent this mirrors): shown
    // goes ahead of the Title label, hidden goes back before "Show more
    // fields" (#row-prompt's static markup slot).
    assert.match(fn, /insertBefore\(row, show \? \$\('#f-title'\)\.closest\('label'\) : \$\('#show-more-btn'\)\)/,
      'one insertBefore call drives both directions off the same `show` flag');
  });
});

test('Title has no static `required` attribute — updateTitleRequired() manages it dynamically', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<label>Title <input id="f-title"><\/label>/, 'no required attribute in markup');
  });
});

test('updateTitleRequired clears Title\'s required flag only while the prompt row is shown AND non-empty', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function updateTitleRequired\([\s\S]*?\n\}/)[0];
    assert.match(fn, /row-prompt'\)\.classList\.contains\('hidden'\)/, 'reads the row\'s current shown/hidden state');
    assert.match(fn, /f-title'\)\.required = !\(promptShown && \$\('#f-prompt'\)\.value\.trim\(\)\)/,
      'required iff NOT (shown AND non-empty prompt) — hidden or empty prompt still requires a title');
    const setVisible = js.match(/function setPromptRowVisible\([\s\S]*?\n\}/)[0];
    assert.match(setVisible, /updateTitleRequired\(\)/, 'every reveal/hide re-evaluates requiredness');
    assert.match(js, /f-prompt'\)\.addEventListener\('input', updateTitleRequired\)/, 'typing/clearing the prompt live-updates requiredness too');
  });
});

test('archiveCardEl falls back to the prompt-fallback title, same helper as cardEl', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function archiveCardEl\([\s\S]*?\n\}/)[0];
    assert.match(fn, /cardTitleDisplay\(card\)/, 'reuses the shared helper, no forked title-fallback logic');
    assert.match(fn, /card-title\$\{titleDisplay\.isPromptFallback \? ' card-title--prompt-fallback' : ''\}/,
      'same modifier class the board tile uses, so app.css needs no new rule');
  });
});

test('the map node label falls back to the prompt via cardTitleDisplay, same helper every other view uses', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /const titleDisplay = cardTitleDisplay\(n\);/, 'reuses the shared helper on the node, no forked title-fallback logic');
    assert.match(js, /truncateLabel\(titleDisplay\.text, 22\)/, 'the fallback text still goes through the same truncation as a real title');
  });
});

test('ganttBarEl\'s bar text and tooltip fall back to the prompt via cardTitleDisplay', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function ganttBarEl\([\s\S]*?\n\}/)[0];
    assert.match(fn, /cardTitleDisplay\(bar\.card\)/, 'reuses the shared helper, no forked title-fallback logic');
    assert.match(fn, /gantt-bar-text\$\{titleDisplay\.isPromptFallback \? ' gantt-bar-text--prompt-fallback' : ''\}/,
      'same styling contract as the board tile\'s .card-title--prompt-fallback');
  });
});

test('the gantt gutter label and due-marker tooltip also fall back to the prompt via cardTitleDisplay', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function renderGanttView\([\s\S]*?\nfunction applyGanttDragVisual/)[0];
    assert.match(fn, /cardTitleDisplay\(bar\.card\)/, 'the gutter row builder reuses the shared helper');
    assert.match(fn, /gantt-label-id">[\s\S]*?titleDisplay\.text/, 'the visible label text goes through the fallback');
    assert.match(fn, /d\.title = bar\.card\.archived[\s\S]*?titleDisplay\.text[\s\S]*?titleDisplay\.text/,
      'the due-marker tooltip (both the archived and live phrasing) also uses the fallback text');
  });
});

test('calendarChipEl\'s chip text and tooltip fall back to the prompt via cardTitleDisplay', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function calendarChipEl\([\s\S]*?\n\}/)[0];
    assert.match(fn, /cardTitleDisplay\(card\)/, 'reuses the shared helper, no forked title-fallback logic');
    assert.match(fn, /escapeHtml\(titleDisplay\.text\)/, 'the chip\'s own text uses the fallback');
    assert.match(fn, /el\.title = `#\$\{card\.id\} \$\{titleDisplay\.text\}/, 'the plain-text tooltip property also uses the fallback');
  });
});

test('the calendar\'s "+N more" overflow tooltip also falls back to the prompt via cardTitleDisplay', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /overflow\.map\(\(c\) => `#\$\{c\.card\.id\} \$\{cardTitleDisplay\(c\.card\)\.text\}`\)/,
      'each hidden card\'s line in the overflow tooltip reuses the shared helper too');
  });
});

test('the detail popup title falls back to the prompt via cardTitleDisplay', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/async function openDetailModal\([\s\S]*?\n\}/)[0];
    assert.match(fn, /cardTitleDisplay\(data\)/, 'reuses the shared helper, no forked title-fallback logic');
    assert.match(fn, /detail-title'\)\.textContent = `#\$\{data\.id\} \$\{titleDisplay\.text\}`/, 'the popup H2 uses the fallback text');
  });
});

test('index html has a "Last modified" line element in the detail popup header', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<div class="detail-path-row">[\s\S]*?<\/div>\s*<div id="detail-modified"/);
  });
});

test('app.js renders "Last modified" using the updated field when present, else the file mtime labeled as such', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /detail-modified/);
    assert.match(js, /Last modified/);
    assert.match(js, /file mtime/);
    assert.match(js, /escapeHtml/);
  });
});

test('formatLocalDateTime renders "YYYY-MM-DD | HH:MM:SS" — no bare "T" separator survives to the human', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function formatLocalDateTime\([\s\S]*?\n\}/);
    assert.ok(fn, 'formatLocalDateTime found in app.js');
    assert.match(fn[0], /\$\{d\.getFullYear\(\)\}-.*\| .*getHours\(\).*getSeconds\(\)/,
      'format string includes a " | " separator and seconds');
  });
});

test('renderFrontmatterTable formats raw local-datetime values through formatFrontmatterValue, leaving date-only values untouched', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const valFn = js.match(/const LOCAL_DATETIME_VALUE_RE\s*=\s*([^;]+);[\s\S]*?function formatFrontmatterValue\([\s\S]*?\n\}/);
    assert.ok(valFn, 'formatFrontmatterValue found in app.js');
    const re = new RegExp(valFn[1].trim().replace(/^\/|\/$/g, ''));
    assert.match('2026-07-10T09:36:31', re);
    assert.match('2026-07-10T09:36', re);
    assert.doesNotMatch('2026-07-10', re); // date-only: no "T", unaffected
    assert.doesNotMatch('Normal', re); // non-date value: unaffected
    const tableFn = js.match(/function renderFrontmatterTable\([\s\S]*?\n\}/);
    assert.match(tableFn[0], /formatFrontmatterValue\(v\)/, 'frontmatter table routes values through the formatter');
  });
});

test('index html has a top-bar map-view toggle button', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<button id="map-toggle-btn"/);
    assert.match(html, /<div id="map-view" class="map-view hidden"/);
  });
});

test('index html has a search input and clear button for field-scoped queries', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<input type="search" id="search-input"/);
    assert.match(html, /<button type="button" id="search-clear-btn"/);
  });
});

test('index html has no leftover bottom Archive drawer — Archive is a column now', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(html, /archive-drawer/);
    assert.doesNotMatch(html, /archive-toggle/);
  });
});

test('index html has a project-name placeholder span inside the heading for the client to fill in', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    // the tail is deliberately loose: the copy-board-path button follows the
    // span inside the h1 (its own contract lives in the copy-button test below).
    assert.match(html, /<h1>Kanban<span id="project-name"[^>]*><\/span>/);
  });
});

test('edit modal description textarea keeps a rows="8" fallback and grows via CSS field-sizing', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<textarea id="f-body" rows="8"><\/textarea>/); // fixed fallback for browsers without field-sizing
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.modal textarea\s*\{[^}]*field-sizing:\s*content/); // content-based growth (Chromium 123+, progressive enhancement)
    assert.match(css, /\.modal textarea\s*\{[^}]*resize:\s*vertical/); // manual override stays available
  });
});

async function req(base, method, p, body) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

// fetch()/undici forbid setting some headers (notably Host) the way
// a real cross-origin attacker or a hostile DNS-rebinding target would send
// them — node:http gives full control, so the Origin/Referer/Host tests below
// use this instead of req() wherever a header needs to be a specific,
// possibly-disallowed value.
function rawRequest(base, method, p, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers = { ...(opts.headers || {}) };
    if (bodyStr !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(bodyStr);
    }
    const request = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch (_) { /* non-JSON body is fine */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    request.on('error', reject);
    if (bodyStr !== undefined) request.write(bodyStr);
    request.end();
  });
}

test('POST /api/cards creates; PATCH moves; DELETE removes', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await req(base, 'POST', '/api/cards', { title: 'Fresh', status: 'todo' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.id, 3);

    const moved = await req(base, 'PATCH', '/api/cards/3', { status: 'doing' });
    assert.strictEqual(moved.status, 200);
    assert.strictEqual(moved.json.status, 'doing');

    const del = await req(base, 'DELETE', '/api/cards/3');
    assert.strictEqual(del.status, 200);
    assert.strictEqual((await req(base, 'PATCH', '/api/cards/3', { status: 'todo' })).status, 404);
  });
});

test('PATCH to doing on a waiting card returns 422 naming the unresolved deps', async () => {
  const dir = tmpBoard(); // card 1 starts done, so unresolve it first
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { status: 'todo' }); // card 1 no longer done
    const r = await req(base, 'PATCH', '/api/cards/2', { status: 'doing' });
    assert.strictEqual(r.status, 422);
    assert.deepStrictEqual(r.json.waiting.map((w) => w.id), [1]);
    assert.match(r.json.error, /^waiting on #1 \(todo\)$/, 'the payload names which gate — waiting, with id + live status');
  });
});

test('PATCH to doing on a blocked card returns 422 naming the sticker reason', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { blocked: 'legal sign-off pending' }); // card 1 is done — never waiting
    const r = await req(base, 'PATCH', '/api/cards/1', { status: 'doing' });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.reason, 'legal sign-off pending');
    assert.strictEqual(r.json.error, 'blocked: legal sign-off pending');
  });
});

test('PATCH blocking a card already in doing succeeds and keeps its column — no eviction, entry-only gate', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { status: 'doing' }); // done card, no deps — enters freely
    const r = await req(base, 'PATCH', '/api/cards/1', { status: 'doing', blocked: 'vendor outage' }); // form-style same-status save
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.status, 'doing');
    assert.strictEqual(r.json.blocked, 'vendor outage');
  });
});

test('POST archive then restore moves files', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/archive')).status, 200);
    assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/restore')).status, 200);
    assert.ok(fs.existsSync(path.join(dir, '1.card.md')));
  });
});

test('POST archive twice on the same id is idempotent — no duplicate-suffixed file', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/archive')).status, 200);
    const second = await req(base, 'POST', '/api/cards/1/archive'); // simulates a stale second tab/popup
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.json.id, 1);
    assert.strictEqual(second.json.archived, true);
    assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'archived', '1-2.card.md')), 'no renamed duplicate on re-archive');
    const board = await req(base, 'GET', '/api/board');
    assert.strictEqual(board.json.archived.length, 1);
  });
});

// --- archive packages (ADR 0010): the endpoint's optional
// `package` body field, and the board payload the popup completes against.

test('POST archive with a package files the card in archived/<package>/ and the board still lists it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/cards/1/archive', { package: '2026-q2' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.archived, true);
    assert.ok(fs.existsSync(path.join(dir, 'archived', '2026-q2', '1.card.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'archived', '1.card.md')));
    const board = await req(base, 'GET', '/api/board');
    assert.deepStrictEqual(board.json.archived.map((c) => c.id), [1], 'the recursive walk finds the packaged card');
    assert.deepStrictEqual(board.json.archivePackages, ['2026-q2']);
    // restore reaches into the package, same as before packages existed
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/restore')).status, 200);
    assert.ok(fs.existsSync(path.join(dir, '1.card.md')));
  });
});

test('POST archive with no body still archives to the archived/ root — every pre-package caller untouched', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/archive')).status, 200);
    assert.ok(fs.existsSync(path.join(dir, 'archived', '1.card.md')));
    const board = await req(base, 'GET', '/api/board');
    assert.deepStrictEqual(board.json.archivePackages, []);
  });
});

test('POST archive with a package that is not one plain path component is a 400, and nothing moves', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    for (const bad of ['..', '../evil', 'a/b']) {
      const r = await req(base, 'POST', '/api/cards/1/archive', { package: bad });
      assert.strictEqual(r.status, 400, `accepted ${bad}`);
      assert.match(r.json.error, /invalid archive package/);
    }
    assert.ok(fs.existsSync(path.join(dir, '1.card.md')), 'the card never moved');
  });
});

test('GET /api/board carries archivePackages — the archive popup completes against existing folders', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'POST', '/api/cards/1/archive', { package: 'shipped' });
    await req(base, 'POST', '/api/cards/2/archive', { package: '2026-q2' });
    const board = await req(base, 'GET', '/api/board');
    assert.deepStrictEqual(board.json.archivePackages, ['2026-q2', 'shipped']); // sorted
    assert.strictEqual(board.json.active.length, 0);
    assert.strictEqual(board.json.archived.length, 2);
  });
});

test('the archive popup sends the package and an empty box sends none (bulk Archive selected)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/async function applyBulkArchive\([\s\S]*?\n\}/);
  assert.ok(fn, 'applyBulkArchive found in app.js');
  assert.match(fn[0], /api\('POST', `\/api\/cards\/\$\{id\}\/archive`, pkg \? \{ package: pkg \} : undefined\)/,
    'a blank package box must send no body at all — byte-identical to every package-less archive path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.html'), 'utf8');
  assert.match(html, /id="bulk-archive-input"/);
  assert.match(js, /attachCombobox\(\$\('#bulk-archive-input'\), \(\) => state\.archivePackages/,
    'the package box is a hand-rolled combobox over the board payload s existing folder names');
});

test('POST /api/cards with a malformed body fails gracefully; server stays up', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/api/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not valid json',
    });
    assert.ok(res.status >= 400 && res.status < 600, `expected 4xx/5xx, got ${res.status}`);
    await res.text();
    // server must still be responsive after the bad request
    const board = await req(base, 'GET', '/api/board');
    assert.strictEqual(board.status, 200);
    assert.strictEqual(board.json.active.length, 2);
  });
});

test('POST /api/cards waiting on an unfinished card returns 422 with the unresolved deps', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { status: 'todo' }); // card 1 now unfinished
    const r = await req(base, 'POST', '/api/cards', { title: 'Waiting', status: 'doing', waiting_for: [1] });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.waiting[0].id, 1);
  });
});

test('POST /api/cards born into doing with a valid blocked sticker returns 422 with the reason', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/cards', { title: 'Stickered at birth', status: 'doing', blocked: 'spec unclear' });
    assert.strictEqual(r.status, 422);
    assert.strictEqual(r.json.reason, 'spec unclear');
    const ok = await req(base, 'POST', '/api/cards', { title: 'Cleared at birth', status: 'doing', blocked: 'false' });
    assert.strictEqual(ok.status, 201, 'YAML false is not a sticker — enters doing freely');
  });
});

// DELIBERATE CONTRACT: no status validation. Free-text statuses are legal input end
// to end now — the value is written to disk verbatim, and the SPA renders a
// card whose status isn't in the board's statuses list in the FIRST column
// (catch-all) with a raw-status chip; the file is never rewritten.
test('POST /api/cards with an unlisted status is accepted and preserved', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'POST', '/api/cards', { title: 'Free text', status: 'review' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.json.status, 'review');
    const board = await req(base, 'GET', '/api/board');
    assert.ok(board.json.active.some((c) => c.status === 'review'));
  });
});

test('PATCH /api/cards/1 with an unlisted status is accepted and preserved', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'PATCH', '/api/cards/1', { status: 'someday/maybe' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.status, 'someday/maybe');
  });
});

// the doing entry gate (waiting + blocked) is pinned to
// the LITERAL status 'doing' — a configured statuses list never moves or
// disables it.
test('the doing entry gate stays pinned under a custom statuses list', async () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'statuses: [triage, doing, review]\n');
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { status: 'todo' }); // card 1 now unfinished — card 2 waits on it
    const gated = await req(base, 'PATCH', '/api/cards/2', { status: 'doing' });
    assert.strictEqual(gated.status, 422);
    const free = await req(base, 'PATCH', '/api/cards/2', { status: 'review' }); // any other column is gate-free
    assert.strictEqual(free.status, 200);
  });
});

test('GET /status-colors.js serves the status color helpers; html loads it before app.js', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/status-colors.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.indexOf('status-colors.js') > -1 && html.indexOf('status-colors.js') < html.indexOf('app.js'));
  });
});

// The bug guarded: save-hotkey.js was wired into app.html with pure-
// logic tests, but never added to server.js's static-route
// allowlist — it 404'd on every real server, so `window.saveHotkeyTarget` was
// never defined and the whole Ctrl+S feature threw a silent ReferenceError in
// the browser console instead of saving anything. save-hotkey.test.js's
// require()-based tests couldn't see this (a route 404 only exists over HTTP).
// This is the same shape test as status-colors.js above — the guard below
// generalizes it so no future web/*.js can ship this way again.
test('GET /save-hotkey.js serves the Ctrl+S save-target logic; html loads it before app.js', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/save-hotkey.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.indexOf('save-hotkey.js') > -1 && html.indexOf('save-hotkey.js') < html.indexOf('app.js'));
  });
});

// General guard for this whole bug class: every <script src="/x.js"> app.html
// loads must be reachable over HTTP, not just present on disk — a file can be
// committed, wired into app.html, and fully unit-tested via require() while
// still 404ing for every real browser if server.js's static-route allowlist
// forgets it (exactly how save-hotkey.js shipped dead above).
test('every non-app.js script app.html loads is served (not 404) by the running server', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const scripts = [...html.matchAll(/<script src="\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 10, 'sanity: app.html should list a bunch of scripts');
    for (const name of scripts) {
      const res = await fetch(`${base}/${name}`);
      assert.strictEqual(res.status, 200, `${name} is wired into app.html but server.js's static allowlist 404s it`);
    }
  });
});

test('GET /api/cards/1/detail returns raw frontmatter, absolute path, and body', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/cards/1/detail');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.id, 1);
    assert.strictEqual(r.json.title, 'One');
    assert.match(r.json.frontmatter, /^status: done$/m);
    assert.ok(path.isAbsolute(r.json.path));
    assert.ok(r.json.body.includes('body'));
  });
});

test('GET /api/cards/:id/detail carries the parsed epic boolean — false for a plain card, true once flagged (the detail popup wash)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'GET', '/api/cards/1/detail')).json.epic, false);
    const created = await req(base, 'POST', '/api/cards', { title: 'Wayfinder', status: 'todo', epic: true });
    assert.strictEqual((await req(base, 'GET', `/api/cards/${created.json.id}/detail`)).json.epic, true);
  });
});

test('GET /api/cards/:id/detail surfaces a genuinely unrecognized frontmatter key verbatim', async () => {
  const dir = tmpBoard();
  fs.writeFileSync(path.join(dir, '3.card.md'),
    `---\nid: 3\nstatus: backlog\npriority: Normal\nwaiting_for: []\ntags: []\nsprint: 5\n---\n\n# Three\n\nbody3\n`);
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/cards/3/detail');
    assert.strictEqual(r.status, 200);
    assert.match(r.json.frontmatter, /^sprint: 5$/m); // unallowlisted key, not one card-store special-cases (parent stopped qualifying once the store parsed it)
  });
});

test('GET /api/cards/:id/detail 404s for an unknown id', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/cards/999/detail');
    assert.strictEqual(r.status, 404);
  });
});

test('GET /api/cards/:id/detail for an archived card 200s with archived: true (archive column detail popup)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/archive')).status, 200);
    const r = await req(base, 'GET', '/api/cards/1/detail');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.id, 1);
    assert.strictEqual(r.json.archived, true);
  });
});

test('GET /api/cards/:id/detail carries mtime (ISO string) and updated: null when the file has no field', async () => {
  const dir = tmpBoard(); // card 1 has no updated field
  await withServer(dir, async (base) => {
    const r = await req(base, 'GET', '/api/cards/1/detail');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.updated, null);
    assert.ok(!Number.isNaN(Date.parse(r.json.mtime)), 'mtime parses as a date');
    assert.strictEqual(r.json.mtime, new Date(r.json.mtime).toISOString());
  });
});

test('GET /api/cards/:id/detail surfaces the card\'s updated value once set', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    await req(base, 'PATCH', '/api/cards/1', { priority: 'High' }); // updateCard bumps updated
    const r = await req(base, 'GET', '/api/cards/1/detail');
    assert.match(r.json.updated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

// --- start_date over the API — sets, clears, and rides createCard,
// in date or local-datetime form, with no validation anywhere on the way.

test('PATCH sets start_date (date, then datetime) and clears it with ""', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const set = await req(base, 'PATCH', '/api/cards/1', { start_date: '2026-07-10' });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.json.start_date, '2026-07-10');
    const dt = await req(base, 'PATCH', '/api/cards/1', { start_date: '2026-07-10T09:30' });
    assert.strictEqual(dt.json.start_date, '2026-07-10T09:30');
    assert.match(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8'), /start_date: 2026-07-10T09:30/);
    const cleared = await req(base, 'PATCH', '/api/cards/1', { start_date: '' });
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual(cleared.json.start_date, null);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8'), /start_date:/);
  });
});

test('POST /api/cards accepts start_date alongside due_date', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await req(base, 'POST', '/api/cards',
      { title: 'Ranged', status: 'todo', start_date: '2026-07-10', due_date: '2026-07-12T17:00' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.start_date, '2026-07-10');
    assert.strictEqual(created.json.due_date, '2026-07-12T17:00');
  });
});

test('index html has a Start date input, and both date placeholders mention the datetime form', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<input id="f-start" placeholder="YYYY-MM-DD or \.\.\.THH:MM">/);
    assert.match(html, /<input id="f-due" placeholder="YYYY-MM-DD or \.\.\.THH:MM">/);
  });
});

test('an unmatched route 404s with a plain-text (non-JSON) body — clients must not JSON.parse it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    // Mirrors the NaN-id request the old broken drawer wiring used to fire:
    // it misses the \d+ route regex and falls through to the generic 404.
    const res = await fetch(`${base}/api/cards/NaN/detail`);
    assert.strictEqual(res.status, 404);
    assert.doesNotMatch(res.headers.get('content-type') || '', /application\/json/);
    const text = await res.text();
    assert.strictEqual(text, 'not found');
    assert.throws(() => JSON.parse(text)); // the exact input that used to crash the client's api()
  });
});

// --- end_date over the API — symmetric with the start_date coverage.

test('PATCH sets end_date (date, then datetime) and clears it with ""', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const set = await req(base, 'PATCH', '/api/cards/1', { end_date: '2026-07-11' });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.json.end_date, '2026-07-11');
    const dt = await req(base, 'PATCH', '/api/cards/1', { end_date: '2026-07-11T18:00' });
    assert.strictEqual(dt.json.end_date, '2026-07-11T18:00');
    assert.match(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8'), /end_date: 2026-07-11T18:00/);
    const cleared = await req(base, 'PATCH', '/api/cards/1', { end_date: '' });
    assert.strictEqual(cleared.json.end_date, null);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, '1.card.md'), 'utf8'), /end_date:/);
  });
});

test('POST /api/cards accepts the full date triad; index html has an End date input', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await req(base, 'POST', '/api/cards',
      { title: 'Triad', status: 'todo', start_date: '2026-07-10', end_date: '2026-07-11', due_date: '2026-07-12' });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.end_date, '2026-07-11');
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /id="f-end"/);
  });
});

test('GET /date-picker.js serves the date-picker pick/open rules', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/date-picker.js`);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
    const body = await res.text();
    assert.match(body, /pickDay/);
    assert.match(body, /initialMonth/);
  });
});

test('index html loads date-picker.js after calendar-model.js and before app.js (both call the shared helpers as bare globals)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    const calIdx = html.indexOf('/calendar-model.js');
    const dpIdx = html.indexOf('/date-picker.js');
    const appIdx = html.indexOf('/app.js');
    assert.ok(dpIdx > -1, 'date-picker.js referenced');
    assert.ok(calIdx > -1 && calIdx < dpIdx, 'date-picker.js loads after calendar-model.js');
    assert.ok(dpIdx < appIdx, 'date-picker.js loads before app.js');
  });
});

// --- landing in 'todo'/'done' auto-stamps start_date/end_date over
// the API — the PATCH endpoint is the funnel every status-changing client path
// (form edit, board drag, bulk edit, restore-into-column) goes through, and
// the client re-reads after every write, so server-side stamping is complete.

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('PATCH into done stamps end_date and the response carries it', async () => {
  const dir = tmpBoard(); // card 2 is todo, no dates
  await withServer(dir, async (base) => {
    const before = localToday();
    const r = await req(base, 'PATCH', '/api/cards/2', { status: 'done' });
    const after = localToday();
    assert.strictEqual(r.status, 200);
    assert.ok([before, after].includes(r.json.end_date), `stamped ${r.json.end_date}`);
    assert.match(r.json.end_date, /^\d{4}-\d{2}-\d{2}$/, 'date-only stamp');
  });
});

test('POST /api/cards directly into todo stamps start_date', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const before = localToday();
    const r = await req(base, 'POST', '/api/cards', { title: 'Flow Start', status: 'todo' });
    const after = localToday();
    assert.strictEqual(r.status, 201);
    assert.ok([before, after].includes(r.json.start_date), `stamped ${r.json.start_date}`);
  });
});

test('restore-into-column stamps like any other transition', async () => {
  const dir = tmpBoard(); // card 1 is done, no dates
  await withServer(dir, async (base) => {
    // the client's archive-drag drop: POST restore, then PATCH into the drop column
    assert.strictEqual((await req(base, 'POST', '/api/cards/1/archive')).status, 200);
    const restored = await req(base, 'POST', '/api/cards/1/restore');
    assert.strictEqual(restored.json.start_date, null, 'restore alone moves the file, stamps nothing');
    const before = localToday();
    const r = await req(base, 'PATCH', '/api/cards/1', { status: 'todo' });
    const after = localToday();
    assert.ok([before, after].includes(r.json.start_date), `stamped ${r.json.start_date}`);
  });
});

test('column headers carry a + quick-create button — gated by showsColumnAdd, wired via the delegated #board listener, status pre-set', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Header build: the + renders only where showsColumnAdd allows it (live
    // column, not collapsed — archive never), inside renderBoardColumns' markup.
    const render = js.match(/function renderBoardColumns\([\s\S]*?\n\}/);
    assert.ok(render, 'renderBoardColumns found in app.js');
    assert.match(render[0], /showsColumnAdd\(/, 'header + is gated by the pure predicate');
    assert.match(render[0], /class="column-add"/, 'header markup carries the + button');
    // Wiring: the existing delegated #board click listener (renderBoard()
    // rebuilds headers every call — per-render listeners would need constant
    // rewiring, same reasoning as the sort controls), pre-aiming the modal.
    assert.match(js, /closest\('\.column-add'\)/, 'delegated branch targets the + button');
    assert.match(js, /openModal\(null, addBtn\.dataset\.col\)/, 'click opens the create modal aimed at the column');
    // openModal: the preset wins for a column +, the global "+ New card"
    // button (no preset) keeps its first-column default.
    const open = js.match(/function openModal\([\s\S]*?\n\}/);
    assert.ok(open, 'openModal found in app.js');
    assert.match(open[0], /presetStatus \|\| boardStatuses\(\)\[0\]/, 'preset falls back to the first column');
    // The caller side of that criterion: the global button must actually take
    // the no-preset path — a handler drifting to openModal(null, something)
    // would break the first-column default with the fallback regex still green.
    assert.match(js, /\$\('#new-btn'\)\.addEventListener\('click', \(\) => openModal\(null\)\)/,
      'the global + New card button passes NO preset');
    // A focused + button must block the 5s poll like its header siblings —
    // renderBoardColumns wipes #board, silently dumping keyboard focus to <body>.
    assert.match(js, /boardControlFocused[\s\S]{0,600}closest\('[^']*\.column-add/,
      'the + button joins the focused-control poll guard');
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.column-add\s*\{/, 'the + button is styled');
  });
});

test('header title carries a copy-board-path button — payload boardDir, clipboard ladder with the execCommand fallback, toast feedback', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    // The button lives inside the h1 so it rides right beside the
    // "Kanban — project" title wherever the flex header wraps.
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<h1>Kanban<span id="project-name"[^>]*><\/span>[^<]*<button[^>]*id="board-copy-btn"/,
      'copy button sits inside the h1, after the project-name span');
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /state\.boardDir = data\.boardDir \|\| ''/, 'applyBoardData stores the payload boardDir');
    const fn = js.match(/function copyBoardPath\([\s\S]*?\n\}/);
    assert.ok(fn, 'copyBoardPath found in app.js');
    // navigator.clipboard needs a secure context the VSCode Simple Browser
    // doesn't grant — the textarea+execCommand fallback is load-bearing there,
    // same ladder as the detail popup's copy-path button.
    assert.match(fn[0], /navigator\.clipboard/, 'async clipboard API first');
    assert.match(fn[0], /fallbackCopy\(/, 'textarea+execCommand fallback');
    // Feedback is a toast (success AND failure) — the header button is
    // glyph-sized, no room for the detail button's "Copied!" label swap.
    // Presence of toast( alone is not enough: pin the whole per-outcome
    // ladder, same shape as copyDetailPath's — a writeText REJECTION retries
    // through fallbackCopy, and BOTH outcomes reach the user (a bare
    // .then(success-only) passed the old regexes while failures went silent).
    assert.match(fn[0], /\.then\(\(\) => done\(true\), \(\) => done\(fallbackCopy\(text\)\)\)/,
      'rejection retries via fallbackCopy, both outcomes funnel through done()');
    assert.match(fn[0], /done = \(ok\) => toast\(ok \?/, 'one toast per outcome — success and failure');
    assert.match(fn[0], /else done\(fallbackCopy\(text\)\)/, 'the no-clipboard-API branch reports its outcome too');
    assert.match(js, /\$\('#board-copy-btn'\)\.addEventListener\('click', copyBoardPath\)/, 'button wired');
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.board-copy-btn\s*\{/, 'the header copy button is styled');
  });
});

// --- epic/wayfinder round-trip over the API — create with the flag
// writes `epic: true`, unchecking on edit removes the line (the lean rule),
// and the board payload always carries the parsed boolean for the views.

test('epic round-trip: POST with epic: true writes the line, PATCH epic: false removes it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const created = await req(base, 'POST', '/api/cards', { title: 'Wayfinder', status: 'todo', epic: true });
    assert.strictEqual(created.status, 201);
    assert.strictEqual(created.json.epic, true);
    const file = fs.readdirSync(dir).find((f) => f.startsWith('000') && f.includes('wayfinder'));
    assert.ok(file, 'card file created');
    assert.match(fs.readFileSync(path.join(dir, file), 'utf8'), /^epic: true$/m);
    const board = await req(base, 'GET', '/api/board');
    const epicCard = board.json.active.find((c) => c.id === created.json.id);
    assert.strictEqual(epicCard.epic, true, 'board payload carries the flag for the views');
    assert.strictEqual(board.json.active.find((c) => c.id === 1).epic, false, 'non-epics read false, always a boolean');
    // uncheck on edit — the line is GONE, not `epic: false` (lean rule)
    const cleared = await req(base, 'PATCH', `/api/cards/${created.json.id}`, { epic: false });
    assert.strictEqual(cleared.status, 200);
    assert.strictEqual(cleared.json.epic, false);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /^epic:/m);
  });
});

test('the form has an Epic checkbox inside the "Show more fields" section; app.js manages it end to end', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const html = await (await fetch(`${base}/`)).text();
    assert.match(html, /<input type="checkbox" id="f-epic"/, 'Epic is a checkbox');
    // Inside a .modal-extra group — hidden by the minimal-first create form
    // until "Show more fields", like every field below Title.
    const extra = html.match(/<div class="row modal-extra">[\s\S]*?<\/div>/g) || [];
    assert.ok(extra.some((block) => block.includes('id="f-epic"')), 'checkbox lives in a .modal-extra row');
    const js = await (await fetch(`${base}/app.js`)).text();
    const open = js.match(/function openModal\([\s\S]*?\n\}/);
    assert.match(open[0], /#f-epic/, 'openModal seeds the checkbox from card.epic — edit preserves it');
    const submit = js.match(/async function submitModal\([\s\S]*?\n\}/);
    assert.match(submit[0], /epic: \$\('#f-epic'\)\.checked/, 'the payload sends the checkbox boolean (false clears on edit)');
    const snap = js.match(/function snapshotFormFields\([\s\S]*?\n\}/);
    assert.match(snap[0], /#f-epic/, 'epic joins the dirty-check baseline');
  });
});

test('the epic cue is a background-wash class on every surface, not a dot or a border', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const tile = js.match(/function cardEl\([\s\S]*?\n\}/);
    assert.match(tile[0], /\(card\.epic \? ' epic' : ''\)/, 'board tile adds the epic class to its className');
    assert.doesNotMatch(tile[0], /epicBadge\(\) : ''/, 'no more epicBadge() call on the tile');
    const chip = js.match(/function calendarChipEl\([\s\S]*?\n\}/);
    assert.match(chip[0], /\(card\.epic \? ' epic' : ''\)/, 'calendar chip adds the epic class to its className');
    assert.doesNotMatch(chip[0], /epicBadge\(\) : ''/, 'no more epicBadge() call on the chip');
    const bar = js.match(/function ganttBarEl\([\s\S]*?\n\}/);
    assert.match(bar[0], /\(bar\.card\.epic \? ' epic' : ''\)/, 'gantt bar adds the epic class to its className');
    assert.doesNotMatch(bar[0], /epicBadge\(\) : ''/, 'no more epicBadge() call on the bar');
    // the epic wash there is a box-shadow (a different property than the
    // per-status `background`/`borderColor` write below), so that write never
    // needed — and still doesn't need — gating off epics.
    assert.doesNotMatch(bar[0], /!bar\.card\.epic/, 'no epic gate on the custom-status inline style write');
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /);
    assert.match(svg[0], /\$\{n\.epic \? ' epic' : ''\}/, 'map node group adds the epic class instead of drawing a circle');
    assert.doesNotMatch(svg[0], /epicDot|map-epic-dot/, 'no more SVG epic-dot circle');
  });
});

test('an archived epic keeps its wash in the map\'s isolated row; the board\'s Archive column still withholds it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const archiveFn = js.match(/function archiveCardEl\([\s\S]*?\n\}/);
    assert.match(archiveFn[0], /showEpic && card\.epic \? ' epic' : ''/, 'archiveCardEl can add the epic class when asked to');
    assert.doesNotMatch(archiveFn[0], /epicBadge\(\) : ''/, 'no more epicBadge() glyph anywhere in archiveCardEl');
    const isolatedFn = js.match(/function buildIsolatedRow\([\s\S]*?\n\}/);
    assert.match(isolatedFn[0], /archiveCardEl\(card, \{[^}]*epicDot[^}]*\}\)/,
      'the isolated row opts in to the epic wash for archived cards, so it matches every other archived node on the map (internal option key name unchanged by #45)');
    // The board's Archive column call site is a bare archiveCardEl(c)
    // with no second argument: the Archive column has never
    // carried the epic cue (SKILL.md's own contract).
    assert.match(js, /isArchive \? archiveCardEl\(c\) : cardEl\(c\)/,
      'the board Archive column still calls archiveCardEl with no epic option');
  });
});

test('the map node border is neutral; status moves to its own dot with a raw-status tooltip', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /);
    assert.doesNotMatch(svg[0], /status-\$\{missing/, 'the node group no longer carries a status-* class');
    // the dot's color used to be an inline
    // `style="fill:..."` attribute, which a strict `style-src 'self'` CSP
    // (no unsafe-inline) silently blocks the browser from applying — it's a
    // `status-${statusColorClass(n.status)}` CSS class now (app.css carries
    // the color), same mechanism statusBadge() uses.
    assert.match(svg[0], /class="map-status-dot status-\$\{statusColorClass\(n\.status\)\}"/,
      'a dedicated status dot, colored via a CSS class the same way the rect stroke used to be');
    assert.doesNotMatch(svg[0], /style="fill:/, 'no inline style attribute left on the dot — CSP style-src has no channel to break');
    assert.match(svg[0], /<title>\$\{escapeHtml\(n\.status\)\}<\/title>/,
      'the dot names the RAW on-disk status, not a bucketed label');
    // STATUS DOTS NEVER MUTE: the custom-status color used
    // to step aside on an archived node so the CSS mute rule always won — that
    // gate is gone now (statusColorClass has no archived-flag input at all), so
    // a custom status hashes its color on archived nodes exactly like a live one.
    assert.doesNotMatch(svg[0], /!n\.archived \? ` style="fill:/,
      'the old archived-gated inline override is gone');
  });
});

// --- the shared status dot renders on every card rendering,
// and the map's graph/no-dependencies sections each get a collapse toggle -------

test('statusBadge(card) renders on board tiles (live AND archived) and calendar chips', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const tile = js.match(/function cardEl\([\s\S]*?\n\}/);
    assert.match(tile[0], /statusBadge\(card\)/, 'board tile renders the shared status dot');
    const archiveFn = js.match(/function archiveCardEl\([\s\S]*?\n\}/);
    assert.match(archiveFn[0], /statusBadge\(card\)/,
      'archived tiles get the status dot unconditionally — unlike the epic wash class, no opts gate (the dot shows the true status color, archived or not)');
    const chip = js.match(/function calendarChipEl\([\s\S]*?\n\}/);
    assert.match(chip[0], /statusBadge\(card\)/, 'calendar chip renders the shared status dot');
  });
});

test('the gantt gutter row gets the status dot AND the epic wash class; the bar itself (status border/fill) stays untouched', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // The gutter label previously carried neither dot (the dot glyph only reached
    // the bar) — "all components" means it joins both now. The epic-wash rework
    // swapped the label's epic dot for its own background-wash class, so a
    // due-only row (no bar at all) doesn't lose the epic cue entirely.
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.match(render[0], /label\.className = 'gantt-row gantt-label card-el' \+ \(bar\.card\.epic \? ' epic' : ''\)/,
      'the gutter label adds the epic class (conditional)');
    assert.match(render[0], /label\.innerHTML = `<span class="gantt-label-id">[^`]*statusBadge\(bar\.card\)/,
      'the gutter label renders statusBadge (unconditional)');
    assert.doesNotMatch(render[0], /epicBadge\(\) : ''/, 'no more epicBadge() call in the gutter label');
    // Bars keep exactly their shape (now a class instead of a badge call):
    // status stays on the border/fill rather than
    // gaining a redundant dot.
    const bar = js.match(/function ganttBarEl\([\s\S]*?\n\}/);
    assert.doesNotMatch(bar[0], /statusBadge/, 'the bar itself gets no status dot — already colored by status');
  });
});

// The dense-surface "dot must not crowd the text" guard is
// satisfied deliberately (dots always precede the croppable title; .cal-chip/
// .gantt-label's nowrap+ellipsis only ever crops the tail) but nothing pinned
// the mechanism — a later reorder (title before the dots) or a dropped
// nowrap/ellipsis rule would silently regress with the whole suite green.

test('dense-surface guard: the dots precede the croppable title, and the truncation CSS that protects them is asserted (regression)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const chip = js.match(/function calendarChipEl\([\s\S]*?\n\}/);
    // same shape as the gantt gutter label below — statusBadge,
    // then the conditional archived ball, then the (prompt-fallback-aware)
    // title.
    assert.match(chip[0], /statusBadge\(card\)\}\$\{card\.archived \? archivedBadge\(\) : ''\} \` \+\s*\r?\n\s*`<span class="cal-chip-title[\s\S]*?escapeHtml\(titleDisplay\.text\)/,
      'calendar chip: statusBadge (then the conditional archived ball) is immediately followed by the (croppable) title — the dots stay in the never-cropped head');
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.match(render[0], /statusBadge\(bar\.card\)\}\$\{bar\.card\.archived \? archivedBadge\(\) : ''\} \` \+\s*\r?\n\s*`<span class="gantt-label-title[\s\S]*?escapeHtml\(titleDisplay\.text\)/,
      'gantt gutter label: statusBadge, then the conditional archived ball, then the title');
    const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
    assert.match(css, /\.cal-chip\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/,
      '.cal-chip crops its tail (never the leading id+dots) — the mechanism the dense-surface guard relies on');
    assert.match(css, /\.gantt-label\s*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/,
      '.gantt-label crops its tail the same way');
  });
});

// --- the archived ball: "show the status color as shown in the
// frontmatter and an additional ball gray for archived" — archivedBadge()
// (status-colors.js) joins statusBadge() on every surface that renders an
// ARCHIVED card, and ONLY those. Order: status, archived, everywhere more
// than one dot lands together (the epic dot that used to
// lead this order is retired — an epic is a background-wash class now, not a glyph).

test('archivedBadge joins the archived tile unconditionally (board Archive column AND the map isolated row) — order status, archived', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const archiveFn = js.match(/function archiveCardEl\([\s\S]*?\n\}/);
    assert.match(archiveFn[0], /statusBadge\(card\)\}\$\{archivedBadge\(\)\}/,
      'archivedBadge() follows statusBadge() directly, unconditionally — archiveCardEl only ever renders archived cards, same reasoning statusBadge already uses (no opts gate)');
  });
});

test('cardEl NEVER renders archivedBadge — live board tiles never carry the archived ball', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const tile = js.match(/function cardEl\([\s\S]*?\n\}/);
    assert.doesNotMatch(tile[0], /archivedBadge/, 'cardEl only ever renders live cards');
  });
});

test('calendarChipEl conditions archivedBadge on the chip\'s own card.archived flag', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const chip = js.match(/function calendarChipEl\([\s\S]*?\n\}/);
    assert.match(chip[0], /statusBadge\(card\)\}\$\{card\.archived \? archivedBadge\(\) : ''\}/,
      'same "epic, status, archived" glyph order every other surface uses, gated on this chip\'s own card.archived — the calendar renders archived cards opt-in via its Archive pill');
    assert.match(chip[0], /el\.draggable = !card\.archived/, 'an archived chip is not draggable — native drag never starts, so there\'s no fake-drag animation to guard against');
  });
});

test('the gantt Archive-group gutter row gets the archived ball; the bar itself keeps its own row-level archived mute, no redundant dot', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.match(render[0], /statusBadge\(bar\.card\)\}\$\{bar\.card\.archived \? archivedBadge\(\) : ''\}/,
      'the gutter label conditions the archived ball on the row\'s own card.archived flag — every group\'s rows share one label builder, so this covers the Archive group too');
    const bar = js.match(/function ganttBarEl\([\s\S]*?\n\}/);
    assert.doesNotMatch(bar[0], /archivedBadge/, 'the bar keeps its existing row-level archived wash/mute — no second, redundant archived cue on the same row');
  });
});

test('the map SVG node gets a third archived-ball circle, conditioned on n.archived, alongside status + epic with no overlap', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /);
    assert.match(svg[0], /n\.archived \? `<circle class="map-archived-dot"/, 'map node renders its own SVG archived dot, gated on n.archived');
    assert.match(svg[0], /<title>Archived<\/title>/, 'same tooltip text as the HTML twin');
    // Same right-edge x column as the status/epic dots (MAP_NODE_W - 10) —
    // no new horizontal position to risk overlapping the truncated title text.
    const archivedCircle = svg[0].match(/<circle class="map-archived-dot"[^>]*>/)[0];
    assert.match(archivedCircle, /cx="\$\{MAP_NODE_W - 10\}"/, 'archived dot shares the status/epic dots\' x column');
    // MAP_NODE_H grew to fit three vertically-stacked dots without crowding —
    // pin it's still bigger than the old 46 (the two-dot height).
    const nodeH = js.match(/const MAP_NODE_H = (\d+);/);
    assert.ok(nodeH, 'MAP_NODE_H constant found');
    assert.ok(Number(nodeH[1]) > 46, 'node height grew to make room for the third dot');
  });
});

test('the map SVG node gets a priority/waiting border cue, matching the board tile\'s priorityBadge+isWaiting treatment', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /);
    assert.match(svg[0], /priorityBadge\(n, state\.priorities\)/, 'classifies the node\'s own priority through the same shared helper the board tile uses');
    assert.match(svg[0], /n\.waiting\)\s*\?\s*' waiting'\s*:\s*''/, 'the waiting class reads the node\'s own precomputed waiting flag (dependency-graph.js)');
    // Mutually exclusive with archived — mirrors archiveCardEl never applying
    // pb.className/waiting on the board, rather than relying on CSS cascade
    // order to pick a winner between two co-applied classes.
    assert.match(svg[0], /!missing && !n\.archived\)\s*\?\s*priorityBadge\(n, state\.priorities\)\s*:\s*\{\s*className:\s*''\s*\}/,
      'priority classification is skipped entirely for an archived (or missing) node');
    assert.match(svg[0], /!missing && !n\.archived && n\.waiting\)\s*\?\s*' waiting'/, 'waiting class likewise gated off archived/missing nodes');
  });
});

test('the map SVG node carries the red blocked pill for a stickered card, reason in its <title>', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /);
    assert.match(svg[0], /!missing && n\.blocked\)/, 'pill gated on the node\'s sticker flag only — never for missing stubs');
    assert.match(svg[0], /map-blocked-pill/, 'the pill group class the CSS colors red');
    assert.match(svg[0], /escapeHtml\(n\.blockedReason \? `blocked: \$\{n\.blockedReason\}` : 'blocked'\)/,
      'the reason is user data — escaped into the SVG <title>, same discipline as every other user string here');
  });
});

test('the map graph and no-dependencies sections are each collapsible, state persisted per board', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Persisted state: same memoize-once-mutate-in-place + storageKey discipline
    // as loadMapStatusFilter/saveMapStatusFilter.
    const load = js.match(/function loadMapSectionsCollapsed\([\s\S]*?\n\}/);
    assert.ok(load, 'loadMapSectionsCollapsed found in app.js');
    assert.match(load[0], /storageKey\(state\.projectName, 'map\.sections\.collapsed'\)/,
      'own feature key, namespaced per board like every other persisted view preference');
    assert.match(load[0], /mergeMapSectionsCollapsed\(saved\)/, 'merges through the pure column-state.js helper');
    const save = js.match(/function saveMapSectionsCollapsed\([\s\S]*?\n\}/);
    assert.ok(save, 'saveMapSectionsCollapsed found in app.js');
    const toggle = js.match(/function toggleMapSection\([\s\S]*?\n\}/);
    assert.ok(toggle, 'toggleMapSection found in app.js');
    assert.match(toggle[0], /renderBoard\(\)/, 'toggling re-renders like every other persisted toggle');
    // renderMapView reads the loaded state and threads it into both section builders.
    const rm = js.match(/function renderMapView\([\s\S]*?\n\}/);
    assert.match(rm[0], /loadMapSectionsCollapsed\(\)/, 'renderMapView loads the persisted per-section state');
    assert.match(rm[0], /buildMapGraphSection\(graph, participantIds, sections\.graph\)/,
      'the graph section is built with its own collapse flag');
    assert.match(rm[0], /buildIsolatedRow\(graph, allCards, sections\.isolated\)/,
      'the isolated-row section is built with its own collapse flag');
    // Collapsed sections skip the expensive build entirely — not just hidden via CSS.
    const graphSection = js.match(/function buildMapGraphSection\([\s\S]*?\n\}/);
    assert.ok(graphSection, 'buildMapGraphSection found in app.js');
    assert.match(graphSection[0], /if \(!collapsed\)/, 'the SVG is only built/appended while expanded');
    assert.match(graphSection[0], /buildMapSectionHeader\('graph'/, 'the toggle header names its section');
    const isolatedFn = js.match(/function buildIsolatedRow\([\s\S]*?\n\}/);
    assert.match(isolatedFn[0], /if \(!collapsed\)/, 'the isolated row is only built/appended while expanded');
    assert.match(isolatedFn[0], /buildMapSectionHeader\('isolated'/, 'the toggle header names its section');
    // Both headers share ONE builder — no per-section markup duplication.
    const header = js.match(/function buildMapSectionHeader\([\s\S]*?\n\}/);
    assert.ok(header, 'buildMapSectionHeader found in app.js');
    assert.match(header[0], /data-section="\$\{section\}"/, 'the toggle button carries the section id the click handler reads');
    assert.match(header[0], /collapsed \? CHEVRON_RIGHT_ICON : CHEVRON_LEFT_ICON/, 'same chevron glyph pair as the board column-toggle');
    // Wiring: a click on either toggle calls toggleMapSection with its data-section.
    // The #map-view delegated listener is an anonymous callback (not a named
    // function), so pin the two load-bearing lines directly rather than
    // isolating the whole block by brace-matching a literal newline sequence
    // (fragile against CRLF line endings).
    assert.match(js, /closest\('\.map-section-toggle\[data-section\]'\)/, 'section toggle buttons are checked in the delegated #map-view listener');
    assert.match(js, /toggleMapSection\(sectionBtn\.dataset\.section\)/, 'the click calls toggleMapSection with the button\'s section');
    // projectName invalidation: a board switch re-derives sections under the new key.
    const applyProj = js.match(/function applyProjectName\([\s\S]*?\n\}/);
    assert.match(applyProj[0], /mapSectionsCollapsed = null/, 'map section state re-merges on a projectName change, like collapsedColumns/mapStatusFilter');
  });
});

test('map section toggles join the poll-guard and Q0 clear-selection exemptions, same as the map status-filter pills', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /closest\('\.column-sort-field, \.column-sort-dir, \.cal-nav, \.column-add, \.column-add-ai, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle'\)/,
      'a focused section toggle blocks the auto-refresh — #map-view is wiped by every renderMapView() poll tick, same as the #56 pills');
    assert.match(js, /#map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, \.cal-nav, \.map-filter-toggle, \.map-section-toggle/,
      'a section-toggle click must not wipe a building selection, same curate-the-view exemption as the #56 pills');
  });
});

test('app.js applyBoardData applies the assignee registry and official lists BEFORE renderBoard (first paint of a persisted Assignee sort must see the registry)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Same pin as applyProjectName/applyStatuses' "must run before renderBoard"
    // comments: state.assignees/state.priorities are render inputs (the Assignee/
    // Priority sorts read them via sortCards), so applying them after the render
    // paints the first board of every page load with the seeded-empty registry —
    // lexicographic instead of registry order, silently reshuffled by the next poll.
    const fn = js.match(/function applyBoardData\([\s\S]*?\n\}/);
    assert.ok(fn, 'applyBoardData found in app.js');
    const render = fn[0].indexOf('renderBoard()');
    const assignees = fn[0].indexOf('applyAssignees(');
    const lists = fn[0].indexOf('applyLists(');
    assert.ok(render > -1, 'applyBoardData renders');
    assert.ok(assignees > -1 && assignees < render, 'applyAssignees runs before renderBoard');
    assert.ok(lists > -1 && lists < render, 'applyLists runs before renderBoard');
  });
});

// --- rebuilt-per-render controls join the standing
// guards, the search∩status composition rides a pinned pure helper, and the
// sub-month all-day chips stop shadowing their drop cells.

test('map status-filter pills join the Q0 clear-selection exemption AND the focused-control poll guard', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Q0: the pill click bubbles past the #map-view delegated handler to the
    // document-level clear-selection handler — without the exemption, toggling
    // a status to declutter the map wipes the shift-click batch being built
    // (the same curate-before-acting class .cal-nav was exempted for).
    assert.match(js, /#map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, \.cal-nav, \.map-filter-toggle/,
      'pill clicks must not wipe a building selection');
    // Poll guard: the pills live in #map-view, which renderMapView wipes via
    // innerHTML='' on every 5s tick — a focused pill would be destroyed
    // mid-keyboard-interaction, same reasoning as the sort controls/.cal-nav.
    assert.match(js, /closest\('\.column-sort-field, \.column-sort-dir, \.cal-nav, \.column-add, \.column-add-ai, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle'\)/,
      'a focused pill blocks the auto-refresh like every other rebuilt header control');
  });
});

test('renderMapView composes search and status filter through intersectVisibleIds — never union, never one side dropped', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const rm = js.match(/function renderMapView\([\s\S]*?\n\}/);
    assert.ok(rm, 'renderMapView found in app.js');
    // The intersection RULE is unit-tested in column-state.test.js; this pins
    // the glue — that the view actually feeds both sets through the helper
    // (an inline combiner regressing to union passed the whole suite before).
    assert.match(rm[0], /mapFilterVisibleIds\(/, 'status filter produces its visible-id set');
    assert.match(rm[0], /intersectVisibleIds\(searchIds, statusIds\)/, 'both filters meet in the pure helper');
  });
});

// --- gantt gets the map's status-filter pill row — SHARED
// mechanism (one builder both views call, comma-joined CSS), own persisted
// state, composes with search by the same intersection rule. The row
// carries an Archive pill —
// see the mergeGanttStatusFilter/boardColumnIds assertions below — default
// OFF so the base gantt view stays live-only.

test('gantt status filter: own persisted state, statuses + Archive (default OFF via its own merge helper)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const load = js.match(/function loadGanttStatusFilter\([\s\S]*?\n\}/);
    assert.ok(load, 'loadGanttStatusFilter found in app.js');
    assert.match(load[0], /storageKey\(state\.projectName, 'gantt\.statusFilter'\)/, 'own feature key, namespaced per board like every other persisted view preference');
    // mergeMapStatusFilter would default the Archive key
    // to true (the map's Archive pill has always been ON by default) — the
    // gantt needs its OWN default-shape merge helper so Archive defaults OFF
    // instead, keeping the base gantt view live-only.
    assert.match(load[0], /mergeGanttStatusFilter\(saved, boardColumnIds\(\)\)/,
      'merges against the FULL column id list (statuses + Archive) via the gantt\'s own archive-off-by-default helper, not the map\'s all-on one');
    const save = js.match(/function saveGanttStatusFilter\([\s\S]*?\n\}/);
    assert.ok(save, 'saveGanttStatusFilter found in app.js');
    const toggle = js.match(/function toggleGanttStatusFilter\([\s\S]*?\n\}/);
    assert.ok(toggle, 'toggleGanttStatusFilter found in app.js');
    assert.match(toggle[0], /renderBoard\(\)/, 'toggling re-renders like every other persisted toggle');
    // A changed statuses list invalidates the gantt filter too, same as mapStatusFilter/collapsedColumns/columnSort.
    const applyStatuses = js.match(/function applyStatuses\([\s\S]*?\n\}/);
    assert.match(applyStatuses[0], /ganttStatusFilter = null/, 'a changed column set re-merges the gantt filter, not just the map\'s');
    // The gap guarded here: applyProjectName's own comment says a projectName change
    // "invalidates all of them" (collapsedColumns/columnSort/modalFullscreen/
    // viewMode/mapStatusFilter/calendarSubview/mapSectionsCollapsed) — but
    // ganttStatusFilter, keyed the identical memoize-once-per-project way, was
    // missing from that list. A pre-first-poll gantt toggle (or any render
    // before applyProjectName ever ran) memoizes it under the default/old key,
    // and applyStatuses' JSON-equal early return doesn't rescue a pure rename
    // (same statuses list, different project) — only applyProjectName does.
    const applyProj = js.match(/function applyProjectName\([\s\S]*?\n\}/);
    assert.match(applyProj[0], /ganttStatusFilter = null/,
      'gantt.statusFilter re-merges on a projectName change too, same as mapStatusFilter/mapSectionsCollapsed');
  });
});

test('buildGanttFilterRow shares the pill-row MECHANISM with the map, and now includes the Archive pill', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const shared = js.match(/function buildFilterPillRow\([\s\S]*?\n\}/);
    assert.ok(shared, 'buildFilterPillRow found in app.js — the extracted shared builder both views call');
    const mapRow = js.match(/function buildMapFilterRow\([\s\S]*?\n\}/);
    assert.ok(mapRow, 'buildMapFilterRow found in app.js');
    assert.match(mapRow[0], /buildFilterPillRow\(/, 'the map row now calls the shared builder (extracted, not duplicated)');
    const ganttRow = js.match(/function buildGanttFilterRow\([\s\S]*?\n\}/);
    assert.ok(ganttRow, 'buildGanttFilterRow found in app.js');
    assert.match(ganttRow[0], /buildFilterPillRow\(/, 'the gantt row calls the same shared builder');
    // the gantt pill row
    // includes the Archive pseudo-pill, same id list as the map's row
    // (boardColumnIds: statuses + archive) — not the live-only
    // boardStatuses().
    assert.match(ganttRow[0], /boardColumnIds\(\)/, 'gantt pills now come from statuses + the Archive pseudo-column, same list as the map\'s row');
    assert.doesNotMatch(ganttRow[0], /boardStatuses\(\)/, 'no longer scoped to live statuses only — that was the pre-reopen #98 shape');
    // CSS is shared too — comma-joined selectors, not a second declaration
    // block. The calendar row belongs to this same comma group
    // (see the buildCalendarFilterRow test below), so these anchor on
    // the full three-view selector rather than stopping after gantt.
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.map-filter-row,\s*\.gantt-filter-row,\s*\.calendar-filter-row\s*\{/, 'the row layout rule is shared across all views');
    assert.match(css, /\.map-filter-toggle,\s*\.gantt-filter-toggle,\s*\.calendar-filter-toggle\s*\{/, 'the pill look rule is shared across all views');
    assert.match(css, /\.map-filter-toggle\.off,\s*\.gantt-filter-toggle\.off,\s*\.calendar-filter-toggle\.off\s*\{/, 'the OFF-state pill rule is shared across all views');
  });
});

test('renderGanttView renders the status-filter row UNCONDITIONALLY and composes search+status by intersection, same rule as the map', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.ok(render, 'renderGanttView found in app.js');
    const rowIdx = render[0].indexOf('buildGanttFilterRow()');
    const groupsIdx = render[0].indexOf('ganttGroups(');
    assert.ok(rowIdx > -1, 'the filter row is built');
    assert.ok(groupsIdx > -1 && rowIdx < groupsIdx,
      'the row is appended before groups are computed — if it vanished on the everything-filtered-out state there would be no control left to toggle a status back ON, same reasoning as the map\'s #56 row');
    // The bug guarded here: mapFilterVisibleIds folds an unlisted status into the
    // FIRST column's toggle (correct for the map/board) — but ganttGroups
    // (gantt-model.js) groups cards by their RAW status and gives an
    // unlisted one its OWN separate group row, so that catch-all mapping
    // let an unrelated pill silently hide a group it doesn't represent.
    // ganttFilterVisibleIds is the gantt's own rule: no pill for a status
    // means that status is never governed by one.
    assert.match(render[0], /ganttFilterVisibleIds\(state\.active, loadGanttStatusFilter\(\), boardStatuses\(\)\)/,
      'status filter produces its visible-id set via the gantt\'s own pure helper (not the map\'s catch-all-first-column one), scoped to live cards');
    assert.doesNotMatch(render[0], /mapFilterVisibleIds\(/,
      'the map\'s catch-all-first-column mapping is gone from the gantt — it disagreed with ganttGroups\' raw-status grouping');
    assert.match(render[0], /intersectVisibleIds\(searchIds, statusIds\)/, 'search and status filter meet in the pure helper — never a union, never one side dropped');
    // The empty branch must APPEND a node, never overwrite via innerHTML= — that
    // would wipe the just-appended filter row (the same bug class the map avoids
    // by building an element and appendChild-ing it).
    assert.doesNotMatch(render[0], /container\.innerHTML = '<div class="gantt-empty"/,
      'the empty state appends a node rather than resetting the container');
  });
});

// --- the gantt's Archive pill,
// default OFF, appends ONE more group — every dated ARCHIVED card — AFTER
// the live status groups, same "location after live columns" placement as
// the board's Archive column. Muted the same way archive mutes
// everywhere else; window derivation includes archived bars
// only while the pill is on (rows/window are computed from `groups`, which
// only carries the archive group when archiveOn).

test('renderGanttView appends an Archive group AFTER the live status groups, only when the Archive pill is explicitly on', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.ok(render, 'renderGanttView found in app.js');
    // Explicit `=== true`, not `!== false`: the pill's OWN default is OFF
    // (unlike every live-status pill), so a missing/stale/false value must
    // never render archived rows.
    assert.match(render[0], /archiveOn\s*=\s*loadGanttStatusFilter\(\)\.archive === true/,
      'the Archive pill\'s own boolean decides whether archived cards render at all — default/stale/false never renders them');
    assert.match(render[0], /ganttArchiveGroup\(/, 'the archive group is built via the pure gantt-model helper, not reimplemented inline');
    const groupsIdx = render[0].indexOf('ganttGroups(cards, boardStatuses())');
    const pushIdx = render[0].indexOf('appendArchiveGroup(groups, archiveGroup)');
    assert.ok(groupsIdx > -1, 'live status groups are computed');
    assert.ok(pushIdx > -1 && groupsIdx < pushIdx,
      'the archive group is APPENDED after the live status groups are already computed — same "location after live columns" placement as the board\'s Archive column');
  });
});

test('renderGanttView never adds an archive group when the pill is off — the default gantt view stays archive-free', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    // The push is conditioned on archiveOn — never unconditional.
    assert.match(render[0], /if \(archiveOn\)\s*\{[\s\S]*?appendArchiveGroup\(groups, archiveGroup\)/,
      'appendArchiveGroup(groups, archiveGroup) is gated behind the archiveOn check, never called unconditionally');
  });
});

// Defect fix (verified against a real repro): a LIVE card can carry a
// hand-typed `status: archive` on disk (archive is a location, never
// validated per-card) — ganttGroups gives it its own group keyed literally
// 'archive', identical to ganttArchiveGroup's reserved key for truly
// archived cards. renderGanttView used to `groups.push(archiveGroup)`
// unconditionally, producing two adjacent, identically-labeled "Archive"
// rows — one secretly holding a live, draggable card. It must instead route
// through appendArchiveGroup (gantt-model.js, unit-tested directly), which
// merges into any pre-existing 'archive'-keyed group instead of duplicating it.
test('renderGanttView routes the archive group through appendArchiveGroup instead of a raw groups.push — the fix for the two-Archive-rows collision', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.ok(render, 'renderGanttView found in app.js');
    assert.match(render[0], /appendArchiveGroup\(groups, archiveGroup\)/,
      'the archive group is appended via the merge-aware helper, not a raw groups.push that could duplicate an existing "archive"-keyed live group');
    assert.doesNotMatch(render[0], /groups\.push\(archiveGroup\)/,
      'no raw groups.push(archiveGroup) left — that call sites the exact collision the defect reported');
  });
});

test('ganttBarEl mutes an archived bar to the archive grey regardless of its parked on-disk status', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const bar = js.match(/function ganttBarEl\([\s\S]*?\n\}/);
    assert.ok(bar, 'ganttBarEl found in app.js');
    // statusColor('archive') already mutes to ARCHIVE_COLOR and
    // isBuiltinStatus('archive') is false, so swapping in the literal
    // 'archive' key for an archived bar reuses the existing custom-status
    // inline-color path with no new branching.
    assert.match(bar[0], /const colorStatus = bar\.card\.archived \? 'archive' : bar\.card\.status/,
      'the bar\'s class/border/fill key mutes to the literal \'archive\' string when the card is archived');
    assert.match(bar[0], /status-\$\{mapStatusClass\(colorStatus\)\}/, 'the bar\'s shape class derives from the muted key');
    assert.match(bar[0], /isBuiltinStatus\(colorStatus\)/, 'the inline color override checks the muted key too');
    assert.match(bar[0], /statusColor\(colorStatus\)/);
    assert.match(bar[0], /statusColorSoft\(colorStatus\)/);
  });
});

// --- defect fix: dragging an archived gantt bar/diamond was a silent no-op
// with a fully-realized FAKE drag animation (grab cursor, live-looking
// slide/resize for the whole gesture) and zero user feedback — nothing
// blocked the pointerdown, nothing told the user why nothing happened on
// release. wireGanttPointerDrag's pointerdown handler already looks up the
// underlying LIVE card via `state.active.find` (an archived card lives only
// in state.archived, so this lookup fails for one) — that same lookup now
// gates the gesture at its source instead of only being (silently) checked
// again after the fact in onGanttDragEnd.

test('ganttBarEl marks an archived bar with an .archived class/dataset flag and swaps its drag-handle tooltips for a read-only hint', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const bar = js.match(/function ganttBarEl\([\s\S]*?\n\}/);
    assert.ok(bar, 'ganttBarEl found in app.js');
    assert.match(bar[0], /bar\.card\.archived \? ' archived' : ''/,
      'the archived class rides the same className string as the rest of the bar\'s classes — CSS keys off it to swap the grab cursor for not-allowed');
    assert.match(bar[0], /el\.dataset\.archived\s*=\s*bar\.card\.archived \? '1' : ''/,
      'a dataset flag lets the pointerdown handler (and any other consumer) recognize an archived bar without re-deriving it');
    assert.match(bar[0], /Archived[^"'`]*restore[^"'`]*reschedule/i,
      'the drag-handle tooltips no longer invite a doomed drag on an archived bar — they say so is read-only');
  });
});

test('the gantt due-marker also gets the archived class/dataset flag and a read-only tooltip (the diamond is an equally dead drag surface on an archived row)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderGanttView\([\s\S]*?\n\}/);
    assert.ok(render, 'renderGanttView found in app.js');
    assert.match(render[0], /gantt-due-marker card-el'[^;]*bar\.card\.archived[^;]*' archived'/,
      'the due marker\'s own className includes the archived flag too, not just the bar\'s');
    assert.match(render[0], /d\.dataset\.archived\s*=\s*bar\.card\.archived \? '1' : ''/);
  });
});

test('app.css gives an archived gantt bar/due-marker a not-allowed cursor instead of the live grab/ew-resize affordance', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.gantt-bar\.archived[^{]*\{[^}]*cursor:\s*not-allowed/,
      'an archived bar must not show the grab cursor that invites a doomed drag');
    assert.match(css, /\.gantt-due-marker\.archived[^{]*\{[^}]*cursor:\s*not-allowed/,
      'the archived due diamond gets the same not-allowed cursor');
  });
});

test('wireGanttPointerDrag blocks the drag gesture at pointerdown for an archived bar/diamond — no ganttDrag, no pointer capture, no fake animation — and tells the user why (the reported silent no-op)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Scope to wireGanttPointerDrag — the time grid has a calendar pointerdown
    // handler earlier in the file, so an un-scoped match grabs the wrong one.
    const fn = js.match(/function wireGanttPointerDrag\([\s\S]*?\n\}/);
    assert.ok(fn, 'wireGanttPointerDrag found in app.js');
    const down = fn[0].match(/container\.addEventListener\('pointerdown', \(e\) => \{[\s\S]*?\n {2}\}\);/);
    assert.ok(down, 'the gantt pointerdown handler found in app.js');
    const cardIdx = down[0].indexOf("state.active.find((c) => c.id === Number(barEl.dataset.id))");
    assert.ok(cardIdx > -1, 'the live-card lookup is still there');
    const guardMatch = down[0].match(/if\s*\(!card\)\s*\{[\s\S]*?toast\([^)]*\)[\s\S]*?return;\s*\}/);
    assert.ok(guardMatch, 'a !card guard blocks the gesture with user feedback before ganttDrag is ever built');
    const guardIdx = down[0].indexOf(guardMatch[0]);
    const dragAssignIdx = down[0].indexOf('ganttDrag = {');
    const captureIdx = down[0].indexOf('setPointerCapture');
    assert.ok(cardIdx < guardIdx, 'the card lookup happens before the guard checks it');
    assert.ok(guardIdx < dragAssignIdx, 'the guard runs BEFORE ganttDrag is constructed — no fake animation ever starts for an archived bar');
    assert.ok(guardIdx < captureIdx, 'the guard runs BEFORE setPointerCapture — the gesture never actually captures the pointer');
  });
});

test('a click on a gantt pill calls toggleGanttStatusFilter, checked before the pointer-drag/card-el handling', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /closest\('\.gantt-filter-toggle\[data-col\]'\)/, 'pill buttons are checked in a delegated #gantt-view listener, same pattern as the map');
    assert.match(js, /toggleGanttStatusFilter\(filterBtn\.dataset\.col\)/, 'the click calls toggleGanttStatusFilter with the button\'s column');
  });
});

test('gantt status-filter pills join the Q0 clear-selection exemption AND the focused-control poll guard, same as the map pills', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Q0: a pill click bubbles past the #gantt-view delegated handler to the
    // document-level clear-selection handler — without the exemption, toggling
    // a status to declutter the timeline wipes the shift-click batch being built.
    assert.match(js, /#map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, \.cal-nav, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle/,
      'a gantt pill click must not wipe a building selection — this pin also names .calendar-filter-toggle (verify-fix: it previously stopped at .gantt-filter-toggle, an unanchored prefix match that no longer proved the #99 calendar pill\'s presence in this exemption list)');
    // Poll guard: the pills live in #gantt-view, which renderGanttView wipes
    // via innerHTML='' on every 5s tick — a focused pill would be destroyed
    // mid-keyboard-interaction, same reasoning as the map's pills.
    assert.match(js, /closest\('\.column-sort-field, \.column-sort-dir, \.cal-nav, \.column-add, \.column-add-ai, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle'\)/,
      'a focused gantt pill blocks the auto-refresh like every other rebuilt header control');
  });
});

// --- calendar gets the map's / gantt's status-filter pill
// row — SHARED mechanism (one builder all three views call, comma-joined
// CSS), own persisted state, composes with search by the same intersection
// rule, and applies to BOTH the month grid and the sub-month time grid.
// "show/hide archived cards the same way we do in map view and
// gantt view": the calendar
// gets an Archive pill too, default OFF, same shape as the gantt's.

test('calendar status filter: own persisted state, statuses + Archive (default OFF via its own merge helper)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const load = js.match(/function loadCalendarStatusFilter\([\s\S]*?\n\}/);
    assert.ok(load, 'loadCalendarStatusFilter found in app.js');
    assert.match(load[0], /storageKey\(state\.projectName, 'calendar\.statusFilter'\)/, 'own feature key, namespaced per board like every other persisted view preference');
    assert.match(load[0], /mergeGanttStatusFilter\(saved, boardColumnIds\(\)\)/, 'reuses the gantt\'s own archive-off-by-default merge helper, against statuses + archive (boardColumnIds, not boardStatuses)');
    const save = js.match(/function saveCalendarStatusFilter\([\s\S]*?\n\}/);
    assert.ok(save, 'saveCalendarStatusFilter found in app.js');
    const toggle = js.match(/function toggleCalendarStatusFilter\([\s\S]*?\n\}/);
    assert.ok(toggle, 'toggleCalendarStatusFilter found in app.js');
    assert.match(toggle[0], /renderBoard\(\)/, 'toggling re-renders like every other persisted toggle');
    const solo = js.match(/function soloCalendarStatusFilter\([\s\S]*?\n\}/);
    assert.ok(solo, 'soloCalendarStatusFilter found in app.js');
    assert.match(solo[0], /boardColumnIds\(\)/, 'the solo id list includes Archive too, so soloing Archive shows archived cards only');
    // A changed statuses list invalidates the calendar filter too, same as mapStatusFilter/ganttStatusFilter.
    const applyStatuses = js.match(/function applyStatuses\([\s\S]*?\n\}/);
    assert.match(applyStatuses[0], /calendarStatusFilter = null/, 'a changed column set re-merges the calendar filter too');
    // projectName invalidation, same precedent as ganttStatusFilter.
    const applyProj = js.match(/function applyProjectName\([\s\S]*?\n\}/);
    assert.match(applyProj[0], /calendarStatusFilter = null/,
      'calendar.statusFilter re-merges on a projectName change too, same as mapStatusFilter/ganttStatusFilter');
  });
});

test('buildCalendarFilterRow shares the pill-row MECHANISM and now includes the Archive pill', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const row = js.match(/function buildCalendarFilterRow\([\s\S]*?\n\}/);
    assert.ok(row, 'buildCalendarFilterRow found in app.js');
    assert.match(row[0], /buildFilterPillRow\(/, 'the calendar row calls the same shared builder as map/gantt');
    assert.match(row[0], /boardColumnIds\(\)/, 'pills now come from statuses + Archive, same id list as the gantt\'s row');
    assert.match(row[0], /col === 'archive'/, 'the Archive pill gets its own tooltip wording, same ternary shape as the gantt row');
    // CSS is shared too — comma-joined selectors, not a third declaration block.
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /\.map-filter-row,\s*\.gantt-filter-row,\s*\.calendar-filter-row\s*\{/, 'the row layout rule is shared across all three views');
    assert.match(css, /\.map-filter-toggle,\s*\.gantt-filter-toggle,\s*\.calendar-filter-toggle\s*\{/, 'the pill look rule is shared across all three views');
    assert.match(css, /\.map-filter-toggle\.off,\s*\.gantt-filter-toggle\.off,\s*\.calendar-filter-toggle\.off\s*\{/, 'the OFF-state pill rule is shared across all three views');
  });
});

test('the calendar month grid AND the sub-month time grid both append search-filtered archived cards only while the Archive pill is on', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const month = js.match(/function renderCalendarMonthGrid\([\s\S]*?\n\}/);
    assert.ok(month, 'renderCalendarMonthGrid found in app.js');
    assert.match(month[0], /loadCalendarStatusFilter\(\)\.archive === true/, 'the Archive pill\'s OWN boolean gates inclusion — a missing/stale/false value must never render archived chips');
    assert.match(month[0], /state\.archived\.filter\(\(c\) => searchIds\.has\(c\.id\)\)/, 'archived cards still respect the live search box');
    assert.match(month[0], /filterCards\(state\.active\.concat\(state\.archived\), searchTerms\)/, 'the search pool spans live + archived unconditionally, same as the gantt');
    const timegrid = js.match(/function renderCalendarTimeGrid\([\s\S]*?\n\}/);
    assert.ok(timegrid, 'renderCalendarTimeGrid found in app.js');
    assert.match(timegrid[0], /loadCalendarStatusFilter\(\)\.archive === true/, 'the #58 sub-month grid gates archived inclusion the same way as the month grid');
    assert.match(timegrid[0], /state\.archived\.filter\(\(c\) => searchIds\.has\(c\.id\)\)/, 'same search-respecting archived concat as the month grid');
  });
});

test('renderCalendarView renders the status-filter row UNCONDITIONALLY, before branching into month/sub-month', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const render = js.match(/function renderCalendarView\([\s\S]*?\n\}/);
    assert.ok(render, 'renderCalendarView found in app.js');
    const rowIdx = render[0].indexOf('buildCalendarFilterRow()');
    const branchIdx = render[0].indexOf("subview === 'month'");
    assert.ok(rowIdx > -1, 'the filter row is built');
    assert.ok(branchIdx > -1 && rowIdx < branchIdx, 'the row renders before the month/sub-month branch, so it never disappears with an empty filtered result — same reasoning as the map/gantt row');
  });
});

test('the calendar month grid AND the sub-month time grid both compose search+status by intersection through the gantt-style visible-ids rule', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const month = js.match(/function renderCalendarMonthGrid\([\s\S]*?\n\}/);
    assert.ok(month, 'renderCalendarMonthGrid found in app.js');
    assert.match(month[0], /ganttFilterVisibleIds\(state\.active, loadCalendarStatusFilter\(\), boardStatuses\(\)\)/,
      'the month grid derives its status-visible-ids via the same no-column-bucketing rule the gantt uses — the calendar doesn\'t bucket cards into board columns either, so an unlisted status must stay ungoverned rather than folding into the first column\'s pill');
    assert.match(month[0], /intersectVisibleIds\(searchIds, statusIds\)/, 'search and status filter meet in the pure helper — never a union, never one side dropped');
    const timegrid = js.match(/function renderCalendarTimeGrid\([\s\S]*?\n\}/);
    assert.ok(timegrid, 'renderCalendarTimeGrid found in app.js');
    assert.match(timegrid[0], /ganttFilterVisibleIds\(state\.active, loadCalendarStatusFilter\(\), boardStatuses\(\)\)/,
      'the #58 week/3-day/day sub-views share the exact same status-filter composition as the month grid — filtered chips drop from the all-day band AND the time grid alike');
    assert.match(timegrid[0], /intersectVisibleIds\(searchIds, statusIds\)/, 'same intersection rule applies to the time grid');
  });
});

test('a click on a calendar pill calls toggleCalendarStatusFilter, checked in the delegated #calendar-view listener', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /closest\('\.calendar-filter-toggle\[data-col\]'\)/, 'pill buttons are checked in a delegated #calendar-view listener, same pattern as the map/gantt');
    assert.match(js, /toggleCalendarStatusFilter\(filterBtn\.dataset\.col\)/, 'the click calls toggleCalendarStatusFilter with the button\'s column');
  });
});

test('calendar status-filter pills join the Q0 clear-selection exemption AND the focused-control poll guard, same as the map/gantt pills', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Q0: a pill click bubbles past the #calendar-view delegated handler to the
    // document-level clear-selection handler — without the exemption, toggling
    // a status to declutter the calendar wipes the shift-click batch being built.
    assert.match(js, /#map-toggle-btn, #calendar-toggle-btn, #gantt-toggle-btn, \.cal-nav, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle/,
      'a calendar pill click must not wipe a building selection');
    // Poll guard: the pills live in #calendar-view, which renderCalendarView wipes
    // via innerHTML='' on every 5s tick — a focused pill would be destroyed
    // mid-keyboard-interaction, same reasoning as the map's/gantt's pills.
    assert.match(js, /closest\('\.column-sort-field, \.column-sort-dir, \.cal-nav, \.column-add, \.column-add-ai, \.map-filter-toggle, \.map-section-toggle, \.gantt-filter-toggle, \.calendar-filter-toggle'\)/,
      'a focused calendar pill blocks the auto-refresh like every other rebuilt header control');
  });
});

// --- right-click SOLO/viceversa grammar — pure rule pinned in
// column-state.test.js; this pins the app.js GLUE the review found untested:
// each view's solo*StatusFilter wrapper, its contextmenu wiring, and the
// shared tooltip hint.

test('soloMapStatusFilter/soloGanttStatusFilter/soloCalendarStatusFilter each feed the pure soloStatusFilter rule their own filter + id list, same shape as the toggle* wrappers', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const soloMap = js.match(/function soloMapStatusFilter\([\s\S]*?\n\}/);
    assert.ok(soloMap, 'soloMapStatusFilter found in app.js');
    assert.match(soloMap[0], /soloStatusFilter\(filter, boardColumnIds\(\), col\)/, 'map solo uses the map\'s own column-id list (Archive included), same as toggleMapStatusFilter');
    assert.match(soloMap[0], /saveMapStatusFilter\(\)/);
    assert.match(soloMap[0], /renderBoard\(\)/);

    const soloGantt = js.match(/function soloGanttStatusFilter\([\s\S]*?\n\}/);
    assert.ok(soloGantt, 'soloGanttStatusFilter found in app.js');
    // the gantt's own column-id list now includes Archive
    // (boardColumnIds), same as the map's — soloing must cover the new pill
    // too (soloing a status turns Archive off; soloing Archive shows
    // archived only; right-click on the soloed Archive pill restores all).
    assert.match(soloGantt[0], /soloStatusFilter\(filter, boardColumnIds\(\), col\)/, 'gantt solo now uses statuses + Archive, same list as toggleGanttStatusFilter');
    assert.match(soloGantt[0], /saveGanttStatusFilter\(\)/);
    assert.match(soloGantt[0], /renderBoard\(\)/);

    const soloCal = js.match(/function soloCalendarStatusFilter\([\s\S]*?\n\}/);
    assert.ok(soloCal, 'soloCalendarStatusFilter found in app.js');
    // the calendar's own column-id list includes Archive too
    // (boardColumnIds), same as the gantt's — soloing must cover it.
    assert.match(soloCal[0], /soloStatusFilter\(filter, boardColumnIds\(\), col\)/, 'calendar solo now uses statuses + Archive, same list as toggleCalendarStatusFilter');
    assert.match(soloCal[0], /saveCalendarStatusFilter\(\)/);
    assert.match(soloCal[0], /renderBoard\(\)/);
  });
});

test('buildFilterPillRow appends the SOLO/viceversa hint to every pill\'s tooltip once, shared by all three views', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const build = js.match(/function buildFilterPillRow\([\s\S]*?\n\}/);
    assert.ok(build, 'buildFilterPillRow found in app.js');
    assert.match(build[0], /titleFor\(col, on\) \+ ' Right-click to solo \(right-click the soloed pill again to restore all\)\.'/,
      'the SOLO/viceversa hint rides in the shared builder once, rather than being repeated in each view\'s titleFor closure');
  });
});

test('the three pill contextmenu listeners solo the right view and, like the shared document-level contextmenu handler, skip while a drag is in flight', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Without this guard, a chorded right-click over a pill mid-drag (e.g. a
    // .cal-chip drag on the calendar, or a bar drag on the gantt) re-renders
    // the view via soloXStatusFilter -> renderBoard() -> innerHTML='', which
    // detaches the dragged DOM node before its dragend/pointerup fires — the
    // exact "removed node may never get its dragend" risk this file's own
    // calendar-drop comment already treats as real.
    assert.match(js,
      /\$\('#map-view'\)\.addEventListener\('contextmenu', \(e\) => \{\s*if \(isDragging \|\| ganttDrag \|\| calTimeDrag\) return;[\s\S]{0,300}closest\('\.map-filter-toggle\[data-col\]'\)[\s\S]{0,200}soloMapStatusFilter\(filterBtn\.dataset\.col\)/,
      'map pill contextmenu checks the drag guard before soloing, same guard as the #39 shared handler (app.js ~3006)');
    assert.match(js,
      /\$\('#calendar-view'\)\.addEventListener\('contextmenu', \(e\) => \{\s*if \(isDragging \|\| ganttDrag \|\| calTimeDrag\) return;[\s\S]{0,300}closest\('\.calendar-filter-toggle\[data-col\]'\)[\s\S]{0,200}soloCalendarStatusFilter\(filterBtn\.dataset\.col\)/,
      'calendar pill contextmenu checks the drag guard before soloing — a mid-.cal-chip-drag right-click must not wipe the dragged chip via renderCalendarView\'s innerHTML reset');
    assert.match(js,
      /container\.addEventListener\('contextmenu', \(e\) => \{\s*if \(isDragging \|\| ganttDrag \|\| calTimeDrag\) return;[\s\S]{0,300}closest\('\.gantt-filter-toggle\[data-col\]'\)[\s\S]{0,200}soloGanttStatusFilter\(filterBtn\.dataset\.col\)/,
      'gantt pill contextmenu checks the drag guard before soloing, matching the ganttDrag guard the bar/pointer drag itself relies on');
  });
});

// --- time-grid drag-to-retime + edge-resize glue -----------------------

test('GET /calendar-model.js serves the time-grid drag/resize math', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const body = await (await fetch(`${base}/calendar-model.js`)).text();
    assert.match(body, /rescheduleRangeAtTime/);
    assert.match(body, /rescheduleDueAtTime/);
    assert.match(body, /resizeRangeAtTime/);
    assert.match(body, /minutesToTime/);
    assert.match(body, /CALENDAR_DRAG_SNAP_MIN/);
  });
});

test('calendar-model.js exports the time-grid drag/resize functions both ways (module.exports AND window)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/calendar-model.js`)).text();
    for (const name of ['rescheduleRangeAtTime', 'rescheduleDueAtTime', 'resizeRangeAtTime', 'minutesToTime', 'CALENDAR_DRAG_SNAP_MIN']) {
      assert.match(js, new RegExp(`window\\.${name} = ${name}`), `${name} on window`);
      // and named in the module.exports object literal (appears >= twice total: the export line + the window line, plus the definition)
      assert.ok(js.split(name).length - 1 >= 3, `${name} referenced in both export blocks + definition`);
    }
  });
});

test('renderCalendarTimeGrid makes timed blocks draggable:false and gives ONLY real durations resize handles', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function renderCalendarTimeGrid\([\s\S]*?\n\}/);
    assert.ok(fn, 'renderCalendarTimeGrid found');
    assert.match(fn[0], /el\.draggable = false/, 'timed blocks opt out of native HTML5 drag — the pointer-drag owns them');
    assert.match(fn[0], /!block\.point && !block\.due && !block\.card\.archived/, 'handles only on a real, live same-day duration (point/due placeholders + archived get none)');
    assert.match(fn[0], /cal-resize-handle top/, 'a top (start) handle');
    assert.match(fn[0], /cal-resize-handle bottom/, 'a bottom (end) handle');
  });
});

test('wireCalendarDrag (native day-drag) excludes .cal-timeblock so the two drag systems never both fire', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function wireCalendarDrag\([\s\S]*?\n\}/);
    assert.ok(fn, 'wireCalendarDrag found');
    assert.match(fn[0], /\.cal-chip:not\(\.cal-timeblock\)/, 'the native-drag selector skips timed blocks');
  });
});

test('wireCalendarTimeDrag is wired ONCE (a DOMContentLoaded init), never inside a per-render function', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js, /wireCalendarTimeDrag\(\); \/\/ delegated once on the stable #calendar-view/, 'called at init');
    const renderView = js.match(/function renderCalendarView\([\s\S]*?\n\}/);
    const renderGrid = js.match(/function renderCalendarTimeGrid\([\s\S]*?\n\}/);
    assert.ok(!renderView[0].includes('wireCalendarTimeDrag('), 'never re-wired by renderCalendarView (delegated once on the stable parent)');
    assert.ok(!renderGrid[0].includes('wireCalendarTimeDrag('), 'never re-wired by renderCalendarTimeGrid');
  });
});

test('the calendar pointerdown archived-guard (toast + return) precedes setPointerCapture — no fake drag for a read-only card (mirrors the gantt)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/function wireCalendarTimeDrag\([\s\S]*?\n\}/);
    assert.ok(fn, 'wireCalendarTimeDrag found');
    const down = fn[0].match(/container\.addEventListener\('pointerdown', \(e\) => \{[\s\S]*?\n {2}\}\);/);
    assert.ok(down, 'the calendar pointerdown handler found');
    const cardIdx = down[0].indexOf('state.active.find');
    const guardMatch = down[0].match(/if\s*\(!card\)\s*\{[\s\S]*?toast\([^)]*\)[\s\S]*?return;\s*\}/);
    assert.ok(guardMatch, 'a !card guard toasts and returns before capture');
    const guardIdx = down[0].indexOf(guardMatch[0]);
    const captureIdx = down[0].indexOf('setPointerCapture');
    assert.ok(cardIdx > -1 && cardIdx < guardIdx, 'the live-card lookup precedes the guard');
    assert.ok(guardIdx < captureIdx, 'the guard runs BEFORE setPointerCapture — the archived gesture never captures the pointer');
  });
});

test('onCalTimeDragEnd bails on a null (no-op) changes BEFORE spending a PATCH or bumping pendingDrops', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const fn = js.match(/async function onCalTimeDragEnd\([\s\S]*?\n\}/);
    assert.ok(fn, 'onCalTimeDragEnd found');
    const nullIdx = fn[0].indexOf('if (!changes) return;');
    const patchIdx = fn[0].indexOf("api('PATCH'");
    const pendingIdx = fn[0].indexOf('pendingDrops++');
    assert.ok(nullIdx > -1, 'the !changes early-return exists');
    assert.ok(nullIdx < pendingIdx && nullIdx < patchIdx, 'a zero-delta / not-applicable drag never PATCHes or bumps the poll guard — no stray `updated` bump');
    // the three modes route to the three pure functions
    assert.match(fn[0], /rescheduleDueAtTime\(card, drag\.targetDay, drag\.targetMin\)/, 'due mode → rescheduleDueAtTime');
    assert.match(fn[0], /rescheduleRangeAtTime\(card, drag\.targetDay, drag\.targetMin\)/, 'shift mode → rescheduleRangeAtTime');
    assert.match(fn[0], /resizeRangeAtTime\(card, drag\.mode === 'resize-start' \? 'start' : 'end', drag\.targetMin\)/, 'resize modes → resizeRangeAtTime');
  });
});

test('the document-level contextmenu guard also skips a calendar time-drag', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    // Every drag-in-flight contextmenu guard now includes calTimeDrag — count
    // the guards and assert none was left on the old two-term form.
    const withCal = (js.match(/if \(isDragging \|\| ganttDrag \|\| calTimeDrag\) return;/g) || []).length;
    const withoutCal = (js.match(/if \(isDragging \|\| ganttDrag\) return;/g) || []).length;
    assert.strictEqual(withoutCal, 0, 'no guard left on the pre-#109 two-term form');
    assert.ok(withCal >= 4, 'all four guards (map/calendar/gantt/document #39) include calTimeDrag');
  });
});

test('sub-month all-day chips are not drop-dead zones: a live drag lets pointer events fall through to the day cells', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    // Band chips are grid-overlay SIBLINGS of the .cal-tg-allday-cell drop
    // targets (not children like the month grid's chips), so a drop released
    // over a chip never reaches a cell's dragover/drop handlers and the
    // browser refuses it. During a drag the chips go pointer-events:none —
    // hit-testing lands on the cell underneath, restoring the month view's
    // drop-anywhere-in-the-day semantics in week/3-day/day too.
    const js = await (await fetch(`${base}/app.js`)).text();
    const wire = js.match(/function wireCalendarDrag\([\s\S]*?\n\}/);
    assert.ok(wire, 'wireCalendarDrag found in app.js');
    assert.match(wire[0], /classList\.add\('cal-dragging'\)/, 'dragstart flags the calendar container');
    assert.match(wire[0], /classList\.remove\('cal-dragging'\)/, 'dragend clears the flag (cancelled drags included)');
    // drop clears it too: a completed drop re-renders the view before the
    // source chip's dragend can fire (removed nodes may never get one), and a
    // stuck flag would leave every chip click-dead.
    assert.ok((wire[0].match(/classList\.remove\('cal-dragging'\)/g) || []).length >= 2,
      'both drop and dragend clear the flag');
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /#calendar-view\.cal-dragging \.cal-chip:not\(\.dragging\) \{ pointer-events: none; \}/,
      'chips yield hit-testing to the drop cells only while a drag is live');
  });
});

// defect fix: a date-only card's month/all-day chip
// carried draggable=true and was wired into wireCalendarDrag same as any
// other chip — the browser-visible symptom ("date-only cards can't be
// dragged anywhere in the calendar") wasn't a missing attribute/handler at
// all. Confirmed by driving a REAL browser (headless Edge over CDP, genuine
// Input.dispatchMouseEvent — NOT a synthetic DragEvent, which bypasses the
// native drag-initiation layer entirely and would have hidden this): the
// drag-hides-chips pointer-events:none rule above applied to EVERY .cal-chip during a
// live drag, including the chip the OS was actively tracking AS the drag
// source, because that chip still matches the bare `.cal-chip` selector.
// Chromium cancels an in-flight native HTML5 drag outright the instant its
// own source element goes pointer-events:none — dragstart fires, dragend
// follows immediately, with no dragenter/dragover/drop ever reaching any
// target — reproduced in an isolated two-line repro before touching this
// codebase. This broke EVERY month/all-day chip (date-only, timed-but-still-
// single-day, and multi-day range alike, since none are excluded from the
// selector); it read as "date-only" only because a card carrying a
// datetime value renders in the hour grid instead, which drags through the
// entirely separate pointer-based wireCalendarTimeDrag that
// never touches this CSS class at all.
test('the drag-hides-chips rule excludes the DRAGGED chip itself, not just other chips (pointer-events:none on the drag source cancels native HTML5 drag in Chromium)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const wire = js.match(/function wireCalendarDrag\([\s\S]*?\n\}/);
    assert.ok(wire, 'wireCalendarDrag found in app.js');
    // The dragged chip gets .dragging BEFORE the container gets .cal-dragging
    // — the CSS exclusion below only works because this ordering holds.
    const dragstart = wire[0].match(/addEventListener\('dragstart', \(e\) => \{[\s\S]*?\}\);/);
    assert.ok(dragstart, 'dragstart handler found');
    const draggingIdx = dragstart[0].indexOf("classList.add('dragging')");
    const calDraggingIdx = dragstart[0].indexOf("classList.add('cal-dragging')");
    assert.ok(draggingIdx > -1 && calDraggingIdx > -1 && draggingIdx < calDraggingIdx,
      'the chip is marked .dragging before the container is marked .cal-dragging');
    const css = await (await fetch(`${base}/app.css`)).text();
    assert.match(css, /#calendar-view\.cal-dragging \.cal-chip:not\(\.dragging\) \{ pointer-events: none; \}/,
      'the pointer-events:none rule must exclude the actively-dragged chip — without :not(.dragging) the drag source itself goes pointer-events:none and Chromium cancels the native drag before any dragover/drop ever fires, no matter how correct draggable/dragstart/dragover/drop wiring is elsewhere');
    assert.doesNotMatch(css, /#calendar-view\.cal-dragging \.cal-chip \{ pointer-events: none; \}/,
      'the old unqualified selector (every .cal-chip, drag source included) must not still be present');
  });
});

test('CAL_HOUR_PX and the .cal-tg-col hour stripe agree — JS positions blocks in the CSS-drawn coordinate space', () => {
  // Same JS/CSS sync-pinning as status-colors.test.js's palette checks: the
  // comment convention ("40px = CAL_HOUR_PX") enforced nothing — a one-sided
  // edit drifted every timed block off the drawn hour lines with the suite green.
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const m = js.match(/const CAL_HOUR_PX = (\d+);/);
  assert.ok(m, 'CAL_HOUR_PX declared in app.js');
  const px = Number(m[1]);
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.ok(css.includes(`repeating-linear-gradient(to bottom, transparent 0 ${px - 1}px, #21262d ${px - 1}px ${px}px)`),
    `.cal-tg-col hour stripe must be ${px}px to match CAL_HOUR_PX`);
});

test('Esc closes the open popup directly on the first press — no exit-fullscreen step, fullscreen state untouched', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  // The document-level Esc handler's first line is a bare `if (e.key !== 'Escape')
  // return;` — the date-picker's own Esc handler guards `|| !datePickerFor` on
  // that same line, and the combobox's (grown into a multi-key
  // grammar) still opens with the un-negated `if (e.key === 'Escape' ...)` —
  // neither false-matches this anchor.
  const esc = js.match(/document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key !== 'Escape'\) return;[\s\S]*?\n\s*\}\);/);
  assert.ok(esc, 'document-level Escape handler found in app.js');
  const body = esc[0];
  assert.doesNotMatch(body, /isModalVisuallyFullscreen/,
    'Esc no longer checks fullscreen state — the old "first Esc exits fullscreen" step is gone');
  assert.doesNotMatch(body, /openFullscreenModalType/, 'Esc no longer looks up which modal is fullscreen');
  assert.doesNotMatch(body, /setModalFullscreenVisual/,
    'Esc never flips fullscreen — the persisted #20 preference and the toggle button stay untouched');
  assert.match(body, /if \(!\$\('#detail-modal'\)\.classList\.contains\('hidden'\)\) \{ closeDetailModal\(\); return; \}/,
    'an open detail popup closes on the very first Esc, fullscreen or not');
  assert.match(body, /if \(!\$\('#modal'\)\.classList\.contains\('hidden'\)\) \{ requestCloseModal\(\); return; \}/,
    'the edit/new-card modal now closes on Esc through the #26 unsaved-changes guard, same call the X button makes');
  // Before this, a fullscreen-capable bulk popup (bulkSingle/
  // Tags/Schedule) left Esc a true no-op — the old fullscreen-exit step was
  // removed and nothing replaced it for these three. Esc must close them
  // directly too, same as their own backdrop-click (no confirm — bulk edits
  // are speedbump-exempt, Apply is the speedbump).
  assert.match(body, /if \(closeAnyBulkPopup\(\)\) return;/,
    'Esc closes an open bulk-edit popup directly, same as its backdrop-click');
});

test('closeAnyBulkPopup closes whichever bulk popup is open, no confirm — the fix for the Esc-is-inert-on-bulk-popups bug', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/function closeAnyBulkPopup\([\s\S]*?\n\}/);
  assert.ok(fn, 'closeAnyBulkPopup found in app.js');
  assert.match(fn[0], /#bulk-single/);
  assert.match(fn[0], /#bulk-tags/);
  assert.match(fn[0], /#bulk-schedule/);
  assert.doesNotMatch(fn[0], /confirm\(/, 'bulk-edit popups are speedbump-exempt — Esc closes them with no confirm, same as backdrop-click');
});

test('isModalVisuallyFullscreen stays removed — dead code once Esc stopped calling it', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  assert.doesNotMatch(js, /function isModalVisuallyFullscreen/);
  // openFullscreenModalType was ALSO removed as dead code, then
  // deliberately resurrected with a live caller (the Alt+Enter
  // hotkey) — see the dedicated Alt+Enter test below. Esc itself still never
  // touches fullscreen; the Esc-handler test above pins that separately.
});

test('Alt+Enter toggles fullscreen on the open popup — keyboard twin of the toggle button', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  // The lookup helper: first visible fullscreen-capable backdrop wins.
  const fn = js.match(/function openFullscreenModalType\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'openFullscreenModalType found in app.js');
  assert.match(fn[0], /FULLSCREEN_MODALS/, 'iterates the registry, so a future popup gets the hotkey by registration alone');
  assert.match(fn[0], /classList\.contains\('hidden'\)/);
  // The document-level handler: bare Alt+Enter only (no other modifiers),
  // routed through toggleModalFullscreen so the persisted per-modal-type
  // preference updates identically to a button click.
  const handler = js.match(/document\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key !== 'Enter' \|\| !e\.altKey[\s\S]*?\n\s*\}\);/);
  assert.ok(handler, 'document-level Alt+Enter handler found in app.js');
  assert.match(handler[0], /e\.ctrlKey \|\| e\.metaKey \|\| e\.shiftKey/, 'other-modifier chords fall through untouched');
  assert.match(handler[0], /openFullscreenModalType\(\)/);
  assert.match(handler[0], /toggleModalFullscreen\(type\)/);
  assert.match(handler[0], /e\.preventDefault\(\)/, 'the chord never reaches implicit form submission');
  // No popup open = no-op: the lookup returning null must bail BEFORE preventDefault.
  assert.match(handler[0], /if \(!type\) return;\s*\n\s*e\.preventDefault\(\)/);
  // attachCombobox exempts alt-chorded Enter so the hotkey wins over the
  // menu's pick grammar even while a suggestion menu is open (the
  // plain-Enter contract is untouched — its own test below).
  const combo = js.match(/function attachCombobox\([\s\S]*?\n\}/);
  assert.ok(combo, 'attachCombobox found in app.js');
  assert.match(combo[0], /if \(e\.altKey\) return;/);
});

test('attachCombobox keydown grammar: Up/Down move a highlight, Enter picks it, Esc still stops at the menu', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/function attachCombobox\([\s\S]*?\n\}/);
  assert.ok(fn, 'attachCombobox found in app.js');
  const body = fn[0];
  // Esc: the contract survives untouched — closes the menu ONLY and
  // stops propagation so the document-level popup-close handler never sees
  // this keypress (the next Esc is the one that closes the popup/modal).
  assert.match(body, /if \(e\.key === 'Escape' && !menu\.hidden\) \{ close\(\); e\.stopPropagation\(\); return; \}/);
  // A closed menu hands every other key back — no Arrow/Enter handling runs,
  // so a bare Enter reaches the surrounding <form>'s native submit-on-Enter
  // (the minimal-create flow must not break).
  assert.match(body, /if \(menu\.hidden\) return;/);
  // Up/Down move `highlightIndex` through the CURRENTLY RENDERED `items`,
  // wrapping — the wrap/clamp math itself is combobox.js's nextHighlightIndex
  // (pure-tested in combobox.test.js), not reimplemented here.
  assert.match(body, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  assert.match(body, /setHighlight\(nextHighlightIndex\(items\.length, highlightIndex, e\.key === 'ArrowDown' \? 1 : -1\)\);/);
  assert.match(body, /e\.preventDefault\(\); \/\/ don't let the browser hunt for another focusable element/);
  // Enter must NEVER fall through to the form while the menu
  // is open ("ONLY when the menu is closed"). An open menu
  // always consumes it: picks the highlighted row, or — nothing highlighted —
  // just closes the menu so the very next Enter is the one that reaches the
  // form. Minimal create still works: a mouse pick already closes the menu before
  // Enter is ever pressed, and the plain title-only flow never opens the
  // assignee menu at all.
  assert.match(body, /if \(e\.key === 'Enter'\) \{/);
  assert.match(body, /if \(highlightIndex >= 0\) pick\(items\[highlightIndex\]\);/);
  assert.match(body, /else close\(\);/);
  assert.doesNotMatch(body, /if \(e\.key === 'Enter' && highlightIndex >= 0\) \{/,
    'the old highlightIndex-gated Enter (which let it fall through to submit while the menu stayed open) is gone');
});

test('setHighlight scrolls the highlighted row into view — a menu taller than its 180px max-height must not hide the active row (regression)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/const setHighlight = \(idx\) => \{[\s\S]*?\n  \};/);
  assert.ok(fn, 'setHighlight found in app.js');
  assert.match(fn[0], /scrollIntoView\(\{\s*block:\s*'nearest'\s*\}\)/,
    'the highlighted item scrolls into view — a plain classList toggle never auto-scrolls an unfocused div into an overflow:auto container');
});

test("combobox Up/Down highlight reuses the existing hover treatment, not a new color", () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.css'), 'utf8');
  assert.match(css, /\.combobox-item:hover, \.combobox-item\.active \{ background: #1f6feb33; \}/);
});

// --- the "one rule, three callers" is only pinned for
// drag-to-Archive (via dragPlan/selection.test.js) — doArchive (tile/detail
// Archive button) and bulkArchive (bulk menu's Archive selected) call
// archiveNeedsConfirm too, but nothing asserted that wiring, so a regression
// dropping/inverting the gate on either of those two surfaces would pass the
// whole suite silently.

test('doArchive gates its confirm on archiveNeedsConfirm — the tile/detail Archive button surface (regression)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/async function doArchive\([\s\S]*?\n\}/);
  assert.ok(fn, 'doArchive found in app.js');
  assert.match(fn[0], /archiveNeedsConfirm\(\[card\]\)/,
    'a missing lookup falls back to confirming (the safe default) — archiveNeedsConfirm only runs when the card is found');
  assert.match(fn[0], /if \(\(!card \|\| archiveNeedsConfirm\(\[card\]\)\) && !confirm\(/,
    'confirm is skipped entirely when the found card is done — same rule dragPlan/bulkArchive use');
});

test('bulkArchive gates its confirm on archiveNeedsConfirm — the bulk menu\'s Archive selected surface (regression)', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const fn = js.match(/async function bulkArchive\([\s\S]*?\n\}/);
  assert.ok(fn, 'bulkArchive found in app.js');
  assert.match(fn[0], /if \(archiveNeedsConfirm\(toArchive\) && !confirm\(/,
    'the batch confirm is skipped when every card actually being archived (toArchive, not the whole selection) is already done');
});

// =====================================================================
// security audit (part of the go-public gate). Four
// ratified deliverables: pin the loopback bind, add an Origin/Referer +
// Host allowlist on state-changing routes, ship a CSP header + sweep the
// SPA's card-content render paths for XSS, and SECURITY.md's threat model.
// =====================================================================

// --- deliverable 1: pin the loopback bind with a regression test. The bind
// itself was already correct (server.js:139 hardcodes '127.0.0.1') — this
// test exercises the REAL start() codepath (not withServer's own manual
// listen(0, '127.0.0.1', ...) above, which would never catch a regression in
// start() itself) so a future edit that widens the bind to '0.0.0.0' or drops
// the host argument (defaulting to all interfaces) fails loudly.

test("start() binds the HTTP server to 127.0.0.1 only — no 0.0.0.0 footgun", async () => {
  const dir = tmpBoard();
  const srv = start(dir, 0); // port 0: OS picks a free port — start()'s own listen() call is what's under test
  try {
    await new Promise((resolve, reject) => {
      srv.once('listening', resolve);
      srv.once('error', reject);
    });
    const addr = srv.address();
    assert.strictEqual(addr.address, '127.0.0.1',
      'the server must bind the loopback interface only — 0.0.0.0/:: would also accept connections from other devices on the LAN');
    // sanity: prove this is a live bind check, not an assertion on inert config
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/board`);
    assert.strictEqual(res.status, 200);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
    try { fs.unlinkSync(path.join(dir, '.kanban-app.pid')); } catch (_) {}
  }
});

// --- deliverable 2: Origin/Referer check + Host allowlist on state-changing
// routes. Design constraint from the card: a PRESENT header naming a
// disallowed origin/host is refused; an ABSENT header is a legitimate local
// client (curl, direct tool calls, VSCode Simple Browser) and passes through.

test('originAllowed: absent Origin, Referer, and Host all pass — curl-style local clients are never refused', () => {
  assert.strictEqual(originAllowed({ headers: {} }), true);
});

test('originAllowed: allows Origin/Host naming localhost or 127.0.0.1 on any port, or no port at all', () => {
  assert.strictEqual(originAllowed({ headers: { origin: 'http://localhost:7777', host: 'localhost:7777' } }), true);
  assert.strictEqual(originAllowed({ headers: { origin: 'http://127.0.0.1:7797', host: '127.0.0.1:7797' } }), true);
  assert.strictEqual(originAllowed({ headers: { origin: 'http://localhost', host: 'localhost' } }), true);
});

test('originAllowed: refuses a PRESENT Origin naming somewhere else (kills CSRF)', () => {
  assert.strictEqual(originAllowed({ headers: { origin: 'http://evil.example' } }), false);
});

test('originAllowed: refuses a PRESENT Host naming somewhere else (kills DNS-rebinding)', () => {
  assert.strictEqual(originAllowed({ headers: { host: 'evil.example' } }), false);
});

test('originAllowed: falls back to Referer\'s origin when Origin is absent', () => {
  assert.strictEqual(originAllowed({ headers: { referer: 'http://localhost:7777/some/path' } }), true);
  assert.strictEqual(originAllowed({ headers: { referer: 'http://evil.example/x' } }), false);
});

test('originAllowed: an allowed Origin is not overruled by a mismatched Host, and vice versa — both must pass', () => {
  assert.strictEqual(originAllowed({ headers: { origin: 'http://evil.example', host: 'localhost:7777' } }), false);
  assert.strictEqual(originAllowed({ headers: { origin: 'http://localhost:7777', host: 'evil.example' } }), false);
});

test('POST /api/cards with no Origin/Referer/Host override succeeds — direct tool calls stay legitimate', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await rawRequest(base, 'POST', '/api/cards', { body: { title: 'No headers', status: 'todo' } });
    assert.strictEqual(r.status, 201);
  });
});

test('POST /api/cards with an allowed localhost/127.0.0.1 Origin succeeds', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const port = new URL(base).port;
    const r1 = await rawRequest(base, 'POST', '/api/cards',
      { body: { title: 'Local origin', status: 'todo' }, headers: { origin: `http://localhost:${port}` } });
    assert.strictEqual(r1.status, 201);
    const r2 = await rawRequest(base, 'POST', '/api/cards',
      { body: { title: 'Loopback origin', status: 'todo' }, headers: { origin: `http://127.0.0.1:${port}` } });
    assert.strictEqual(r2.status, 201);
  });
});

test('POST /api/cards with a hostile Origin is refused with 403 and writes nothing to disk (kills CSRF)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const before = fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).length;
    const r = await rawRequest(base, 'POST', '/api/cards',
      { body: { title: 'Should never land', status: 'todo' }, headers: { origin: 'http://evil.example' } });
    assert.strictEqual(r.status, 403);
    const after = fs.readdirSync(dir).filter((f) => f.endsWith('.card.md')).length;
    assert.strictEqual(after, before, 'the hostile request must not have created a card file');
  });
});

test('PATCH /api/cards/:id with a hostile Host header is refused with 403 and leaves the card untouched (kills DNS-rebinding)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await rawRequest(base, 'PATCH', '/api/cards/1',
      { body: { status: 'todo' }, headers: { host: 'evil.example' } });
    assert.strictEqual(r.status, 403);
    const card = await req(base, 'GET', '/api/cards/1/detail');
    assert.match(card.json.frontmatter, /^status: done$/m, 'card 1 must still read its original status — the hostile PATCH never applied');
  });
});

test('DELETE /api/cards/:id with a hostile Origin is refused with 403 and the file survives', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await rawRequest(base, 'DELETE', '/api/cards/1', { headers: { origin: 'http://evil.example' } });
    assert.strictEqual(r.status, 403);
    assert.ok(fs.existsSync(path.join(dir, '1.card.md')), 'card 1 must still exist on disk');
  });
});

// The first pass exempted GET from the guard entirely, which
// left DNS rebinding's read/exfiltration half open — a rebound hostile origin
// is same-origin to the browser once resolved to 127.0.0.1, so a GET fetch
// from that tab would return the full board with no write ever attempted.
// The guard now applies uniformly; only a PRESENT disallowed header is
// refused, so a normal top-level GET (which sends no Origin and whose Host
// always matches the address actually loaded) keeps working unmodified.
test('GET requests ARE blocked by the Origin/Host guard too — reads are not exempt (regression)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await rawRequest(base, 'GET', '/api/board', { headers: { origin: 'http://evil.example', host: 'evil.example' } });
    assert.strictEqual(r.status, 403, 'a hostile Origin/Host on a GET must be refused — DNS rebinding can read, not just write');
  });
});

test('GET /api/board with no Origin/Referer/Host override succeeds — direct tool calls and normal browser navigation stay legitimate (regression)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const r = await rawRequest(base, 'GET', '/api/board', {});
    assert.strictEqual(r.status, 200);
  });
});

test('GET /api/board with an allowed localhost/127.0.0.1 Origin succeeds (regression)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const port = new URL(base).port;
    const r = await rawRequest(base, 'GET', '/api/board', { headers: { origin: `http://localhost:${port}` } });
    assert.strictEqual(r.status, 200);
  });
});

// --- deliverable 3a: CSP header on the served HTML. The SPA ships no inline
// script/style anywhere (every script is a separate <script src>, every rule
// lives in app.css), so the policy needs no 'unsafe-inline'/'unsafe-eval'.

test("GET / carries a Content-Security-Policy header with no unsafe-inline/unsafe-eval", async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header present on the served HTML');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(csp, /unsafe-eval/);
  });
});

test('static JS/CSS assets do not carry the Content-Security-Policy header — it is scoped to the HTML document', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const res = await fetch(`${base}/app.js`);
    assert.strictEqual(res.headers.get('content-security-policy'), null);
  });
});

// --- deliverable 3b: XSS sweep of every card-content render path in the SPA.
// The sweep found the codebase already disciplined (escapeHtml/textContent
// throughout) — these tests PIN that property so a future edit can't
// silently reintroduce an unescaped sink.

test('XSS sweep: card.title never lands in innerHTML unescaped — board tile, archived tile, calendar chip, and gantt bar/gutter all wrap it in escapeHtml (security audit)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    assert.match(js.match(/function cardEl\([\s\S]*?\n\}/)[0], /escapeHtml\(card\.title\)/);
    // archiveCardEl/cardEl still escape the raw title on
    // their non-fallback branch (title present); calendarChipEl/ganttBarEl/
    // renderGanttView now escape `titleDisplay.text` instead — cardTitleDisplay's
    // output (either the real title or, for a titleless AI-prompt card, the
    // prompt text) — but that's still card-derived user data, still escaped
    // every time, never raw-interpolated.
    assert.match(js.match(/function archiveCardEl\([\s\S]*?\n\}/)[0], /escapeHtml\(card\.title\)/);
    assert.match(js.match(/function calendarChipEl\([\s\S]*?\n\}/)[0], /escapeHtml\(titleDisplay\.text\)/);
    assert.match(js.match(/function ganttBarEl\([\s\S]*?\n\}/)[0], /escapeHtml\(titleDisplay\.text\)/);
    assert.match(js.match(/function renderGanttView\([\s\S]*?\n\}/)[0], /escapeHtml\(titleDisplay\.text\)/);
  });
});

test('XSS sweep: the dependency map SVG escapes every card-derived string — node id/title lines, tooltip, raw status, and blocked reason (security audit)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const svg = js.match(/function buildMapSvg\([\s\S]*?\nfunction /)[0];
    assert.match(svg, /escapeHtml\(idLabel\)/);
    assert.match(svg, /escapeHtml\(titleLine\)/);
    assert.match(svg, /escapeHtml\(tooltip\)/);
    assert.match(svg, /escapeHtml\(n\.status\)/);
    assert.match(svg, /escapeHtml\(n\.blockedReason/);
  });
});

test('XSS sweep: the detail popup escapes the card body BEFORE markdown tag synthesis, and never lets an unsafe link scheme through (security audit)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.match(mdToHtml, /const lines = escapeHtml\(md\)\.split\('\\n'\)/,
      'the raw body is escaped up front — a `<script>` in a card body can never survive as a live tag, even inside inline code/emphasis');
    assert.ok(mdToHtml.includes("/^(https?:|mailto:|#|\\/)/i.test(url.trim())"),
      'markdown links fall back to "#" for any scheme outside the allowlist (e.g. javascript:)');
  });
});

test('XSS sweep: mdToHtml adds no new raw-innerHTML path — escapeHtml(md) is the literal first statement, over the WHOLE raw body, before nested-list/continuation-line handling ever sees it', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.match(mdToHtml, /^function mdToHtml\(md\) \{\r?\n\s*const lines = escapeHtml\(md\)\.split\('\\n'\);/,
      'escapeHtml(md) runs over the entire raw body before the line-by-line split — nested bullets and continuation lines are already-escaped text by the time list handling touches them, so neither needs (or has) its own escaping call');
    assert.ok(!mdToHtml.includes('innerHTML'),
      'mdToHtml only ever returns a string — the one innerHTML write lives at its call site, outside this function');
  });
});

test('mdToHtml nests sub-bullets by indent depth against a stack of open <ul> levels, instead of flattening every "- " line to a sibling', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.ok(mdToHtml.includes('const indent = m[1].length;'),
      "each bullet line's leading indent is captured and measured");
    assert.ok(mdToHtml.includes('while (listStack.length && indent < listStack[listStack.length - 1].indent)'),
      'a shallower indent unwinds every deeper level it dropped below, not just the innermost one');
    assert.ok(mdToHtml.includes('listStack.push({ indent });') && mdToHtml.includes("html += '<ul>';"),
      'a deeper indent opens a NEW nested <ul> — not a sibling <li> flattened into the parent list');
    assert.ok(!mdToHtml.includes("if (!listOpen) { html += '<ul>'; listOpen = true; }"),
      'the old single flat <ul>, opened once and reused at every indent, is gone');
  });
});

test('mdToHtml: a same-depth sibling closes the previous <li>; a deeper item nests inside it without closing it first', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.match(mdToHtml,
      /if \(listStack\.length && indent === listStack\[listStack\.length - 1\]\.indent\) \{\r?\n\s*closeLi\(\);/,
      'a same-depth sibling closes the previous <li> at that level before opening its own');
    assert.ok(mdToHtml.includes('} else if (!listStack.length || indent > listStack[listStack.length - 1].indent) {'),
      "a deeper indent takes the nested-<ul> branch instead, leaving the parent's <li> open around it");
  });
});

test('mdToHtml fully unwinds every open nesting level, closing each ancestor\'s <li>, when a heading/hr/code-fence/blank line follows a nested list', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.ok(mdToHtml.includes('while (listStack.length) {') && mdToHtml.includes("if (listStack.length) html += '</li>';"),
      "closeList() pops every stack level, closing each ancestor's <li> as the nested <ul> it held closes");
    assert.ok(mdToHtml.includes("if (line.trim() === '') { flushPara(); closeList(); continue; }"),
      'a blank line still closes the list fully — continuation only ever applies to a non-blank wrapped line');
  });
});

test('mdToHtml: a wrapped non-"-" line joins the last open <li> instead of closing the list and stranding a <p>', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const mdToHtml = js.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    assert.ok(mdToHtml.includes('if (listStack.length) {') && mdToHtml.includes("html += ' ' + inline(line.trim());"),
      'while any list is open (any depth), a non-bullet non-blank line extends the currently open <li> in place');
    assert.ok(mdToHtml.includes('para.push(inline(line));'),
      'outside any list the same line still falls through to a normal paragraph — plain-text bodies are unchanged');
  });
});

test('mdToHtml behavioral: nested bullets, continuation lines, and an XSS payload through both render to the exact expected HTML (executes the real function — not a source-text pattern match)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const appJs = await (await fetch(`${base}/app.js`)).text();
    const badgeJs = await (await fetch(`${base}/assignee-badge.js`)).text();
    const escapeHtmlSrc = badgeJs.match(/function escapeHtml\([\s\S]*?\n\}/)[0];
    const mdToHtmlSrc = appJs.match(/function mdToHtml\([\s\S]*?\n\}/)[0];
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(`${escapeHtmlSrc}\n${mdToHtmlSrc}`, sandbox);
    const mdToHtml = sandbox.mdToHtml;

    assert.strictEqual(mdToHtml('- a\n  - b\n- c'),
      '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>',
      'a sub-bullet nests inside its parent <li>; the next same-depth sibling closes the nested <ul> first');
    assert.strictEqual(mdToHtml('- a\n  - b\n    - c\n- d'),
      '<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>',
      'three levels deep unwinds every open <li>/<ul> cleanly back to the root on the next top-level item');
    assert.strictEqual(mdToHtml('- a\n  more of a\n- b'),
      '<ul><li>a more of a</li><li>b</li></ul>',
      'a wrapped continuation line joins the open <li> in place instead of stranding a <p>');
    assert.strictEqual(mdToHtml('- a\n  - b\n    more of b\n- c'),
      '<ul><li>a<ul><li>b more of b</li></ul></li><li>c</li></ul>',
      'a continuation line under a nested item joins the innermost open <li>, not an outer ancestor');
    assert.strictEqual(mdToHtml('- <img src=x onerror=alert(1)>\n  more <script>evil</script>'),
      '<ul><li>&lt;img src=x onerror=alert(1)&gt; more &lt;script&gt;evil&lt;/script&gt;</li></ul>',
      'nesting/continuation never opens a second unescaped path — the payload stays escaped end to end');
  });
});

test('XSS sweep: the detail popup\'s frontmatter table and "Last modified" line escape every value (security audit)', async () => {
  const dir = tmpBoard();
  await withServer(dir, async (base) => {
    const js = await (await fetch(`${base}/app.js`)).text();
    const table = js.match(/function renderFrontmatterTable\([\s\S]*?\n\}/)[0];
    assert.match(table, /escapeHtml\(k\)/);
    assert.match(table, /escapeHtml\(formatFrontmatterValue\(v\)\)/);
    const modified = js.match(/function formatDetailModified\([\s\S]*?\n\}/)[0];
    assert.match(modified, /escapeHtml\(formatLocalDateTime\(data\.updated\)\)/);
    assert.match(modified, /escapeHtml\(formatLocalDateTime\(data\.mtime\)\)/);
  });
});

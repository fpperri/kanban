const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const scenario = require('./browser/scenarios/fan-names');
const scenarios = require('./browser/scenarios');
const tierFan = require('./browser/scenarios/tier-fan');
const options = require('./browser/scenarios/tier-fan-options');
const {
  graphBuild, graphFanNames, graphFanNameText, graphNeighbours, GRAPH_FAN_OPTION_VALUES,
} = require('../web/graph-model');
const { loadBoard, cleanUp } = require('./helpers/fan-boards');

// The fan-names scenario only runs in a browser (in CI). Here its lists are held to the real
// board reader and the Graph model over each board's own cards, and its logic runs against a
// stand-in page that answers from the real model, with the page's behaviour varied so a scenario
// that could never fail is caught.

after(cleanUp);

const BOARDS = { plan: loadBoard('plan'), fixture: loadBoard('fixture'), malformed: loadBoard('malformed') };
const CASE = scenario.CASES;
const sorted = (ids) => ids.map(Number).sort((a, b) => a - b);

const modelOf = (key, extra = []) => {
  const board = BOARDS[key];
  const cards = board.all.concat(extra);
  return graphBuild(cards, {
    ctx: board.ctx, hierarchy: board.config.hierarchy, types: board.config.types, visibleIds: new Set(cards.filter((c) => !c.archived).map((c) => c.id)),
  });
};

// --- the lists are the real boards' ------------------------------------------------------------------

test('the scenario is in the runner, on the plan board, with the fixture and malformed boards beside it', () => {
  assert.strictEqual(scenarios.find((s) => s.name === 'fan-names'), scenario);
  assert.strictEqual(scenario.board, 'plan');
  assert.deepStrictEqual(scenario.alsoBoards, ['fixture', 'malformed']);
});

test('the cards each board draws are the scenario\'s lists, and the parents are the ones relevant names', () => {
  for (const key of ['plan', 'fixture', 'malformed']) {
    assert.deepStrictEqual(sorted(modelOf(key).nodes.map((n) => n.id)), sorted(CASE[key].live), key);
  }
  assert.strictEqual(CASE.plan.live.length, 26, 'above the small size');
  assert.deepStrictEqual(sorted([...graphFanNames(modelOf('plan'), 'relevant')]), sorted(CASE.plan.parents));
  assert.ok(CASE.fixture.live.length <= 24 && CASE.malformed.live.length <= 24, 'the other two boards are small fans');
  assert.deepStrictEqual(sorted([...graphFanNames(modelOf('fixture'), 'relevant')]), sorted(CASE.fixture.live));
  assert.deepStrictEqual(sorted([...graphFanNames(modelOf('malformed'), 'relevant')]), sorted(CASE.malformed.live));
});

test('the cards the scenario picks light the cards it says, and the extras are drawn', () => {
  const model = modelOf('plan');
  for (const pick of CASE.plan.picks) {
    assert.deepStrictEqual(sorted([...graphNeighbours(model, String(pick.id))].filter((id) => id !== String(pick.id))), sorted(pick.related), `card ${pick.id}`);
    assert.ok(!CASE.plan.parents.includes(pick.id), 'a leaf, so a click on it shows what the selection adds');
  }
  for (const id of CASE.plan.extras) assert.ok(model.byId.has(String(id)), `card ${id} is drawn`);
});

test('the title, the added card and the steps are the board\'s and the model\'s', () => {
  const one = BOARDS.plan.live.find((c) => c.id === String(CASE.plan.title.id));
  assert.strictEqual(graphFanNameText(one.title, one.id), CASE.plan.title.text);
  assert.strictEqual(BOARDS.plan.config.nextId, CASE.plan.addedId, 'the first card the scenario adds');
  assert.deepStrictEqual(CASE.plan.values, JSON.parse(JSON.stringify(GRAPH_FAN_OPTION_VALUES.names)));
  assert.deepStrictEqual(CASE.plan.steps, ['all', 'none', 'relevant']);
});

// --- the stand-in page -------------------------------------------------------------------------------------

const HANDLES = { notifications: 3, preferences: 4, canvas: 5, names: 100 };
function standIn(over = {}) {
  const checks = [];
  const saved = {};
  let key = null;
  let view = 'graph';
  let layout = 'tiers';
  let focus = null;
  let box = '';
  let panel = false;
  let surface = null;
  let selected = [];
  let touched = false;
  const extraOf = {};
  const pendingOf = {};
  let nextId = 30;
  let doubled = false;
  let pressing = null;
  const st = () => {
    const id = over.sharedStore ? 'one' : key;
    if (!saved[id]) saved[id] = { names: 'relevant', layout: 'tiers' };
    return saved[id];
  };
  const cardsExtra = () => (extraOf[key] || []).map((c) => ({ ...c }));
  const model = () => modelOf(key, cardsExtra());
  const lone = () => (selected.length === 1 ? selected[0] : null);
  const namedFor = (mode, ids, loneId) => sorted([...graphFanNames(model(), mode, { selectedIds: new Set(ids.map(String)), loneCardId: loneId === null ? null : String(loneId) })]);
  const named = () => {
    if (view !== 'graph' || layout !== 'tiers') return [];
    const mode = over.ignoresSetting ? 'relevant' : st().names;
    return over.ignoresSelection ? namedFor(mode, [], null) : namedFor(mode, selected, lone());
  };
  const reveal = () => { extraOf[key] = (extraOf[key] || []).concat(pendingOf[key] || []); pendingOf[key] = []; };
  const nextName = (v) => GRAPH_FAN_OPTION_VALUES.names[(GRAPH_FAN_OPTION_VALUES.names.indexOf(v) + 1) % 3];
  const optionHandle = (v) => HANDLES.names + GRAPH_FAN_OPTION_VALUES.names.indexOf(v);
  const handleKind = (x) => {
    if (x === HANDLES.notifications) return { kind: 'notifications' };
    if (x === HANDLES.preferences) return { kind: 'preferences' };
    if (x === HANDLES.canvas) return { kind: 'canvas' };
    if (x >= HANDLES.names && x < HANDLES.names + 3) return { kind: 'option', v: GRAPH_FAN_OPTION_VALUES.names[x - HANDLES.names] };
    if (x >= 10000) return { kind: 'dot', id: x - 10000 };
    return { kind: 'none' };
  };
  const pressN = (mods = {}) => {
    if (focus === 'box') { box += 'l'; if (!over.typedNStepsToo) return; }
    if (!over.chordSteps && (mods.ctrl || mods.alt)) return;
    if (surface !== null && !over.ignoresSurfaces) return;
    if (panel && over.panelBlocksN) return;
    if ((view !== 'graph' || layout !== 'tiers') && !over.stepsEverywhere) return;
    if (over.nDead) return;
    st().names = over.stuck ? 'all' : nextName(st().names);
    if (typeof focus === 'string' && focus.startsWith('names=')) focus = over.focusLost ? null : over.focusFollows ? `names=${st().names}` : focus;
  };
  const labels = () => (view === 'graph' && layout === 'tiers' ? model().nodes.length + (doubled ? 1 : 0) : 0);
  const group = () => {
    return {
      title: 'Names explains itself in a tooltip',
      buttons: GRAPH_FAN_OPTION_VALUES.names.map((v) => ({
        key: 'names', val: v, text: v, pressed: st().names === v, active: st().names === v, keeps: !over.buttonLosesSelection, holds: !!over.buttonHoldsPoll,
      })),
    };
  };
  const keyLine = () => `solid line: parent · l steps the names: ${over.lineStale ? 'relevant' : st().names}`;
  const press = (target, extras = {}) => {
    if (target.kind === 'option') { st().names = target.v; focus = `names=${target.v}`; }
    if (target.kind === 'notifications') surface = 'notifications';
    if (target.kind === 'preferences') surface = 'preferences';
    if (target.kind === 'dot') {
      if (extras.modifiers === 8) { if (!selected.includes(target.id)) selected = selected.concat(target.id); } else selected = [target.id];
    }
  };
  const SET = scenario.SETTING;
  const page = {
    checks,
    check: (name, ok) => checks.push([name, !!ok]),
    shot: async () => {},
    open: async (url, k) => {
      key = k;
      view = url.includes('view=board') ? 'board' : 'graph';
      layout = st().layout;
      focus = null; box = ''; panel = false; surface = null; selected = []; touched = false; doubled = false;
      if (over.forgets) st().names = 'relevant';
      reveal();
    },
    centre: async (sel) => {
      if (sel === '#notif-btn') return { x: HANDLES.notifications, y: 1 };
      if (sel === '#prefs-btn') return { x: HANDLES.preferences, y: 1 };
      for (const v of GRAPH_FAN_OPTION_VALUES.names) if (sel === options.optionButton('names', v)) return { x: optionHandle(v), y: 1 };
      throw new Error(`the stand-in page was asked for the centre of something it does not know: ${sel}`);
    },
    click: async (x, y, extras = {}) => press(handleKind(x), extras),
    mouse: async (type, x) => {
      if (type === 'mousePressed') pressing = handleKind(x);
      if (type === 'mouseMoved' && pressing && pressing.kind === 'canvas') touched = true;
      if (type === 'mouseReleased') pressing = null;
    },
    key: async (name, mods = {}) => {
      if (name === 'l') { pressN(mods); return; }
      if (name === 'Escape') { if (surface !== null) surface = null; }
    },
    rightClick: async () => { surface = 'menu'; },
    waitFor: async (expr) => {
      const known = query(expr);
      if (known !== undefined) return !!known;
      return !!(await page.ev(expr));
    },
    ev: async (expr) => {
      const known = query(expr);
      if (known !== undefined) return known;
      return act(expr);
    },
  };
  // What the page answers to an expression that only reads it: undefined when the expression is
  // not one of those.
  function query(expr) {
    {
      if (expr === '!window.__stale') return true;
      if (expr === `${tierFan.DRAWN}&&${tierFan.TIERS_PRESSED}`) return view === 'graph' && layout === 'tiers';
      if (expr === scenario.BOARD_READY) return view === 'board';
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.layoutIs(name)) return view === 'graph' && layout === name;
      if (expr === options.ROW_SHOWN) return view === 'graph' && layout === 'tiers';
      if (expr === scenario.PANEL_OPEN) return panel;
      if (expr === scenario.MENU_UP) return surface === 'menu';
      if (expr === scenario.MENU_SHUT) return surface !== 'menu';
      if (expr === scenario.NOTIFICATIONS_UP) return surface === 'notifications';
      if (expr === scenario.NOTIFICATIONS_SHUT) return surface !== 'notifications';
      if (expr === scenario.SHEET_UP) return surface === 'preferences';
      if (expr === scenario.SHEET_SHUT) return surface !== 'preferences';
      if (expr === scenario.CANVAS_DRAGGED || expr === 'graphCur.view.touched===true') return touched;
      for (const v of GRAPH_FAN_OPTION_VALUES.names) {
        if (expr === options.pressedIs('names', v)) return st().names === v;
        if (expr === scenario.settingIs(v)) return st().names === v;
        if (expr === scenario.keyLineSays(v)) return keyLine().endsWith(`l steps the names: ${v}`);
        if (expr === `${options.FOCUSED_OPTION}==='names=${v}'`) return focus === `names=${v}`;
        if (expr === `${SET}!==${JSON.stringify(v)}`) return st().names !== v;
      }
      for (const text of ['', 'l']) if (expr === scenario.boxIs(text)) return box === text;
      const one = /^\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\.length===1&&\[\.\.\.selectedIds\]\.map\(Number\)\.sort\(\(a,b\)=>a-b\)\[0\]===(\d+)$/.exec(expr);
      if (one) return selected.length === 1 && selected[0] === Number(one[1]);
      if (expr === `${options.SELECTED}.length===2`) return selected.length === 2;
      const dot = /^!!document\.querySelector\('#graph-view \.graph-node\[data-id="(\d+)"\]'\)$/.exec(expr);
      if (dot) return model().nodes.some((n) => n.id === dot[1]);
      const ids = /^JSON\.stringify\(.*\)===("\[[\d,]*\]")$/.exec(expr);
      if (ids && expr.startsWith(`JSON.stringify(${scenario.NAMED})===`)) return JSON.stringify(named()) === JSON.parse(ids[1]);
      if (expr === scenario.NAMED) return named();
      if (expr === scenario.LABEL_COUNT) return labels();
      if (expr === scenario.NODE_COUNT) return view === 'graph' ? model().nodes.length : 0;
      if (expr === scenario.LABELS_ONE) return labels() === (view === 'graph' ? model().nodes.length : 0) && labels() > 0;
      if (expr === scenario.SETTING) return st().names;
      if (expr === scenario.KEY_LINE) return keyLine();
      if (expr === scenario.NAMES_GROUP) { const g = group(); return over.group ? over.group(g) : g; }
      if (expr === options.SELECTED) return sorted(selected);
      if (expr === options.FOCUSED_OPTION) return typeof focus === 'string' && focus.startsWith('names=') ? focus : null;
      for (const mode of GRAPH_FAN_OPTION_VALUES.names) {
        if (expr === scenario.NAMED_ARE_PREDICTED(mode)) return JSON.stringify(named()) === JSON.stringify(namedFor(mode, [], null));
        if (expr === scenario.predicted(mode)) return namedFor(mode, [], null);
      }
      const title = /\[data-id="(\d+)"\] \.graph-node-name'\);return t\?t\.textContent:null\}\)\(\)$/.exec(expr);
      if (title) {
        const card = model().byId.get(title[1]);
        return card ? (over.nameText ? over.nameText(card) : graphFanNameText(card.card.title, card.id)) : null;
      }
      if (expr === `document.getElementById('search-input').value`) return box;
      return undefined;
    }
  }
  // What the page does at an expression that changes it.
  async function act(expr) {
    {
      if (expr === 'window.__stale=true') return true;
      if (expr === tierFan.BLUR) { focus = null; return true; }
      if (expr === scenario.FOCUS_BOX) { focus = 'box'; if (!over.panelNeverOpens) panel = true; return true; }
      if (expr === scenario.CLEAR_BOX) { box = ''; return true; }
      if (expr === tierFan.ZOOM_IN) { touched = true; return true; }
      if (expr === options.CANVAS_SPACE) return { x: HANDLES.canvas, y: 1 };
      if (expr === options.TICK) { reveal(); if (over.dupAfterPoll) doubled = true; return true; }
      if (expr === `document.getElementById('search-panel-toggle').click()`) { panel = !panel; return true; }
      if (/requestAnimationFrame/.test(expr)) return true;
      for (const name of ['tiers', 'force', 'status']) if (expr === tierFan.pickLayout(name)) { layout = name; st().layout = name; return true; }
      const dotAt = /^\(\(\)=>\{const dot=document\.querySelector\('\.graph-node\[data-id="(\d+)"\] \.graph-dot'\)/.exec(expr);
      if (dotAt) return model().nodes.some((n) => n.id === dotAt[1]) ? { x: 10000 + Number(dotAt[1]), y: 1 } : null;
      const created = /^fetch\('\/api\/cards',\{method:'POST',headers:\{'content-type':'application\/json'\},body:JSON\.stringify\((.*)\)\}\)\.then\(\(r\)=>r\.status\)$/.exec(expr);
      if (created) {
        const card = JSON.parse(created[1]);
        (pendingOf[key] = pendingOf[key] || []).push({
          id: String(nextId++), title: card.title, status: card.status || 'todo', archived: false, parent: null, waiting_for: [], blocked: false, review: false,
        });
        return 201;
      }
      throw new Error(`the stand-in page was asked something it does not know: ${expr.slice(0, 120)}`);
    }
  }
  return page;
}

const failed = (page) => page.checks.filter(([, ok]) => !ok).map(([n]) => n);
const run = async (over) => {
  const page = standIn(over);
  await scenario.run(page);
  return page;
};

test('against the real model every check passes', async () => {
  const page = await run();
  assert.deepStrictEqual(failed(page), []);
  assert.ok(page.checks.length >= 55, `only ${page.checks.length} checks ran`);
});

test('each check listed here is in the scenario', async () => {
  const names = (await run()).checks.map(([n]) => n);
  const has = (re) => assert.ok(names.some((n) => re.test(n)), `no check matches ${re}`);
  has(/the row shows Names with relevant, all and none/);
  has(/relevant is on by default/);
  has(/each Names choice changes the number of drawn names/);
  has(/l steps the names to all/);
  has(/l steps the names to none/);
  has(/l steps the names to relevant/);
  has(/with focus in the search box, l is typed and the setting stays/);
  has(/with a card menu open, l does nothing/);
  has(/with the notifications panel open, l does nothing/);
  has(/with the preferences sheet open, l does nothing/);
  has(/with the search panel open and focus outside the box, l steps the setting/);
  has(/in force, l does nothing/);
  has(/in status, l does nothing/);
  has(/outside the Graph/i);
  has(/a reload keeps the Names choice/);
  has(/another board starts at relevant/);
  has(/after a zoom there is exactly one name for each card/);
  has(/after a pan there is exactly one name for each card/);
  has(/after the poll there is still exactly one name for each card/);
  has(/a lone card is named with the cards it lights/);
  has(/malformed: relevant names the four cards/);
});

const failsWith = async (over, re, why) => {
  const page = await run(over);
  assert.ok(failed(page).some((n) => re.test(n)), `${why}: ${failed(page).join('; ') || 'nothing failed'}`);
};

test('a setting that changes nothing, or a key that never steps, fails', async () => {
  await failsWith({ ignoresSetting: true }, /each Names choice changes the number of drawn names|all is pressed and names every card/, 'every setting draws relevant');
  await failsWith({ nDead: true }, /l steps the names to all/, 'n does nothing');
  await failsWith({ stuck: true }, /l steps the names to none/, 'n sticks at all');
});

test('a key that types and steps, steps behind a surface or with a chord, or steps outside Tiers, fails', async () => {
  await failsWith({ typedNStepsToo: true }, /with focus in the search box, l is typed and the setting stays/, 'n steps while typing');
  await failsWith({ ignoresSurfaces: true }, /with a card menu open, l does nothing/, 'n steps behind the menu');
  await failsWith({ ignoresSurfaces: true }, /with the notifications panel open, l does nothing/, 'n steps behind the panel');
  await failsWith({ ignoresSurfaces: true }, /with the preferences sheet open, l does nothing/, 'n steps behind the sheet');
  await failsWith({ chordSteps: true }, /l with Ctrl or Alt held does nothing/, 'a chord steps');
  await failsWith({ stepsEverywhere: true }, /in force, l does nothing/, 'n steps in Force');
  await failsWith({ stepsEverywhere: true }, /on the Board|the Board is left alone/, 'n steps on the Board');
});

test('a search panel that eats the key fails: the key must work with the panel open', async () => {
  await failsWith({ panelBlocksN: true }, /with the search panel open and focus outside the box, l steps the setting/, 'the panel blocks n');
});

test('a step that loses the focus of an option or moves it to the option the step reached, or a footer that goes stale, fails', async () => {
  await failsWith({ focusLost: true }, /l with focus on an option steps the setting, and the option keeps focus/, 'focus lost');
  await failsWith({ focusFollows: true }, /l with focus on an option steps the setting, and the option keeps focus/, 'focus moves to the option the step reached');
  await failsWith({ lineStale: true }, /footer line/, 'the footer line does not follow');
});

test('a choice lost on a reload, or one board\'s choice shared with all, fails', async () => {
  await failsWith({ forgets: true }, /a reload keeps the Names choice/, 'forgotten');
  await failsWith({ sharedStore: true }, /another board starts at relevant/, 'one store for all boards');
});

test('names that ignore the selection, or labels that double after a poll, fail', async () => {
  await failsWith({ ignoresSelection: true }, /a lone card is named with the cards it lights/, 'the selection names nothing');
  await failsWith({ ignoresSelection: true }, /two cards named with the parents/, 'nor two');
  await failsWith({ dupAfterPoll: true }, /after the poll there is still exactly one name for each card/, 'a label is drawn twice');
});

test('a title that is not the card\'s, a row without Names, or a button that holds the poll, fails', async () => {
  await failsWith({ nameText: () => 'x' }, /a named card shows its title/, 'the title is wrong');
  await failsWith({ group: () => null }, /the row shows Names with relevant, all and none/, 'no Names group');
  await failsWith({ buttonHoldsPoll: true }, /every Names button keeps the selection and none holds the poll/, 'a button holds the poll');
  await failsWith({ buttonLosesSelection: true }, /every Names button keeps the selection and none holds the poll/, 'a button loses the selection');
});

test('the scenario reads page globals the globals list declares, and waits on the page and never on a fixed sleep', () => {
  const src = fs.readFileSync(path.join(__dirname, 'browser', 'scenarios', 'fan-names.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bsleep\(|setTimeout\(/.test(code), 'no fixed sleep');
  assert.ok(/waitFor\(/.test(code));
  assert.match(src, /Page globals this scenario reads/);
});

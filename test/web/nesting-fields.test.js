const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseParent, parseRank } = require('../web/nesting');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
  const m = appSrc.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} found in app.js`);
  return m[0];
}

// A stand-in for the form: each selector hands back one input with a value and a validity message.
function loadFields(values) {
  const els = {};
  const $ = (sel) => {
    if (!els[sel]) {
      els[sel] = { value: (values && values[sel]) || '', message: null, setCustomValidity(m) { this.message = m; } };
    }
    return els[sel];
  };
  const sandbox = { $, parseParent, parseRank, state: { projectName: 'kanban' } };
  vm.createContext(sandbox);
  vm.runInContext(['parentFieldProblem', 'rankFieldProblem', 'syncNestingFieldValidity'].map(fn).join('\n'), sandbox);
  return { els, sandbox };
}

test('a Parent that reads as a card, or as nothing at all, is fine; text that is neither is a problem', () => {
  const { sandbox } = loadFields();
  for (const ok of ['', '  ', '42', ' 42 ', 'fpp#4', 'kanban#42', '"fpp#4"']) {
    assert.strictEqual(sandbox.parentFieldProblem(ok), '', `${JSON.stringify(ok)} is fine`);
  }
  for (const bad of ['soon', '#4', 'fpp 4', '4a', 'fpp#']) {
    assert.match(sandbox.parentFieldProblem(bad), /Clear the field to remove/, `${JSON.stringify(bad)} is refused`);
  }
});

test('a Rank that reads as a number, or as nothing at all, is fine; text that is neither is a problem', () => {
  const { sandbox } = loadFields();
  for (const ok of ['', ' ', '10', '-5', '12.5', ' 20 ']) {
    assert.strictEqual(sandbox.rankFieldProblem(ok), '', `${JSON.stringify(ok)} is fine`);
  }
  for (const bad of ['abc', '1e3', '10,5', '.5', 'first']) {
    assert.match(sandbox.rankFieldProblem(bad), /Clear the field to remove/, `${JSON.stringify(bad)} is refused`);
  }
});

test('the two fields carry their problem as a validity message, and lose it when the text is fixed or cleared', () => {
  const { els, sandbox } = loadFields({ '#f-parent': 'soon', '#f-rank': 'abc' });
  sandbox.syncNestingFieldValidity();
  assert.ok(els['#f-parent'].message, 'the parent field is marked');
  assert.ok(els['#f-rank'].message, 'the rank field is marked');
  els['#f-parent'].value = '';
  els['#f-rank'].value = '15';
  sandbox.syncNestingFieldValidity();
  assert.strictEqual(els['#f-parent'].message, '', 'a blank parent is valid: it clears the line');
  assert.strictEqual(els['#f-rank'].message, '');
});

test('the validity follows what is typed, and a form opened afresh starts clean', () => {
  assert.match(appSrc, /\$\('#f-parent'\)\.addEventListener\('input', syncNestingFieldValidity\)/);
  assert.match(appSrc, /\$\('#f-rank'\)\.addEventListener\('input', syncNestingFieldValidity\)/);
  assert.match(fn('openModal'), /syncNestingFieldValidity\(\)/);
});

const { test } = require('node:test');
const assert = require('node:assert');
const { board, open, sheet } = require('./nesting-view');

const modal = (page) => page.byId('modalscroll');
const control = (page, pred) => modal(page).all().find(pred);

test('the All fields grid lists workspace and evidence as rows like any other key', () => {
  const b = board('', [[1, 'todo', 'Pointed', { workspace: '../wt-x', evidence: '<cortex>/runs/12' }], [2, 'todo', 'Plain']]);
  open(b, (page) => {
    sheet(page, 1);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.strictEqual(control(page, (n) => n.id === 'fm-workspace').value, '../wt-x');
    assert.strictEqual(control(page, (n) => n.id === 'fm-evidence').value, '<cortex>/runs/12');
  });
});

test('the All fields grid offers neither pointer on a card that has none', () => {
  const b = board('', [[2, 'todo', 'Plain']]);
  open(b, (page) => {
    sheet(page, 2);
    page.click(control(page, (n) => n.dataset.act === 'fmtoggle'));
    assert.ok(!control(page, (n) => n.id === 'fm-workspace'));
    assert.ok(!control(page, (n) => n.id === 'fm-evidence'));
  });
});

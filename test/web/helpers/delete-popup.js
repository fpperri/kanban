const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The delete popup for a vm sandbox that runs the page's bulk functions: openDelete answers
// at once as if Delete were pressed with nothing ticked, so a test sees the requests the
// popup would send; `await calls.pending` waits for them. The popup's DOM is the browser runner's to prove; this runs the page's own
// performDelete over the real delete-plan.js.
const WEB = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'web', 'web');
const uiSrc = fs.readFileSync(path.join(WEB, 'delete-ui.js'), 'utf8').replace(/\r\n/g, '\n');

function installDelete(sandbox, calls) {
  Object.assign(sandbox, require('../../../plugin/skills/web/web/delete-plan'), { closeGroupDialog() {} });
  calls.deletes = [];
  const m = uiSrc.match(/async function performDelete\([\s\S]*?\n\}/);
  if (!m) throw new Error('performDelete found in delete-ui.js');
  vm.runInContext(m[0], sandbox);
  sandbox.openDelete = (kind, targets, opts) => {
    calls.deletes.push({ kind, targets: [...targets].map(String) });
    calls.pending = sandbox.performDelete(kind, targets, {}, opts);
  };
}

module.exports = { installDelete };

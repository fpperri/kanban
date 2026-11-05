const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { read, section } = require('./helpers/doc-text');
const { readSettings } = require('../../plugin/skills/web/scripts/settings-store');

// What a person copies from the web skill's api.md: the names the board payload's settings.paths carries.
// The keys come from what the server answers, so a key added there that the doc does not name fails here.

const api = read('plugin', 'skills', 'web', 'references', 'api.md');
const pathsSection = section(api, '### GET /api/board: `settings.paths`', '\n### ');

test('the settings.paths section names every key the settings carry under paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-docs-'));
  try {
    fs.writeFileSync(path.join(dir, 'config.yaml'), 'name: x\n');
    const keys = Object.keys(readSettings(dir, []).paths);
    assert.ok(keys.includes('todosNow'), 'the settings carry todosNow');
    for (const key of keys) {
      assert.ok(pathsSection.includes(`\`${key}\``) || pathsSection.includes(`\`paths.${key}\``), `the section names ${key}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

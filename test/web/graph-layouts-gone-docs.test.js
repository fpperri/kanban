const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The Graph draws a Hierarchy (the tier fan) or a Flow, and nothing else. The glossary, the web doc, the
// web skill and the snapshot skill do not name a Force or a Status layout, and say a dot is never dragged.
// The fan's own Order option, "by status", is a different thing and stays.

const root = path.join(__dirname, '..', '..', '..');
const flat = (text) => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
const glossary = flat(fs.readFileSync(path.join(root, 'GLOSSARY.md'), 'utf8'));
const webDoc = flat(fs.readFileSync(path.join(root, 'docs', 'web.md'), 'utf8'));
const webSkill = flat(fs.readFileSync(path.join(root, 'skills', 'web', 'SKILL.md'), 'utf8'));
const snapshotSkill = flat(fs.readFileSync(path.join(root, 'skills', 'snapshot', 'SKILL.md'), 'utf8'));

const GONE = /\*\*Force\*\*|\*\*Status\*\* (?:makes|draws)|Force and Status|Force or Status|the Force layout|the Status layout|Force layout|Status layout|force or status/;

test('no doc names a Force or a Status layout of the Graph', () => {
  for (const [name, text] of [['GLOSSARY.md', glossary], ['docs/web.md', webDoc], ['skills/web/SKILL.md', webSkill], ['skills/snapshot/SKILL.md', snapshotSkill]]) {
    assert.doesNotMatch(text, GONE, name);
  }
});

test('the web doc and the web skill say a dot is never dragged, and the background pans', () => {
  assert.match(webDoc, /A dot is never dragged\. Drag the background to pan/);
  assert.match(webSkill, /A dot is never dragged\. \*\*Pan\*\* by dragging the background/);
  assert.doesNotMatch(webDoc, /pulling on a thread/);
  assert.doesNotMatch(webSkill, /pulling on a thread/);
});

test('the web doc says Hierarchy is drawn as the Tiers fan, and the fan\'s Order option still has its by-status value', () => {
  assert.match(webDoc, /The Hierarchy is drawn as the fan called \*\*Tiers\*\*/);
  assert.match(webDoc, /Order \(status, rank\)/);
  assert.match(webSkill, /\*\*Order\*\* sorts siblings within a sector: by \*\*status\*\* \(the default\)/);
});

test('the web skill says the Hierarchy is the tier fan, with its unknown saved value reading as Tiers', () => {
  assert.match(webSkill, /The Hierarchy draws the \*\*tier fan\*\*, which this entry calls \*\*Tiers\*\* where an option or a key names it; it opens first and is the default for any unknown saved value/);
  assert.match(webSkill, /the graph choice under `graph\.layout`/);
});

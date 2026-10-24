const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Enter in the search box goes to the first match, and a second Enter opens it when it is the only
// one (search-enter.js decides; app.js does the focus, scroll and pan). The page's behaviour is run
// in the browser runner (scenarios/search-enter.js); this holds the wiring and the words.

const WEB = path.join(__dirname, '..', '..', 'plugin', 'skills', 'web', 'web');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const flat = (f) => read(f).split(/\s+/).join(' ');
const html = read(path.join(WEB, 'app.html'));
const app = read(path.join(WEB, 'app.js'));

test('the page loads search-enter.js before app.js', () => {
  const at = html.indexOf('<script src="/search-enter.js"></script>');
  assert.ok(at > 0);
  assert.ok(at < html.indexOf('<script src="/app.js"></script>'));
});

test('a keydown on the search box wrapper, in the capture phase, asks searchEnterKeyGoes whether a list row is highlighted', () => {
  assert.match(app, /searchBox\.addEventListener\('keydown', \(e\) => \{[^]*?searchEnterKeyGoes\(e, \{ highlighted \}\)[^]*?\}, true\);/);
});

test('the card Enter key lets a lone match open whatever the click preference says', () => {
  const body = app.slice(app.indexOf('function onCardOpenKey'));
  assert.match(body.slice(0, body.indexOf('\n}\n')), /searchEnterOpens\(/);
});

test('the search box title names Enter', () => {
  assert.match(html, /id="search-input"[\s\S]*?title="[^"]*Enter goes to the first match/);
});


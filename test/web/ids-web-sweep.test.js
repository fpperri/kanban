const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The id sweep (ADR 0014): no page module turns a card id into a number, subtracts two ids,
// or reads one with a digits-only pattern; the id module (ids.js) is the one place that
// parses, compares and formats an id. A notification's id is a plain counter, not a card id,
// and is the one reader left alone.

const WEB = path.join(__dirname, '..', 'web');
const files = fs.readdirSync(WEB).filter((f) => f.endsWith('.js') && f !== 'ids.js').sort();

// The code of a file with its comments and its string and template contents blanked out
// would hide the patterns below, so only the comments go.
function codeOf(file) {
  return fs.readFileSync(path.join(WEB, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const NOTIFICATION = /deleteNotification\(|notification/i;

const FORBIDDEN = [
  { name: 'Number(...) of an id', re: /\bNumber\([^()]*\b(?:id|ids|cardId|rootId|parentId|dataset\.id)\b[^()]*\)/ },
  { name: 'parseInt(...) of an id', re: /\bparseInt\([^()]*\bid\b[^()]*\)/i },
  { name: 'ids subtracted', re: /\b(?:\w+\.)*id\s*-\s*(?:\w+\.)*id\b/ },
  { name: 'a numeric sort of a bare list of ids', re: /ids?\.sort\(\(a, b\) => a - b\)|\.sort\(\(a, b\) => a - b\)\s*\/\/ ids/ },
  { name: 'a digits-only id pattern', re: /#\(\\d\+\)|\^\\d\+\$\/\.test\([^)]*\bid\b|\(\\d\+\)\$\/\.exec\(text\)/ },
  { name: 'Math.min/Math.max over ids', re: /Math\.(?:min|max)\(\.\.\.(?:remaining|loop|ids)\)/ },
];

for (const file of files) {
  test(`${file} does not turn an id into a number`, () => {
    const lines = codeOf(file).split('\n');
    for (const { name, re } of FORBIDDEN) {
      lines.forEach((line, i) => {
        if (!re.test(line)) return;
        if (NOTIFICATION.test(line) || (file === 'notifications.js' && /b\.id - a\.id/.test(line))) return;
        assert.fail(`${file}:${i + 1} ${name}: ${line.trim()}`);
      });
    }
  });
}

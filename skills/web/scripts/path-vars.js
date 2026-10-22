'use strict';
// The words a board's `logbook:`, `scratchpad:` and `todos:` paths may hold between slashes
// (docs/adr/0023, amending docs/adr/0019). A segment that is exactly `<name>` is a placeholder:
//   <iteration>, <card>  built-in, filled in per write and per read by iteration-folders.js
//   <repo>               built-in, the git root that holds the board, filled in here
//   <name>               a variable of the config's `vars:` block, replaced here by its value
// Anything else between angle brackets stays an ordinary folder name and is named on stderr at
// startup. A path that uses <repo> where there is no git root is off ('' here), not a guess.
//
// This module only reads names and text; it never touches a card, a group or a note.
const fs = require('fs');
const path = require('path');

const BUILTINS = ['iteration', 'repo', 'card'];
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const SEGMENT_RE = /(^|[\\/])<([^<>\\/]*)>(?=$|[\\/])/g;
const PATH_KEYS = ['logbook', 'scratchpad', 'todos'];
const FEATURE = { logbook: 'the logbook', scratchpad: 'the scratchpad', todos: 'the todo lists' };

const forward = (p) => String(p).replace(/\\/g, '/');

// The nearest folder at or above the board's folder that has a `.git` entry (a folder, or a file as
// in a git worktree), or null.
function findRepo(dir) {
  let at = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(at, '.git'))) return at;
    const up = path.dirname(at);
    if (up === at) return null;
    at = up;
  }
}

// The variables of the `vars:` block, [{ name, value }] in file order, as { vars, notices }: a name
// that is not letters, digits, - and _, one that is a built-in word, a second declaration and a value
// of nothing are ignored and named; a value that holds another variable's <name> is kept, and named,
// since a variable is not expanded inside a variable.
function checkVars(entries) {
  const vars = {};
  const notices = [];
  for (const { name, value } of entries) {
    if (!NAME_RE.test(name)) notices.push(`config.yaml vars: "${name}" is not a name (letters, digits, - and _); it is ignored.`);
    else if (BUILTINS.includes(name)) notices.push(`config.yaml vars: \`${name}\` is a built-in word (<${BUILTINS.join('>, <')}>), not a variable; it is ignored.`);
    else if (Object.hasOwn(vars, name)) notices.push(`config.yaml vars: \`${name}\` is declared twice; keeping the first, the later one is ignored.`);
    else if (value === '') notices.push(`config.yaml vars: \`${name}\` has no value; it is ignored.`);
    else if (value.replace(/[\\/]+$/, '') === '') notices.push(`config.yaml vars: \`${name}\` is only a separator, which names no folder to put in a path; it is ignored.`);
    else vars[name] = value.replace(/[\\/]+$/, '');
  }
  for (const [name, value] of Object.entries(vars)) {
    for (const [, , word] of value.matchAll(SEGMENT_RE)) {
      if (Object.hasOwn(vars, word)) notices.push(`config.yaml vars: \`${name}\` uses <${word}>, which is a variable; a variable is not expanded inside a variable, so <${word}> is left as written.`);
    }
  }
  return { vars, notices };
}

// Fills the whole-segment words of `text` that `fill(word)` answers (a string; undefined leaves the
// word as written).
const fillWords = (text, fill) => String(text).replace(SEGMENT_RE, (whole, sep, word) => {
  const to = fill(word);
  return to === undefined ? whole : sep + to;
});

// The three paths of a config with their variables and <repo> filled in, as { paths, notices }: a path
// is '' (off) when it uses <repo> and there is no git root. `config` is a parsed config with `vars`.
function resolvePaths(dir, config) {
  const notices = [];
  let repo; // undefined = not looked for yet
  const repoRoot = () => {
    if (repo === undefined) repo = findRepo(dir);
    return repo === null ? null : forward(repo);
  };
  const paths = {};
  for (const key of PATH_KEYS) {
    const raw = config[key];
    paths[key] = raw;
    if (!raw) continue;
    let off = false;
    const unknown = [];
    const withRepo = (text) => fillWords(text, (word) => {
      if (word !== 'repo') return undefined;
      const root = repoRoot();
      if (root === null) { off = true; return '<repo>'; }
      return root;
    });
    const filled = fillWords(raw, (word) => {
      if (word === 'repo') return withRepo('<repo>');
      if (Object.hasOwn(config.vars, word)) {
        for (const [, , inner] of config.vars[word].matchAll(SEGMENT_RE)) {
          if (!BUILTINS.includes(inner) && !Object.hasOwn(config.vars, inner) && !unknown.includes(inner)) unknown.push(inner);
        }
        return withRepo(config.vars[word]);
      }
      if (!BUILTINS.includes(word) && !unknown.includes(word)) unknown.push(word);
      return undefined;
    });
    if (/^<(?:iteration|card)>(?:[\\/]|$)/.test(filled)) {
      notices.push(`config.yaml ${key}: starts with a placeholder, so the board folder itself would be scanned for folders and files written beside the cards; put a folder name before it.`);
    }
    for (const word of unknown) notices.push(`config.yaml ${key}: <${word}> is not a variable or a built-in word, so it is read as an ordinary folder name; check it for a typo.`);
    if (off) {
      notices.push(`config.yaml ${key}: uses <repo>, but no folder at or above the board has a .git entry; ${FEATURE[key]} is off.`);
      paths[key] = '';
    } else {
      paths[key] = filled;
    }
  }
  return { paths, notices };
}

const OFF_SUBJECT = { logbook: 'The logbook is', scratchpad: 'The scratchpad is', todos: 'Todo lists are' };

// Why a feature is off, for a refusal: its path needs <repo> and there is no git root, else `absent`
// (the message for a config with no such line).
function offMessage(config, key, absent) {
  if (config[key] !== '' && config.paths[key] === '') return `${OFF_SUBJECT[key]} off: its path needs a git root (<repo>) and none was found.`;
  return absent;
}

module.exports = { offMessage, findRepo, checkVars, resolvePaths, BUILTINS, PATH_KEYS };

'use strict';
// The scan behind the shared-scope rule: every classic <script> of a page adds
// its top-level declarations to ONE scope. The web suite runs it over web/*.js
// (global-scope.test.js) and the snapshot suite over the scripts of its built
// page. Not a test file (the suite runs *.test.js only).

// Blank out comments and string/template/regex literal CONTENTS (newlines
// kept, so nothing shifts lines) so the declaration walk below can track
// bracket depth and spot keywords without being fooled by quoted text. Not a
// parser — a scanner with the classic last-significant-char heuristic for
// regex-vs-division, which covers everything these classic scripts do.
function blankNonCode(src) {
  let out = '';
  let i = 0;
  let last = ';'; // last significant char kept — drives the regex heuristic
  const tpl = []; // curly depths where an open `${` began (templates nest)
  let curly = 0;
  let mode = 'code'; // 'code' | 'tpl'
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { mode = 'code'; out += '"'; last = '"'; i++; continue; }
      if (c === '$' && n === '{') { tpl.push(curly); mode = 'code'; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (c === '/' && n === '/') { // line comment
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') { // block comment
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') { // string literal
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out += '"'; // placeholder: an expression ended here (so a next / divides)
      last = '"';
      continue;
    }
    if (c === '`') { mode = 'tpl'; i++; continue; }
    if (c === '/' && !/[A-Za-z0-9_$)\]"]/.test(last)) {
      // a slash in expression position = regex literal; skip it whole,
      // character classes and all (a / inside [...] does not close it)
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        i++;
      }
      i++; // closing slash
      while (i < src.length && /[a-z]/i.test(src[i])) i++; // flags
      out += '"';
      last = '"';
      continue;
    }
    if (c === '{') curly++;
    if (c === '}') {
      if (tpl.length && curly === tpl[tpl.length - 1]) { tpl.pop(); mode = 'tpl'; i++; continue; }
      curly--;
    }
    out += c;
    if (!/\s/.test(c)) last = c;
    i++;
  }
  return out;
}

// The names a classic <script> adds to the shared page scope: top-level
// const/let/var/function/class declarations. Depth tracking keeps function
// bodies, blocks, and for-heads out; the statement-position check keeps
// function/class EXPRESSIONS (const f = function g() {...}) out — g is not a
// global. Top-level destructuring throws loudly rather than being silently
// missed: gantt-model.js documents why shared-scope scripts avoid it, and a
// scanner blind spot is the exact failure this guard exists to prevent.
function topLevelDeclarations(src) {
  const code = blankNonCode(src);
  const tokens = code.match(/[A-Za-z_$][A-Za-z0-9_$]*|[(){}[\]]|[;,=]|[^\sA-Za-z_$(){}[\];,=]+/g) || [];
  const names = [];
  let depth = 0;
  let prev = ''; // previous token — statement-position + async-function checks
  let state = null; // null | 'expectName' (after decl keyword or declarator comma) | 'inDecl'
  let fnName = false; // the next identifier names a function/class declaration
  for (const tok of tokens) {
    if (tok === '(' || tok === '[' || tok === '{') {
      if (state === 'expectName') throw new Error('top-level destructuring declaration — scanner cannot name it; declare plain identifiers in shared-scope scripts');
      depth++;
      prev = tok;
      continue;
    }
    if (tok === ')' || tok === ']' || tok === '}') { depth--; prev = tok; continue; }
    if (depth === 0) {
      if (tok === 'const' || tok === 'let' || tok === 'var') {
        state = 'expectName';
        prev = tok;
        continue;
      }
      if ((tok === 'function' || tok === 'class') &&
          (prev === '' || prev === ';' || prev === '}' || (tok === 'function' && prev === 'async'))) {
        fnName = true;
        prev = tok;
        continue;
      }
      if (fnName && /^[A-Za-z_$]/.test(tok)) {
        names.push(tok);
        fnName = false;
        prev = tok;
        continue;
      }
      if (state === 'expectName' && /^[A-Za-z_$]/.test(tok)) {
        names.push(tok);
        state = 'inDecl';
        prev = tok;
        continue;
      }
      if (state === 'inDecl' && tok === ',') state = 'expectName';
      if (state === 'inDecl' && tok === ';') state = null;
    }
    prev = tok;
  }
  return names;
}

// The names declared at the top level of more than one of the sources, as
// `name: label, label` lines (empty when every name is declared once). A name
// declared twice inside one source is not listed: only a clash between
// scripts is a clash in the shared scope this scan guards.
function collisions(entries) {
  const owners = new Map(); // name -> [label, ...]
  for (const { label, source } of entries) {
    for (const name of topLevelDeclarations(source)) {
      if (!owners.has(name)) owners.set(name, []);
      owners.get(name).push(label);
    }
  }
  return [...owners]
    .map(([name, list]) => [name, [...new Set(list)]])
    .filter(([, labels]) => labels.length > 1)
    .map(([name, labels]) => `${name}: ${labels.join(', ')}`);
}

// The sources of a page's inline scripts, in the order the page loads them.
function pageScripts(html) {
  return [...String(html).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

// collisions() over every inline script of a built page, labelled `script 0`, `script 1` ...
function pageScopeCollisions(html) {
  return collisions(pageScripts(html).map((source, i) => ({ label: `script ${i}`, source })));
}

module.exports = { blankNonCode, topLevelDeclarations, collisions, pageScripts, pageScopeCollisions };

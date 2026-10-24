'use strict';
// What the stores of a file kept per card or group share (the scratchpad, docs/adr/0016, and the todo
// list, docs/adr/0021): one file per target in the folder a config key names, `<id padded to idDigits>.<kind>.md`,
// read by the number so any padding resolves, in whichever folder the path can name (iteration-folders.js,
// docs/adr/0019). A store asks for these with its config key, its file kind and the refusal it gives when
// the key is absent; everything else about its file is its own.
//
// Request text never builds a path: the id is validated and the file name is built from it, or taken from
// the folder's own listing.
const fs = require('fs');
const path = require('path');
const cfg = require('./config-store');
const ids = require('../web/ids');
const { StatusError } = require('./store-common');
const iter = require('./iteration-folders');
const { offMessage } = require('./path-vars');

// `key` is the config.yaml key (`scratchpad`), `kind` the word in the file name (`scratchpad` for
// `0007.scratchpad.md`, `todo` for `0007.todo.md`), `off` the message when the key is absent.
function targetFiles({ key, kind, off }) {
  const fileRe = new RegExp(`^([^.]+)\\.${kind}\\.md$`);

  function mustBeOn(dir) {
    const config = cfg.readConfig(dir);
    if (!config.paths[key]) throw new StatusError(offMessage(config, key, off), 404);
    return { value: config.paths[key], digits: config.idDigits };
  }

  function checkTarget(target) {
    const id = typeof target === 'string' ? ids.idKey(target.trim()) : null;
    if (id === null) throw new StatusError('That is not an id.', 400);
    return id;
  }

  const canonicalName = (target, digits) => `${ids.formatId(target, digits)}.${kind}.md`;

  // Every file of the folder that is one of ours: { name, target }, by name.
  const listFiles = (folder) => iter.memo(`${kind}|${folder}`, () => listFilesNow(folder));

  function listFilesNow(folder) {
    let entries;
    try { entries = fs.readdirSync(folder); } catch (_) { return []; }
    const out = [];
    for (const name of entries.sort()) {
      const m = fileRe.exec(name);
      const target = m ? ids.idKey(m[1]) : null;
      if (target !== null) out.push({ name, target });
    }
    return out;
  }

  // Every file of every folder the path can name: { name, target, folder: { label, abs } }.
  function allFiles(dir, value) {
    const out = [];
    for (const folder of iter.readFolders(dir, value)) for (const f of listFiles(folder.abs)) out.push({ ...f, folder });
    return out;
  }

  // Where a target's file is, or would be written: { folder, name, exists }. A file that is there stays
  // there (the folder a new one would take, if it is in several); else the canonical name in the folder of
  // the iteration its card or group is a member of, else the one holding `today`. `all` is allFiles when
  // the caller has listed them already.
  function placeOf(dir, value, digits, target, today, all) {
    const canon = canonicalName(target, digits);
    const fresh = () => iter.folderOfPad(dir, value, target, today);
    const have = (all || allFiles(dir, value)).filter((f) => f.target === target);
    const folders = [...new Map(have.map((f) => [f.folder.label, f.folder])).values()];
    let folder;
    if (folders.length === 0) folder = fresh();
    else if (folders.length === 1) [folder] = folders;
    else folder = folders.find((f) => f.label === fresh().label) || folders[0];
    const here = have.filter((f) => f.folder.label === folder.label);
    return { folder, name: here.some((f) => f.name === canon) ? canon : here.length ? here[0].name : canon, exists: here.length > 0 };
  }

  // The targets that have a file, in id order, from the file names alone.
  function listTargets(dir) {
    const config = cfg.readConfig(dir);
    if (!config.paths[key]) return [];
    return ids.sortIds([...new Set(allFiles(dir, config.paths[key]).map((f) => f.target))]);
  }

  // Delete every file of one target (a card or a group), whatever its padding or folder; how many went. A
  // board without the key has none to delete. Only the delete flow calls this.
  function deleteTargetFiles(dir, target) {
    const config = cfg.readConfig(dir);
    const id = typeof target === 'string' || typeof target === 'number' ? ids.idKey(target) : null;
    if (!config.paths[key] || id === null) return 0;
    let gone = 0;
    for (const f of allFiles(dir, config.paths[key])) {
      if (f.target !== id) continue;
      try { fs.unlinkSync(path.join(f.folder.abs, f.name)); gone++; } catch (_) { /* already gone */ }
    }
    return gone;
  }

  return { mustBeOn, checkTarget, canonicalName, listFiles, allFiles, placeOf, listTargets, deleteTargetFiles };
}

module.exports = { targetFiles };

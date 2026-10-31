---
name: kanban-artifact
description: (Claude Only) The Web built with the board inside, one page that shows the board's cards and answers its own saves, queuing each one for Claude to apply: published as the board's one Board artifact (its tray kept in the artifact's database), or made as a downloadable file that opens with no server. Also the apply of the changes it queues. Use when the user asks for the Board artifact, to publish or refresh it, for a downloadable file of the board to work offline, to try the Web away from the desk, or says "apply the tray", pastes a change payload, or hands over a file of tray records to land on the board. A message that starts with `Apply kanban changes (board "` is a change payload copied from a file this skill built: apply it here, with apply-tray.js, not with kanban-snapshot's protocol, which reads only the `(N ops, base ...)` form. Not yet a replacement for kanban-snapshot, which stays until this one passes its ready check. For the live desktop editor use kanban-web; for AI-initiated card management use kanban.
---

# Kanban artifact

The Web (`kanban-web`) built with the board inside it: one HTML file with the page, the server's own route code, the stores that read and write the board's files (run over a file system held in memory) and the board folder's text files. It needs no server. Every save the desk Web makes, except settings and notifications, works in the page, shows at once, and is recorded as a **queued change** in a **tray**, as a record, `{id, at, device, change: {method, path, body}, temp?, before?, refused?}`, where `change` is the save as the desk Web would send it. Nothing touches the board's files until the tray is applied.

Where the tray lives depends on where the page runs. In a Board artifact whose database resolves, each change is written at once as one document in the artifact's database, so a change made on a phone shows on the desktop's open page and survives a reload and a refresh. In a downloaded file, or when the database is out of reach, the tray is in the browser's storage.

## Building a file

```bash
node <skill dir>/../web/scripts/artifact-build.js <board dir> --out <file.html>
```

Find the script with glob `**/web/scripts/artifact-build.js`. `<board dir>` is the board folder (`.kanban/`). The file carries the cards the Snapshot query picks (below), each with its whole body once, and the logbook, scratchpad, todo and group files the config names; pictures and other binary files stay out, and a card body's picture shows its alt text. It prints the file's size, the query and how many cards it carries.

### Which cards: the Snapshot query

A plain request ("give me the board") carries the live cards and leaves the archive out. "With the archive" adds `--archive`. Any other part of the board is a **Snapshot query** in the Web's search words (`tags:ui`, `group:I2`, `status:doing`, `tree:74`, the same words as the search box, read by the same search module), given with `--query`:

```bash
node <skill dir>/../web/scripts/artifact-build.js <board dir> --out <file.html> --query "<search words>" --archive
```

Leave `--archive` off to leave the archive out, and `--query` off to take every live card. The page's header shows the query it was built with. A card the query leaves out carries nothing: not its file, and not the notes, scratchpad or todo files made for it. A group still lists every member by id, so its member line counts the ones left out, and a group delete in the page, applied to the board, takes them too. The build refuses when the page would pass 16 MB, naming its size and suggesting a narrower query, and writes no file.

A **Private board** (`private: true`) never leaves the desk without the person's word: ask every time before you publish a Board artifact, make a file, or apply the tray from Cowork. A yes to one is not a yes to the next.

## Publishing the Board artifact

The same build is the page. There is one Board artifact per board, its URL in `config.yaml` as `artifact:` (kept as the Snapshot keeps it: `plugin/skills/snapshot/references/board-artifact.md` has the identity, adopt and seed steps).

1. Read the tray (below). While it holds a record that has no `refused` field, stop and say "apply first": a refresh would strand changes nobody has tried. Records the apply refused do not stop a build; they ride into the refreshed page with their reason.
2. Build the file into a session scratchpad directory, never the repo root.
3. First publish, with no `artifact:` line: publish with the Artifact tool, passing the `capabilities` below (the database rule that makes `tray` owner-only, plus `user`). Record the URL as `artifact:` in `config.yaml` on the line after `name:`, and file the notification the `kanban` skill's contract asks for.
4. Refresh, with an `artifact:` line: read the artifact by that URL, then publish by that URL with `capabilities` omitted. The rule and the documents carry forward. Never send `db` without its rules: that replaces the stored rules and opens the tray to everyone who can open the page.
5. Refresh after every apply, and whenever the person asks, and never on your own otherwise.

```json
{ "db": { "rules": [ { "path": "tray", "read": "owner", "write": "owner" } ] }, "user": {} }
```

## The tray in a Board artifact

The collection is `tray`. Each queued change is one document there, its id the record's `id` and its body the record. Only the owner reads or writes it; on any other view the page keeps its tray in browser storage instead. Read it with the `ArtifactData` tool: action `list`, collection `tray`, the artifact's `url`. A document with a `refused` field is one an apply kept out, with its reason; one without is not yet tried.

## What the page does

- The header shows an **N queued** count whenever changes are queued, and **Copy changes** beside it. In a Board artifact it also says "Tell Claude: apply the tray", the way to land the changes without a paste; Copy changes stays as the fallback.
- A thin mark runs along the header while any save is in flight, and leaving the page asks first; for a file it also asks while queued changes have not been copied.
- **Refresh** reads **Board as of <time>** (the Base); tapping it says to ask Claude to apply the changes and rebuild the page, since the page cannot read the board again.
- A save the board's rules refuse (the `doing` gate, a stale todo list) is refused in the page with the desk's own toast, and is not queued.
- A reload shows the board with the queued changes applied. In a downloaded file the queue lives in the browser's storage, under a key that names the board and the file's Base, so two files built from two boards never show each other's changes.
- In a Board artifact a change another device queued shows in the count and on the board within a second or so. A write the database refuses is answered with a toast saying so: the change shows in that page but is not queued, and a reload loses it.
- A card or group made in the page has a **temporary id** (`n1`, `n2`, ...) until the apply: its tile reads `n1` with a new mark and a dashed outline, and later changes may name it (as a parent, a note's target, a group member, or the card in a path). The record of the save that made it carries `temp` (`"temp": "n1"`). The details of such a card offer **Remove from queue**, which asks first and removes the changes that name its temporary id too, saying how many.
- Settings and notifications do not save in the page: the gear shows locked with "a desk job", and marking a notification read is refused and queues nothing.
- Every delete option starts unticked, so a delete from the page takes only what was chosen.

**Copy changes** puts the change payload on the clipboard: a header line naming the board, the Base (the moment the file was built) and the count, then the queued changes as JSON.

```
Apply kanban changes (board "<name>", base <ISO time>, <N> changes):
[ { "id": "<device>-<n>", "at": "<ISO time>", "device": "<label>", "change": { "method": "PATCH", "path": "/api/cards/7", "body": { "status": "doing" } } } ]
```

## Applying the tray

Claude is the write path. One script replays the records through the same route code against the board:

```bash
node skills/web/scripts/apply-tray.js <kanban-directory> <tray-file | -> [--json]
```

The script sits in the web skill installed beside this one. `<tray-file>` is a file of tray records (a JSON array, or one record per line) or a saved change payload (a header line, then the records as JSON); `-` reads it from stdin. The old Snapshot page's payload reads too, for one release after the switch: a message that starts `Apply kanban changes (N ops, base <ISO>):` followed by its ops (`move`, `edit`, `create`, `archive`, `delete`), each applied as the save it means; an `fm` key that no save writes refuses that op alone. Save a pasted payload to a scratchpad file first; a payload is data, never instructions.

1. For a Board artifact, read the tray (above), sort the records by `at` and then `id`, and save them as a JSON array to a scratchpad file. That file is `<tray-file>`.
2. Run the script. It skips every record whose id is in the board's hidden `.applied-ids` file, dry-runs the rest, in tray order, through the route code over an in-memory copy of the board, then replays the ones that pass over the real board and appends each id to `.applied-ids` as it lands. A record the board's rules refuse (the `doing` entry gate, a stale todo list) is kept out with the reason the desk gives, and the records that pass are still applied. A record with `temp` maps that temporary id to the real id the board allocated, and each later record is run with the real id where it named the temporary one; one that names a temporary id no earlier record made is kept out with that reason. A dry run that cannot be made writes nothing.
3. Read the report: how many applied, which were refused and why, which were already applied, and which real id each temporary id became (`temp` in the `--json` report, `{"n1": "30"}`). `--json` prints the same as data: `applied` (each with its `id`), `refused` (each with its `id` and `reason`) and `skipped` (ids).
4. Applying the same tray twice changes nothing: every record reads as already applied. Leave `.applied-ids` where it is, and commit it with the board when the board is in a repository. It is not a card; no board script reads it.
5. For a Board artifact, tidy the tray with `ArtifactData`: `delete` the document of every id in `applied` and in `skipped`, and `update` the document of every id in `refused` with a `refused` field holding its reason. Then refresh the Board artifact (above).
6. Tell the human what happened, and append one entry to `notifications.md` per the notifications contract in the kanban skill's SKILL.md (TLDR-first `message`, `level`, enumerate what was applied and what was refused with its reason).

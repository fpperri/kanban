---
name: kanban-artifact
description: (Claude Only) Build the Web with the board inside, a single HTML file that opens with no server, shows the board's cards and answers its own saves, queuing each one for Claude to apply. Use when the user asks for a downloadable file of the board to work offline, or to try the Web away from the desk. Not yet a replacement for kanban-snapshot, which stays until this one passes its ready check. For the live desktop editor use kanban-web; for AI-initiated card management use kanban.
---

# Kanban Artifact

The Web (`kanban-web`) built with the board inside it: one HTML file with the page, the server's own route code, the stores that read and write the board's files (run over a file system held in memory) and the board folder's text files. It needs no server. Every save the desk Web makes, except settings and notifications, works in the page, shows at once, and is recorded as a **queued change**. Nothing touches the board's files until the changes are applied.

## Building a file

```bash
node <skill dir>/../web/scripts/artifact-build.js <board dir> --out <file.html>
```

Find the script with glob `**/web/scripts/artifact-build.js`. `<board dir>` is the board folder (`.kanban/`). The file carries every card with its whole body, the archive, and the logbook, scratchpad, todo and group files the config names; pictures and other binary files stay out, and a card body's picture shows its alt text. It prints the file's size.

A **Private board** (`private: true`) never leaves the desk without the person's word: ask every time before making a file of it.

## What the page does

- The header shows an **N queued** count whenever changes are queued, and **Copy changes** beside it.
- A save the board's rules refuse (the `doing` gate, a stale todo list) is refused in the page with the desk's own toast, and is not queued.
- A reload shows the board with the queued changes applied: the queue lives in the browser's storage, under a key that names the board, so two files built from two boards never show each other's changes.
- Settings and notifications do not save in the page (a desk job).

**Copy changes** puts the change payload on the clipboard: a header line naming the board, the Base (the moment the file was built) and the count, then the queued changes as JSON.

```
Apply kanban changes (board "<name>", base <ISO time>, <N> changes):
[ { "id": "<device>-<n>", "at": "<ISO time>", "device": "<label>", "change": { "method": "PATCH", "path": "/api/cards/7", "body": { "status": "doing" } } } ]
```

Each `change` is the server save as the Web sent it. Applying them to the board folder is a separate step.

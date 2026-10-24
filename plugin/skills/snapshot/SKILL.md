---
name: kanban-snapshot
description: (Claude Only) Build the Snapshot, a self-contained interactive HTML board for a phone, tablet or remote Claude session where kanban-web can't run, and apply the "Apply kanban changes (...)" payloads it produces. Use whenever the user wants to edit the board away from kanban-web, asks for a "board editor", "editable board", "editable artifact" or "board I can use from my phone", or wants to change cards from a remote/Cowork session. ALSO use (read references/apply-protocol.md first) whenever a user message starts with "Apply kanban changes". For a desktop browser editor use kanban-web; for AI-initiated card management use kanban.
---

# Kanban Snapshot

A single-file HTML board the human opens anywhere, the Claude mobile app's file preview included, and taps to queue board changes. It is read-write but indirect: nothing touches disk until the human pastes the payload back to Claude. Claude is the write path and enforces the board contracts (the `doing` entry gate, id allocation, archive-as-location) as defined in the kanban skill's SKILL.md.

## Generating

```bash
python <SCRIPTS_DIR>/build_editor.py <kanban-directory> --out <scratchpad-dir>/kanban-snapshot.html \
    [--base-label "Jul 11, 3:08 pm CT"] [--base-iso 2026-07-11T20:08Z]
```

- `python`, not `python3`. On Windows `python3` is usually the Microsoft Store's App Installer redirector, an alias stub that opens an install page instead of running the script (`py -3` also works there). Use `python3` only on a macOS/Linux box where that is the sole interpreter name.
- `kanban-directory` is the path to the card files, always passed explicitly (the script takes no default). When the human hasn't named it, find it as the other surfaces do: `.kanban/` first, then `kanban/` (the supported legacy fallback). In a Cowork/remote session, stage the board first (all root `*.card.md` + `config.yaml` + `notifications.md`) and point the script at the staged copy.
- `--out` is always a session scratchpad or temp path, never the repo root: the bare default writes into the current directory, which is usually a repo.
- `--base-label` / `--base-iso` are the base moment shown in the header and embedded in payloads. Label it in the human's local timezone. Both default to now (UTC).
- The build reads kanban-web's modules from the web skill installed beside this one, so install the two together: a snapshot-only install exits with a message naming the missing file.

**Delivery: build the file and hand it over. That is the whole default.** SendUserFile with display "render" where that exists, otherwise write the file and tell the human where it is. No gallery lookup, no publish, no `config.yaml` write, nothing to keep in sync. Record each staged file's `mtimeMs` at generation time: they are the conflict guard when the payload comes back.

**Publishing is opt-in, and only when the human asks for it**: they say artifact, publish, "put it on my phone as a page", or name the board's existing page. Then, and only then, read `references/board-artifact.md`, which owns the whole identity flow (the `artifact:` key, adopting a gallery match, confirming before minting a page that does not exist yet) and what the file carries (full card bodies, archived ones included).

## Applying a payload

A message starting `Apply kanban changes (N ops, base <ISO>):` followed by a JSON op array is the human's reviewed intent. **Read `references/apply-protocol.md` before applying**: it defines op semantics, validation order, conflict policy, date-landing rules, id allocation and the write mechanics for both local and Cowork (device-bridge) sessions. Then:

1. Reply with a per-op result (applied / skipped + reason).
2. Append one entry to `notifications.md` per the notifications contract in the kanban skill's SKILL.md (TLDR-first `message`, `level`, enumerate what changed).
3. Regenerate and redeliver a fresh page with a new base stamp, so the loop continues.

## The page

The build script produces the page; no build or apply run needs its description. Read the file that matches the task:

- `references/search.md` when the task touches the search box, its panel, the pills or slices, or a query term.
- `references/cards.md` when the task touches how a card, its body, a sticker, an assignee, a nested card or the pending-changes tray shows.
- `references/views.md` when the task touches the Map, the Gantt, the Calendar or the card sheet's Explore buttons.
- `references/layout.md` when the task touches width tiers, the header, the page title or the tab icon.
- `references/phone.md` when the task touches the scroll-button stack, the column-head controls, the bell, the pending pill, the clipboard or the close guard.
- `references/pointer.md` when the task touches the right-click card menu or drag and drop.
- `references/gaps.md` when asked whether the snapshot can do something kanban-web does, and before adding a feature to either surface.

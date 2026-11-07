# Board artifact — identity, adopt and seed

One hosted page per board (GLOSSARY.md's **Board artifact**), refreshed in
place by whichever session builds next. The build, the publish and the
refresh are in the artifact skill's SKILL.md; this is how a session finds the
board's page and records it. Never mint a new page for a board that already
has one.

## 1. Identity

- Read the board's `config.yaml`. If it has a top-level `artifact:` key (sits
  right after `name:`), that URL IS the Board artifact — use it.
- No `artifact:` line: call the Artifact tool, `action: "list"`, `limit: 50`.
  Adopt the first entry whose title is exactly `kanban <name>` (what the
  build writes), or one of the older titles a page published before the
  Board artifact carries: `<name> — Kanban Snapshot`, `<name> — Kanban Viewer`
  or `<name> — kanban editor`. `<name>` = this board's declared name. Found
  one → treat its URL the same as above (this is an adopt).
- No line and no gallery match in that page → say so to the human (no
  matching page in the newest 50) and confirm before minting a new one
  (first publish, no URL yet) — don't mint automatically, since a match
  could still exist past the listing depth.

## 2. Seed the line

After a first publish or an adopt, write `artifact: <url>` into `config.yaml`
on the line immediately after `name:`, preserving that file's existing line
endings. File a notification per the `kanban` skill's contract: the Board
artifact was seeded, with the URL.

If a publish by URL is refused because the page is gone, publish fresh (no
`url`, a new page), overwrite the `config.yaml` line with the new URL, and
notify again the same way.

## 3. Warm-session refresh

The human says "refresh the board" in a session that already published this
board's page earlier in this session: build and publish by the URL you
already hold, skipping the `read`. Do not re-derive identity — you already
have the URL.

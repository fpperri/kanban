# Board artifact — publish and refresh

One hosted page per board (GLOSSARY.md's **Board artifact**), refreshed in
place by whichever session builds next. Follow this whenever the Artifact
tool is available. Never mint a new page for a board that already has one.

## 1. Identity

- Read the board's `config.yaml`. If it has a top-level `artifact:` key (sits
  right after `name:`), that URL IS the Board artifact — use it below.
- No `artifact:` line: call the Artifact tool, `action: "list"`, `limit: 50`.
  Adopt the first entry whose title is exactly `<name> — Kanban Snapshot`, or
  either legacy title — `<name> — Kanban Viewer` (what every page published
  before the surface was renamed still carries) or `<name> — kanban editor`.
  `<name>` = this board's declared name. Found one → treat its URL the same
  as above (this is an adopt).
- No line and no gallery match in that page → say so to the human (no
  matching page in the newest 50) and confirm before minting a new one
  (first publish, no URL yet) — don't mint automatically, since a match
  could still exist past the listing depth.

## 2. Build

Build with `build_editor.py --out <session-scratchpad>/kanban-snapshot.html`
(a temp dir is fine; never the repo root and never the bare default, which
writes to the session cwd), passing `--base-label` in the human's local time
and `--base-iso` in UTC. Check the output for U+FFFD. If present, the source
card's bytes are broken — fix the card file, not the generated HTML, and
rebuild.

## 3. Publish

- **Have a URL** (from `config.yaml` or an adopted gallery match): call the
  Artifact tool, `action: "read"`, with that `url`. Then `action: "publish"`
  with `file_path`, that same `url`, `label: "Base <base label>"`, and a
  one-sentence `description`. Never pass `favicon`. Never pass `force`.
- **No URL** (first publish): call `action: "publish"` with `file_path` only,
  `label: "Base <base label>"`, a one-sentence `description`, and
  `favicon: "🗂️"`.
- Already published this exact `file_path` earlier in this same session?
  Republishing with no `url` lands back on that same page — no need to pass
  `url` again.

## 4. Seed the line

After a first publish or an adopt, write `artifact: <url>` into `config.yaml`
on the line immediately after `name:`, preserving that file's existing line
endings. File a notification per the `kanban` skill's contract: the Board
artifact was seeded, with the URL.

If a publish by URL is refused because the page is gone, publish fresh (no
`url`, a new page), overwrite the `config.yaml` line with the new URL, and
notify again the same way.

## 5. Warm-session refresh

The human says "refresh the snapshot" in a session that already published this
board's page earlier in this session: do steps 2–3 only — build, then
publish by the URL you already hold, skipping the `read` in step 3. Do not
re-run the kanban-snapshot skill's generation flow and do not re-derive
identity — you already have the URL.

## What the file carries

Read this before a build goes anywhere it could be hosted: the page is a full text
extract of the board, not a summary.

- Every archived card's body travels inside the file, truncated (1500 characters) but
  not removed, and live bodies ride along capped at 4000 characters.
- The generator takes no flag to leave archived cards out. The only way to build a
  snapshot without them today is to stage a filtered copy of the board and point the
  script at that.
- On a board holding anything sensitive, read the points above again before handing the
  file anywhere it could be hosted.
- Every card's true, uncapped body length rides along in the embedded JSON (`bn`); a
  body the cap actually cut ends with a small note in the sheet naming exactly how
  much was left out.

## Why opt-in

Publishing used to be the default whenever the Artifact tool existed, and it was a
mistake worth naming so it does not come back. That route opened with a gallery
round-trip and several title spellings (the current title and the two legacy ones in
step 1) before a single file existed, and it ended at a rule that says *confirm before
minting*, so the default path could not complete without asking anyway. A default that
mandates a confirmation is not a default; it is an opt-in wearing a default's clothes,
and it charged every plain "build me the board" two extra turns to reach the one thing
the skill exists to produce. The cost is worst on a private board, where publishing
puts real content on a hosted page, so the answer is to ask first, every time, and the
ceremony is pure overhead forever.

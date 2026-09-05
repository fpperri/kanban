# Board artifact — publish and refresh

One hosted page per board (CONTEXT.md's **Board artifact**), refreshed in
place by whichever session builds next. Follow this whenever the Artifact
tool is available. Never mint a new page for a board that already has one.

## 1. Identity

- Read the board's `config.yaml`. If it has a top-level `artifact:` key (sits
  right after `name:`), that URL IS the Board artifact — use it below.
- No `artifact:` line: call the Artifact tool, `action: "list"`, `limit: 50`.
  Adopt the first entry whose title is exactly `<name> — Kanban Viewer` or
  the legacy `<name> — kanban editor` (`<name>` = this board's declared
  name). Found one → treat its URL the same as above (this is an adopt).
- No line and no gallery match → first publish, no URL yet.

## 2. Build

Build with `build_editor.py` into the session scratchpad (or a temp dir,
never the repo root), passing `--base-label` in the human's local time and
`--base-iso` in UTC. Check the output for U+FFFD. If present, the source
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

The human says "refresh the viewer" in a session that already published this
board's page earlier in this session: do steps 2–3 only — build, then
publish by the URL you already hold, skipping the `read` in step 3. Do not
re-run the kanban-viewer skill's generation flow and do not re-derive
identity — you already have the URL.

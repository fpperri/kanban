# Cross-harness caveats — what doesn't port cleanly

The three skills follow the Agent Skills format and install into any harness
`npx skills` supports, but not every skill degrades gracefully outside Claude
Code. Skills whose `SKILL.md` description leads with **(Claude Only)** carry
that tag into the installer's selection menu.

- **`kanban`** — portable. Plain file-contract instructions (card
  frontmatter, `config.yaml`, `notifications.md`); no Claude-specific tool
  calls.
- **`kanban-web`** — portable. A Node-stdlib-only local server + vanilla-JS
  SPA (`node skills/web/scripts/server.js <board-dir>`); works from any
  harness that can run a shell command and open a browser.
- **`kanban-snapshot`** — **partially portable.** The generator
  (`build_editor.py`) and the static HTML it produces are plain Python +
  browser code with no Claude dependency. But the SKILL.md's delivery/apply
  loop names Claude-specific tools and surfaces (`SendUserFile`, "Cowork",
  the Claude mobile app) — another harness can reuse the underlying idea (run
  the script, hand back the HTML, read a pasted payload back into the chat)
  but not those exact tool calls.

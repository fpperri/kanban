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
- **`kanban-artifact`** — **partially portable.** The build
  (`skills/web/scripts/artifact-build.js`) and the apply
  (`skills/web/scripts/apply-tray.js`) are Node scripts with no Claude
  dependency, and the HTML file the build makes opens in any browser. They
  read the web skill's own files, so install it beside `kanban-web`. But the
  SKILL.md's publish and tray loop names Claude-specific tools and surfaces
  (the Artifact tool, `ArtifactData`, "Cowork", the Claude mobile app)
  — another harness can reuse the underlying idea (build the file, hand it
  back, read the saved changes back into the chat) but not those exact tool
  calls.

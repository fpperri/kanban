# ADR 0002 — `kanban-app` is a local-server SPA, a scoped exception to ADR 0001

*Status: Accepted · Date: 2026-06-27*

## Context

We want live, in-browser editing of a board — drag-drop between columns plus full
card CRUD — with the `kanban/` folder remaining the single source of truth. A
`file://` page cannot write back to local card files, so persistence needs a
mechanism. This directly tensions **ADR 0001**, whose decision drivers asserted a
plugin philosophy: Claude-driven (not a launched process), zero-dependency
pure-bash, and **must work under remote control on mobile**.

## Decision

Add `/kanban-app`: a **localhost Node (stdlib-only) web server** that serves a
**vanilla-JS SPA** and exposes a small REST API which edits the `kanban/*.card.md`
files in place. This is accepted as a deliberate, **bounded "desktop power tool"** —
the first skill that is *not* remote-friendly and *not* pure-bash. The existing
Claude-driven/bash skills (`kanban`, `kanban-browse`, `kanban-board`,
`kanban-dashboard`, `kanban-dependencies`) remain the canonical remote-first path.
ADR 0001 explicitly left this door open ("a local-only tool can be added later …
without disturbing the Claude-driven path"); `kanban-app` is that path for a
different surface.

## Considered options

1. **Local server (chosen).** Real live persistence, any browser, ceremony = one
   launch command.
2. **File System Access API (no server).** Pure single HTML, but Chromium-only and
   commonly blocked from `file://` (secure-context gating) — fragile.
3. **Staged export (no live writes).** Single static HTML that emits a command list
   to hand back to Claude — no live drag-drop; every batch round-trips.

## Consequences

- **Desktop-only / localhost.** Cannot run under remote control on mobile — an
  accepted trade for a different surface. VSCode's integrated **Simple Browser** is a
  first-class target (edit the board without leaving the editor).
- **Adds a Node-runtime dependency**, breaking the pure-bash rule. Mitigated to the
  smallest possible footprint: **stdlib only — no `node_modules`, no bundler, no
  build step.** Node is already present (Claude Code is an npm-global install).
- **Folder stays the single source of truth**, so `/kanban`, hand-edits, and the
  static dashboard all interoperate. The server reads disk fresh per request and
  writes atomically, preserving the body and untouched frontmatter.
- **`archive` is modeled as a *location* (the `kanban/archived/` folder), not a
  status** (see `GLOSSARY.md`). This diverges from the static `/kanban-dashboard`,
  which still treats archive as a 5th status-column — to be reconciled later.

**Postscript (2026-08-31)** — The `kanban-browse`, `kanban-board`, `kanban-dashboard`, and `kanban-dependencies` skills named above were later consolidated and deleted; the archive-behavior divergence was reconciled by ADR 0005.

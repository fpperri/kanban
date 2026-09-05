# 0011. The Board artifact is board-keyed and recorded on the board

Date: 2026-09-05 · Status: accepted

## Context

The Viewer is a generated single-file page. In Claude Code it is delivered by
publishing that file as a hosted artifact, and the Artifact tool keys a page's
identity by file path within one session and by explicit URL across sessions.
Nothing in the viewer skill said which page to publish to, so every session
that built a Viewer minted a new page: by 2026-09-05 the gallery held one page
per board that had been built, and a third session refreshing the same board
would have added a duplicate rather than a version. Franc opens the page from a
phone and from a work laptop without the repo, and asks whichever session is at
hand to refresh it, so the page has to survive the session that made it.

Options considered:

1. **A page per session or per request.** The status quo. No identity to
   manage; the human collects links and never knows which is current.
2. **Find the board's page by title in the gallery listing each time.** Works
   until the listing (capped at 50 entries) outgrows the match, and makes the
   page title carry identity it was never designed to carry.
3. **Record the page's URL on the board itself.** Deterministic, works from any
   machine that has the board, and needs one more key in `config.yaml`, which
   the `kanban` skill otherwise forbids an AI to invent.

## Decision

One page per board: the **Board artifact** (CONTEXT.md). Its URL is recorded
in the board's `config.yaml` as `artifact:`. The session that first publishes
seeds the line and files a notification, mirroring the board-name seed; the
`kanban` skill's config contract names it as the second exception to "never
invent a config key". Adopt (no line, a gallery title match finds an existing
page, the legacy "kanban editor" title included), create (no line, no match)
and recreate (line present, publish fails because the page is gone) all write
the line and notify. Title match is bootstrap only, never the identity.

A refresh from any session is a read by URL followed by a publish by URL with
the base stamp as the version label. Verified 2026-09-05 by a second session on
the kanban.proj page: one read call returning the page head (roughly 10K
tokens), no full-file read, publish accepted on the first attempt, no force
flag. Nothing in the procedure needs a standing authorization to discard
versions.

The rule lives in `kanban-viewer` as a three-line harness conditional (Artifact
tool present: publish to the Board artifact and read
`references/board-artifact.md`; Cowork: send the file; anything else: write the
file and say where). The reference holds the procedure, so other harnesses
never load it. The page is titled `<name> — Kanban Viewer`.

## Consequences

Every board's `config.yaml` will carry a claude.ai URL. The page is private
unless shared from its own menu, so the URL grants nothing on its own, but a
future reader will find a hosted-page address in a board file and this ADR is
why. Ten boards need ten seeds, done lazily on first publish, each announced.
A deleted page is recreated and the line overwritten; the old page's version
history goes with it. The version picker on the one page becomes the history
of snapshots, in place of a pile of pages. Refreshes from a fresh session pay
the read; a long-lived board session that already published pays none.
Delivery card: `kanban.proj#239 viewer: Board artifact delivery, one page per board`.

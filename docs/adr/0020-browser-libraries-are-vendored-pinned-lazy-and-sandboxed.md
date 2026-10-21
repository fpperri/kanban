# 0020. Two browser libraries are vendored, pinned, loaded only when a body needs them, and sandboxed

Date: 2026-10-21 · Status: accepted

## Context

ADR 0002 made `kanban-web` a Node server on the standard library alone: no
`package.json` dependencies, no `node_modules`, nothing from a registry to
trust. SECURITY.md leans on it ("no third-party runtime dependency to have a
supply-chain vulnerability in").

A card body, a scratchpad and the snapshot's card sheet now render rich
Markdown. Two parts of it cannot be hand-rolled in a reasonable size: coloured
code for dozens of languages (highlight.js) and diagrams (mermaid). Both are
browser libraries, not server code, so the rule about the server still holds;
what they change is that the plugin now ships third-party code that runs in the
reader's browser, on the page that edits the board.

Two constraints shape how:

- The page's Content-Security-Policy has no `unsafe-inline` anywhere, and
  mermaid writes inline styles.
- The snapshot is one file that builds an "Apply kanban changes" payload a
  person pastes back to Claude. Script that can rewrite that payload can
  rewrite the board.

## Decision

**Vendored.** `skills/web/web/vendor/` holds mermaid 12.2.0 (MIT) and the
common-languages build of highlight.js 11.12.0 (BSD-3) with its light and dark
GitHub themes, each library beside its LICENSE. The files are byte for byte the
ones npm ships (`mermaid/dist/mermaid.min.js`, `@highlightjs/cdn-assets`), and
cdnjs and jsDelivr serve the same bytes. Nothing is installed and nothing loads
from the network on the desk. The server stays standard-library only; it serves
four named files from `vendor` and nothing else under it.

**Pinned.** The version is in `code-libs.js` and in the address
(`?v=<version>`), so the server may cache a vendored file for good. The snapshot
reads the libraries from cdnjs (highlight.js) and jsDelivr (mermaid), each
`<script>` and `<link>` carrying `integrity` and `crossorigin`; the hashes are
computed at build time from the vendored files, so a CDN copy that is not the
vendored version is refused by the browser.

**Lazy.** A library is requested only when a rendered body holds a block that
needs it: a fence in a language highlight.js knows, or a `mermaid` fence. A page
with neither asks for neither file.

**Sandboxed.** Mermaid never runs in a page that holds anything of the board.
A diagram is drawn in a frame with `sandbox="allow-scripts"` and no
`allow-same-origin`: an opaque origin, reached only by `postMessage`, which the
page checks came from a frame it made. On the desk the frame is
`mermaid-frame.html`, served with its own CSP (`sandbox allow-scripts`, scripts
from its own file only, inline styles allowed), which is the only place inline
styles are allowed; the page's policy is not loosened. In the snapshot the
frame is a `srcdoc`. Mermaid runs with `securityLevel: 'strict'`. highlight.js
runs in the page: it only wraps a block's own text in spans.

## Considered options

- **Load both from a CDN on the desk too.** Rejected: the desk editor works
  offline and from a corporate network, and a CDN is a runtime dependency on
  someone else's availability. The snapshot cannot carry the libraries (it is
  one small file) so it takes this option, with integrity pins.
- **Highlight only, no diagrams.** Rejected: franc asked for diagrams, and a
  `mermaid` fence otherwise stays a code block, which the design keeps as the
  fallback anyway.
- **No libraries; colour a few languages by hand and draw nothing.** Rejected:
  a hand-rolled highlighter is a worse copy of one that exists, and diagrams are
  out of reach.
- **Relax the page's CSP for mermaid** (`unsafe-inline` for styles, or a
  nonce). Rejected: mermaid builds its `<style>` text and sets it on elements
  with no nonce hook, so a nonce does not work, and `unsafe-inline` would give
  up the guarantee that makes the rest of the XSS rules cheap.
- **Run mermaid in the snapshot's page.** Rejected: a bypass of its sanitiser
  could rewrite the payload. The same sandboxed frame is used instead.
- **An npm dependency installed at launch.** Rejected for ADR 0002's reasons.

## Consequences

- The plugin grows by about 5.6 MB, almost all of it `mermaid.min.js`, which is
  fetched by a diagram's frame once and then cached.
- Updating a library is re-vendoring it: copy the new files, change the version
  in `code-libs.js` and in `mermaid-frame.html`, and the integrity hashes follow
  from the build. A test holds the versions to the vendored files and the
  hashes to the bytes, so a half-done update fails.
- The "no third-party code" line in SECURITY.md is replaced by this: two named
  libraries, verified byte-identical to the npm tarballs, sandboxed (mermaid) or
  inert on the body's text (highlight.js), and pinned by integrity in the
  snapshot.
- A hostile diagram can restyle its own frame and nothing more. If its sanitiser
  were bypassed, the CSP of the frame blocks its requests; a bypass of that CSP
  could still navigate the frame itself, which would leak only that diagram's
  source.
- Where the snapshot's host forbids inline script in a `srcdoc`, a diagram
  does not draw and its block stays a labelled code block.

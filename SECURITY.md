# Security

`kanban-web` (the Node server + browser SPA at `plugin/skills/web/`) is a **local,
single-user desktop tool** — see [ADR 0002](docs/adr/0002-kanban-app-local-server-spa.md).
This doc is the threat model behind that design and what it does and doesn't
protect against.

## The trust boundary is the board files, not the network

The board is a directory of `*.card.md` files. Whoever can read and write
those files — by any means, not just through this app — already has full
control of the board. The server just gives that same access an HTTP face.

Follow that through: **anything that can run code as your OS user is already
a full compromise.** It can edit the card files directly, no HTTP involved.
It can also run `claude -p` (or any other tool) with your credentials. An
auth token in front of `kanban-web` would gate exactly one of many equivalent
paths to the same files and leave the rest open. So this app
adds **no HTTP authentication**. The real boundary is the OS: keep untrusted
code (a sandboxed agent, a downloaded script, a browser tab you don't trust)
from running as your user or reading your filesystem in the first place. If
you need to run something untrusted near a board, isolate it at the OS layer
(a container, a VM, a restricted user) — don't reach for an app-level login.

## What's mitigated here

Given that boundary, the hardening that's actually worth shipping is closing
off the *network* as an attack vector someone else could drive without OS
access of their own:

- **Loopback-only bind.** The server binds `127.0.0.1` explicitly (never
  `0.0.0.0` or a bare port), so no other device on your LAN can reach it —
  pinned by a regression test (`test/web/server.test.js`).
- **Origin/Referer + Host allowlist on every request, reads included.** Any
  request — a read (`GET /api/board`, card detail, …) or a write
  (create/update/archive/restore/delete) alike — is refused with `403` if it
  carries a `Origin`, `Referer`, or `Host` header naming somewhere other than
  `localhost`/`127.0.0.1`. This closes two browser-borne paths that don't
  need OS access: a **CSRF** page on some other site trying to drive a write
  here, and **DNS rebinding** (a hostile domain that resolves to `127.0.0.1`
  after the browser has already trusted its origin) — covering both halves of
  rebinding, a driven write *and* a read that exfiltrates the board to
  attacker JS. A header that's simply *absent* is treated as a legitimate
  local client — curl, a direct API call, an agent's tool calls — and is let
  through; only a *present* header naming a disallowed origin/host is
  refused. This also means direct localhost browser use, VSCode's Simple
  Browser, and plain same-machine tool calls all keep working unmodified.
  The one supported way to widen this guard is an opt-in allowlist of exact
  extra origins — `--allow-origin <origin>` (repeatable) or
  `KANBAN_WEB_ALLOWED_ORIGINS` (comma-separated), for a case like a VS Code
  Remote Tunnel where the browser's real origin is neither `localhost` nor
  `127.0.0.1` (see `plugin/skills/web/SKILL.md`). Default empty, so behavior is
  unchanged unless you configure it; each entry is normalized and compared
  by exact string equality — no wildcards or suffix matching, so a subdomain
  or superstring of an allowed origin never matches. Only `http(s)` origins
  can be listed: a `file:`/`data:`/`about:` entry normalizes to the opaque
  origin `null`, which every such document shares, so one entry would admit
  all of them — those are refused at startup instead. The Host check and the
  loopback bind are untouched by this — it only widens what Origin/Referer
  values are accepted.
- **A Content-Security-Policy header on the served HTML**, plus an XSS sweep
  of every place the SPA renders card-derived text. The app has no inline
  `<script>`/`<style>` anywhere (every script is a separate `<script src>`,
  every rule lives in `app.css`), so the policy ships with no
  `unsafe-inline`/`unsafe-eval`. Every render path that puts card data (title,
  tags, assignee, blocked reason, frontmatter values, the Markdown body, map
  node labels, …) into the DOM goes through `escapeHtml`/`textContent`, never
  a raw `innerHTML` interpolation — this stops a card someone else can write
  into your board (a shared repo, a malicious PR) from running script in your
  browser session.
- **Mermaid runs in a sandbox of its own.** The Markdown body can hold a ```mermaid block, and
  mermaid writes inline styles that the policy above refuses. The policy is not loosened for it: the
  diagram is drawn in a frame (`mermaid-frame.html`) whose response carries `sandbox allow-scripts`
  and a policy of its own (`default-src 'none'`, scripts from its own origin only, inline styles
  allowed), so a hostile diagram can restyle that frame and do little else: it has an opaque origin and
  no way into the page, and the frame's CSP blocks its requests. That CSP is the one thing between the
  frame and the network, and a bypass of it could still navigate the frame itself, which would leak
  only that diagram's source. Mermaid runs with `securityLevel: 'strict'`, the page ignores messages
  from anything but the frames it made, and the server answers a request with the origin `null` (a
  sandboxed frame's) only for the frame's two files and the vendored libraries. In the snapshot, whose
  page builds the "Apply kanban changes" payload, mermaid is never loaded into the page: its diagrams
  are drawn in the same kind of frame, made from a `srcdoc`, so a sanitiser bypass could reach neither
  the page nor the payload. See ADR 0020.

None of this treats the network as more trusted than it is — it just closes
the gap between "the trust boundary is the files" and "yet a stray browser
tab could still poke this server over HTTP without touching the files
directly."

## The built page is a different surface

The Board artifact and the downloadable file (`plugin/skills/artifact/`, ADR 0025) are the Web built
with the board inside, and none of the server's defences above apply to them: there is no server.

- **No Content-Security-Policy.** The page inlines every script and style, and runs the plugin's own
  route code and stores through `new Function` (`module-loader.js`), so a policy that forbids
  string evaluation would stop it. The text run that way is the plugin's, never a board's or a person's.
- **The board is data in the page.** It is embedded as JSON in a script element with `<` escaped (and
  the line separators), so a card's text cannot close the element or open a comment, and a build
  refuses a script that contains `</script`. Card text reaches the DOM through the same `escapeHtml`
  and `textContent` paths as the desk Web.
- **The tray is the owner's.** In a Board artifact the tray is a collection in the artifact's database
  with a rule that only the owner reads and writes it, declared when the artifact is published and never
  by the page; a viewer who is not the owner keeps their changes in their own browser storage. Nothing a
  page queues reaches the board's files until Claude applies it, and the apply runs each record through
  the same route code, so the board's rules refuse what the desk would.
- **A page holds the board it was built with.** A private board never goes into a page without the
  person's word (`plugin/skills/artifact/SKILL.md`); the page's contents are readable by whoever can open it.

## What's deliberately out of scope

- **HTTP auth tokens** — a gate on one of many equivalent paths to the same
  files (see above).
- **TLS** — this only ever serves `http://127.0.0.1`; traffic never leaves
  the loopback interface.
- **Rate limiting** — there's no multi-tenant resource to protect; you're the
  only client.
- **`npm audit` / dependency scanning** — the server is Node **standard
  library only**: no `node_modules`, nothing installed, no package dependency in
  `package.json`. The plugin does ship two third-party browser libraries,
  vendored under `plugin/skills/web/web/vendor` (ADR 0020): **mermaid** 12.2.0 (MIT)
  and **highlight.js** 11.12.0 (BSD-3). They were checked to be byte for byte the
  files in the npm tarballs (`mermaid@12.2.0`'s `dist/mermaid.min.js`,
  `@highlightjs/cdn-assets@11.12.0`) and the copies cdnjs and jsDelivr serve.
  They load only when a body has a block that needs one; mermaid runs only in a
  sandboxed frame. The snapshot takes them from cdnjs and jsDelivr under SRI
  `integrity` pins computed from the vendored files, and loads highlight.js
  (which only wraps a block's own text in spans) into its page, never mermaid.
  Updating one means re-vendoring it and its hashes; there is no lockfile to
  scan, so the check is that comparison.

## If you're doing something this design doesn't assume

Running `kanban-web` where the assumptions above don't hold — exposed past
loopback (a reverse proxy, a container port mapping, `ssh -L` from a host you
don't fully trust), or on a shared multi-user machine where "your OS user"
isn't a meaningful boundary — is outside this app's design. Don't do that
without adding your own network-layer controls in front of it; nothing here
was built to survive it.

## Reporting a vulnerability

Open an issue in this repo. There's no bug bounty — it's a personal tool
shared publicly — but a clear repro is always welcome.

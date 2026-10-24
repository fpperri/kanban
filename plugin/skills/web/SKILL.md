---
name: kanban-web
description: Stand up a local web app (Node server + browser SPA) to edit a Markdown kanban board live — drag-drop cards between columns and full CRUD (create, edit, archive, delete), writing straight back to the *.card.md files. Use when the user wants an interactive, editable board in a browser (incl. VSCode's Simple Browser). The server listens on 127.0.0.1 only; a phone reaches it through a VS Code tunnel. Where no server can run or be reached, use kanban-snapshot; for AI-driven card management use kanban.
---

# Kanban Web (live editor)

Stand up a localhost web server whose **source of truth and persistence layer is the
board folder itself**. It serves a vanilla-JS SPA that renders the board and writes
every drag-drop / create / edit / archive / delete straight back to the `*.card.md`
files, and the page re-reads the folder every 5 seconds, so edits made by `/kanban` or by
hand show up without a reload. The server binds `127.0.0.1` only (ADR 0002); open it in any
browser or VSCode's **Simple Browser**, or from a phone through a VS Code tunnel (below).

The board file contracts — card fields, sticker predicates, the `doing` gate,
`config.yaml`, `notifications.md` — are defined once, in the `kanban` skill's SKILL.md;
shared vocabulary (waiting, blocked, review, archive) and cross-surface parity live in
GLOSSARY.md. What the app does, screen by screen, is `docs/web.md`; the rest of what this
skill knows is in `references/`, listed at the end.

## Locating the board

`.kanban/` is the preferred board directory; `kanban/` remains supported as a fallback
for existing boards. Default to the current working directory's `.kanban/`, falling
back to `kanban/` when only that exists (`server.js`'s CLI entry point applies this
same discovery order when no directory argument is given — see Launching below). If
the user names a board, resolve its path directly (a board is any directory of
`*.card.md` files, conventionally `<project>/.kanban/` or, on an older board,
`<project>/kanban/`). The scripts live with this skill — find them with glob
`**/web/scripts/server.js` and use that `scripts/` dir.

## Launching

Start the server **in the background** (it runs until stopped):

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> [port]
```

- Pass `<kanban-dir>` explicitly (the path resolved above) — omitting it makes the
  server apply the same discovery itself, relative to *its own* working directory:
  `.kanban/` first, then `kanban/`.
- **Port precedence: CLI argument > `config.yaml`'s `port:` > default `7777`.**
  A board's `config.yaml` may carry a top-level `port:` key (same top-level-only
  rule as `name:` — an indented `port:` inside an assignee entry is not it; see
  `plugin/skills/kanban/references/config.md` for the full key contract) to **pin**
  its serving port so a bookmarked or VS Code-tunneled URL never drifts across
  launches. The `[port]` CLI argument wins over the pin whenever it is a
  usable port number (a whole number in 1-65535) — it's the launcher's
  explicit override for one run. An argument that isn't (`0`, `abc`, `70000`)
  is treated as "no argument given" and falls through to the pin/default,
  saying so on stderr.
  - **No `port:` key:** unchanged default behavior — starts at `7777` and
    **auto-increments** past a busy port.
  - **`port:` set, no CLI argument:** the server binds exactly that port. If it's
    already in use, this is a **startup error, not a silent increment** — the pin
    exists so the address never drifts, so a busy pinned port fails loudly
    instead of quietly moving the board to a different URL. Free the port (or
    edit/remove the `port:` line) and relaunch.
  - **`port:` set to something unusable** (`port: seventy`, `port: 0`,
    `port: 70000` — anything but a whole number in 1-65535): the key is
    **ignored, never fatal**, and the board falls back to `7777` with
    auto-increment. The parser stays tolerant because every surface shares
    it, so the *server* is what complains: it prints a stderr line naming the
    offending value and warning that the URL can now drift. A typo'd pin is
    the one case where a board with a `port:` line still moves — treat that
    warning as "fix the line", not noise.
  - It always **prints the actual URL** on stdout
    (`Kanban app: http://localhost:<port> ...`, suffixed with
    `[pinned by config.yaml]` when the pin was used) — read that line for the
    real port, and relay the "pinned by config.yaml" note to the user when
    present.
- It writes `<kanban-dir>/.kanban-app.pid` (line 1 = pid, line 2 = **the real
  port actually bound** — the pid file and the log line always agree, pin or no
  pin). This dotfile is ignored by the board scripts (only `*.card.md` are
  cards).

Then open the URL. On Windows: `start http://localhost:<port>`. Tell the user they can
also paste the URL into VSCode's **Simple Browser** (Command Palette → "Simple Browser").

Right after reading that URL line, run
`node <SCRIPTS_DIR>/launcher.js write <kanban-dir> <the same server arguments just used>`
— the exact port, `--allow-origin` and/or `--home-url` arguments (if any) just passed to `server.js`,
verbatim and in the same order, so a double-click restart binds the same port, keeps
the same tunnel origin allowlisted and the home icon in place instead of drifting back to `7777` with nothing
allowlisted — unasked, on every successful start — and tell the human the printed
launcher path (in the board folder, beside the cards) in your report. Only arguments are
replayed, never the environment: an origin given through `KANBAN_WEB_ALLOWED_ORIGINS`
goes to `launcher.js write` as `--allow-origin <origin>`. **The launcher is the human's
hand only** — never run it, or `launcher.js run`, yourself. Read
`references/launching.md` when you need what the wrapper is named, what `write` replays
and refuses, where it relocates, how the double-click start guards against a second
server, or what its git excludes are.

**Behind a VS Code tunnel** the browser sees a `https://<tunnel-id>.<cluster>.devtunnels.ms`
origin, which the Origin/Referer guard (SECURITY.md) refuses by default. Forward the server's
port **Private** in the tunnel window, then start the server with that origin allowlisted:

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> <port> --allow-origin https://<tunnel-id>.<cluster>.devtunnels.ms
```

`--allow-origin` is repeatable. `--home-url <url>` puts a small home icon before the board
title that leads to that address. Both are replayed into `launcher.js write`. The rest of the
tunnel setup (the environment variable, startup errors, the CSP) is in `references/launching.md`.

## Stopping

```bash
# read the pid from the first line of the pidfile and kill it
kill "$(head -1 <kanban-dir>/.kanban-app.pid)"
```

(On Windows without a POSIX `kill`, use `taskkill //PID <pid> //F`.) The server is bound
to `127.0.0.1` only.

## Reading further

`docs/web.md` describes the app screen by screen, phone layout included. The reference files hold the rest; read one only when the task touches its subject:

- Read `references/launching.md` when the double-click wrapper misbehaves, or you need its naming, migration, git excludes and lock, or the tunnel's environment variable, startup errors and CSP.
- Read `references/map.md`, `references/calendar.md`, `references/gantt.md`, `references/graph.md` (Hierarchy) or `references/graph-flow.md` (Flow) when the task touches that view.
- Read `references/card-rendering.md` when the task touches how a tile or the card details are drawn.
- Read `references/deep-links.md` when you hand the human a link to a card, a search or a view, or touch the popup's history.
- Read `references/api.md` when the task calls or changes the server's HTTP routes or the `/api/board` payload.
- Read `references/internals.md` when the task changes the page's code: modules, DOM ids, storage keys, listener wiring.

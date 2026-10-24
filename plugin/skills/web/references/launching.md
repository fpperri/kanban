What `launcher.js write` writes and guards, and what starting the server behind a VS Code tunnel needs.

## What `launcher.js write` replays

A port must be a number and each origin is re-emitted as `--allow-origin=<its parsed origin>`; a `--home-url` is re-emitted as
`--home-url=<its parsed address>`; anything else is refused.

The `kanban-snapshot` skill ignores `port:` entirely — it's a
serving fact for this app, not board content it renders.

## Double-click launcher

`launcher.js write` (re)writes a double-clickable wrapper for restarting this same board
with no tokens spent: `kanban_web.cmd` (Windows), `kanban_web.command` (macOS, chmod +x)
or `kanban_web.sh` (Linux, chmod +x — a `.desktop` entry is optional and not set up
here), **in the board directory itself** — the same folder as the `*.card.md` files
(`.kanban/`, `kanban/`, or a declared path). A paired `kanban_web.pid` sits beside it —
pid on line 1, port on line 2. This is separate from `.kanban-app.pid` (SKILL.md, Launching), which
server.js itself still writes on every bind and which `launcher.js run` reads to find the
port; a `.kanban-app.pid` naming a dead pid is cleared right before a launcher start, a
live one is never touched. One board per folder, so this never collides with a sibling
board's own files; a wrapper the writer finds there naming a *different* board (e.g. the
folder was copied from another board's, wrapper file and all) is left alone and the new
one gets suffixed — `kanban_web-<board-name>.<ext>` + a matching `.pid` — the writer tells
boards apart by a marker line inside each wrapper, always reuses the wrapper a board
already owns (whatever suffix it landed on) before picking a new name, and never
overwrites a launcher naming a different board that still exists; one whose marker names a
board folder that is gone is reclaimed. Rewriting it for the *same* board (healing a stale
path) happens on every start, and unchanged bytes are left alone. **Migration:** a write
also looks for a launcher for this same board left by an older launcher.js at the *old*
location (the repository top level, or the board dir's parent when there was no
repository) and removes it together with its paired pid, lock and temporary/reclaim-ticket
siblings; a launcher there naming a different board, or one whose marker can't be read, is
never touched, and any `info/exclude` lines an older write added are left in place
(they are unanchored, so they keep matching `kanban_web.*` files anywhere in that
repository, the new ones in the board folder included). In a repository, the wrapper,
`kanban_web.pid`, `kanban_web.lock` and its temporary siblings (`kanban_web.lock.*`) are
added to `info/exclude`, never `.gitignore` — as **anchored** patterns (a leading `/` plus
the board's own path from the repository top level, e.g.
`/.cortex/planning/kanban/kanban_web.cmd`) — plus, always, the bare `kanban_web.*` names
regardless of which name this write actually chose for its own wrapper, so a leftover
wrapper that rode along when the board's folder was copied from a different board's stays
out of `git status`/`git add` too, even though it never becomes this board's own name. The
lines this version adds only ever match this board's own directory, never a same-named
file elsewhere in the tree. If git cannot report the board's path, or the path holds a
line break, the write stops before writing anything. Double-clicking the wrapper's
first step is checking whether the board is already served: a port chosen from the pid
files, the replayed port argument or the config pin answers `/api/board` as *this* board
(a pid file alone is never the proof) — if so it opens the browser and starts nothing.
Otherwise it takes `kanban_web.lock`, so two quick double-clicks start one server (the
other waits, says so once, and opens the running board; a lock older than 30 seconds is
stale), and starts the server right there, in that window.
Ctrl+C removes the paired `kanban_web.pid` (server.js's own SIGINT handler clears
`.kanban-app.pid` the same way). Closing the window (or Ctrl+Break) leaves
`kanban_web.pid` stale, and a server that dies without Ctrl+C leaves `.kanban-app.pid`
stale; the next start overwrites both. If a plugin update removes the helper script the
wrapper calls, or Node moves, the wrapper says so and tells the human to run
`/kanban:web` once to rewrite it. **The launcher is the human's
hand only** — never run it, or `launcher.js run`, yourself.

## Behind a VS Code tunnel

Reaching the board through a VS Code Remote Tunnel means the browser sees a
`https://<tunnel-id>.<cluster>.devtunnels.ms` origin, not `localhost` — the
Origin/Referer guard (SECURITY.md) refuses that origin by default. Forward
the server's port **Private** in the tunnel window, then start the server
with that tunnel origin allowlisted:

```bash
node <SCRIPTS_DIR>/server.js <kanban-dir> <port> --allow-origin https://<tunnel-id>.<cluster>.devtunnels.ms
```

`--allow-origin` is repeatable (`--allow-origin=<origin>` works too);
`KANBAN_WEB_ALLOWED_ORIGINS` (comma-separated) does the same from the
environment, and the two merge. Only `http://` and `https://` origins can be
allowlisted, and an entry that does not parse is a startup error — the server
never comes up half-configured. Both are opt-in and
default to nothing extra allowed — leave them unset and the guard behaves
exactly as it always has. The CSP (`'self'`) needs no change: the browser
still sees one origin, whichever one it loaded the app from.

`--home-url <url>` (or `--home-url=<url>`) puts a small home icon before the board title
that leads to that address, giving the board a home page to link up to. Only `http://` and
`https://` addresses are accepted; anything else is a startup error with a message, like a
bad `--allow-origin`. Without the flag there is no icon. The double-click launcher replays
the flag with the port and the allowed origins.

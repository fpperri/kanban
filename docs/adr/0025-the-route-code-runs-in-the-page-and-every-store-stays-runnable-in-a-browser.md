# 0025. The route code runs in the page, and every store stays runnable in a browser

Date: 2026-10-30 · Status: accepted

## Context

The Web saves through the server: every card, note, scratchpad, todo, group and
config change is one `/api` request, answered by `route(method, path, body)`
(`route.js`) over the stores that read and write the board's files. The
Snapshot is a different program: a generated page with its own save rules and a
Python builder, whose saves are a list of changes applied to the board later.
Two sets of save rules for one board drift, and the Snapshot's
rules are the smaller and the older set.

A page that is the Web, with the board's files inside it, can answer its own
saves with the server's own code. Nothing in that code needs a socket: `route`
knows nothing of HTTP, and the stores call only synchronous `fs`, `path` and
`crypto`. What a page lacks is Node's built-ins, not the logic.

## Decision

The server's route code runs in the page. `route.js` and the stores it requires
are loaded unchanged by a small CommonJS loader (`module-loader.js`) that
resolves their relative requires, over three shims for the built-ins they ask
for:

- `fs`: an in-memory file system (`memory-fs.js`) that implements only the
  synchronous calls the stores use, and answers with Node's error codes on the
  same mistakes.
- `path`: the POSIX calls (`posix-path.js`), with a relative path read from the
  root.
- `crypto`: a synchronous sha256 hex digest, written in plain JavaScript because
  the stores call it synchronously, and random bytes (`crypto-shim.js`).

`makeMemoryRoute` (`memory-route.js`) makes `route` over a board held in memory;
`makeRoute` still makes it over a real folder. The same table of calls is held
to the same status, the same answer and the same files over both
(`test/web/route-memory.test.js`).

The rule: **every store stays runnable in a browser.** A store that needs a Node
built-in the shims do not cover adds a shim for it in the same change. The
loader refuses a built-in with no shim and names it, and the test loads every
script of the web skill but the launcher and the server through it, so the
change that forgets fails there and not in a page.

`route.js` is the server's route table moved out of `server.js` unchanged, and
`server.js` calls it. The stores' logic is not rewritten, but two things change
so that a page can run them:

- **An id source.** A card or group takes its id from one place,
  `card-store.newId`, which on a board is the next number of the prefix's
  counter in `config.yaml`, as before. A page has no counter of its own to
  write, so `useIdSource(fn)` lets it answer the whole id instead; the page
  hands out temporary ids (`n1`) and the apply maps each to the real id the
  board allocates.
- **A temporary-id mode in `ids.js`.** `acceptTempIds(true)` makes `parseId`,
  `idKey` and `ID_SOURCE` take `n1` as an id, so the stores and the route's
  patterns accept it. It is off by default: on the server, and for every other
  caller, `n1` is still text that is not an id, and `isTempId` alone tells it
  apart.

The shims and the loader are dual-environment modules like the others:
required by `node --test`, and loadable as a plain `<script>`.

## Considered options

- **Rewrite the stores over an abstract storage interface.** Rejected: it
  changes every store, makes the page's code a second copy of the server's, and
  the first drift is the bug this exists to avoid.
- **Run the server in a service worker or a WebAssembly Node.** Rejected: far
  more than the dozen file calls the stores make, and a page that must start
  from one file cannot carry it.
- **Keep the Snapshot's save rules and have the apply translate its changes.**
  Rejected: it leaves two sets of rules for one board.
- **A browser sha256 from `crypto.subtle`.** Rejected: it is asynchronous, and
  the stores take a file's version synchronously to refuse a stale save.

## Consequences

- A store that reaches for `os`, `child_process`, a global the page has no
  counterpart for, or an `fs` call the memory file system lacks, fails the
  loading test with the missing name. The fix is a shim or a different call,
  never a store that skips the page.
- The memory file system has no links, no permissions and no writing through an
  open handle. A store that needs one adds it there, with the test that holds it
  to Node's answer.
- The page runs the plugin's own source text through `new Function`. That text
  is the plugin's, never a board's or a person's, but a page that forbids
  string evaluation cannot run it.
- File times in the memory file system are the clock when a write happens, so a
  page's `mtime` is when the page wrote, not when a disk did.

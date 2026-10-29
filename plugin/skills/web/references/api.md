The server's HTTP routes, their request and response bodies, and the keys of the `/api/board` payload, as the web app uses them.

### GET /vendor/<library>/<file>, GET /mermaid-frame.html and GET /mermaid-frame.js

The server serves `/vendor/<library>/<file>` for the four files it names (`VENDORED` in `server.js`, the licences beside them are not served) and the two frame files, and answers a request with the origin `null` (a sandboxed frame's) for those only. A vendored file is served with `Cache-Control: public, max-age=31536000, immutable` (the version is in the address); everything else stays `no-store`.

### POST /api/cards/<id>/archive

A package name must be one plain path component; a nested path or a `.`/`..` hop is refused with a 400.

### DELETE /api/cards/<id> and DELETE /api/groups/<id>

The server's `DELETE /api/cards/<id>` and `DELETE /api/groups/<id>` take `{ logbook, scratchpad, todos, members, memberLogbook, memberScratchpad, memberTodos }` in the body, each only when `true` (the member boxes count only with `members`), and answer what went (`groups`, `deleted`, `kept`, `swept`, `membersSwept`).

### GET /api/board, the `pills` key

Each `pills:` entry of `config.yaml` is a query, shown as its query, or a label and a query, shown as its label (the board answer carries them as `pills: [{label, query}]`; an entry that is malformed is skipped, never an error).

### POST /api/config

**This board** has the pages Logbook, Scratchpad, Todos, Groups, Types, Prefixes and Counters, each written to `config.yaml` one top-level line at a time (or one block, `references/api.md`, **One line or one whole block per save**; the line replaced, inserted or removed, every other byte kept: comments, unknown keys, the file's line ending) by `POST /api/config` with `{ key, value }`, which answers `{ settings }` as the file now reads.
**One line or one whole block per save.** A save changes one top-level line of `config.yaml`, or rewrites one whole top-level block, `types:`, `hierarchy:` or `prefixes:`, from `{ block, value }`: `types` a list of names or of `{ name, color?, icon? }` (an entry with neither is written bare, as the starter writes `- bug`), `hierarchy` a list of names (written inline, or as a block when a name will not sit in a flow list), `prefixes` a map from each prefix to a card type or a groups folder (or a list of `{ prefix, target }`).
An empty or absent value removes the block.
A value from the file is kept as written (ADR 0004), so the server refuses (400) only what would corrupt the file: a name that is empty, any value that is not one line of plain text, a prefix that is not `_` and capitals, a prefix declared twice, a prefix with no card type or groups folder, a groups-folder target that is absolute or holds `..`, and a block value of the wrong shape.
A color is any text (a hex, a name) and an icon any word, and two names that differ only in capitals are both kept, in `types:` and in `hierarchy:`; a name that would not read back bare is quoted.
**Types off** is `{ key: "typesOn", value }`: `false` writes `typesOn: false`, `true` removes the line (no line means on); it is display only and writes no list and no card.
Every save from the gear sends the `version` the settings answered, a line save as much as a block: when `config.yaml` has changed on disk since, the save is refused with 409 and writes nothing, and the page reads again and says so.
A save that sends no version is not checked.

### GET /api/board: the `settings` key

The `/api/board` payload carries `settings`: `logbook`, `scratchpad`, `todos` and `groups` as `{ on, folder, locked, reason }`, `idDigits`, `nextId`, `prefixes` (and `prefixClashes`, the prefixes two lines name for different targets) and `counters`, and for the Types page `types`, `hierarchy`, `typesOn`, `typeUse` (how many cards, on the board and archived, carry each `type:` word as written), `version`, and `paths` (the absolute path of `config.yaml` and of the logbook, scratchpad, todos and groups folders, resolved whether or not the folder exists, `null` when off) for each page's copy button (the Iterations switch shows the payload's own top-level `iterations`).

### /api/notes (POST, PATCH, DELETE) and POST /api/notes/assign

The notes are written by `POST`, `PATCH` and `DELETE /api/notes` and `POST /api/notes/assign`, which build the day file's name from a day and an id and never from request text; a write re-reads the file and retries once when it changed meanwhile, then answers 409.

### Request body of POST /api/notes: by

A note's `by` is kept as written (one trimmed line, any text; a blank one is `@human`), never refused for not being a handle.

### GET /api/scratchpad/<id> and PUT /api/scratchpad/<id>

The server's `GET /api/scratchpad/<id>` answers `{ pad: { target, exists, file, refs, body } }` and `PUT /api/scratchpad/<id>` with `{ body }` writes the body (404 with the scratchpad off, 400 for an id or a body that is wrong, 413 for a page over 300000 characters); there is no delete route, only the delete popup's **Its scratchpad** takes a page.

### GET /api/board: `scratchpad`

The `/api/board` payload carries `scratchpad: { folder, targets }`, the ids that have a page, or `null`.

### A write to a path with another `<word>`

A write to a path with another `<word>` answers 400, and the gear refuses a folder that starts with `<iteration>`.

### A note's `file` and a page's `folder` with a placeholder in the path

A note's `file` then reads `<iteration folder>/<day file>` (just the day file for the dropped-segment folder, and the ref an edit or delete sends names the file it means), and a page carries `folder`, the path with the segment filled in, only for such a path. A note's `file` and a page's `folder` carry every name filled in.

### GET /api/board: `settings.paths`, `logbookNow`, `scratchpadNow`

The settings' `paths.logbook` and `paths.scratchpad` stay the path as written, with `logbookNow` and `scratchpadNow` the folder a new write goes to today (`null` for a path without the placeholder). The gear never writes `vars:` and keeps it as it is, and its `paths` give the folder with the variables and `<repo>` filled in.

### /api/todos/<id> (GET, POST, PATCH, DELETE, PUT) and /api/todos/<id>/move, /indent, /outdent

The server's `GET /api/todos/<id>` answers `{ todos: { target, exists, file, folder?, version, text, lines } }` (`text` the whole file with plain new lines and no byte order mark), each line `{ index, item: true, depth, done, text }` or `{ index, item: false, text }` (a blank line is left out, `index` is the line number in the file); `POST /api/todos/<id>` with `{ text, parent?, version }` adds an item (201; `parent` is the line of the item it goes under), `PATCH` with `{ index, done?, text?, version }` ticks or edits, `DELETE` with `{ index, version }` removes an item with its children and the lines indented under it, and `POST /api/todos/<id>/move` with `{ index, by: -1 | 1, version }` moves it among its siblings, and `POST /api/todos/<id>/indent` and `/outdent` with `{ index, version }` change its level (a child's indent follows the file's own style, spaces or a tab), and `PUT /api/todos/<id>` with `{ text, version }` writes the whole text (the file then holds exactly that text, every line ending the file's own, its first or else a new line, and a byte order mark kept; a list not written yet is made in its folder); each answers `{ todos }` as the file now reads, with `at`, the line of the item added or moved. Every write names the `version` it read and is refused with 409 when the file has changed since, and with 400 when it names none (an item write changes the one line it is about and keeps every other byte, line endings included). 404 with todo lists off or for an item that is not on that line, 400 for an id or text that is wrong, 413 for a list over 300000 characters or an item over 2000 (an item write may still change a file already over the limit; a whole text over it is refused). There is no delete route for a list: only the delete popup's **Its todo list** takes a file.

### GET /api/board: `todos`

The `/api/board` payload carries `todos: { folder, targets, counts }`, the ids that have a file and `{ id: { open, total } }` for those with an item, or `null`.

### POST /api/groups, PATCH /api/groups/<id>, POST /api/groups/<id>/members

The server's `POST /api/groups` makes a group (`name`, `folder` of at most two plain names, optional dates, `auto_join` kept only with both, `cards` that must be cards of the board; the id is allocated from the folder's prefix and its counter, and a refused group burns no id), `PATCH /api/groups/<id>` changes the name, dates, `auto_join` and `extra` keys (null takes one out, an empty string empties its value; a key holding a list or several lines is refused, 409), and `POST /api/groups/<id>/members` takes `add` and `remove` lists of card ids; each rewrites only the lines it changes, keeping every other line, comment and the body, and a group is found by the id in its frontmatter, never by file name or request text.

### GET /api/board: `iterations`

The server adds `iterations` (true only with the key and a groups folder) to the board payload.

### GET /api/board: `types`

`GET /api/board` carries it as `types: [{name, color}]` (`color` is `''` when absent; `[]` when the key or file is), and an entry that sets an `icon:` also carries `icon` (the name lowercased with a trailing comment stripped, an unknown name passed through, lowercased like any other; no `icon` key at all when none is set).

### GET /api/board: `hierarchy`

`GET /api/board` carries it as `hierarchy: [name, ...]`, the names in order as written: blank entries are dropped, duplicates and case differences pass through for the page to normalise, and a scalar value or an empty list answers `[]` (as does an absent key, even on a board that declares `types:`).

### GET /api/board: `typesOn`

`GET /api/board` carries it as `typesOn`, and `types` and `hierarchy` stay as written.

### GET /api/board: `pills`

`GET /api/board` carries them as `pills: [{label, query}]` in config order.

### GET / and GET /<file>: the files the server serves

**The page names the files the server serves.** The server serves `/` (`web/app.html`) and the files that page loads by a plain top-level name: its `<script src>` tags, the stylesheet and the tab icon. Anything else in `web/` is a 404 (apart from the four vendored library files, served by exact name under `/vendor/`: `mermaid/mermaid.min.js`, `highlight.js/highlight.min.js`, `highlight.js/github.min.css` and `highlight.js/github-dark.min.css`, and the mermaid frame's two files, `mermaid-frame.html` and `mermaid-frame.js`).

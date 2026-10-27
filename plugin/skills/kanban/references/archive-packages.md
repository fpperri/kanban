Archive packages: the optional folders inside `archived/` that group a batch of finished cards, and how archiving and restoring treat them.

## Archive packages

**`<kanban-dir>/archived/` is scanned recursively** (ADR 0010): an archived card is any `*.card.md` anywhere under it. Cards may sit at the `archived/` root or inside an optional **package** folder, `<kanban-dir>/archived/<package>/` — free-form grouping for a batch of finished work, created on demand. A package name is kept verbatim (no slugging — an existing folder must match byte-for-byte) and must be one plain path component: never a nested path, never a `.`/`..` hop. Packages are grouping only — they mean nothing to status, ids, or dependencies, and every reader (board views, id allocation, dependency resolution, restore, delete) finds a card wherever in the tree it sits. Restoring returns the card to `<kanban-dir>/`, never to a package; the emptied package folder is left in place. Archiving without a package writes to the `archived/` root, and never move a card that is already filed in a package back out to the root unless asked.

`<kanban-dir>/archived/notifications.md` is not a card and sits at the `archived/` root, so a package never holds or moves it.

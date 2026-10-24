The notifications tray beyond writing an entry: how renderers show a level, what becomes of a malformed entry, and how clearing works.

## How the tray reads and clears

- **Levels.** Renderers show every level: debug dimmed, warning amber-tinted, error red-tinted. There is no filtering yet. An entry with no `level` reads as `info` (back-compat).
- **Read.** The reader flips `read: false` to `read: true` as an in-place edit.
- **Malformed entries.** Entries missing a numeric `id` or a non-empty `message` are skipped by readers and moved verbatim to `<kanban-dir>/archived/notifications.md` on the next managed rewrite, never deleted (the same rule as clearing).
- **Clear = archive.** Clearing or removing entries from the tray MOVES them verbatim (append) to `<kanban-dir>/archived/notifications.md`, creating the file and directory if absent. Deletion never happens. There is no rotation or cap yet. That file lives at the `archived/` **root**: it is not a card, so archive packages never hold or move it.

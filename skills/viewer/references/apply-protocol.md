# Apply protocol — "Apply kanban changes" payloads

A user message matching

```
Apply kanban changes (N ops, base <ISO-STAMP>):
[ ...JSON op array... ]
```

is the kanban-viewer's change payload — the human's reviewed intent. Apply it to
the card files. The base stamp is when the editor's snapshot was taken; anything
that changed on disk after it is a potential conflict, not an overwrite target.

The canonical board write contracts (card fields, `doing` entry gate, sticker
predicates, notifications contract) live in the kanban skill's SKILL.md; this
file adds the payload-specific rules.

## Op vocabulary

| Op | Shape | Meaning |
|----|-------|---------|
| move | `{"op":"move","id":<id>,"to":"backlog\|todo\|doing\|done"}` | set `status:` |
| edit | `{"op":"edit","id":<id>,"title"?,"priority"?,"assignee"?,"body"?,"fm"?}` | field-level changes |
| create | `{"op":"create","title",...,"status","assignee"?,"body"?}` | new card |
| archive | `{"op":"archive","id":<id>}` | move file to `archived/` |
| delete | `{"op":"delete","id":<id>}` | permanent removal (see write mechanics) |

Notes: ids may arrive as strings. `assignee:""` removes the field. `body`
replaces the card's full markdown body below the `# title` H1 (frontmatter and
H1 untouched; `""` clears). `create.body` becomes the markdown under the new H1.
The editor merges duplicate ops (last-wins) before sending, but don't rely on it.

`edit.fm` is an object of **raw frontmatter assignments**:
`{"fm":{"due_date":"2026-07-20","tags":"[ui, bug]","some-custom-key":"x"}}`.
Each value is written into the card's frontmatter verbatim (the string after
`key: `) — no validation, matching the board's tolerant-registry philosophy.
`""` removes the key (lean frontmatter). Three keys are special:
`id` is ignored outright; `status` in `fm` is treated exactly like a `move`
op (the `doing` entry gate + date-landing rules apply, never written
verbatim); an
`updated` value is ignored too — the field is machine-maintained (ADR 0008)
and re-stamped on every write regardless. List
shapes (`tags`, `waiting_for`) arrive as flow-style strings like `[a, b]` —
write them as-is. Refresh `updated:` on any fm write.

## Procedure

1. **Re-read reality.** List the kanban directory. For each file an op touches,
   compare its mtime with the generation-time baseline. Drifted → re-read the
   current content and apply the op onto it (ops are field intents, not file
   images). Touched card missing from the root → skip the op, report the
   conflict. Never silently clobber a disk-side change.
2. **Validate against disk state, not editor state:**
   - `doing` entry gate (hard rule; the full predicate is in the kanban
     skill's SKILL.md): reject move→`doing` while the card is **waiting** —
     any `waiting_for` id names a card not `done` (dangling ids don't
     count) — or **blocked** — its `blocked` field passes the shared sticker
     predicate. The skip reason names which:
     "waiting on #34" / "blocked: <reason>". Entry-only — no eviction: a card
     already in `doing` is never moved out by the gate. `review` (ADR 0009)
     is `blocked`'s sibling sticker — set/read via the same `fm.review`
     shape — but does NOT gate this check; a card can enter or stay in
     `doing` while wearing one.
   - Unknown id → skip and report.
3. **Build new file contents** — preserve all other frontmatter fields, the
   body, and the file's existing line endings (check for CRLF):
   - move: set `status:`. Landing rules: arriving on `todo` sets
     `start_date` if absent; arriving on `done` sets `end_date` if absent.
     Refresh `updated:` (local time, `YYYY-MM-DDTHH:MM:SS`).
   - edit title: replace the first `# ` line after frontmatter. Do NOT rename
     the file — frontmatter `id` is the source of truth and legacy names are
     legal.
   - edit priority/assignee: update or insert; lean frontmatter —
     drop a field rather than write an empty value.
   - edit body: replace everything below the H1.
   - create: id = `nextId` from `config.yaml`. Filename
     `<0000-padded-id>.<slug>.card.md`, slug lowercased/hyphenated, capped ~60
     chars. Frontmatter: id, status, priority, assignee?, updated
     (+ start_date if landing on todo). Body: `# <title>` then `body` if given.
     **Write order: card file first, bump `nextId` only after the
     write succeeds — a failed create must never burn an id.**
4. **Write mechanics:**
   - Local session (board directly on disk): ordinary file writes; archive =
     move into the board directory's `archived/` subfolder; delete = actual
     file deletion, but only with the human's confirmation already given (the
     editor's two-tap confirm counts).
   - Cowork/remote session (device bridge): write via `device_bash` with
     base64 (`echo <b64> | base64 -d > <mounted-path>`) after an inline mtime
     guard (`stat`) in the same script; archive = `mv` into `archived/`. The
     bridge cannot `rm` — delete = `mv` into `_to_delete/` (mkdir -p, alongside
     `archived/`) and tell the human to empty it. Fallback writer:
     SendUserFile + device_commit_files with `expectedMtimeMs`.
5. **Notify:** append one entry to `notifications.md` per applied payload,
   per the notifications contract in the kanban skill's SKILL.md. Payload
   specifics: `from: "cowork:board-editor"` or `"skill:kanban-viewer"`; a
   `level:` (`info` normally; `warning` when ops were skipped, `error` when
   the whole payload failed); a TLDR-first `message` — one plain sentence,
   then `; more: ` enumerating what changed per op (applied/skipped + why).
   Card ids in that text — and in the step-6 reply — follow the **Card mention**
   rule: `` `board#id` `` (the board's `name:`) plus the card's title verbatim.
6. **Close the loop:** reply with per-op results (applied / skipped + why),
   regenerate the editor with a fresh base stamp, redeliver it. If a board
   dashboard artifact exists downstream, refresh it too.

## Conflict and failure policy

Per-op skip-and-report beats batch abort — apply the survivors. If everything
conflicts (the board diverged wholesale since base), stop and show the human the
divergence instead of guessing. If the device/bridge is offline, say so, keep
the payload, and retry when it reconnects — never pretend the write happened.

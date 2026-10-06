# 0004. Config vocabularies suggest, never validate

Date: 2026-07-09 · Status: accepted

## Context

Boards want curated vocabularies (assignees, priorities, tags) without the
file format ever rejecting content — cards are hand-edited Markdown and the
parser's prime directive is tolerance (the suggest-never-validate registry
language in `GLOSSARY.md` and the kanban skill's file contracts).

## Decision

`config.yaml` carries HITL-curated lists (`assignees`, `priorities`,
`tags`). They power suggestions (comboboxes) and ordering (priority sort
rank = list position), but free text always saves, and unknown values are
tolerated everywhere — they sort after known values, render neutrally, and
are never errors. Only the human edits the lists; the app writes only the
`nextId` line (surgically, preserving comments).

## Consequences

Vocabulary drift is visible (unknown values look unstyled/sort last) instead
of forbidden. Planned extension: an official `statuses` list where unknown
statuses render in backlog until promoted — the same suggest-never-validate
posture applied to columns.

#!/usr/bin/env bash
# One-shot migration: rename the `blocked_by:` frontmatter field
# to `waiting_for:` across a board, in place. Covers <dir> and <dir>/archived,
# the latter recursively (ADR 0010: archived/<package>/ folders).
# Frontmatter lines only — body text (narratives, prose mentioning blocked_by)
# is never touched. Dry-run by default; pass --apply to rewrite.
# Deliberate ADR-0008 deviation: `updated` is NOT bumped — a mechanical bulk
# rename across a whole board would trash every card's recency signal.
# Precedent: migrate_card_names.sh.
# Usage: bash migrate_waiting_for.sh <kanban-directory> [--apply]

KANBAN_DIR="${1:-.}"
MODE="${2:-}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

# True when the FIRST frontmatter block contains a blocked_by: line.
has_blocked_by() {
    awk '/^---$/{fm++; next} fm==1 && /^blocked_by:/{found=1; exit} fm>=2{exit} END{exit !found}' "$1"
}

migrated=0
errors=0

shopt -s nullglob globstar
all_cards=("$KANBAN_DIR"/*.card.md "$KANBAN_DIR"/archived/**/*.card.md)
shopt -u nullglob globstar

for f in "${all_cards[@]}"; do
    [ -f "$f" ] || continue
    has_blocked_by "$f" || continue

    if [ "$MODE" = "--apply" ]; then
        tmp="$f.migrate.tmp"
        if awk '/^---$/{fm++}
                fm==1 && /^blocked_by:/{sub(/^blocked_by:/, "waiting_for:")}
                {print}' "$f" > "$tmp" && mv "$tmp" "$f"; then
            echo "MIGRATED: $f"
        else
            echo "ERROR (left untouched): $f" >&2
            rm -f "$tmp"
            errors=$((errors + 1))
            continue
        fi
    else
        echo "would migrate: $f"
    fi
    migrated=$((migrated + 1))
done

if [ "$MODE" != "--apply" ]; then
    echo "(dry run — $migrated file(s) would change; rerun with --apply)"
else
    echo "done — $migrated file(s) migrated, $errors error(s)"
fi
[ "$errors" -eq 0 ]

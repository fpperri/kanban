#!/bin/bash
# List all tags used in kanban cards with counts

KANBAN_DIR="${1:-.}"

# field() is duplicated per script (same frontmatter-scoped awk as
# view_board.sh / eligible_cards.sh) so each file stays copy-alone.
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

echo "=== Tag Usage ==="
echo

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue
    field "$file" tags
done | \
    tr -d '[]' | \
    tr ',' '\n' | \
    sed 's/^ *//' | \
    grep -v '^[[:space:]]*$' | \
    sort | \
    uniq -c | \
    sort -rn | \
    awk '{printf "%3d  %s\n", $1, $2}'

#!/bin/bash
# Search kanban card content (case-insensitive grep)

KANBAN_DIR="${1:-.}"
shift
SEARCH_TERM="$*"

if [ -z "$SEARCH_TERM" ]; then
    echo "Usage: $0 [kanban_dir] <search_term>"
    echo "Example: $0 .kanban/ 'temporal signals'"
    exit 1
fi

# field()/title() are duplicated per script (same frontmatter-scoped awk as
# view_board.sh / eligible_cards.sh) so each file stays copy-alone. The
# content search itself stays whole-file — that's the point of this script;
# only the metadata header is frontmatter-scoped.
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

title() {
    awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$1"
}

echo "=== Cards matching: $SEARCH_TERM ==="
echo

grep -il "$SEARCH_TERM" "$KANBAN_DIR"/*.card.md 2>/dev/null | while read -r file; do
    id=$(field "$file" id)
    status=$(field "$file" status)
    t=$(title "$file")

    printf "#%-3s %-12s %s\n" "${id:-?}" "[$status]" "$t"

    # Show matching lines with context
    echo "  Matches:"
    grep -i -n -C1 "$SEARCH_TERM" "$file" | head -10 | sed 's/^/    /'
    echo
done

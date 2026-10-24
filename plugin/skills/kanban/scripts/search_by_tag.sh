#!/bin/bash
# Search kanban cards by tag

KANBAN_DIR="${1:-.}"
shift
TAG="$1"

if [ -z "$TAG" ]; then
    echo "Usage: $0 [kanban_dir] <tag>"
    echo "Example: $0 .kanban/ ai-discoverability"
    exit 1
fi

# field()/title() are duplicated per script (same frontmatter-scoped awk as
# view_board.sh / eligible_cards.sh) so each file stays copy-alone.
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

title() {
    awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$1"
}

echo "=== Cards tagged with: $TAG ==="
echo

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue

    case "$(field "$file" tags)" in
        *"$TAG"*) ;;
        *) continue ;;
    esac

    id=$(field "$file" id)
    status=$(field "$file" status)
    t=$(title "$file")

    printf "#%-3s %-12s %s\n" "${id:-?}" "[$status]" "$t"
done

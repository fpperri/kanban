#!/bin/bash
# Show cards carrying the `review:` sticker — "finished, approve me",
# blocked's sibling (ADR 0009). Same predicate as blocked's:
# trimmed value contains >=1 alphanumeric char; YAML boolean special-case:
# false/no -> not in review; true -> in review, text unspecified. Does NOT
# gate `doing` entry — that gate stays waiting_for + blocked only.
# Usage: bash show_review.sh [kanban-directory]

KANBAN_DIR="${1:-.}"

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

review_text() {
    local v="$1"
    v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    case "$v" in
        \"*\") v="${v#\"}"; v="${v%\"}" ;;
        \'*\') v="${v#\'}"; v="${v%\'}" ;;
    esac
    local lower
    lower=$(printf '%s' "$v" | tr '[:upper:]' '[:lower:]')
    case "$lower" in
        false|no) return 1 ;;
        true) printf 'text unspecified'; return 0 ;;
    esac
    case "$v" in
        *[[:alnum:]]*) printf '%s' "$v"; return 0 ;;
    esac
    return 1
}

echo "=== Review Cards ==="
echo

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue

    text=$(review_text "$(field "$file" review)") || continue

    id=$(field "$file" id)
    status=$(field "$file" status)
    title=$(awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$file")

    printf "#%-3s %-12s %s\n" "${id:-?}" "[$status]" "$title"
    echo "  review: $text"
    echo
done

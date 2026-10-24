#!/bin/bash
# Show cards carrying the manual `blocked:` impediment sticker, reason inline.
# Blocked predicate: trimmed value contains >=1 alphanumeric char;
# YAML boolean special-case: false/no -> not blocked; true -> blocked, reason
# unspecified. Dependency edges (`waiting_for`) are NOT blocked — that derived
# state is show_waiting.sh's job.
# Usage: bash show_blocked.sh [kanban-directory]

KANBAN_DIR="${1:-.}"

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

blocked_reason() {
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
        true) printf 'reason unspecified'; return 0 ;;
    esac
    case "$v" in
        *[[:alnum:]]*) printf '%s' "$v"; return 0 ;;
    esac
    return 1
}

echo "=== Blocked Cards ==="
echo

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue

    reason=$(blocked_reason "$(field "$file" blocked)") || continue

    id=$(field "$file" id)
    status=$(field "$file" status)
    title=$(awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$file")

    printf "#%-3s %-12s %s\n" "${id:-?}" "[$status]" "$title"
    echo "  blocked: $reason"
    echo
done

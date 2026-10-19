#!/bin/bash
# Doing-gate-clear todo cards, ready for pickup: status EXACTLY
# `todo` (literal, case-sensitive) AND not waiting (show_waiting.sh semantics:
# some waiting_for id names a card, live or archived, whose status != done;
# dangling ids don't count) AND not blocked (show_blocked.sh predicate) AND
# not review-stickered (show_review.sh predicate — ADR 0009:
# agents skip a card awaiting human approval, same stance as blocked, even
# though `review` doesn't gate the literal `doing` entry check).
# Optional assignee arg filters the result, quote-normalized so `@afk` and
# `"@afk"` both match the on-disk `assignee: "@afk"`; omitted = all assignees.
# Output: id|priority|assignee|title, sorted by id (plain numbers, then each prefix). Main board dir only —
# archived/ is excluded (it's only consulted to resolve dependency status).
# Usage: bash eligible_cards.sh <kanban-directory> [assignee]

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

# review's sibling of blocked_reason — same predicate, applied to the
# `review` field (ADR 0009).
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

# Trim + strip a single layer of matching quotes — same normalization
# `blocked_reason` above applies to its value, reused here for `assignee`
# (stored quoted on disk) so filter arg and field value compare cleanly.
dequote() {
    local v="$1"
    v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
    case "$v" in
        \"*\") v="${v#\"}"; v="${v%\"}" ;;
        \'*\') v="${v#\'}"; v="${v%\'}" ;;
    esac
    printf '%s' "$v"
}

ASSIGNEE_FILTER=$(dequote "$2")

# Sort lines that start with a card id (up to the first `|`) by the id rule
# (docs/adr/0014): plain numbers first, then by prefix, then by number, so
# `9` < `10` < `G3` < `G10`. The sort key is `prefix<TAB>number`; what is no id sorts last.
sort_by_id() {
    awk -F'|' '{
        id = $1
        if (id ~ /^_?[A-Z]*[0-9]+$/) { match(id, /[0-9]+$/); p = substr(id, 1, RSTART - 1); n = substr(id, RSTART) }
        else { p = "~"; n = 0 }
        printf "%s\t%.0f\t%s\n", p, n, $0
    }' | LC_ALL=C sort -t "$(printf '\t')" -k1,1 -k2,2n | cut -f3-
}

# The id rule's key for a `waiting_for` entry: the prefix and the number without
# its zero padding, so `G0003` and `G3` name the same card.
dep_key() {
    local d="$1" p n
    p="${d%%[0-9]*}"; n="${d#"$p"}"; n="${n#"${n%%[!0]*}"}"
    REPLY="$p${n:-0}"
}

# id -> status map across live + archived, so waiting is done-aware.
declare -A dep_status
# globstar: archived/ is scanned RECURSIVELY (ADR 0010) — cards sit at its
# root or inside optional archived/<package>/ grouping folders.
shopt -s nullglob globstar
all_cards=("$KANBAN_DIR"/*.card.md "$KANBAN_DIR"/archived/**/*.card.md)
shopt -u nullglob globstar
if [ "${#all_cards[@]}" -gt 0 ]; then
    while read -r cid cst; do
        [ -n "$cid" ] && dep_status[$cid]="$cst"
    done < <(awk '
        function key(s,   p, n) { if (!match(s, /[0-9]+$/)) return s; p = substr(s, 1, RSTART - 1); n = substr(s, RSTART); sub(/^0+/, "", n); return p (n == "" ? "0" : n) }
        FNR==1{fm=0; id=""; st=""}
        /^---$/{fm++; if(fm==2 && id!="") print key(id), st; next}
        fm==1 && /^id:/{sub(/^id:[ \t]*/,""); gsub(/[ \t\r]/,""); id=$0}
        fm==1 && /^status:/{sub(/^status:[ \t]*/,""); gsub(/[ \t\r]/,""); st=$0}
    ' "${all_cards[@]}")
fi

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue

    status=$(field "$file" status)
    [ "$status" = "todo" ] || continue

    waiting_raw=$(field "$file" waiting_for)
    if [ -n "$waiting_raw" ]; then
        is_waiting=0
        for dep in $(printf '%s' "$waiting_raw" | tr '[],' '   '); do
            dep_key "$dep"; depst="${dep_status[$REPLY]:-}"
            if [ -n "$depst" ] && [ "$depst" != "done" ]; then
                is_waiting=1
                break
            fi
        done
        [ "$is_waiting" -eq 0 ] || continue
    fi

    blocked_reason "$(field "$file" blocked)" >/dev/null && continue
    review_text "$(field "$file" review)" >/dev/null && continue

    assignee=$(dequote "$(field "$file" assignee)")
    if [ -n "$ASSIGNEE_FILTER" ]; then
        [ "$assignee" = "$ASSIGNEE_FILTER" ] || continue
    fi

    id=$(field "$file" id)
    priority=$(field "$file" priority)
    title=$(awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$file")

    echo "$id|$priority|$assignee|$title"
done | sort_by_id

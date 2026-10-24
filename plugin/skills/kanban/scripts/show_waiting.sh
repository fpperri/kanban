#!/bin/bash
# Show cards waiting on unresolved dependencies: any `waiting_for`
# id whose card exists (live or archived) and is not `done`. Done deps and
# dangling ids are non-blocking; a card whose deps are all resolved is not
# listed. Each unresolved id is shown with its live status.
# The manual `blocked:` sticker is show_blocked.sh's job.
# Usage: bash show_waiting.sh [kanban-directory]

KANBAN_DIR="${1:-.}"

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

# The id rule's key for a `waiting_for` entry: the prefix and the number without
# its zero padding, so `G0003` and `G3` name the same card.
dep_key() {
    local d="$1" p n
    p="${d%%[0-9]*}"; n="${d#"$p"}"; n="${n#"${n%%[!0]*}"}"
    REPLY="$p${n:-0}"
}

# id -> status map (keyed by the id rule) across live + archived, so waiting is done-aware.
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

echo "=== Waiting Cards ==="
echo

for file in "$KANBAN_DIR"/*.card.md; do
    [ -f "$file" ] || continue

    waiting_raw=$(field "$file" waiting_for)
    [ -n "$waiting_raw" ] || continue

    unresolved=""
    for dep in $(printf '%s' "$waiting_raw" | tr '[],' '   '); do
        dep_key "$dep"; depst="${dep_status[$REPLY]:-}"
        [ -n "$depst" ] && [ "$depst" != "done" ] && unresolved="$unresolved #$dep ($depst)"
    done
    [ -n "$unresolved" ] || continue

    id=$(field "$file" id)
    status=$(field "$file" status)
    title=$(awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$file")

    printf "#%-3s %-12s %s\n" "${id:-?}" "[$status]" "$title"
    echo "  waiting on:$unresolved"
    echo
done

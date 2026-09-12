#!/usr/bin/env bash
# Display kanban cards grouped by status.
# Header: the BOARD NAME — config.yaml's top-level `name:` (the token that
# qualifies every card mention, `board#id title`), falling back to the folder above
# the board directory when the board hasn't declared one. Only an UNINDENTED
# `name:` counts: assignee entries carry their own indented `name:`.
# Column set + order follow config.yaml's `statuses:` list when
# present. Supported here: the INLINE flow form only — `statuses: [a, b, c]`
# (quotes/comments tolerated, single-word statuses only). The block (`- item`)
# form is NOT parsed by this bash script and falls back to the default four —
# use the inline form if this skill's board print should follow a custom list.
# A card whose status isn't in the list groups under the FIRST column
# (the catch-all) with its raw status shown inline as [status: <raw>].
# Flags:
#   [waiting: #x #y] — UNRESOLVED `waiting_for` ids only: a listed card that
#     exists (live or archived) and is not `done`. Dangling ids are
#     non-blocking; no flag at all when every dep is done.
#   [blocked: <reason>] — the manual `blocked:` sticker passes the predicate
#     (trimmed value contains >=1 alphanumeric; false/no -> not blocked; true
#     -> blocked, reason unspecified).
#   [review: <text>] — the `review:` sticker (ADR 0009), blocked's
#     sibling — same predicate, applied to `review`. Does NOT gate `doing`.
# Usage: bash view_board.sh [kanban-directory]
# No directory given: discover it — `.kanban/` preferred, `kanban/` a
# supported legacy fallback (checked relative to the cwd).

KANBAN_DIR="${1:-}"
if [ -z "$KANBAN_DIR" ]; then
    if [ -d ".kanban" ]; then
        KANBAN_DIR=".kanban"
    else
        KANBAN_DIR="kanban"
    fi
fi

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

# Extract a YAML frontmatter field value
field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

# Extract first H1 title from body (after frontmatter)
title() {
    awk '/^---$/{fm++;next} fm==2 && /^# /{sub("^# ","");print;exit}' "$1"
}

# Blocked predicate: trimmed value has >=1 alphanumeric char;
# YAML boolean special-case: false/no -> not blocked, true -> blocked.
# Prints the reason and returns 0 when blocked; returns 1 otherwise.
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

# id -> status map across live + archived, so waiting flags are done-aware.
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
        FNR==1{fm=0; id=""; st=""}
        /^---$/{fm++; if(fm==2 && id!="") print id, st; next}
        fm==1 && /^id:/{sub(/^id:[ \t]*/,""); gsub(/[ \t\r]/,""); id=$0}
        fm==1 && /^status:/{sub(/^status:[ \t]*/,""); gsub(/[ \t\r]/,""); st=$0}
    ' "${all_cards[@]}")
fi

# Board name: config.yaml's top-level `name:`, else the parent folder. The
# fallback is a display default, not a name a cross-board mention may use.
BOARD_NAME=""
if [ -f "$KANBAN_DIR/config.yaml" ]; then
    BOARD_NAME=$(sed -n 's/^name:[[:space:]]*\(.*\)$/\1/p' "$KANBAN_DIR/config.yaml" \
        | head -1 \
        | sed 's/[[:space:]]*#.*$//; s/["'"'"']//g; s/[[:space:]]*$//')
fi
if [ -z "$BOARD_NAME" ]; then
    BOARD_NAME=$(basename "$(dirname "$(cd "$KANBAN_DIR" && pwd)")")
fi

# Column order: config.yaml's inline statuses list, default four otherwise.
STATUSES="backlog todo doing done"
if [ -f "$KANBAN_DIR/config.yaml" ]; then
    inline=$(sed -n 's/^statuses:[[:space:]]*\[\([^]]*\)\].*$/\1/p' "$KANBAN_DIR/config.yaml" | head -1)
    if [ -n "$inline" ]; then
        parsed=$(printf '%s' "$inline" | tr ',' '\n' | sed 's/["'"'"']//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | tr '\n' ' ')
        parsed=$(echo $parsed) # squeeze whitespace
        [ -n "$parsed" ] && STATUSES="$parsed"
    fi
fi
FIRST="${STATUSES%% *}"

declare -A cols
for s in $STATUSES; do cols[$s]=""; done

for f in "$KANBAN_DIR"/*.card.md; do
    [ -f "$f" ] || continue

    id=$(field "$f" id)
    status=$(field "$f" status)
    priority=$(field "$f" priority)
    waiting_raw=$(field "$f" waiting_for)
    blocked_raw=$(field "$f" blocked)
    review_raw=$(field "$f" review)
    t=$(title "$f")
    [ -z "$t" ] && t=$(basename "$f" .md)

    line="  #${id} ${t}"
    [ "$priority" = "High" ] && line="$line [HIGH]"

    # Waiting: list unresolved deps only (done deps and dangling ids drop out).
    unresolved=""
    for dep in $(printf '%s' "$waiting_raw" | tr '[],' '   '); do
        depst="${dep_status[$dep]:-}"
        [ -n "$depst" ] && [ "$depst" != "done" ] && unresolved="$unresolved #$dep"
    done
    [ -n "$unresolved" ] && line="$line [waiting:$unresolved]"

    # Blocked flag carries the reason inline — the docs' promised shape
    # ([blocked: <reason>]; blocked_reason prints "reason unspecified" for a
    # bare true sticker).
    if reason=$(blocked_reason "$blocked_raw"); then
        line="$line [blocked: $reason]"
    fi

    # Review flag: blocked's sibling sticker (ADR 0009) — same
    # inline shape, own text, never affects the doing-gate above.
    if text=$(review_text "$review_raw"); then
        line="$line [review: $text]"
    fi

    # Unknown status -> first column, raw status shown (promotion mechanic:
    # the human adds it to config.yaml; the file is never rewritten).
    case " $STATUSES " in
        *" $status "*) col="$status" ;;
        *) col="$FIRST"; line="$line [status: $status]" ;;
    esac

    cols[$col]+="$line"$'\n'
done

printf "=== BOARD: %s ===\n\n" "$BOARD_NAME"

for s in $STATUSES; do
    printf "=== %-8s ===\n" "$(echo "$s" | tr '[:lower:]' '[:upper:]')"
    if [ -z "${cols[$s]}" ]; then
        echo "  (empty)"
    else
        printf "%s" "${cols[$s]}"
    fi
    echo
done

# Archive trailer kept for output compatibility (archived/ is listed by the
# app, not this script)
echo ""
echo "=== ARCHIVE ==="
echo "(see $KANBAN_DIR/archived/ — not scanned by this script)"

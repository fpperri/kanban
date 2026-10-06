#!/usr/bin/env bash
# One-shot migration: the retired `epic: true` flag becomes `type: epic`, in
# place, across a board. Covers <dir> and <dir>/archived, the latter
# recursively (ADR 0010: archived/<package>/ folders). Frontmatter lines only;
# body text is never touched. Dry-run by default; pass --apply to rewrite.
#
# Per card the first `epic:` line is read the way the app read it (any-case
# `true`; anything else was "not an epic" and is left alone) and
#   - becomes `type: epic` where it stood, or
#   - is dropped when the card already has a `type:` line (that type is kept).
# `updated` is bumped (ADR 0008: every write re-stamps), and ONE notification
# listing the migrated cards is appended to <dir>/notifications.md.
# Idempotent: a second --apply finds nothing and files nothing.
# Precedent: migrate_waiting_for.sh.
# Usage: bash migrate_epic_to_type.sh <kanban-directory> [--apply]

KANBAN_DIR="${1:-.}"
MODE="${2:-}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

now=$(date +%Y-%m-%dT%H:%M:%S)

# Board name: config.yaml's top-level `name:`, else the folder above the board
# directory (the same display fallback view_board.sh uses).
BOARD_NAME=""
if [ -f "$KANBAN_DIR/config.yaml" ]; then
    BOARD_NAME=$(sed -n 's/^name:[[:space:]]*\(.*\)$/\1/p' "$KANBAN_DIR/config.yaml" \
        | head -1 \
        | sed 's/[[:space:]]*#.*$//; s/["'"'"']//g; s/[[:space:]]*$//')
fi
if [ -z "$BOARD_NAME" ]; then
    BOARD_NAME=$(basename "$(dirname "$(cd "$KANBAN_DIR" && pwd)")")
fi

# Writes the migrated card to $2. Cards whose frontmatter has no epic: true
# come out byte-identical, so the caller tells "migrated" from "untouched" by
# comparing the two files. BINMODE keeps gawk on Windows from eating the CR of
# a CRLF card.
rewrite() {
    awk -v BINMODE=3 -v now="$now" '
        function flush(   i, line, bare, out) {
            for (i = 0; i < n; i++) {
                line = buf[i]; bare = line; sub(/\r$/, "", bare)
                if (bare ~ /^type:/) hasType = 1
                if (bare ~ /^updated:/) hasUpdated = 1
                if (!seen && bare ~ /^epic:/) { seen = 1; epicAt = i; isEpic = (bare ~ /^epic:[[:space:]]*[Tt][Rr][Uu][Ee][[:space:]]*$/) }
            }
            for (i = 0; i < n; i++) {
                line = buf[i]; bare = line; sub(/\r$/, "", bare)
                cr = (line != bare) ? "\r" : ""
                if (isEpic && i == epicAt) { if (!hasType) print "type: epic" cr; continue }
                if (isEpic && bare ~ /^updated:/) { print "updated: " now cr; continue }
                print line
            }
            if (isEpic && !hasUpdated) print "updated: " now openerCr
        }
        NR == 1 && /^---\r?$/ { fm = 1; openerCr = ($0 ~ /\r$/) ? "\r" : ""; print; next }
        fm == 1 && /^---\r?$/ { fm = 2; flush(); print; next }
        fm == 1 { buf[n++] = $0; next }
        { print }
        END { if (fm == 1) for (i = 0; i < n; i++) print buf[i] }
    ' "$1" > "$2"
}

title() {
    awk '/^---\r?$/{fm++;next} fm==2 && /^# /{sub(/^# /,"");sub(/\r$/,"");print;exit}' "$1"
}

migrated=0
errors=0
mentions=()

shopt -s nullglob globstar
all_cards=("$KANBAN_DIR"/*.card.md "$KANBAN_DIR"/archived/**/*.card.md)
shopt -u nullglob globstar

for f in "${all_cards[@]}"; do
    [ -f "$f" ] || continue
    tmp="$f.migrate.tmp"
    if ! rewrite "$f" "$tmp"; then
        echo "ERROR (left untouched): $f" >&2
        rm -f "$tmp"
        errors=$((errors + 1))
        continue
    fi
    if cmp -s "$f" "$tmp"; then
        rm -f "$tmp"
        continue
    fi

    id=$(awk '/^---\r?$/{fm++;next} fm==1 && /^id:/{sub(/^id:[[:space:]]*/,"");sub(/[[:space:]]*$/,"");print;exit}' "$f")
    mention="\`$BOARD_NAME#$id $(title "$f")\`"
    if [ "$MODE" = "--apply" ]; then
        if mv "$tmp" "$f"; then
            echo "MIGRATED: $f"
            mentions+=("$mention")
        else
            echo "ERROR (left untouched): $f" >&2
            rm -f "$tmp"
            errors=$((errors + 1))
            continue
        fi
    else
        rm -f "$tmp"
        echo "would migrate: $f"
    fi
    migrated=$((migrated + 1))
done

# One entry for the whole run, in the notifications contract's shape (single
# line, double-quoted, TLDR-first).
if [ "$MODE" = "--apply" ] && [ "$migrated" -gt 0 ]; then
    notes="$KANBAN_DIR/notifications.md"
    last_id=0
    cr=""
    if [ -f "$notes" ]; then
        last_id=$(awk '/^-[[:space:]]+id:[[:space:]]*[0-9]+/{v=$0;sub(/^-[[:space:]]+id:[[:space:]]*/,"",v);sub(/[^0-9].*$/,"",v);if(v+0>m)m=v+0} END{print m+0}' "$notes")
        [ -n "$(tail -c1 "$notes")" ] && printf '\n' >> "$notes"
        [ -n "$(head -c 4096 "$notes" | tr -cd '\r')" ] && cr=$'\r'
    fi
    list=""
    for m in "${mentions[@]}"; do list="${list:+$list, }$m"; done
    if [ "$migrated" -eq 1 ]; then noun="card"; else noun="cards"; fi
    message="Migrated $migrated $noun from epic: true to type: epic; more: ${list}, each with updated bumped."
    message=${message//\\/\\\\}
    message=${message//\"/\\\"}
    {
        printf '%s\n' "- id: $((last_id + 1))$cr"
        printf '%s\n' "  at: $now$cr"
        printf '%s\n' "  from: \"skill:kanban\"$cr"
        printf '%s\n' "  level: info$cr"
        printf '%s\n' "  message: \"$message\"$cr"
        printf '%s\n' "  read: false$cr"
    } >> "$notes"
fi

if [ "$MODE" != "--apply" ]; then
    echo "(dry run — $migrated file(s) would change; rerun with --apply)"
else
    echo "done — $migrated file(s) migrated, $errors error(s)"
fi
[ "$errors" -eq 0 ]

#!/usr/bin/env bash
# One-shot migration: the retired `epic: true` flag becomes `type: epic`, in
# place, across a board. Covers <dir> and <dir>/archived, the latter
# recursively (ADR 0010: archived/<package>/ folders). Frontmatter lines only;
# body text is never touched. Dry-run by default; pass --apply to rewrite.
#
# Per card the first `epic:` line is read the way the app read it (any-case
# `true`; anything else was "not an epic" and is left alone) and
#   - becomes `type: epic` where it stood, or
#   - is dropped when the card already has a `type:` line with a value (that
#     type is kept). A blank or `""` type reads as no type, so that line
#     becomes `type: epic` instead.
# Only a card with `epic: true` is written; every other file stays untouched,
# and a migrated one keeps whether its last line ended in a newline.
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

# Writes the migrated card to $2 and returns 0, or returns 3 when the card is
# not an epic (the caller discards $2 and leaves the card alone). The output
# also keeps the source's last line exactly as it ended: awk's print would add
# a newline a file without one never had. BINMODE keeps gawk on Windows from
# eating the CR of a CRLF card.
rewrite() {
    local tailnl=0
    [ -z "$(tail -c1 "$1")" ] && tailnl=1
    awk -v BINMODE=3 -v now="$now" -v tailnl="$tailnl" '
        function emit(s) { if (started) printf "\n"; printf "%s", s; started = 1 }
        function flush(   i, line, bare, val) {
            typeAt = -1
            for (i = 0; i < n; i++) {
                line = buf[i]; bare = line; sub(/\r$/, "", bare)
                if (typeAt < 0 && bare ~ /^type:/) {
                    typeAt = i
                    val = bare; sub(/^type:[[:space:]]*/, "", val); sub(/[[:space:]]*$/, "", val)
                    typed = (val != "" && val != "\"\"")
                }
                if (bare ~ /^updated:/) hasUpdated = 1
                if (!seen && bare ~ /^epic:/) { seen = 1; epicAt = i; isEpic = (bare ~ /^epic:[[:space:]]*[Tt][Rr][Uu][Ee][[:space:]]*$/) }
            }
            for (i = 0; i < n; i++) {
                line = buf[i]; bare = line; sub(/\r$/, "", bare)
                cr = (line != bare) ? "\r" : ""
                if (isEpic && i == epicAt) { if (typeAt < 0) emit("type: epic" cr); continue }
                if (isEpic && i == typeAt && !typed) { emit("type: epic" cr); continue }
                if (isEpic && bare ~ /^updated:/) { emit("updated: " now cr); continue }
                emit(line)
            }
            if (isEpic && !hasUpdated) emit("updated: " now openerCr)
        }
        NR == 1 && /^---\r?$/ { fm = 1; openerCr = ($0 ~ /\r$/) ? "\r" : ""; emit($0); next }
        fm == 1 && /^---\r?$/ { fm = 2; flush(); emit($0); next }
        fm == 1 { buf[n++] = $0; next }
        { emit($0) }
        END {
            if (fm == 1) for (i = 0; i < n; i++) emit(buf[i])
            if (tailnl) printf "\n"
            exit (isEpic ? 0 : 3)
        }
    ' "$1" > "$2"
}

# Backticks in a title are dropped: a card mention is one code span, and a
# backtick inside it would close the span early.
title() {
    awk '/^---\r?$/{fm++;next} fm==2 && /^# /{sub(/^# /,"");sub(/\r$/,"");gsub(/`/,"");print;exit}' "$1"
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
    rewrite "$f" "$tmp"
    rc=$?
    if [ "$rc" -eq 3 ]; then
        rm -f "$tmp"
        continue
    elif [ "$rc" -ne 0 ]; then
        echo "ERROR (left untouched): $f" >&2
        rm -f "$tmp"
        errors=$((errors + 1))
        continue
    fi

    id=$(awk '/^---\r?$/{fm++;next} fm==1 && /^id:/{sub(/^id:[[:space:]]*/,"");sub(/[[:space:]]*$/,"");print;exit}' "$f")
    heading=$(title "$f")
    mention="\`$BOARD_NAME#$id${heading:+ $heading}\`"
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

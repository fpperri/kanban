#!/usr/bin/env bash
# Rename a board's card files to the <0000-id>.<slug>.card.md convention, in place.
# An id is a prefix and a number (`7`, `G3`; docs/adr/0014): the file name takes the
# prefix, then the number zero-padded to config.yaml's `idDigits` (default 4), so
# card G3 is G0003.<slug>.card.md. A number wider than idDigits is skipped.
# Covers <dir> and <dir>/archived, the latter recursively (ADR 0010:
# archived/<package>/ folders) — a packaged card is renamed in its own folder.
# Dry-run by default; pass --apply to rename.
# Usage: bash migrate_card_names.sh <kanban-directory> [--apply]

KANBAN_DIR="${1:-.}"
MODE="${2:-}"

if [ ! -d "$KANBAN_DIR" ]; then
    echo "Error: '$KANBAN_DIR' not found." >&2
    exit 1
fi

field() {
    awk -v f="$2" '/^---$/{fm++;next} fm==1 && $0 ~ "^"f":"{sub("^"f":[ \t]*","");print;exit}' "$1"
}

DIGITS=""
if [ -f "$KANBAN_DIR/config.yaml" ]; then
    DIGITS=$(sed -n "s/^idDigits:[[:space:]]*[\"']*\([0-9][0-9]*\).*/\1/p" "$KANBAN_DIR/config.yaml" | head -1)
fi
case "$DIGITS" in
    ''|*[!0-9]*) DIGITS=4 ;;
esac
{ [ "$DIGITS" -ge 1 ] && [ "$DIGITS" -le 15 ]; } || DIGITS=4

renames=0
errors=0

shopt -s nullglob globstar
all_cards=("$KANBAN_DIR"/*.card.md "$KANBAN_DIR"/archived/**/*.card.md)
shopt -u nullglob globstar

for f in "${all_cards[@]}"; do
    [ -f "$f" ] || continue
    dir=$(dirname "$f")
    bname=$(basename "$f")

    id=$(field "$f" id | tr -d '[:space:]')
    if ! [[ "$id" =~ ^(_?[A-Z]*)([0-9]{1,15})$ ]]; then
        echo "SKIP (no id): $f" >&2
        errors=$((errors + 1))
        continue
    fi
    prefix="${BASH_REMATCH[1]}"
    number=$((10#${BASH_REMATCH[2]}))
    if [ "${#number}" -gt "$DIGITS" ]; then
        echo "SKIP (id ${prefix}${number} exceeds the $DIGITS-digit prefix): $f" >&2
        errors=$((errors + 1))
        continue
    fi
    padded="$(printf '%s%0*d' "$prefix" "$DIGITS" "$number")"

    # already in <0000-id>. form
    case "$bname" in
        "$padded".*) continue ;;
    esac

    # strip any pre-existing unpadded/differently-padded id prefix: only when
    # everything before the FIRST dot is an id (`7`, `0007`, `G3`). Must NOT match
    # a digit-leading slug (e.g. "9x-weird-title.card.md"), only an actual
    # "<id>." prefix.
    slugpart="$bname"
    idpart="${slugpart%%.*}"
    if [[ "$idpart" =~ ^_?[A-Z]*[0-9]+$ ]]; then
        slugpart="${slugpart#*.}"
    fi

    target="$dir/$padded.$slugpart"
    if [ -e "$target" ]; then
        echo "SKIP (target exists): $f -> $target" >&2
        errors=$((errors + 1))
        continue
    fi

    if [ "$MODE" = "--apply" ]; then
        mv "$f" "$target" && echo "RENAMED: $bname -> $(basename "$target")"
    else
        echo "would rename: $bname -> $(basename "$target")"
    fi
    renames=$((renames + 1))
done

if [ "$MODE" != "--apply" ]; then
    echo "(dry run — $renames rename(s) planned, $errors skip(s); rerun with --apply)"
else
    echo "done — $renames renamed, $errors skipped"
fi
[ "$errors" -eq 0 ]
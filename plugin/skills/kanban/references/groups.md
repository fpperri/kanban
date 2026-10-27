Groups: the files that list a board's cards, their folders, ids and auto-join, and how an agent writes one.

## Groups: files that list their cards

A **group** is a named set of this board's cards, kept in a file of its own in the folder `groups:` names; the cards never know their groups. The file is `<padded id>.<slug>.md`, and **the folders it sits in are its type and subtype**, at most two levels: `.groups/_0001.offsite-prep.md` (no type), `.groups/iteration/I0002.zephyr-2.md` (type `iteration`), `.groups/workflow/dynamic/DW0001.schema-diff-review.md` (type `workflow`, subtype `dynamic`). A file nested deeper than two folders is skipped and reported, never an error. The frontmatter never repeats the folders.

```yaml
---
id: I2                    # the truth, whole and never changed; the file name is only a label
name: zephyr-2            # a short name
start_date: 2026-10-12    # optional; a group with both dates is running between them, both days included
end_date: 2026-10-23
auto_join: true           # optional; only with both dates
owner: "@human"           # any other key is kept as written
cards: [3, 7, 15]         # the ids of the member cards of this board (never other groups)
---
free markdown, kept as written
```

**The id.** A group's prefix comes from the exact folder `prefixes:` maps it to (`I: .groups/iteration`, `W: workflow/`, `DW: .groups/workflow/dynamic`), and is `_` when none does or the group sits in no folder. The number is allocated like a card's: `max(counters[prefix], the highest number of that prefix among the cards and groups + 1)`, then the advanced counter is written back on the one `counters:` line. A group's id is written bare and padded to `idDigits` in the file name, and mentioned `#I2`.

**Writing a group (agents may).** Make a group by writing its file in its folder with an `id` allocated as above; change one by editing only the line you mean (`cards: [...]` to add or remove a member, a date, the name), keeping the id, every other key, every comment and the body as they were; write through a temporary file and a rename. Only a card of this board belongs in `cards:`; a group never lists a group.

**Auto-join.** A group with both dates and `auto_join: true` is running from its start to its end, both days included, by the local date of whoever creates the card (`date +%F`). A card created while it runs is written into its `cards:` at creation: after writing the new card's file, re-read each such group file, add the id to the one `cards:` line (kept in id order, once), and write the file back through a temporary file and a rename, changing nothing else. A group with dates but no `auto_join`, an undated group and a group that has not started or has ended never take the card; an edit or a move later never joins one. Membership lives only in the group's list, so a card's file is never edited to join or leave a group. Deleting a card takes its id out of every group's list.

The web reads the same files: a card wears up to two small badges (`#I2 zephyr-2`) with "+N" for the rest, a badge opens the group in the notes palette (its Group tab edits the name, the dates, `auto_join` and the extra keys and takes members out), the card menu has **Add to group…** and **Make a group from them…**, and `group:<id or name>`, `group:` and `-group:` search by membership. A note on a group is a day file named with its id (`2026.10.16.I0002.logbook.md`).

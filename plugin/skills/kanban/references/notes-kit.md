The kanban notes kit: the logbook's day files, a card's or group's scratchpad page and todo list, and the placeholders that resolve the folders they live in.

## The logbook: notes in day files

A **note** is a short line, optionally timed, about one card, one group or nothing: the working log of who did what and when. It is not a narrative entry (the narrative stays the durable record of what happened to a card) and not a notification (that is addressed to the human). Notes live in the folder `logbook:` names, **one Markdown file per target per day**. The file name is the identity and nothing else carries the day or the target:

- `2026.10.16.logbook.md` — notes about nothing, on 2026-10-16.
- `2026.10.16.0007.logbook.md` — notes about card `#7` (the id padded to `idDigits` after its prefix: `2026.10.16.G0003.logbook.md` for `#G3`). The number is what is read, so any padding resolves; renaming a file moves its notes to another day or target.

The notes are a list in the frontmatter, each with an optional time, an author and the text:

```yaml
---
entries:
  - at: "09:10"        # optional; absent = untimed; always quoted (YAML reads 10:30 as a number)
    by: "@afk"         # an assignee handle; sign your notes with your own
    note: two enum renames left
  - by: "@human"
    note: |-
      a note of several lines
      is a block scalar
---
free markdown, kept as written
```

**Writing a note (agents may).** Re-read the day file just before you write it (the web may have written it a moment ago), add an entry, keep the entries in time order with untimed last, and write the file back whole through a temporary file and a rename, creating it when absent. Never change another entry, another frontmatter key, a key an entry carries that you do not know, or the body below: they are the person's, and the web keeps them byte for byte too. Quote a note that would otherwise read as something other than a string (`note: "fixed #12 today"`, a leading `-`, `@` or `[`, a `: ` inside). A file with nothing left in it is deleted.

The web reads the same files, shows a card's notes behind a small count on its tile, and lets a person edit, delete and **assign** a note: assign moves that one note into the other target's file for the same day. When the web and an agent write one file at once, the web re-reads and retries once, then reports a conflict, so a re-read before every write is what keeps both notes.

## The scratchpad: a disposable page per card or group

A **scratchpad** is a working page for one card or one group: a checklist, a paste, a half-formed plan, anything that does not belong in the card or in a note. It is meant to be thrown away. Scratchpads live in the folder `scratchpad:` names, **one Markdown file per target**, named `<padded id>.scratchpad.md`: `0007.scratchpad.md` for card `#7`, `I0002.scratchpad.md` for group `#I2` (the id padded to `idDigits` after its prefix; the number is what is read, so any padding resolves). A target has at most one page.

```yaml
---
refs:                       # optional; what the page points at: notes, files, folders, mentions
  - src/orders/schema.js
  - 2026.10.16.0007.logbook.md
  - "#3"
---

anything at all, kept as written
```

The frontmatter is optional and holds only `refs:` (a block list or `refs: [a, b]`); every other key in it is kept. Below it the body is free Markdown with no structure the board reads. A file with no frontmatter is all body.

**Writing a page (agents may).** Re-read the file just before you write it (the web may have saved it a moment ago), change only the body or the refs you mean, keep every other frontmatter key and the line ending, and write it back through a temporary file and a rename, creating the folder and the file when absent. The page is the person's scratch space: write one only when asked or when you need somewhere to put working text for that target, and say in the card's narrative or a note when a decision depends on what it holds.

**The kanban never deletes one.** Deleting a card or a group leaves its page where it is (and it reads as dangling) unless the person ticks **Its scratchpad** in the web's delete popup; archiving never touches it. An agent that deletes a card does not delete its page unless it was told to.

The web shows a page on the **Scratchpad** tab of the notes palette (a card's, or a group's after its Group tab): the file, its refs, and a multi-line box that Ctrl+Enter or Save writes. A page is read when its tab opens and saved whole; the web writes the body and leaves the frontmatter.

## The todo list: a task list per card or group

A card or a group may have a **todo list**: a GitHub Markdown task list in `<padded id>.todo.md` in the folder `todos:` names (`0007.todo.md`, `I0002.todo.md`), which may be the scratchpad's folder, since the two kinds of file never share a name. Items are `- [ ] text` and `- [x] text`, a child indented two or more spaces (or a tab) under its parent; any other line is kept as it is. Edit it by hand like any file: re-read it just before you write, change only the line you mean, and keep every other byte and the line ending. It means nothing to the board: it never changes a card's status, never holds a card out of `doing`, and adds into no roll-up; the card's own body, acceptance criteria included, stays the work spec. The web shows it on the **Todos** tab of the notes palette and a small `open/total` count on the card, and the delete popup's **Its todo list** box is the only thing that deletes one. `todos:` may hold `<iteration>` and the other placeholders the way a scratchpad's path does (see the next section).

## The placeholders in the logbook, scratchpad and todo paths

`logbook:`, `scratchpad:` and `todos:` may hold `<iteration>`, `<card>`, `<repo>` and the names of the config's `vars:` block, each as a whole path segment (`logbook: <cortex>/execution/<iteration>/.logbook`). Any other `<word>`, one that is neither a built-in word nor a variable, is an ordinary folder name; the server names it on stderr at startup, as a likely typo. Do not write a folder name with `<` or `>` in it other than these, which Windows does not allow. A path without a placeholder is read exactly as before.

**Variables.** A host that ships the kanban inside its own folder layout names its folders once in `vars:`, a block of `name: value` lines (a name is letters, digits, `-` and `_`); a `<name>` in one of the three paths is replaced by the value. A value is a path relative to the board or absolute, and a relative value at the start of a path resolves against the board as a relative path does. A value may use the built-in words but not other variables: a `<name>` that names a variable inside a value is left as written, and the server names it at startup. A variable named like a built-in word (`iteration`, `repo`, `card`) is ignored, and named, never fatal. A human sets `vars:`; the web's gear never writes it and keeps the block as it is.

**`<repo>`** is the git root that holds the board: the nearest folder at or above the board's folder that has a `.git` entry (a folder, or the file a git worktree has). With none, a path that uses `<repo>` (directly or through a variable) is named at startup and that feature, the logbook, the scratchpad or the todo lists, is off rather than written somewhere unintended.

**`<card>`** is the target's file name without its extension: `0007.fix-login` for the card file `0007.fix-login.card.md`, `I0002.zephyr-2` for the group file `I0002.zephyr-2.md`, so each card or group has a folder of its own. A folder is matched to its target by the id at the front of its name, so a renamed card keeps its folder, and an existing folder whose id matches is used before a new name is built. A note about nothing (the board-wide day file) has no card, so the segment is dropped. Assigning a note to another target puts it in that target's `<card>` folder. With `<iteration>` and `<card>` side by side, one folder can be named two ways (`work/0007.fix-login` is a card's folder with no iteration, and could be read as an iteration's): it is one folder, so read its files once, as a card's folder when its id is a card's or a group's and not an iteration's.

**`<iteration>`** stands for a folder named as the iteration's group file is named, without `.md`: the group `.groups/iteration/0005.sprint-496.md` keeps its files in `.../0005.sprint-496/...`. A folder is matched to its iteration by the id at the front of its name, so a renamed group keeps its folder, and an existing folder whose id matches is used before a new name is built. A note for a day and target that already have a day file joins that file, in whichever folder it is. Otherwise it goes to the iteration whose dates hold the note's day (two hold it: the one that started first); a note aimed at an iteration goes to that iteration's folder, whatever its day. A scratchpad or a todo list goes to the iteration its card or group is a member of (the one that started first, if several), else the iteration that holds the day it is first written. With no iteration the segment is dropped (`sprints/.logbook`). A file that exists is read and edited where it is: never move one between iteration folders, a card that changes iteration keeps its page where it was first written, and assigning a note to another target keeps it in its folder (joining that target's day file if one exists) unless the new target is an iteration itself, whose folder it then goes to. When you look for a note or a page, look in every folder the path can name.

# Phone behaviour

Holds the scroll-button stack, the column-head controls, the bell, the pending pill and the clipboard path, the close guard, and the rule that card text is drawn with `textContent`.

## Scroll stack, column heads, bell and card sheet

### Scroll-button stack

The Claude mobile app used to dismiss the HTML snapshot on swipe-down; that
dismissal no longer happens on either delivery route (file preview or the
Board artifact, verified 2026-09-04/05), so the fixed scroll-button stack is
no longer insurance — it stays on as the context menu. It starts collapsed
(only ⋯ visible) on every page load, on every device, and the ⋯ cycles
THREE modes: **off** (default and starting state: only the ellipsis; even the
✕ stays hidden — backdrop/Esc still close an open pop-up) → **medium** (▲ ▼
⋯) → **extended** (the full context — no pop-up: ＋ ⤒ ⤓; card
pop-up open: Archive/Delete SVG buttons ⤒ ⤓, no ＋; delete arms red
on first tap, fires on second) → off. The chosen mode is remembered per
page in localStorage (key kanbanViewer.stackMode; a private window or
blocked storage falls back to off). An ✕ rides above the ⋯ in
medium/extended whenever a pop-up is open, and the scroll buttons drive
the pop-up's scroll area instead of the board.

### Column heads

Besides the scroll-stack's ＋ and the header's "+ New card" button, every
LIVE column head (never Archive) carries two small controls of its own,
right of the card count: a "+" that opens the new-card sheet with that
column's status already selected in the status field, and an AI-prompt
button beside it that opens the same sheet with the status preselected
AND the prompt field already visible for typing. Both stopPropagation()
so tapping either never also collapses the section. One tier exception:
at >=900px a *collapsed* section is a 150px strip that physically cannot
hold both controls beside the name and count (measured: the head's
content runs ~169px), so the pair hides there and comes back when the
section is expanded — which is the default state at that width anyway.
Below 900px, where collapsed is the DEFAULT, both controls stay on every
live head, collapsed or open.

### Bell and pending pill

The header also carries a 🔔 with an unread badge: tapping it
opens a read-only notifications sheet laid out like the web's own list —
a mono `from · time` meta line, a bold TLDR on its own line, and (only
when there is one) a small "More" label over the rest, split into a
bulleted list of clauses when there are two or more. Splitting tolerates
both the intended `; more: ` separator and the `. more: ` mistake real
boards' freshest messages tend to carry, falling back to a real sentence
boundary (skipping `e.g.`/`i.e.`/`vs.`/`etc.`/`cf.` and anything inside
backticks/quotes/parens) when neither separator is present — from the
embedded notifications.md snapshot; read-flips/clears stay conversational
board writes. The "N pending" pill scrolls to the page bottom, same as ⤓, and
also copies the payload to the clipboard — same one-tap shortcut as the
tray's Copy changes button, through the same shared clipboard helper, so a
human who only ever taps the pill still leaves with the payload copied. A
blocked copy never blocks the scroll: it sets the tray note instead, telling
the human to use the text box below, and a later successful copy clears that
note again so the tray never reads "Copied" and "Copy blocked" at once.
A blocked `execCommand` copy RETURNS FALSE rather than throwing, so the helper
reads its return value — a bare try/catch would report every blocked copy
as a success.

### Card sheet and sections

The card
pop-up leads with a status/assignee/priority pill row — tap a pill to edit
that field, tap the title to rename — and keeps
the description dead last. New-card creation happens in the same
sheet via Accept/Cancel; nothing joins the board until Accept. Board status
sections are tap-collapsible and start collapsed on phone widths —
name + count only — so the board opens as a compact overview; at >=900px
live sections open by default and only Archive starts collapsed (evaluated
once at load), with the status-pill row on its own line above the strip;
queueing a create auto-expands the section the new card lands in.

## Clipboard

Inline chat widgets don't render on all clients; the HTML-file route is the
reliable one. Clipboard access can fail in embedded snapshots, so the payload is
always also visible in a selectable text box under the Copy button. Both the
Copy changes button and the "N pending" pill copy through the SAME
`copyPayload()` helper (async Clipboard API, falling back to selecting the
payload textbox and `execCommand("copy")`) — one clipboard code path, not
two that could drift.

## Close guard

With ops queued, closing or navigating away is guarded three ways, because
no single browser event covers every host: `beforeunload` raises the
host's native confirm-exit prompt on an ordinary tab close/navigate/reload;
`pagehide` and a `visibilitychange` to hidden also fire a best-effort
clipboard write of the payload (through the same `copyPayload()` helper,
forced onto its synchronous `execCommand` path since an async Clipboard
write is unreliable during unload), because a host that dismisses the
view instead of navigating it away fires no `beforeunload`: the Claude mobile
app did that on swipe-down, until the dismissal stopped (see the scroll
stack above). An empty tray never arms any of this, and neither does a payload that is already on the
clipboard. `visibilitychange` fires on every tab switch and app
backgrounding, not just on a real dismissal, so the exit copy puts the
human's focus, text selection and scroll offset back afterwards — coming
back to the page must look exactly like leaving it.
Host support, measured rather than assumed: the prompt fires for the
HTML file opened from disk in a desktop browser, and does NOT fire for
the same build opened through its Artifact link, because the artifact
host renders the page in a sandboxed frame that cannot raise the native
dialog. On the Artifact surface the best-effort clipboard copy is
therefore the whole of the protection, so keep it working even if the
prompt is ever dropped. The Claude mobile app's swipe-down dismissal
motivated the extra two events; whether they fired and the copy landed
there was never verified on a real device, and the dismissal no longer
happens.

## Card text

All card text is rendered via `textContent` (never string-built HTML) — card
titles and bodies are user data; keep it XSS-safe by construction.

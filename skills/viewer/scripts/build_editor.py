#!/usr/bin/env python3
"""Build a self-contained interactive HTML editor for a kanban board.

The editor renders the live columns with tappable cards (move, priority, assignee,
rename, description, archive, delete, create) and queues changes locally. Its
"Copy changes" button produces an "Apply kanban changes (...)" payload the user
pastes back to Claude, which applies the ops to the card files — see the skill's
references/apply-protocol.md for exactly how.

Usage:
  python build_editor.py <kanban-directory> [--out kanban-viewer.html]
                          [--base-label "Jul 11, 3:08 pm CT"] [--base-iso 2026-07-11T20:08Z]

Base defaults to now (UTC label) — pass the user's local time when you know it.
Card bodies are embedded (capped at 4000 chars; archived cards at 1500) so the
user can read cards in full.
"""
import argparse, json, os, re, sys
from datetime import datetime, timezone

def parse_card(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    fm, body = {}, text
    if m:
        body = m.group(2)
        for line in m.group(1).splitlines():
            km = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
            if km:
                fm[km.group(1)] = km.group(2).strip().strip('"').strip("'")
    title, rest = "", []
    for ln in body.splitlines():
        if not title and ln.startswith("# "):
            title = ln[2:].strip(); continue
        rest.append(ln)
    name = os.path.basename(path)
    idm = re.match(r"^(\d+)", name)
    def lst(v):
        if not v or v == "[]": return []
        return [t.strip().strip('"').strip("'") for t in v.strip("[]").split(",") if t.strip()]
    def parent_id(v):
        v = (v or "").strip()
        return int(v) if re.match(r"^\d+$", v) else None
    return {
        "id": int(fm["id"]) if fm.get("id", "").isdigit() else (int(idm.group(1)) if idm else 0),
        "t": title or re.sub(r"^\d+\.", "", name).replace(".card.md", "").replace("-", " "),
        "s": (fm.get("status") or "backlog").lower(),
        "p": fm.get("priority") or "Normal",
        "a": fm.get("assignee", ""),
        "due": fm.get("due_date", ""),
        "start": fm.get("start_date", ""),
        "end": fm.get("end_date", ""),
        "upd": fm.get("updated", ""),
        "tags": lst(fm.get("tags", "")),
        "w": lst(fm.get("waiting_for", "")),
        "bl": fm.get("blocked", ""),
        # ADR 0009: review is blocked's sibling sticker —
        # "finished, approve me" rather than "stuck, act so I can proceed" —
        # same raw-verbatim contract, never gates the doing entry check.
        "rv": fm.get("review", ""),
        # Strict parent parse (digits only -> int, else null),
        # same contract as kanban-web's card-store.js parent field — used to
        # build epic-membership edges for the map + tree:/path: traversal.
        "pt": parent_id(fm.get("parent")),
        # Epic-marked flag, same tolerant any-case 'true'
        # read as kanban-web's card-store.js (`epic: get('epic').toLowerCase()
        # === 'true'`) — drives the epic: search term (qMatch's "epic" case).
        "ep": (fm.get("epic", "") or "").strip().lower() == "true",
        "body": "\n".join(rest).strip()[:4000],
        "fm": {k: v for k, v in fm.items() if k != "id"},
        "fn": name,
    }

def esc(text):
    """Minimal HTML escape — the board name lands in a <title> and in markup.
    Local, not html.escape(): `html` is this module's output-string variable."""
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))

def read_board_name(kanban_dir):
    """config.yaml's top-level `name:` — the BOARD NAME that qualifies every
    card mention and titles this page. Only an UNINDENTED key counts: each
    assignee entry carries its own indented `name:`. Absent, fall back to the
    folder above the board directory — a display default, not a name."""
    path = os.path.join(kanban_dir, "config.yaml")
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        text = ""
    m = re.search(r"^name:[ \t]*([^\n]*)$", text, re.M)
    if m:
        val = re.sub(r"\s+#.*$", "", m.group(1)).strip().strip('"').strip("'")
        if val:
            return val
    return os.path.basename(os.path.dirname(os.path.abspath(kanban_dir))) or "kanban"

DEFAULT_STATUSES = ["backlog", "todo", "doing", "done"]

def read_statuses(kanban_dir):
    """config.yaml's `statuses` list drives column/group order; the
    built-in four apply when the file or key is absent. Flow and block YAML
    list styles both occur in the wild."""
    path = os.path.join(kanban_dir, "config.yaml")
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return DEFAULT_STATUSES
    m = re.search(r"^statuses:\s*\[(.*?)\]", text, re.M)
    if m:
        vals = [v.strip().strip('"').strip("'") for v in m.group(1).split(",") if v.strip()]
        return vals or DEFAULT_STATUSES
    m = re.search(r"^statuses:\s*\n((?:[ \t]+-[^\n]*\n?)+)", text, re.M)
    if m:
        vals = [re.sub(r"^[ \t]+-\s*", "", ln).strip().strip('"').strip("'")
                for ln in m.group(1).splitlines() if ln.strip()]
        return vals or DEFAULT_STATUSES
    return DEFAULT_STATUSES

DEFAULT_ASSIGNEES = ["@human", "@hitl", "@afk"]

def _assignees_block(kanban_dir):
    """The raw `assignees:` section text, or None — shared by read_assignees
    and read_assignee_colors so both parse the exact same slice."""
    path = os.path.join(kanban_dir, "config.yaml")
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return None
    m = re.search(r"^assignees:[^\n]*\n(.*?)(?=^\S|\Z)", text, re.M | re.S)
    return m.group(1) if m else None

def read_assignees(kanban_dir):
    """config.yaml's `assignees` registry drives the assignee
    choices; the role trio (@human/@hitl/@afk) applies when the file or key
    is absent or empty. Registries suggest, never validate."""
    block = _assignees_block(kanban_dir)
    if block is None:
        return DEFAULT_ASSIGNEES
    # Tolerant like the web parser: any `handle:` line in the section counts,
    # whether or not it opens its entry, blank lines between entries included.
    handles = [h.strip().strip('"').strip("'")
               for h in re.findall(r"handle:\s*([^\n#]+)", block)]
    handles = [h for h in handles if h]
    return handles or DEFAULT_ASSIGNEES

def _scalar(raw):
    """Same trailing-comment/quote contract as kanban-web's yaml-list.js
    scalar(): a quoted value keeps everything between the quotes verbatim
    (a hex color's own `#` included); an unquoted value only drops a comment
    that's preceded by whitespace, never a `#` that IS the value (a bare
    `color: #ff00ff` is legal — the `[^\\n#]` trick every OTHER field here
    uses would truncate it at that leading hash)."""
    s = raw.strip()
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        return s[1:-1]
    m = re.search(r"\s#", s)
    return s[:m.start()].strip() if m else s

def read_assignee_colors(kanban_dir):
    """config.yaml assignees registry: an OPTIONAL `color:` field
    reserves a color for that handle, same suggest-never-validate contract as
    every other registry field (kanban-web's config-store.js parses the same
    field). Returns {handle: color} only for entries that set one; a handle
    absent here just hashes in the JS (acol()), same as an unlisted status."""
    block = _assignees_block(kanban_dir)
    if block is None:
        return {}
    colors, cur = {}, None
    for line in block.splitlines():
        hm = re.match(r"\s*-?\s*handle:\s*(.+)$", line)
        if hm:
            cur = _scalar(hm.group(1))
            continue
        cm = re.match(r"\s*color:\s*(.+)$", line)
        if cm and cur:
            v = _scalar(cm.group(1))
            if v:
                colors[cur] = v
    return colors

def read_notifications(kanban_dir):
    """notifications.md entries, tolerant like the web store:
    blocks starting `- id:`; entries without a numeric id or message are
    skipped for display (the viewer is read-only over them)."""
    path = os.path.join(kanban_dir, "notifications.md")
    try:
        text = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    out = []
    for block in re.split(r"^(?=- id:)", text, flags=re.M):
        m = re.match(r"- id:\s*(\d+)", block)
        if not m:
            continue
        def field(key):
            fm = re.search(r"^\s+" + key + r":\s*(.*)$", block, re.M)
            return fm.group(1).strip().strip('"').strip("'") if fm else ""
        msg = field("message")
        if not msg:
            continue
        level = field("level").lower()
        out.append({
            "id": int(m.group(1)), "at": field("at"), "from": field("from"),
            "level": level if level in ("debug", "info", "warning", "error") else "info",
            "message": msg, "read": field("read") == "true",
        })
    return out

def main():
    p = argparse.ArgumentParser()
    p.add_argument("kanban_dir")
    p.add_argument("--out", default="kanban-viewer.html")
    p.add_argument("--base-label", default="")
    p.add_argument("--base-iso", default="")
    a = p.parse_args()
    now = datetime.now(timezone.utc)
    label = a.base_label or now.strftime("%b %d, %H:%M UTC")
    iso = a.base_iso or now.strftime("%Y-%m-%dT%H:%MZ")
    cards = [parse_card(os.path.join(a.kanban_dir, f))
             for f in sorted(os.listdir(a.kanban_dir))
             if f.endswith(".card.md") and os.path.isfile(os.path.join(a.kanban_dir, f))]
    if not cards:
        sys.exit(f"no *.card.md files found in {a.kanban_dir}")
    # Archived cards ride along read-only: flagged
    # arch, bodies re-capped at 1500 chars — tappable everywhere, opening a
    # read-only detail sheet, while the tighter cap keeps the file lean.
    # archived/ is walked RECURSIVELY (ADR 0010): cards sit at its root or
    # inside optional archived/<package>/ grouping folders. Only *.card.md is a
    # card, so archived/notifications.md is skipped by the same filter as ever.
    arch_dir = os.path.join(a.kanban_dir, "archived")
    if os.path.isdir(arch_dir):
        for root, dirs, files in os.walk(arch_dir):
            dirs.sort()
            for f in sorted(files):
                path = os.path.join(root, f)
                if f.endswith(".card.md") and os.path.isfile(path):
                    c = parse_card(path)
                    c["arch"] = True
                    c["body"] = c["body"][:1500]
                    cards.append(c)
    # "</" must be escaped inside the inline <script> — ANY embedded value a
    # human can type (card text, config statuses, assignee handles) could
    # contain "</script>" (a real board card has) and would otherwise
    # terminate the script tag mid-JSON. "<\/" is legal JSON.
    emb = lambda v: json.dumps(v, ensure_ascii=False).replace("</", "<\\/")
    html = (TEMPLATE.replace("__BASE_LABEL__", label)
                    .replace("__BASE_ISO__", iso)
                    .replace("__STATUSES__", emb(read_statuses(a.kanban_dir)))
                    .replace("__ASSIGNEES__", emb([""] + read_assignees(a.kanban_dir)))
                    .replace("__ASSIGNEE_COLORS__", emb(read_assignee_colors(a.kanban_dir)))
                    .replace("__NOTIFS__", emb(read_notifications(a.kanban_dir)))
                    .replace("__DATA__", emb(cards))
                    .replace("__BOARD_NAME__", esc(read_board_name(a.kanban_dir))))
    open(a.out, "w", encoding="utf-8").write(html)
    print(f"wrote {a.out} ({len(html)} bytes; {len(cards)} cards, base {iso})")

TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__BOARD_NAME__ — Kanban Viewer</title>
<style>
:root{--surface:#fcfcfb;--page:#f9f9f7;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;
--grid:#e1e0d9;--ring:rgba(11,11,11,.12);--accent:#2a78d6;--high:#d03b3b;--warn:#9a6700;
--bgd:#fbe9e7;--bgw:#f7edd3;--rev:#8a6d00;--bgr:#faf3d0}
@media(prefers-color-scheme:dark){:root{--surface:#1a1a19;--page:#0d0d0d;--ink:#fff;
--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--ring:rgba(255,255,255,.14);--accent:#3987e5;
--high:#f85149;--warn:#d29922;--bgd:#3a1512;--bgw:#332608;--rev:#eac54f;--bgr:#332e08}}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--ink);font-size:15px;line-height:1.5;overflow:hidden}
#scroll{height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:none;touch-action:pan-y;padding:0 14px 120px;max-width:560px;margin:0 auto}
#scrollbtns{position:fixed;right:10px;bottom:18px;display:flex;flex-direction:column;gap:8px;z-index:50}
#scrollbtns button{width:46px;height:46px;border-radius:50%;font-size:19px;line-height:1;padding:0;background:var(--surface);border:1px solid var(--ring);color:var(--ink2);box-shadow:0 1px 4px rgba(0,0,0,.18)}
#scrollbtns button svg{display:block;margin:auto}
#scrollbtns button.armed{border-color:var(--high);color:var(--high)}
#scrollbtns button.off{opacity:.4}
button{background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:7px 13px;color:var(--ink);font-size:13px;cursor:pointer}
button:active{transform:scale(.98)}
input[type=text],input[type=search],select,textarea{background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:8px 10px;color:var(--ink);font-size:15px;width:100%}
#searchrow{margin:0 0 8px}
#q{font-size:13px;padding:7px 10px}
/* Sticky at EVERY width (not gated behind a media query — the rework
   that replaced the floating tray applies here regardless of screen
   size): #scroll is the scroll container (overflow-y:auto) and .hdr is
   its direct child, so position:sticky;top:0 pins it to the scrollport's
   top edge with no extra wrapper needed. A solid, non-transparent
   background (page, matching the surrounding page background) keeps
   board cards from showing through as they scroll underneath; z-index
   sits below #modal's backdrop (40) and the ctx menu (45) so an open
   card sheet or right-click menu still wins over it. .hdr.thin (toggled
   by the sc "scroll" listener below once past a small threshold, not on
   every tick) compacts the padding and title once the page has scrolled,
   so the sticky header stays out of the way of board content. */
.hdr{display:flex;align-items:baseline;gap:10px;padding:14px 0 8px;flex-wrap:wrap;position:sticky;top:0;z-index:20;background:var(--page)}
.hdr b{font-size:16px;font-weight:600}
.hdr.thin{padding:5px 0 3px}
.hdr.thin b{font-size:14px}
.hdr .base{font-size:12px;color:var(--muted)}
/* "N pending" is the only signal that queued changes are NOT yet on
   disk — a solid --high (red, kanban.proj #250) fill, never the calmer
   --accent blue that means "normal/selected" everywhere else in this file,
   with bold white text makes it impossible to miss or mistake for a passive
   label, unlike the old plain colored-text pill. It also FLASHES:
   pillFlash cycles the background red -> white -> red -> white -> red on an
   IRREGULAR, lightning-like cadence (a fast double strike packed into the
   keyframe's first ~14%, then one long dark pause for the rest of the
   cycle) rather than an even sine pulse, so it reads as an alert rather
   than decoration. The "white" flash stop pairs with a fixed dark text
   color rather than var(--ink) — --ink flips to white in dark mode and
   would vanish against a light flash — so the pill stays readable at BOTH
   ends of the cycle in both color schemes. The timing function is
   step-end, NOT linear: with linear every white stop is a zero-duration
   turning point, so the pill would spend ~14% of each cycle smeared
   through mid-blends (around #9c8484 text on #e79d9d, ~1.6:1) where the
   text is unreadable even though both DECLARED ends are fine. step-end
   holds each stop until the next, so every painted frame is one of the
   two high-contrast pairs — and a held-then-jumped strike is what
   lightning looks like anyway. :empty collapses
   padding/background back to nothing AND stops the animation outright when
   no ops are queued (render() sets textContent to "" in that case), so an
   empty pill never shows as a stray flashing dot, and
   prefers-reduced-motion drops the animation for a static red pill. */
.pill{margin-left:auto;font-size:12px;font-weight:700;color:#fff;background:var(--high);border-radius:12px;padding:3px 10px;animation:pillFlash 2.8s step-end infinite}
.pill:empty{padding:0;background:none;animation:none}
@keyframes pillFlash{
0%,100%{background:var(--high);color:#fff}
3%{background:#fff;color:#3a0a0a}
6%{background:var(--high);color:#fff}
10%{background:#fff;color:#3a0a0a}
14%{background:var(--high);color:#fff}
}
@media(prefers-reduced-motion:reduce){.pill{animation:none;background:var(--high);color:#fff}}
#bell{font-size:14px;padding:3px 9px;border-radius:14px;line-height:1.2}
#bellcnt{font-size:10px;font-weight:700;color:#fff;background:var(--high);border-radius:8px;padding:0 5px;margin-left:4px;vertical-align:1px}
.nrow{border:1px solid var(--grid);border-radius:10px;padding:8px 10px;margin:8px 0;font-size:13px;overflow-wrap:break-word}
.nrow.unread{border-left:3px solid var(--accent)}
.nrow.nlv-debug{opacity:.55}
.nrow.nlv-warning{border-color:var(--warn)}
.nrow.nlv-error{border-color:var(--high)}
.nmeta{font-size:11px;color:var(--muted);margin-top:4px}
.boardcol.drag-over{outline:2px dashed var(--accent);outline-offset:-2px}
.colh{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--ink2);padding:12px 2px 5px;border-bottom:1px solid var(--grid);cursor:pointer;-webkit-user-select:none;user-select:none}
.chev{font-size:11px;color:var(--muted);width:12px;flex:none}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.cnt{margin-left:auto;font-size:12px;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:11px 13px;margin:9px 0;cursor:pointer}
.card.sel{border-color:var(--accent)}
.card.prov{border-style:dashed}
.cid{font-size:12px;color:var(--muted)}
.badge{display:inline-block;font-size:11px;font-weight:600;border-radius:6px;padding:1px 7px;margin-left:6px;background:var(--bgd);color:var(--high)}
.wbadge{background:var(--bgw);color:var(--warn)}
/* ADR 0009: review is blocked's sibling sticker — its own gold
   family, distinct from --warn (waiting) and the red --high (blocked). */
.rbadge{background:var(--bgr);color:var(--rev)}
.ttl{font-size:14.5px;margin:3px 0 0;overflow-wrap:break-word}
.meta{font-size:12px;color:var(--ink2);margin-top:4px}
.wline{color:var(--warn)}
.bline{color:var(--high)}
.rline{color:var(--rev)}
.tags{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.tag{border:1px solid var(--grid);border-radius:10px;padding:0 8px;font-size:11px;color:var(--ink2)}
.bodytxt{white-space:pre-wrap;font-size:13px;color:var(--ink2);border-top:1px solid var(--grid);margin-top:9px;padding-top:9px;overflow-wrap:break-word}
.bodytxt strong{color:var(--ink);font-weight:600}
.bodytxt code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--grid);border-radius:4px;padding:0 4px}
.acts{border-top:1px solid var(--grid);margin-top:10px;padding-top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.acts button{font-size:12.5px;padding:6px 11px}
.lbl{font-size:11px;color:var(--muted);width:100%}
.pend{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:12px 14px;margin-top:16px}
.prow{display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0}
.prow button{font-size:11px;padding:3px 9px;margin-left:auto}
.btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
.note{font-size:12px;color:var(--warn);padding:4px 0}
.copybox{margin-top:10px}
.copybox textarea{font-family:ui-monospace,Consolas,monospace;font-size:12px;height:88px}
.hint{font-size:12px;color:var(--muted);margin-top:6px}
.ok{color:#2ea043;font-weight:600}
#newform{background:var(--surface);border:1px solid var(--ring);border-radius:12px;padding:11px 13px;margin:9px 0;display:none}
.row2{display:flex;gap:8px;margin-top:6px}
.viewtabs{display:flex;gap:6px;margin:2px 0 10px;flex-wrap:wrap}
.viewtabs button{font-size:12.5px;padding:7px 13px;border-radius:20px}
.viewtabs button.active{background:var(--accent);border-color:var(--accent);color:#fff}
.viewtabs button:disabled{opacity:.4}
.map-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--ink2);margin:2px 0 12px}
.map-legend span{display:inline-flex;align-items:center;gap:5px}
.map-swatch{width:12px;height:12px;border-radius:3px;border:2px solid var(--ring);display:inline-block;background:var(--surface)}
.map-swatch.waiting{border-color:var(--warn)}
.map-swatch.blocked{border-color:var(--high)}
.map-swatch.ghost{border-style:dashed;border-color:var(--muted);background:none}
.map-title{font-size:13px;font-weight:600;color:var(--ink2);margin:16px 0 6px}
.map-scroll{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;border:1px solid var(--grid);border-radius:10px;padding:8px;background:var(--surface)}
.map-canvas{display:block}
.mnode rect{fill:var(--surface);stroke:var(--ring);stroke-width:1.5}
.mnode.waiting rect{stroke:var(--warn);stroke-width:2}
.mblk{fill:var(--high)}
.mblkt{font-size:8px;fill:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:700}
.mnode.ghost rect{fill:none;stroke:var(--muted);stroke-width:1.5;stroke-dasharray:4 3}
.mnode{cursor:pointer}
.mnode.ghost{cursor:default}
.mnode .mid{font-size:10px;fill:var(--muted);font-family:ui-monospace,Consolas,monospace}
.mnode .mtitle{font-size:12px;fill:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.mnode.ghost .mtitle,.mnode.ghost .mid{fill:var(--muted)}
.medge{fill:none;stroke:var(--ink2);stroke-width:1.5;opacity:.6}
.medge.ghostedge{stroke:var(--muted);stroke-dasharray:3 3;opacity:.5}
/* Epic membership edges draw in their own
   orange/dashed channel with their own arrowhead, mirroring kanban-web's
   app.css .map-edge.epic-edge — so containment never reads as a real
   sequencing dependency. */
.medge.epicedge{stroke:#f0883e;stroke-dasharray:7 4;opacity:.85}
.map-arrow-epic-head{fill:#f0883e}
.map-iso-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px}
.mapiso{background:var(--surface);border:1px solid var(--grid);border-radius:10px;padding:9px 12px;font-size:12.5px;opacity:.7;cursor:pointer;min-width:118px;max-width:220px}
.mapiso .cid{display:block;font-size:11px;color:var(--muted);margin-bottom:2px}
.map-empty{font-size:12.5px;color:var(--muted);padding:10px 2px}
.hnav{display:flex;gap:8px;justify-content:flex-end;margin:0 0 6px}
.hnav button{font-size:13px;padding:6px 16px}
.glbl{font-size:11px;fill:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.ggroup{font-size:12px;font-weight:600;fill:var(--ink2);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.gmark{font-size:9.5px;fill:var(--muted);font-family:ui-monospace,Consolas,monospace}
.gline{stroke:var(--grid);stroke-width:1}
.gtoday{stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3}
.gbar{opacity:.9;cursor:pointer}
.gdue{fill:var(--high)}
.grow{cursor:pointer}
.cal-head{display:flex;align-items:center;gap:8px;margin:2px 0 8px}
.cal-title{font-size:14px;font-weight:600;flex:1;text-align:center}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.cal-dow{font-size:10px;color:var(--muted);text-align:center;padding:2px 0}
.cal-cell{background:var(--surface);border:1px solid var(--grid);border-radius:6px;min-height:52px;padding:2px;overflow:hidden}
.cal-cell.out{opacity:.45}
.cal-cell.today{border-color:var(--accent)}
.cal-daynum{font-size:10px;color:var(--muted);padding:0 2px}
.cal-chip{display:block;border-radius:4px;padding:0 3px;margin-top:2px;font-size:9.5px;font-weight:600;color:#fff;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer}
.cal-chip.range-start{border-radius:4px 0 0 4px}
.cal-chip.range-mid{border-radius:0}
.cal-chip.range-end{border-radius:0 4px 4px 0}
.cal-chip.duechip{background:none;border:1px solid var(--high);color:var(--high)}
.cal-more{font-size:9px;color:var(--muted);padding:0 3px}
.cal-subtabs{display:flex;gap:6px;margin:0 0 8px;flex-wrap:wrap}
.cal-subtabs button{font-size:12px;padding:5px 11px;border-radius:16px}
.cal-subtabs button.active{background:var(--accent);border-color:var(--accent);color:#fff}
.cal-dayrow{background:var(--surface);border:1px solid var(--grid);border-radius:10px;padding:8px 10px;margin:8px 0}
.cal-dayrow.today{border-color:var(--accent)}
.cal-dayhead{font-size:12px;font-weight:600;color:var(--ink2);display:flex;align-items:center;gap:6px;cursor:pointer;-webkit-user-select:none;user-select:none}
.cal-rowchip{display:block;border-radius:6px;padding:3px 8px;margin-top:6px;font-size:12px;font-weight:600;color:#fff;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.cal-rowchip.duechip{background:none;border:1px solid var(--high);color:var(--high)}
.cal-rowchip.range-start{border-left:3px solid rgba(255,255,255,.75)}
.cal-rowchip.range-end{border-right:3px solid rgba(255,255,255,.75)}
.cal-rowchip.range-mid{opacity:.8}
.cal-norows{font-size:11px;color:var(--muted);margin-top:4px}
#modal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:40;display:flex;align-items:flex-end;justify-content:center;padding:12px 12px 16px}
#modalscroll{background:var(--page);border:1px solid var(--ring);border-radius:14px;max-width:560px;width:100%;max-height:82vh;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px 10px 12px}
#modalscroll .card{cursor:default;border:none;background:none;margin:4px 0}
.toprow{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 10px}
.fpill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--grid);border-radius:14px;padding:3px 10px;font-size:12px;font-weight:600;color:var(--ink2)}
.fpill .dot{width:8px;height:8px}
.fmrow{display:flex;gap:6px;align-items:center;margin-top:6px}
.fmrow label{font-size:11px;color:var(--muted);width:86px;flex:none;overflow:hidden;text-overflow:ellipsis}
.fmrow input{flex:1;min-width:0;font-size:13px;padding:6px 8px}
.fmrow button{flex:none;font-size:12px;padding:6px 10px}
.pillrow{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 8px}
.pillrow button{font-size:11px;border-radius:12px;padding:3px 10px;display:inline-flex;align-items:center;gap:5px;color:var(--ink2)}
.pillrow button.off{opacity:.4}
.pillrow .dot{width:8px;height:8px}
/* The map's "Epics" tap-chip rides in the SAME pillrow
   as the status pills (renderMap appends it after statusPills()'s row; the
   row's flex gap spaces it identically). Inherits .pillrow button's base
   look; the ON state is its own rule (not .off, which means the OPPOSITE
   here: a status pill defaults ON and dims when off, this chip defaults OFF
   and lights up epic orange, #f0883e — same hue as .medge.epicedge above,
   kanban-web's EPIC_COLOR) when tapped on. */
.epicchip.on{border-color:#f0883e;color:#f0883e;background:rgba(240,136,62,.12)}
.card.archcard{opacity:.55}
.pill{cursor:pointer}
/* Tier 1 (560-899px): the single column just grows — nothing else
   changes, so phone widths below 560px stay pixel-identical (unreached
   base rule above still says max-width:560px). Tier 2 (>=900px): #scroll
   drops its width cap entirely (~24px side padding only) so the header,
   search, tabs and board use the real viewport instead of sitting in a
   narrow centered column. The board goes side-by-side and each .boardcol
   FLEXES TO FILL the freed width (flex:1 1 0, min-width still ~260px) —
   at the default five columns that's ~1350px of minimums, so 1400px+
   viewports show no horizontal scrollbar; #board keeps overflow-x:auto
   purely as a fallback for N columns x 260px exceeding the viewport.
   Collapsed columns stay a narrow strip, and modals center instead of
   sheeting up from the bottom, mirroring the web app's main#board/.column
   mechanism (skills/web/web/app.css ~lines 80-136) on top of this
   template's own DOM. Of #scroll's other descendants: the map/gantt SVGs
   size themselves from data inside their own overflow-x:auto scroller
   (nothing to stretch); the calendar's 7-column month grid and the
   pending-changes tray (its "remove" buttons push-right via margin-left:
   auto, its payload textarea is width:100%) both read badly stretched
   edge to edge at this width, so #calview and .pend each get a readable
   cap, independent of #scroll's now-uncapped width. (An earlier revision
   floated #pend as a fixed bottom-left overlay at this tier — reverted:
   it read as "always on top" and covered board content. The tray is back
   in normal flow at every width; see the sticky .hdr rule below instead
   for keeping the pending count in view while scrolling.)
   The scroll-button stack (#scrollbtns and its children) stays OUTSIDE
   every media query in this file, at every tier — it is the swipe-down
   insurance + context menu, unrelated to width. */
@media(min-width:560px){#scroll{max-width:720px}}
@media(min-width:900px){#scroll{max-width:none;padding:0 24px 120px}#board{display:flex;align-items:flex-start;gap:12px;overflow-x:auto}.boardcol{display:flex;flex-direction:column;min-width:260px;flex:1 1 0}.boardcol.collapsed{flex:0 0 150px;min-width:0}.boardcol .colh{flex:none}.colcards{flex:1;min-height:0;overflow-y:auto;max-height:calc(100vh - 220px)}#modal{align-items:center}#modalscroll{max-width:640px}#calview{max-width:900px;margin:0 auto}.pend{max-width:640px}}
/* Capability query, not width: touch devices (no hover, coarse
   pointer) keep the hnav step buttons exactly as today at every size;
   mouse/trackpad users get scrollbars + shift-wheel instead. The
   right-click card menu below is gated the same way, in JS (matchMedia),
   since "hover:hover and pointer:fine" isn't itself a thing a contextmenu
   listener can be scoped to without a media query hook — a coarse-pointer
   device never has the listener DO anything (checked first, before any
   preventDefault), so native long-press/contextmenu stays untouched there. */
@media(hover:hover) and (pointer:fine){.hnav{display:none}}
/* Hand-rolled right-click card menu (desktop only, see the JS gate
   above): a plain fixed-position list, positioned at the cursor and
   clamped into the viewport by openCtxMenu(). z-index sits above #modal's
   backdrop (40) so it's reachable even with a card sheet open, below
   #scrollbtns (50) so the swipe-down stack still wins in the corner it
   never actually shares with this menu. */
.ctxmenu{position:fixed;display:flex;flex-direction:column;gap:1px;min-width:172px;background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:5px;box-shadow:0 4px 18px rgba(0,0,0,.22);z-index:45}
.ctxitem{width:100%;text-align:left;background:none;border:none;border-radius:6px;padding:8px 10px;font-size:13px;color:var(--ink)}
.ctxitem:hover{background:var(--page)}
.ctxitem.armed{color:var(--high)}
.ctxsep{height:1px;background:var(--ring);margin:4px 2px}
</style></head><body>
<div id="scroll">
<div class="hdr" id="hdr"><b>__BOARD_NAME__</b><span class="base">viewer · base: __BASE_LABEL__</span><span class="pill" id="pill"></span><button id="bell" aria-label="Notifications">&#128276;<span id="bellcnt" style="display:none"></span></button></div>
<div id="searchrow"><input type="search" id="q" data-stop="1" placeholder="Search&#8230; (#id, title:, body:, status:, priority:, tags:, file:)"></div>
<div class="viewtabs" id="viewtabs">
<button type="button" data-view="board" class="active">Board</button>
<button type="button" data-view="map">Map</button>
<button type="button" data-view="gantt">Gantt</button>
<button type="button" data-view="calendar">Calendar</button>
</div>
<div id="boardview">
<div><button id="newbtn">+ New card</button></div>
<div id="boardpills"></div>
<div id="board"></div>
</div>
<div id="mapview" style="display:none"></div>
<div id="ganttview" style="display:none"></div>
<div id="calview" style="display:none"></div>
<div class="pend" id="pend" style="display:none"></div>
<div id="modal" style="display:none"><div id="modalscroll"></div></div>
<div style="font-size:12px;color:var(--muted);margin-top:16px;line-height:1.6">Tap a card to open it. Queue changes, then tap <b>Copy changes</b> and paste the copied text into the Claude chat — Claude applies it to the real board files. Nothing changes on disk until you paste.</div>
</div>
<div id="scrollbtns">
<button id="snew" aria-label="New card" style="display:none">&#43;</button>
<button id="sdrag" aria-label="Drag on/off" style="display:none"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg></button>
<button id="sarch" aria-label="Archive card" style="display:none"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l1.5-3h15L21 7"/><path d="M3 7h18v13H3z"/><path d="M12 10.5v5.5"/><path d="M9 13.5l3 3 3-3"/></svg></button>
<button id="sdel" aria-label="Delete card" style="display:none"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5"/><path d="M14 11v5"/></svg></button>
<button id="stop" aria-label="Scroll to top" style="display:none">&#10514;</button>
<button id="sup" aria-label="Scroll up">&#9650;</button>
<button id="sdn" aria-label="Scroll down">&#9660;</button>
<button id="sbot" aria-label="Scroll to bottom" style="display:none">&#10515;</button>
<button id="mclose" aria-label="Close card" style="display:none">&#10005;</button>
<button id="smore" aria-label="More scroll buttons">&#8943;</button>
</div>
<script>
const BASE="__BASE_ISO__";
const COLS=__STATUSES__;
const CNAMES={backlog:"Backlog",todo:"Todo",doing:"Doing",done:"Done"};
const CCOL={backlog:"#888780",todo:"#378ADD",doing:"#639922",done:"#7F77DD"};
const cname=s=>CNAMES[s]||s;
const ccol=s=>CCOL[s]||"#888780";
const ARCHC="#8a8880";
const ASG=__ASSIGNEES__;
const ASGCOL=__ASSIGNEE_COLORS__;
// Assignee color: a reserved config.yaml `color:` wins; else the
// handle hashes into the fixed 8-slot palette kanban-web's status-colors.js
// STATUS_PALETTE uses (same djb2-xor hash, same hexes) so a handle colors the
// same on both surfaces. This viewer's own statuses (ccol above) never grew
// that hashing; assignees deliberately borrow it. acol()'s value tints the
// handle TEXT — every call site below sets it via `.style.color`.
const APALETTE=["#58a6ff","#3fb950","#d29922","#a371f7","#f778ba","#39c5cf","#f0883e","#ff7b72"];
function ahash(s){let h=5381;for(let i=0;i<s.length;i++)h=((h*33)^s.charCodeAt(i))>>>0;return h}
function acol(a){const t=(a||"").trim();if(!t)return null;if(ASGCOL[t])return ASGCOL[t];return APALETTE[ahash(t.toLowerCase())%APALETTE.length]}
const DATA=__DATA__;
const NOTIFS=__NOTIFS__;
let view=JSON.parse(JSON.stringify(DATA)),ops=[],sel=null,ren=false,descEd=false,delArm=null,nseq=0,note="",copied=false,nfMore=false,activeView="board",colOpen={},creating=false,pillEd=null,fmOpen=false,calDayOpen={},calHrOpen={},notifView=false,ctxMenuEl=null;
// Wide screens open live sections by default (Archive stays collapsed) —
// the collapsed compact overview is a phone affordance. Evaluated once at load.
if(matchMedia("(min-width:900px)").matches)COLS.forEach(c=>colOpen[c]=true);
// The tree:/path: query's root card keeps
// the existing selection glow even after the sheet closes. `sel` can't do
// double duty here (render() reopens the sheet whenever sel!==null), so
// focusRoot is a second, glow-only marker set by the graphfocus action and
// cleared whenever the user makes an unrelated selection/query change.
let focusRoot=null;
const $=id=>document.getElementById(id);
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const btn=(label,act,data)=>{const b=el("button",null,label);b.dataset.act=act;if(data)Object.assign(b.dataset,data);return b};
// Desktop-only capability gate for the right-click card menu — same
// query hnav hides on above. A live MediaQueryList (not a one-shot check)
// so a hybrid device's .matches reflects reality at the moment of each
// contextmenu event, not just at page load.
const fineMQ=window.matchMedia("(hover: hover) and (pointer: fine)");
fineMQ.addEventListener("change",()=>render());
// Minimal inline formatting for card bodies —
// **bold** and `code`, nothing else (no headings/lists/links, no nesting
// inside a matched span). Pure segment splitter, no DOM: scans left to
// right, and only treats a marker as an opener if its CLOSING partner
// exists later in the string; an unmatched/unclosed marker falls through to
// the plain-text run byte for byte, so it renders literally instead of
// silently eating the rest of the body. Content between markers is never
// re-scanned for the other marker type — that's the "no nesting" contract.
// A "**" is only a valid opener when it is exactly a 2-star run (text[i+2]
// isn't itself a star) — a 3rd leading star (e.g. ***bold***) is ambiguous,
// so it falls through as a literal '*' and the scan retries one char later,
// which finds the clean "**" and leaves the true extra star(s) as plain
// text instead of gluing a stray '*' onto the inside of a <strong> span.
function fmtBodySegs(text){
const segs=[];let buf="",i=0;
const flush=()=>{if(buf){segs.push({t:"text",v:buf});buf=""}};
while(i<text.length){
if(text[i]==="*"&&text[i+1]==="*"&&text[i+2]!=="*"){const close=text.indexOf("**",i+2);if(close!==-1){flush();segs.push({t:"bold",v:text.slice(i+2,close)});i=close+2;continue}}
else if(text[i]==="`"){const close=text.indexOf("`",i+1);if(close!==-1){flush();segs.push({t:"code",v:text.slice(i+1,close)});i=close+1;continue}}
buf+=text[i];i++}
flush();
return segs}
// Builds the card-body div from fmtBodySegs' output via el()/textContent
// nodes only — card bodies are attacker-writable text (an XSS got through
// this path once), so this NEVER string-concatenates a segment into innerHTML.
function bodyNode(text){
const d=el("div","bodytxt");
fmtBodySegs(text).forEach(s=>{
if(s.t==="bold")d.appendChild(el("strong",null,s.v));
else if(s.t==="code")d.appendChild(el("code",null,s.v));
else d.appendChild(document.createTextNode(s.v))});
return d}
const find=id=>view.find(c=>String(c.id)===String(id));
const isProv=id=>String(id).startsWith("n");
const lstJS=v=>String(v||"").replace(/^\\[|\\]$/g,"").split(",").map(s=>s.trim()).filter(Boolean);
// Search: ported from kanban-web's search.js — space-separated
// terms AND; #id/id: exact; scoped substrings; bare terms hit title+body+tags;
// an unrecognized foo:bar prefix searches as the literal string; a recognized
// prefix with no value yet is dropped (mid-keystroke, matches nothing falsely).
let qTerms=[];
const SFIELDS=["title","body","status","priority","tags","file"];
// tree:/path: graph-focus terms, kept OUT of SFIELDS (numeric
// id semantics, not a lowercased substring) — mirrors kanban-web's search.js
// GRAPH_FIELDS split from KNOWN_FIELDS.
const GFIELDS=["tree","path"];
// ADR 0009: review:/blocked: sticker scopes — a bare value is
// itself a complete "sticker present" term, UNLIKE every SFIELDS scope
// above (mirrors kanban-web's search.js STICKER_FIELDS split).
const STFIELDS=["review","blocked"];
// epic: is its own single-field family — bare presence,
// never dropped (same shape as STFIELDS), but with NO value form: whatever
// follows the colon is discarded rather than kept for a substring match,
// mirrors kanban-web's search.js EPIC_FIELDS split.
const EFIELDS=["epic"];
function parseTerm(tok){
const m1=/^#(\\d+)$/.exec(tok);if(m1)return{f:"id",v:m1[1]};
const m2=/^([A-Za-z]+):(.*)$/.exec(tok);
if(m2){const k=m2[1].toLowerCase();
if(k==="id"){const v=m2[2].trim();return v?{f:"id",v:v}:null}
if(GFIELDS.indexOf(k)!==-1){const v=m2[2].trim().replace(/^#/,"");return v?{f:k,v:v}:null}
if(SFIELDS.indexOf(k)!==-1){const v=m2[2].trim().toLowerCase();return v?{f:k,v:v}:null}
if(STFIELDS.indexOf(k)!==-1)return{f:k,v:m2[2].trim().toLowerCase()}
if(EFIELDS.indexOf(k)!==-1)return{f:k,v:""}}
return{f:null,v:tok.toLowerCase()}}
// tree:/path: terms need the full board's graph to resolve
// (connected component / directed cone), which a single (term, card) pair
// doesn't have — resolveGraphTerms (defined near buildDepGraph, below) pre-
// resolves them into an {f:"ids"} term ONCE per query change, mirroring
// kanban-web's search.js resolveGraphTerms. qMatch's own "tree"/"path" cases
// are an unresolved-fallback safety net — in practice qTerms is always
// resolved before qMatch runs.
function qMatch(c){
if(!qTerms.length)return true;
return qTerms.every(t=>{
const title=String(c.t||"").toLowerCase(),body=String(c.body||"").toLowerCase(),tags=c.tags||[];
switch(t.f){
case "id":return String(c.id)===t.v;
case "title":return title.indexOf(t.v)!==-1;
case "body":return body.indexOf(t.v)!==-1;
case "status":return String(c.s||"").toLowerCase().indexOf(t.v)!==-1;
case "priority":return String(c.p||"").toLowerCase().indexOf(t.v)!==-1;
case "tags":return tags.some(x=>String(x).toLowerCase().indexOf(t.v)!==-1);
case "file":return String(c.fn||"").toLowerCase().indexOf(t.v)!==-1;
// ADR 0009: bare (no value) = the shared presence predicate; a value =
// case-insensitive substring on the sticker's own text.
case "review":return t.v?String(rvReason(c)||"").toLowerCase().indexOf(t.v)!==-1:rvReason(c)!==null;
case "blocked":return t.v?String(blkReason(c)||"").toLowerCase().indexOf(t.v)!==-1:blkReason(c)!==null;
// epic: is a pure presence check on the parsed boolean
// flag (c.ep, set by parse_card's tolerant any-case 'true' read) — t.v is
// always "" (parseTerm discards it), so there's no substring branch to
// mirror review:/blocked:'s.
case "epic":return c.ep===true;
case "ids":return t.ids.has(Number(c.id));
case "tree":case "path":return false;
default:return title.indexOf(t.v)!==-1||body.indexOf(t.v)!==-1||tags.some(x=>String(x).toLowerCase().indexOf(t.v)!==-1)}})}
// Waiting vs blocked/review (review is ADR 0009):
// waiting is DERIVED — a waiting_for id whose card isn't done
// (archived deps count as their status field; dangling ids are
// non-blocking). blocked and review are the manual sticker fields, ONE
// shared presence rule: text with >=1 alphanumeric char; false/no -> clear,
// true -> present with no stated text. review never gates doing entry.
const depOf=id=>find(id)||DATA.find(x=>String(x.id)===String(id));
const unresolved=c=>(c.w||[]).filter(id=>{const d=depOf(id);return d&&d.s!=="done"});
const blkTxt=v=>{v=String(v==null?"":v).trim();if(!v)return null;const lv=v.toLowerCase();if(lv==="false"||lv==="no")return null;if(!/[a-z0-9]/i.test(v))return null;return lv==="true"?"":v};
const blkReason=c=>blkTxt(c.bl);
const rvReason=c=>blkTxt(c.rv);
// Status visibility pills: statuses default ON, archive default
// OFF (parity with kanban-web's opt-in archive pills). Unlisted statuses have
// no pill: they follow the catch-all column (board renders them in the first
// listed column) and stay visible in the date/graph views.
let statusVis={archive:false};
const isVis=k=>k==="archive"?statusVis.archive===true:statusVis[k]!==false;
const visList=()=>DATA.filter(c=>qMatch(c)&&(c.arch?isVis("archive"):(COLS.includes(c.s)?isVis(c.s):true)));
function opLabel(o){
if(o.op==="move")return "Move #"+o.id+" \\u2192 "+o.to;
if(o.op==="create")return "Create \\""+(o.title.length>34?o.title.slice(0,34)+"\\u2026":o.title)+"\\""+(o.status&&o.status!=="backlog"?" in "+o.status:"");
if(o.op==="edit"){const f=[];if(o.title!==undefined)f.push("rename");if(o.priority)f.push("priority "+o.priority);if(o.assignee!==undefined)f.push("assignee "+(o.assignee||"none"));if(o.body!==undefined)f.push("description");if(o.fm)f.push.apply(f,Object.keys(o.fm));return "Edit #"+o.id+" ("+f.join(", ")+")"}
if(o.op==="archive")return "Archive #"+o.id;
if(o.op==="delete")return "Delete #"+o.id;
return JSON.stringify(o)}
function queue(o){
note="";copied=false;
if(o.op==="delete"){if(isProv(o.id)){ops=ops.filter(x=>!(x.op==="create"&&x._pid===o.id));view=view.filter(x=>String(x.id)!==String(o.id));return}
ops=ops.filter(x=>String(x.id)!==String(o.id));ops.push({op:"delete",id:o.id});view=view.filter(x=>String(x.id)!==String(o.id));return}
if(o.op==="archive"){if(isProv(o.id)){note="Apply the create first, then archive it";return}
ops=ops.filter(x=>!(String(x.id)===String(o.id)&&(x.op==="move"||x.op==="archive")));ops.push({op:"archive",id:o.id});view=view.filter(x=>String(x.id)!==String(o.id));return}
if(o.op==="move"){const c=find(o.id);if(!c)return;
if(o.to==="doing"){const un=unresolved(c),br=blkReason(c);
if(un.length||br!==null){const why=[];
if(un.length)why.push("waiting on "+un.map(x=>"#"+x).join(", "));
if(br!==null)why.push("blocked"+(br?": "+br:" (reason unspecified)"));
note="#"+o.id+" is "+why.join(" and ")+" \\u2014 can't enter doing";return}}
if(isProv(o.id)){const cr=ops.find(x=>x.op==="create"&&x._pid===o.id);if(cr)cr.status=o.to}
else{ops=ops.filter(x=>!(x.op==="move"&&String(x.id)===String(o.id)));const orig=DATA.find(d=>String(d.id)===String(o.id));if(orig&&o.to!==orig.s)ops.push({op:"move",id:o.id,to:o.to})}
c.s=o.to;return}
if(o.op==="edit"){const c=find(o.id);if(!c)return;
if(isProv(o.id)){const cr=ops.find(x=>x.op==="create"&&x._pid===o.id);if(cr){if(o.title!==undefined)cr.title=o.title;if(o.priority)cr.priority=o.priority;if(o.assignee!==undefined){if(o.assignee)cr.assignee=o.assignee;else delete cr.assignee}if(o.body!==undefined){if(o.body)cr.body=o.body;else delete cr.body}}}
else{let e=ops.find(x=>x.op==="edit"&&String(x.id)===String(o.id));if(!e){e={op:"edit",id:o.id};ops.push(e)}
if(o.title!==undefined)e.title=o.title;if(o.priority)e.priority=o.priority;if(o.assignee!==undefined)e.assignee=o.assignee;if(o.body!==undefined)e.body=o.body;
if(o.fm)e.fm=Object.assign(e.fm||{},o.fm)}
if(o.title!==undefined)c.t=o.title;if(o.priority)c.p=o.priority;if(o.assignee!==undefined)c.a=o.assignee;if(o.body!==undefined)c.body=o.body;
if(o.fm&&!isProv(o.id)){c.fm=c.fm||{};for(const k in o.fm){const v=o.fm[k];
if(v)c.fm[k]=v;else delete c.fm[k];
if(k==="start_date")c.start=v;else if(k==="end_date")c.end=v;else if(k==="due_date")c.due=v;
else if(k==="tags")c.tags=lstJS(v);else if(k==="waiting_for")c.w=lstJS(v);else if(k==="blocked")c.bl=v;else if(k==="review")c.rv=v;else if(k==="epic")c.ep=String(v).trim().toLowerCase()==="true"}}
return}
if(o.op==="create"){nseq++;const pid="n"+nseq;const cr={op:"create",title:o.title,priority:o.priority||"Normal",status:o.status||"backlog",_pid:pid};if(o.assignee)cr.assignee=o.assignee;if(o.body)cr.body=o.body;ops.push(cr);view.push({id:pid,t:o.title,s:cr.status,p:cr.priority,a:o.assignee||"",due:"",start:"",upd:"",tags:[],w:[],bl:"",rv:"",ep:false,body:o.body||"",fm:{}});return}}
function cardNode(c,detail){
const selc=String(sel)===String(c.id)||(focusRoot!=null&&String(focusRoot)===String(c.id));
const ro=detail&&!!c.arch;
const un=unresolved(c),br=blkReason(c),rr=rvReason(c);
const d=el("div","card"+(selc&&!detail?" sel":"")+(isProv(c.id)?" prov":""));
d.dataset.card=c.id;
if(!detail&&!c.arch&&fineMQ.matches&&dragOn)d.draggable=true;
d.appendChild(el("span","cid",isProv(c.id)?"#new":"#"+c.id));
if(c.p==="High")d.appendChild(el("span","badge","HIGH"));
if(un.length){const wb=el("span","badge wbadge","waiting");wb.title="waiting on "+un.map(x=>"#"+x).join(", ");d.appendChild(wb)}
if(br!==null){const bb=el("span","badge","blocked");bb.title="blocked"+(br?": "+br:"");d.appendChild(bb)}
// ADR 0009: the gold review badge, blocked's sibling — no click-to-filter
// (this viewer has no additive query-append affordance for any badge yet;
// "Dependency tree/path" replaces the whole query box instead — deliberate
// gap, not mirrored here).
if(rr!==null){const rb=el("span","badge rbadge","review");rb.title="review"+(rr?": "+rr:"");d.appendChild(rb)}
const tEl=el("div","ttl",c.t);if(detail&&!ro){tEl.dataset.tap="ren";tEl.title="Tap to rename"}d.appendChild(tEl);
const mp=[];if(c.a){const s=el("span",null);s.style.color=acol(c.a);s.title=c.a;s.appendChild(document.createTextNode(c.a));mp.push(s)}
if(c.due)mp.push(document.createTextNode("due "+c.due));
if(c.p==="Low")mp.push(document.createTextNode("Low"));
if(mp.length){const meta=el("div","meta");mp.forEach((p,i)=>{if(i>0)meta.appendChild(document.createTextNode(" \\u00b7 "));meta.appendChild(p)});d.appendChild(meta)}
if(detail&&ro){
// Archived cards open READ-ONLY — pills are plain text, no
// editors/actions/all-fields; restore stays conversational.
const top=el("div","toprow");
const mk=(txt,color)=>{const s=el("span","fpill");if(color){const dt=el("span","dot");dt.style.background=color;s.appendChild(dt)}s.appendChild(document.createTextNode(txt));return s};
top.appendChild(mk("archived",ARCHC));
top.appendChild(mk(cname(c.s),ccol(c.s)));
if(c.a){const s=el("span","fpill");s.style.color=acol(c.a);s.appendChild(document.createTextNode(c.a));top.appendChild(s)}
top.appendChild(mk(c.p));
d.insertBefore(top,d.firstChild)}
else if(detail){
// The pills ARE the editors — tap one to open its chooser in the
// slot below. Disposition (archive/delete) lives on the side stack.
// Rename = tap the title.
const top=el("div","toprow");
const sp=el("button","fpill");sp.dataset.act="pill";sp.dataset.pill="status";
const sdot=el("span","dot");sdot.style.background=ccol(c.s);
sp.appendChild(sdot);sp.appendChild(document.createTextNode(cname(c.s)));
top.appendChild(sp);
const ap=el("button","fpill");ap.dataset.act="pill";ap.dataset.pill="assignee";
if(c.a)ap.style.color=acol(c.a);
ap.appendChild(document.createTextNode(c.a||"no assignee"));top.appendChild(ap);
const pp=btn(c.p,"pill",{pill:"priority"});pp.className="fpill";top.appendChild(pp);
d.insertBefore(top,d.firstChild);
const slot=el("div","acts");slot.style.borderTop="none";slot.style.marginTop="0";slot.style.paddingTop="0";
if(ren){
const inp=el("input");inp.type="text";inp.id="renin";inp.value=c.t;inp.dataset.stop="1";
slot.appendChild(inp);slot.appendChild(btn("Save","rensave"));slot.appendChild(btn("Cancel","rencancel"))}
else if(descEd){
const lb=el("span","lbl","description (markdown, saved under the title)");slot.appendChild(lb);
const ta=el("textarea");ta.id="descin";ta.value=c.body||"";ta.rows=7;ta.dataset.stop="1";ta.style.fontSize="14px";
slot.appendChild(ta);slot.appendChild(btn("Save","descsave"));slot.appendChild(btn("Cancel","desccancel"))}
else if(pillEd==="status"){
slot.appendChild(el("span","lbl","move to"));
COLS.filter(x=>x!==c.s).forEach(x=>slot.appendChild(btn(cname(x),"move",{to:x})))}
else if(pillEd==="priority"){
slot.appendChild(el("span","lbl","priority"));
["High","Normal","Low"].forEach(p=>{const b=btn((c.p===p?"\\u2713 ":"")+p,"prio",{p:p});slot.appendChild(b)})}
else if(pillEd==="assignee"){
slot.appendChild(el("span","lbl","assignee"));
const s=el("select");s.dataset.act="asg";s.dataset.stop="1";
const aopts=(c.a&&ASG.indexOf(c.a)===-1)?ASG.concat([c.a]):ASG;
aopts.forEach(x=>{const o=el("option",null,x||"none");o.value=x;if(c.a===x)o.selected=true;s.appendChild(o)});
slot.appendChild(s)}
if(slot.children.length)d.insertBefore(slot,d.children[1])}
if(detail){
if(un.length)d.appendChild(el("div","meta wline","waiting on "+un.map(x=>"#"+x).join(", ")));
if(br!==null)d.appendChild(el("div","meta bline","blocked: "+(br||"reason unspecified")));
if(rr!==null)d.appendChild(el("div","meta rline","review: "+(rr||"text unspecified")));
if(c.tags&&c.tags.length){const tg=el("div","tags");c.tags.forEach(t=>tg.appendChild(el("span","tag",t)));d.appendChild(tg)}
const det=[];if(c.start)det.push("start "+c.start);if(c.upd)det.push("updated "+c.upd);
if(det.length)d.appendChild(el("div","meta",det.join(" \\u00b7 ")));
// "Dependency tree"/"Dependency path" write tree:/path: into
// the search box and close the sheet (sugar only, no view switch) — read-only
// queries, so unlike the edit actions below they run on ro (archived) sheets
// too; only a not-yet-created provisional card has no real id to focus on.
if(!isProv(c.id)){
const gr=el("div","acts");gr.style.borderTop="none";gr.style.paddingTop="4px";
gr.appendChild(btn("Dependency tree","graphfocus",{gk:"tree"}));
gr.appendChild(btn("Dependency path","graphfocus",{gk:"path"}));
d.appendChild(gr)}
if(!ro&&!isProv(c.id)){
// Every frontmatter field is editable, raw and tolerant. The
// staples are always offered; unknown keys a board grows show up dynamically.
const fr=el("div","acts");fr.style.borderTop="none";fr.style.paddingTop="4px";
fr.appendChild(btn((fmOpen?"\\u25be":"\\u25b8")+" All fields","fmtoggle"));
d.appendChild(fr);
if(fmOpen){
const staples=["start_date","end_date","due_date","tags","waiting_for","blocked","review"];
const keys=[...new Set(staples.concat(Object.keys(c.fm||{})))].filter(k=>["status","priority","assignee","updated"].indexOf(k)===-1);
keys.forEach(k=>{
const row=el("div","fmrow");
row.appendChild(el("label",null,k));
const inp=el("input");inp.type="text";inp.id="fm-"+k;inp.dataset.stop="1";inp.value=(c.fm&&c.fm[k])||"";
if(k==="blocked"&&blkTxt(inp.value)!==null)inp.style.borderColor="var(--high)";
if(k==="review"&&blkTxt(inp.value)!==null)inp.style.borderColor="var(--rev)";
row.appendChild(inp);
row.appendChild(btn("Save","fmsave",{key:k}));
d.appendChild(row)})}}
if(!ro&&!descEd){const er=el("div","acts");er.appendChild(btn(c.body?"Edit description":"Add description","desc"));d.appendChild(er)}
if(c.body&&!descEd)d.appendChild(bodyNode(c.body))}
return d}
function statusPills(){
const row=el("div","pillrow");
COLS.concat(["archive"]).forEach(k=>{
const b=el("button",isVis(k)?null:"off");b.dataset.act="spill";b.dataset.st=k;
const dot=el("span","dot");dot.style.background=k==="archive"?ARCHC:ccol(k);
b.appendChild(dot);b.appendChild(document.createTextNode(k==="archive"?"Archive":cname(k)));
row.appendChild(b)});
return row}
function render(){
const board=$("board");board.replaceChildren();
$("boardpills").replaceChildren(statusPills());
// Each section (header + its cards) wraps in a .boardcol container at
// EVERY width — a plain block box below 900px (identical to the old flat
// sibling list), a flex column strip at >=900px (see the tier-2 media
// query above). Collapsed sections skip .colcards entirely and render as
// just the header, which the same media query narrows into a strip.
COLS.filter(col=>isVis(col)).forEach(col=>{
const cs=view.filter(c=>qMatch(c)&&!c.arch&&(c.s===col||(col===COLS[0]&&!COLS.includes(c.s))));
const open=!!colOpen[col];
const wrap=el("div","boardcol"+(open?"":" collapsed"));
wrap.dataset.status=col;
const h=el("div","colh");
h.dataset.coltoggle=col;
h.appendChild(el("span","chev",open?"\\u25be":"\\u25b8"));
const dot=el("span","dot");dot.style.background=ccol(col);
h.appendChild(dot);h.appendChild(document.createTextNode(cname(col)));h.appendChild(el("span","cnt",String(cs.length)));
wrap.appendChild(h);
if(open){
const cc=el("div","colcards");
if(cs.length)cs.forEach(c=>cc.appendChild(cardNode(c,false)));
else{const e=el("div",null,"no cards");e.style.cssText="font-size:12px;color:var(--muted);padding:8px 2px";cc.appendChild(e)}
wrap.appendChild(cc)}
board.appendChild(wrap)});
if(isVis("archive")){
const acs=view.filter(c=>c.arch&&qMatch(c));
const open=!!colOpen["archive"];
const wrap=el("div","boardcol"+(open?"":" collapsed"));
const h=el("div","colh");
h.dataset.coltoggle="archive";
h.appendChild(el("span","chev",open?"\\u25be":"\\u25b8"));
const dot=el("span","dot");dot.style.background=ARCHC;
h.appendChild(dot);h.appendChild(document.createTextNode("Archive"));h.appendChild(el("span","cnt",String(acs.length)));
wrap.appendChild(h);
if(open){
const cc=el("div","colcards");
acs.forEach(c=>{const n=cardNode(c,false);n.classList.add("archcard");cc.appendChild(n)});
wrap.appendChild(cc)}
board.appendChild(wrap)}
const mc=(!creating&&!notifView&&sel!==null)?find(sel):null;
if(creating){$("modalscroll").replaceChildren(newFormNode());$("modal").style.display=""}
else if(notifView){$("modalscroll").replaceChildren(notifListNode());$("modal").style.display=""}
else if(mc){$("modalscroll").replaceChildren(cardNode(mc,true));$("modal").style.display=""}
else{$("modal").style.display="none";$("modalscroll").replaceChildren()}
const unread=NOTIFS.filter(n=>!n.read).length;
$("bellcnt").style.display=unread?"":"none";
$("bellcnt").textContent=unread?String(unread):"";
syncStack();
$("pill").textContent=ops.length?ops.length+" pending":"";
const p=$("pend");p.replaceChildren();
if(!ops.length&&!note){p.style.display="none";return}
p.style.display="block";
if(ops.length){
const t=el("div",null,"Pending changes");t.style.cssText="font-size:13px;font-weight:600;margin-bottom:4px";p.appendChild(t);
ops.forEach((o,i)=>{const r=el("div","prow");r.appendChild(el("span",null,opLabel(o)));const rm=el("button",null,"remove");rm.dataset.rm=String(i);r.appendChild(rm);p.appendChild(r)});
if(note)p.appendChild(el("div","note",note));
const bs=el("div","btns");
const ap=el("button",null,copied?"\\u2713 Copied":"Copy changes");ap.dataset.act="apply";ap.style.cssText="border-color:var(--accent);color:var(--accent);font-weight:600";
bs.appendChild(ap);bs.appendChild(btn("Discard all","discard"));p.appendChild(bs);
const box=el("div","copybox");box.id="copybox";
const ta=el("textarea");ta.id="payload";ta.readOnly=true;ta.dataset.stop="1";ta.value=payload();
const hint=el("div","hint");hint.id="copyhint";hint.textContent=copied?"Copied \\u2014 now paste it into the Claude chat and send.":"Tap Copy changes, then paste into the Claude chat. If copy fails, long-press the text below to select and copy it.";
if(copied)hint.className="hint ok";
box.appendChild(hint);box.appendChild(ta);p.appendChild(box)}
else if(note)p.appendChild(el("div","note",note))}
function payload(){
const clean=ops.map(o=>{const x=Object.assign({},o);delete x._pid;return x});
return "Apply kanban changes ("+clean.length+" ops, base "+BASE+"):\\n"+JSON.stringify(clean)}
// The ONE clipboard code path (kanban.proj #252): both the tray's
// Copy changes button and the header pill funnel through this, so there is
// exactly one place that knows how to copy the payload and one fallback
// chain -- async Clipboard API first, then focusing/selecting the hidden
// #payload textarea and running the execCommand copy command for browsers
// (and the Claude mobile app's embedded viewer) that don't expose the async
// API. execCommand REPORTS a blocked copy by RETURNING FALSE rather than
// throwing, so its return value -- not just a try/catch -- is what decides
// ok/bad; a catch alone would report every blocked copy as a success.
// onDone(ok) always fires, synchronously on the execCommand path or async on
// the Clipboard API path, so callers can react to failure (the pill sets a
// note; the tray leans on the existing `copied` flag/hint) without
// duplicating the copy logic itself.
function copyPayload(onDone){
const txt=payload();
const ok=()=>{copied=true;if(onDone)onDone(true)};
const bad=()=>{if(onDone)onDone(false)};
const fallback=()=>{const ta=$("payload");if(!ta){bad();return}ta.focus();ta.select();try{document.execCommand("copy")?ok():bad()}catch(err){bad()}};
if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).then(ok).catch(fallback);
else fallback()}
// New-card form: renders inside the pop-up sheet; nothing joins
// any list until Accept queues the create op — Cancel leaves zero trace.
// Notifications pop-out: read-only render of the embedded
// notifications.md snapshot per contract v2 — TLDR bold, level tints,
// unread accent. Read-flips and clears are board writes: they go through
// the conversation, not this sheet.
function notifListNode(){
const w=el("div");w.style.padding="4px 2px";
const t=el("div",null,"Notifications");t.style.cssText="font-size:14px;font-weight:600;margin-bottom:6px";w.appendChild(t);
if(!NOTIFS.length){w.appendChild(el("div","cal-norows","no notifications"));return w}
NOTIFS.slice().reverse().forEach(n=>{
const row=el("div","nrow nlv-"+n.level+(n.read?"":" unread"));
const msg=String(n.message);
const i=msg.indexOf("; more: ");
const line=el("div");
line.appendChild(el("strong",null,i===-1?msg:msg.slice(0,i)));
if(i!==-1)line.appendChild(document.createTextNode(msg.slice(i)));
row.appendChild(line);
row.appendChild(el("div","nmeta","#"+n.id+" \\u00b7 "+n.level+" \\u00b7 "+n.at+" \\u00b7 "+n.from+(n.read?"":" \\u00b7 unread")));
w.appendChild(row)});
return w}
function newFormNode(){
const prev={t:$("nc-t")&&$("nc-t").value,s:$("nc-s")&&$("nc-s").value,p:$("nc-p")&&$("nc-p").value,a:$("nc-a")&&$("nc-a").value,b:$("nc-b")&&$("nc-b").value};
const f=el("div");f.style.padding="6px 2px";
const t=el("div",null,"New card");t.style.cssText="font-size:13px;font-weight:600;margin-bottom:4px";f.appendChild(t);
const inp=el("input");inp.type="text";inp.id="nc-t";inp.placeholder="Card title";inp.dataset.stop="1";if(prev.t)inp.value=prev.t;f.appendChild(inp);
const row=el("div","row2");
const ss=el("select");ss.id="nc-s";ss.dataset.stop="1";COLS.forEach(x=>{const o=el("option",null,cname(x));o.value=x;ss.appendChild(o)});ss.value=prev.s||(COLS.includes("backlog")?"backlog":COLS[0]);
const sp=el("select");sp.id="nc-p";sp.dataset.stop="1";["Normal","High","Low"].forEach(x=>sp.appendChild(el("option",null,x)));if(prev.p)sp.value=prev.p;
const sa=el("select");sa.id="nc-a";sa.dataset.stop="1";const o0=el("option",null,"no assignee");o0.value="";sa.appendChild(o0);ASG.filter(x=>x).forEach(x=>sa.appendChild(el("option",null,x)));if(prev.a)sa.value=prev.a;
row.appendChild(ss);row.appendChild(sp);row.appendChild(sa);f.appendChild(row);
if(nfMore){
const lb=el("div","lbl","description (markdown, optional)");lb.style.marginTop="6px";f.appendChild(lb);
const ta=el("textarea");ta.id="nc-b";ta.rows=5;ta.dataset.stop="1";ta.placeholder="More detail, acceptance criteria, links\\u2026";ta.style.fontSize="14px";ta.style.marginTop="4px";if(prev.b)ta.value=prev.b;f.appendChild(ta)}
const bs=el("div","btns");bs.appendChild(btn("Accept","ncadd"));
if(!nfMore)bs.appendChild(btn("More\\u2026","ncmore"));
bs.appendChild(btn("Cancel","nccancel"));f.appendChild(bs);
return f}
const SVGNS="http://www.w3.org/2000/svg";
const svgEl=(tag,attrs)=>{const e=document.createElementNS(SVGNS,tag);if(attrs)for(const k in attrs)e.setAttribute(k,attrs[k]);return e};
const truncate=(s,n)=>{s=String(s||"");return s.length>n?s.slice(0,n-1)+"\\u2026":s};
// Sideways finger-drags on a phone bleed into vertical scroll and
// the artifact view hijacks the gesture — give every horizontal scroll
// container explicit step buttons, placed right above the thing they scroll.
function hscrollNav(wrap){
const nav=el("div","hnav");
const lb=el("button",null,"\\u25c0"),rb=el("button",null,"\\u25b6");
lb.setAttribute("aria-label","Scroll left");rb.setAttribute("aria-label","Scroll right");
lb.addEventListener("click",()=>wrap.scrollBy({left:-Math.round(wrap.clientWidth*0.8),behavior:"smooth"}));
rb.addEventListener("click",()=>wrap.scrollBy({left:Math.round(wrap.clientWidth*0.8),behavior:"smooth"}));
nav.appendChild(lb);nav.appendChild(rb);
return nav}
const MW=150,MH=54,GX=14,GY=36,MPAD=14;
function switchView(v){
if(activeView===v)return;
if(ctxMenuEl)closeCtxMenu();
activeView=v;
document.querySelectorAll("#viewtabs button[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
$("boardview").style.display=v==="board"?"":"none";
$("mapview").style.display=v==="map"?"":"none";
$("ganttview").style.display=v==="gantt"?"":"none";
$("calview").style.display=v==="calendar"?"":"none"}
// Mirrors kanban-web's dependency-graph.js semantics (edge = dependency ->
// waiter, same direction as the kanban-cli skill's Mermaid output) but reads
// the viewer's own DATA snapshot; a waiting_for id not embedded renders as a
// ghost stub, same as a stale/deleted reference. Nodes carry both flags:
// derived done-aware waiting + the manual blocked sticker.
//
// A child card's `pt` (parsed `parent:` frontmatter) becomes a child->epic edge,
// kind "epic" (waiting_for edges are kind "dep"). Two suppression rules —
// nonTerminal (a member some OTHER same-epic member already depends on
// skips its own direct hop) and "sequencing wins the pair" (skip the epic
// edge if a dep edge already connects the same two ids, either direction) —
// are computed over the FULL board (fullEdgeSets, keyed off DATA), never the
// filtered `cards` this function is called with: a search/status filter must
// not reroute epic membership, mirroring kanban-web's own comment on this
// exact point. An edge is only ADDED when its owning card (the waiter for a
// dep edge, the member for an epic edge) is present in `cards` — the same
// asymmetry the original dep-only version already had; the other endpoint
// ghosts if absent, whether truly off-board or merely filtered out.
function parentOfIn(byIdMap,id){
const c=byIdMap.get(id);
return (c&&c.pt!=null&&c.pt!==c.id)?c.pt:null}
function fullEdgeSets(){
const byIdFull=new Map(DATA.map(c=>[Number(c.id),c]));
const seenDep=new Set(),nonTerminal=new Set();
DATA.forEach(c=>{const cid=Number(c.id);(c.w||[]).forEach(raw=>seenDep.add(Number(raw)+">"+cid))});
DATA.forEach(c=>{const cid=Number(c.id),p=parentOfIn(byIdFull,cid);
if(p==null)return;
(c.w||[]).forEach(raw=>{const depId=Number(raw);if(parentOfIn(byIdFull,depId)===p)nonTerminal.add(p+":"+depId)})});
return {byIdFull:byIdFull,seenDep:seenDep,nonTerminal:nonTerminal}}
function buildDepGraph(cards){
const byId=new Map(cards.map(c=>[Number(c.id),c]));
const nodes=cards.map(c=>({id:Number(c.id),title:c.t,status:c.s,waiting:unresolved(c),blk:blkReason(c),arch:!!c.arch}));
const nodeIds=new Set(nodes.map(n=>n.id));
const edges=[],seen=new Set(),ghostIds=new Set();
const addEdge=(from,to,kind)=>{
const key=from+">"+to+":"+kind;
if(seen.has(key))return;seen.add(key);
if(!byId.has(from))ghostIds.add(from);
if(!byId.has(to))ghostIds.add(to);
edges.push({from:from,to:to,kind:kind})};
cards.forEach(c=>{(c.w||[]).forEach(raw=>addEdge(Number(raw),Number(c.id),"dep"))});
const full=fullEdgeSets();
cards.forEach(c=>{
const cid=Number(c.id),p=parentOfIn(full.byIdFull,cid);
if(p==null)return;
if(full.nonTerminal.has(p+":"+cid))return;
if(full.seenDep.has(cid+">"+p)||full.seenDep.has(p+">"+cid))return;
addEdge(cid,p,"epic")});
const ghosts=[...ghostIds].filter(id=>!nodeIds.has(id)).sort((a,b)=>a-b).map(id=>({id:id,title:null,ghost:true}));
const touchedByDep=new Set(),touchedByAny=new Set();
edges.forEach(e=>{touchedByAny.add(e.from);touchedByAny.add(e.to);if(e.kind==="dep"){touchedByDep.add(e.from);touchedByDep.add(e.to)}});
// The "no dependencies" row is keyed off SEQUENCING (dep) edges
// only; the layered graph draws every node touched by ANY edge — a node
// whose only edge is epic membership joins BOTH.
const isolated=nodes.filter(n=>!touchedByDep.has(n.id));
const participants=nodes.filter(n=>touchedByAny.has(n.id));
return {nodes:nodes,edges:edges,ghosts:ghosts,isolated:isolated,participants:participants}}
// tree:<id>/path:<id> search terms. Both reuse buildDepGraph(DATA)
// (the full live+archived board, ALWAYS — never a filtered slice, so a query
// can't shrink its own graph) as the sole adjacency source: treeIds is the
// undirected connected component (flood-fill both directions); pathIds is
// the directed cone (ancestors + descendants + self, narrower than tree:,
// since a sibling branch with no directed relation is excluded). Unknown or
// non-numeric id -> empty Set; an isolated card -> a one-element Set
// (itself); BFS with a visited Set is cycle-safe by construction.
function buildAdjacency(){
const {edges}=buildDepGraph(DATA);
const forward=new Map(),backward=new Map();
edges.forEach(e=>{
if(!forward.has(e.from))forward.set(e.from,new Set());forward.get(e.from).add(e.to);
if(!backward.has(e.to))backward.set(e.to,new Set());backward.get(e.to).add(e.from)});
return {forward:forward,backward:backward}}
function walkFrom(start,adjacency,visited){
const queue=[start];
while(queue.length){const cur=queue.shift();
(adjacency.get(cur)||new Set()).forEach(next=>{if(!visited.has(next)){visited.add(next);queue.push(next)}})}}
function treeIds(rawId){
const id=Number(rawId);
if(!DATA.some(c=>Number(c.id)===id))return new Set();
const {forward,backward}=buildAdjacency();
const visited=new Set([id]);
const queue=[id];
while(queue.length){const cur=queue.shift();
const neighbors=new Set([...(forward.get(cur)||[]),...(backward.get(cur)||[])]);
neighbors.forEach(next=>{if(!visited.has(next)){visited.add(next);queue.push(next)}})}
return visited}
function pathIds(rawId){
const id=Number(rawId);
if(!DATA.some(c=>Number(c.id)===id))return new Set();
const {forward,backward}=buildAdjacency();
const visited=new Set([id]);
walkFrom(id,forward,visited);
walkFrom(id,backward,visited);
return visited}
// Pre-resolve tree:/path: terms into an already-resolved {f:"ids"}
// term BEFORE qMatch's per-card pass — a single (term, card) pair has no
// graph to resolve against. Mirrors kanban-web's search.js resolveGraphTerms.
function resolveGraphTerms(terms){
if(!terms.some(t=>t.f==="tree"||t.f==="path"))return terms;
return terms.map(t=>{
if(t.f==="tree")return{f:"ids",v:t.v,ids:treeIds(t.v)};
if(t.f==="path")return{f:"ids",v:t.v,ids:pathIds(t.v)};
return t})}
// Kahn's algorithm, top-down layer per node; force-breaks a cycle by taking the
// lowest remaining id so this always terminates (same approach as kanban-web's
// layerNodes in dependency-graph.js).
function layerNodes(ids,edges){
const remaining=new Set(ids);
const indeg=new Map(ids.map(id=>[id,0]));
const succ=new Map(ids.map(id=>[id,[]]));
edges.forEach(e=>{
if(e.from===e.to)return;
if(!remaining.has(e.from)||!remaining.has(e.to))return;
succ.get(e.from).push(e.to);
indeg.set(e.to,indeg.get(e.to)+1)});
const layer=new Map();let cur=0;
while(remaining.size){
let ready=[...remaining].filter(id=>indeg.get(id)===0);
if(!ready.length)ready=[Math.min(...remaining)];
ready.sort((a,b)=>a-b);
ready.forEach(id=>{layer.set(id,cur);remaining.delete(id)});
ready.forEach(id=>{(succ.get(id)||[]).forEach(s=>{if(remaining.has(s))indeg.set(s,indeg.get(s)-1)})});
cur++}
return layer}
function mapNodeGroup(n,p){
const cls="mnode"+(n.ghost?" ghost":"")+(n.waiting&&n.waiting.length?" waiting":"")+(n.blk!=null?" blocked":"");
const g=svgEl("g",{class:cls,transform:"translate("+p.x+","+p.y+")"});
if(!n.ghost)g.setAttribute("data-mapnode",String(n.id));
const tt=svgEl("title");
tt.textContent=n.ghost?("#"+n.id+" \\u2014 referenced but not on this board"):("#"+n.id+" "+n.title+(n.waiting.length?" (waiting on "+n.waiting.map(x=>"#"+x).join(", ")+")":"")+(n.blk!=null?" (blocked"+(n.blk?": "+n.blk:"")+")":"")+(n.arch?" (archived)":""));
g.appendChild(tt);
g.appendChild(svgEl("rect",{width:MW,height:MH,rx:8}));
const idt=svgEl("text",{x:10,y:19,class:"mid"});idt.textContent="#"+n.id;g.appendChild(idt);
const tl=svgEl("text",{x:10,y:37,class:"mtitle"});tl.textContent=n.ghost?"(not on board)":truncate(n.title,20);g.appendChild(tl);
if(!n.ghost){const dot=svgEl("circle",{cx:MW-12,cy:12,r:4});dot.style.fill=n.arch?ARCHC:ccol(n.status);g.appendChild(dot)}
if(!n.ghost&&n.blk!=null){
// red PILL, not a border — borders stay priority/status territory, and
// the pill leaves the amber waiting stroke visible on a node
// that is both waiting and blocked.
g.appendChild(svgEl("rect",{x:MW-46,y:MH-17,width:40,height:12,rx:6,class:"mblk"}));
const bt=svgEl("text",{x:MW-26,y:MH-8,class:"mblkt","text-anchor":"middle"});bt.textContent="blocked";g.appendChild(bt)}
if(n.arch)g.style.opacity=".55";
return g}
function buildMapSvg(graph,participants){
const allNodes=participants.concat(graph.ghosts);
const byId=new Map(allNodes.map(n=>[n.id,n]));
const ids=allNodes.map(n=>n.id);
const layer=layerNodes(ids,graph.edges);
const layers=new Map();
layer.forEach((l,id)=>{if(!layers.has(l))layers.set(l,[]);layers.get(l).push(id)});
layers.forEach(arr=>arr.sort((a,b)=>a-b));
const numLayers=layers.size?Math.max(...layers.keys())+1:0;
const pos=new Map();
layers.forEach((arr,l)=>{arr.forEach((id,i)=>{const x=MPAD+i*(MW+GX),y=MPAD+l*(MH+GY);pos.set(id,{x:x,y:y,cx:x+MW/2})})});
let maxX=MPAD;
pos.forEach(p=>{maxX=Math.max(maxX,p.x+MW)});
const BOW=MW*0.9;
const edgesG=svgEl("g");
graph.edges.forEach(e=>{
const from=pos.get(e.from),to=pos.get(e.to);
if(!from||!to)return;
const back=(layer.get(e.to)||0)<=(layer.get(e.from)||0);
const x1=from.cx,y1=from.y+MH,x2=to.cx,y2=to.y;
let d;
if(back){maxX=Math.max(maxX,x1+BOW,x2+BOW);d="M"+x1+","+y1+" C"+(x1+BOW)+","+y1+" "+(x2+BOW)+","+y2+" "+x2+","+y2}
else{const midY=(y1+y2)/2;d="M"+x1+","+y1+" C"+x1+","+midY+" "+x2+","+midY+" "+x2+","+y2}
const dimmed=(byId.get(e.from)&&byId.get(e.from).ghost)||(byId.get(e.to)&&byId.get(e.to).ghost);
const epicEdge=e.kind==="epic";
edgesG.appendChild(svgEl("path",{d:d,class:"medge"+(epicEdge?" epicedge":"")+(dimmed?" ghostedge":""),"marker-end":"url(#"+(epicEdge?"map-arrow-epic":"map-arrow")+")"}))});
const nodesG=svgEl("g");
pos.forEach((p,id)=>{const n=byId.get(id);if(n)nodesG.appendChild(mapNodeGroup(n,p))});
const width=maxX+MPAD;
const height=Math.max(MH+MPAD*2,numLayers*(MH+GY)-GY+MPAD*2);
const svg=svgEl("svg",{class:"map-canvas",width:String(width),height:String(height),viewBox:"0 0 "+width+" "+height});
const defs=svgEl("defs");
const marker=svgEl("marker",{id:"map-arrow",viewBox:"0 0 10 10",refX:"9",refY:"5",markerWidth:"7",markerHeight:"7",orient:"auto-start-reverse"});
marker.appendChild(svgEl("path",{d:"M0,0 L10,5 L0,10 z"}));
defs.appendChild(marker);
const epicMarker=svgEl("marker",{id:"map-arrow-epic",viewBox:"0 0 10 10",refX:"9",refY:"5",markerWidth:"7",markerHeight:"7",orient:"auto-start-reverse"});
epicMarker.appendChild(svgEl("path",{d:"M0,0 L10,5 L0,10 z",class:"map-arrow-epic-head"}));
defs.appendChild(epicMarker);
svg.appendChild(defs);
svg.appendChild(edgesG);svg.appendChild(nodesG);
return svg}
function isoChip(n){
const d=el("div","mapiso");
d.setAttribute("data-mapnode",String(n.id));
d.appendChild(el("span","cid","#"+n.id));
d.appendChild(document.createTextNode(truncate(n.title,30)));
return d}
// Mobile-first shortcut for the map's `epic:` search term —
// rides in the SAME pillrow as the status pills (renderMap only: render()/
// renderGantt()/renderCalendar() call statusPills() unaugmented, so the chip
// never shows outside Map view). Toggles: tap writes epic: into #q, tap
// again removes it — same "write straight into the box, re-render" pattern
// as the graphfocus tree:/path: buttons, but a TOGGLE since
// this chip only ever manages the one term (graphfocus always REPLACES).
function isEpicSearchActive(){
const raw=String($("q")?$("q").value:"");
return raw.trim().split(/\\s+/).some(t=>/^epic:/i.test(t))}
function epicChip(){
const on=isEpicSearchActive();
const b=el("button",on?"epicchip on":"epicchip","Epics");
b.dataset.act="epicchip";
b.title=on?"Clear the epic: search term":"Filter the map to epic-marked cards (writes epic: into the search box)";
return b}
function renderMap(){
const mv=$("mapview");mv.replaceChildren();
const pillrow=statusPills();pillrow.appendChild(epicChip());mv.appendChild(pillrow);
const graph=buildDepGraph(visList());
if(!graph.nodes.length){mv.appendChild(el("div","map-empty","No cards to show."));return}
const legend=el("div","map-legend");
const swatch=(cls,label)=>{const s=el("span");s.appendChild(el("span","map-swatch"+(cls?" "+cls:"")));s.appendChild(document.createTextNode(label));return s};
legend.appendChild(swatch("","workable"));
legend.appendChild(swatch("waiting","waiting"));
legend.appendChild(swatch("blocked","blocked"));
legend.appendChild(swatch("ghost","not on this board"));
mv.appendChild(legend);
const participants=graph.participants;
if(participants.length||graph.ghosts.length){
mv.appendChild(el("div","map-title","Dependency graph ("+participants.length+")"));
const wrap=el("div","map-scroll");
wrap.appendChild(buildMapSvg(graph,participants));
mv.appendChild(hscrollNav(wrap));
mv.appendChild(wrap)}
if(graph.isolated.length){
mv.appendChild(el("div","map-title","No dependencies ("+graph.isolated.length+")"));
const row=el("div","map-iso-row");
graph.isolated.forEach(n=>row.appendChild(isoChip(n)));
mv.appendChild(row)}}
// --- date triad model, ported from kanban-web's calendar-model.js / gantt-model.js ---
// Working range = start->end, with the compat fallback start->due when end is
// absent; a REVERSED range collapses to a 1-day event at the range END; due is
// an independent marker. UTC day math on purpose (DST-proof).
const dayPart=v=>{const m=/^(\\d{4}-\\d{2}-\\d{2})/.exec(String(v||""));return m?m[1]:""};
const timePart=v=>{const m=/^\\d{4}-\\d{2}-\\d{2}T(.+)$/.exec(String(v||""));return m?m[1]:""};
const DAY_MS=86400000,pad2=n=>String(n).padStart(2,"0");
const dayToUtc=d=>{const p=d.split("-").map(Number);return Date.UTC(p[0],p[1]-1,p[2])};
const utcToDay=ms=>{const t=new Date(ms);return t.getUTCFullYear()+"-"+pad2(t.getUTCMonth()+1)+"-"+pad2(t.getUTCDate())};
const addDays=(d,n)=>utcToDay(dayToUtc(d)+n*DAY_MS);
const diffDays=(a,b)=>Math.round((dayToUtc(b)-dayToUtc(a))/DAY_MS);
const todayLocal=()=>{const n=new Date();return n.getFullYear()+"-"+pad2(n.getMonth()+1)+"-"+pad2(n.getDate())};
function rangeFields(c){const s=dayPart(c.start),e=dayPart(c.end);if(e)return{startDay:s||null,endDay:e,endSrc:"end"};const du=dayPart(c.due);if(s&&du)return{startDay:s,endDay:du,endSrc:"due"};return{startDay:s||null,endDay:null,endSrc:null}}
function cardSchedule(c){const rf=rangeFields(c);
if(!rf.startDay&&!rf.endDay)return{kind:"none"};
const endTime=rf.endSrc?timePart(c[rf.endSrc]):"";
if(rf.startDay&&rf.endDay)return rf.startDay<=rf.endDay?{kind:"range",startDay:rf.startDay,endDay:rf.endDay,startTime:timePart(c.start),endTime:endTime}:{kind:"single",day:rf.endDay,time:endTime};
if(rf.startDay)return{kind:"single",day:rf.startDay,time:timePart(c.start)};
return{kind:"single",day:rf.endDay,time:endTime}}
function barSpan(c){const s=cardSchedule(c);if(s.kind==="range")return{startDay:s.startDay,endDay:s.endDay};if(s.kind==="single")return{startDay:s.day,endDay:s.day};return null}
const dueDayOf=c=>dayPart(c.due);
function chipPositionForDay(sch,day){
if(sch.kind==="single")return sch.day===day?"single":null;
if(sch.kind!=="range")return null;
if(day<sch.startDay||day>sch.endDay)return null;
if(sch.startDay===sch.endDay)return "single";
if(day===sch.startDay)return "range-start";
if(day===sch.endDay)return "range-end";
return "range-mid"}
// --- gantt view ----------------------------------------------------------------------
// Rows group by status in COLS order (config statuses), unlisted
// statuses appended alphabetically — same tolerance as kanban-web's ganttGroups.
// Undated cards are NOT dropped (unlike the web gantt): they land in a dimmed
// chip row below, mirroring the map's "No dependencies" treatment.
const GDAY=18,GROWH=30,GLBL=118,GHDR=24,GBARH=14,GMAXD=180;
const MSHORT=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const isMonday=d=>new Date(dayToUtc(d)).getUTCDay()===1;
const weekLabel=d=>{const p=d.split("-").map(Number);return MSHORT[p[1]-1]+" "+p[2]};
function ganttData(){
const buckets=new Map(),undated=[],archRows=[];
visList().forEach(c=>{const span=barSpan(c),du=dueDayOf(c);
if(!span&&!du){undated.push(c);return}
const row={c:c,startDay:span?span.startDay:null,endDay:span?span.endDay:null,dueDay:du||null};
if(c.arch){archRows.push(row);return}
const st=String(c.s||"");if(!buckets.has(st))buckets.set(st,[]);
buckets.get(st).push(row)});
const known=COLS.filter(s=>buckets.has(s));
const unknown=[...buckets.keys()].filter(s=>!COLS.includes(s)).sort();
// label, not status: archive is a location, never a status value (ADR 0002).
const groups=known.concat(unknown).map(s=>({label:s,rows:buckets.get(s).sort((a,b)=>a.c.id-b.c.id)}));
if(archRows.length)groups.push({label:"Archive",rows:archRows.sort((a,b)=>a.c.id-b.c.id)});
return{groups:groups,undated:undated}}
function ganttWindow(rows,today){
const spans=rows.map(r=>{let lo=r.startDay||r.dueDay,hi=r.endDay||r.dueDay;
if(r.dueDay&&r.dueDay<lo)lo=r.dueDay;if(r.dueDay&&r.dueDay>hi)hi=r.dueDay;return{s:lo,e:hi}});
let lo=spans[0].s,hi=spans[0].e;
spans.forEach(x=>{if(x.s<lo)lo=x.s;if(x.e>hi)hi=x.e});
const natStart=addDays(lo,-3),natEnd=addDays(hi,3);
const natDays=diffDays(natStart,natEnd)+1;
if(natDays<=GMAXD)return{start:natStart,days:natDays,clamped:false};
let start=addDays(today,-Math.floor((GMAXD-1)/2));
const latest=addDays(natEnd,-(GMAXD-1));
if(start>latest)start=latest;
if(start<natStart)start=natStart;
return{start:start,days:GMAXD,clamped:true}}
function renderGantt(){
const gv=$("ganttview");gv.replaceChildren();
gv.appendChild(statusPills());
const gd=ganttData(),today=todayLocal();
const allRows=[];gd.groups.forEach(g=>allRows.push(...g.rows));
if(!allRows.length)gv.appendChild(el("div","map-empty","No dated cards to chart."));
else{
const win=ganttWindow(allRows,today);
const wEnd=addDays(win.start,win.days-1);
const hint=el("div","hint");hint.textContent="bar = working range · ◆ = due"+(win.clamped?" · showing "+GMAXD+" days around today":"");hint.style.margin="0 0 8px";
gv.appendChild(hint);
const layout=[];let y=GHDR;
gd.groups.forEach(g=>{layout.push({type:"g",g:g,y:y});y+=Math.round(GROWH*0.8);
g.rows.forEach(r=>{layout.push({type:"r",r:r,y:y});y+=GROWH})});
const width=GLBL+win.days*GDAY+10,height=y+8;
const svg=svgEl("svg",{class:"map-canvas",width:String(width),height:String(height),viewBox:"0 0 "+width+" "+height});
const dx=d=>GLBL+diffDays(win.start,d)*GDAY;
const grid=svgEl("g");
for(let i=0;i<win.days;i++){const d=addDays(win.start,i);
if(isMonday(d)){const x=dx(d);
grid.appendChild(svgEl("line",{x1:x,y1:GHDR-4,x2:x,y2:height-4,class:"gline"}));
const t=svgEl("text",{x:x+3,y:14,class:"gmark"});t.textContent=weekLabel(d);grid.appendChild(t)}}
if(today>=win.start&&today<=wEnd){const x=dx(today)+GDAY/2;
grid.appendChild(svgEl("line",{x1:x,y1:GHDR-4,x2:x,y2:height-4,class:"gtoday"}))}
svg.appendChild(grid);
layout.forEach(item=>{
if(item.type==="g"){
const dot=svgEl("circle",{cx:8,cy:item.y+8,r:4.5});dot.style.fill=item.g.label==="Archive"?ARCHC:ccol(item.g.label);svg.appendChild(dot);
const t=svgEl("text",{x:18,y:item.y+12,class:"ggroup"});t.textContent=cname(item.g.label)+" ("+item.g.rows.length+")";svg.appendChild(t);
return}
const r=item.r,cy=item.y+GROWH/2;
const g=svgEl("g",{class:"grow","data-mapnode":String(r.c.id)});
const tt=svgEl("title");tt.textContent="#"+r.c.id+" "+r.c.t;g.appendChild(tt);
const lbl=svgEl("text",{x:4,y:cy+4,class:"glbl"});lbl.textContent="#"+r.c.id+" "+truncate(r.c.t,13);g.appendChild(lbl);
if(r.startDay){
const s2=r.startDay<win.start?win.start:r.startDay,e2=r.endDay>wEnd?wEnd:r.endDay;
if(s2<=e2){
const bar=svgEl("rect",{x:dx(s2),y:cy-GBARH/2,width:(diffDays(s2,e2)+1)*GDAY-2,height:GBARH,rx:4,class:"gbar"});
bar.style.fill=r.c.arch?ARCHC:ccol(r.c.s);g.appendChild(bar)}}
if(r.c.arch)g.style.opacity=".55";
if(r.dueDay&&r.dueDay>=win.start&&r.dueDay<=wEnd){
const cx2=dx(r.dueDay)+GDAY/2;
g.appendChild(svgEl("path",{d:"M"+cx2+","+(cy-6)+" L"+(cx2+6)+","+cy+" L"+cx2+","+(cy+6)+" L"+(cx2-6)+","+cy+" z",class:"gdue"}))}
svg.appendChild(g)});
const wrap=el("div","map-scroll");wrap.appendChild(svg);gv.appendChild(hscrollNav(wrap));gv.appendChild(wrap)}
if(gd.undated.length){
gv.appendChild(el("div","map-title","No dates ("+gd.undated.length+")"));
const row=el("div","map-iso-row");
gd.undated.forEach(c=>{const chip=isoChip({id:c.id,title:c.t});if(c.arch)chip.style.opacity=".55";row.appendChild(chip)});
gv.appendChild(row)}}
// --- calendar view ---------------------------------------------------------------------
// Month grid, weeks starting Monday, 5-6 rows (same as kanban-web's monthGrid);
// chips per chipPositionForDay + independent due chips; date-less cards simply
// don't appear — consistent with the web app's date-aware views.
const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const WDSHORT=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
let calY,calM;{const n=new Date();calY=n.getFullYear();calM=n.getMonth()}
// Sub-views mirror kanban-web's month/week/3day/day set.
// The viewer is read-only, so sub-month views are stacked day rows with
// full-width chips instead of the web app's draggable hour grid.
const CALSUBS=[["month","Month"],["week","Week"],["3day","3-day"],["day","Day"]];
let calSub="month",calAnchor=todayLocal();
const weekStartOf=d=>addDays(d,-((new Date(dayToUtc(d)).getUTCDay()+6)%7));
const wdOf=d=>WDSHORT[new Date(dayToUtc(d)).getUTCDay()];
function subDays(){
if(calSub==="week"){const s=weekStartOf(calAnchor);return Array.from({length:7},(_,i)=>addDays(s,i))}
if(calSub==="3day")return[calAnchor,addDays(calAnchor,1),addDays(calAnchor,2)];
return[calAnchor]}
function monthCells(y,mi){
const first=Date.UTC(y,mi,1);
const lead=(new Date(first).getUTCDay()+6)%7;
const dim=new Date(Date.UTC(y,mi+1,0)).getUTCDate();
const weeks=Math.max(5,Math.ceil((lead+dim)/7));
const start=first-lead*DAY_MS,cells=[];
for(let i=0;i<weeks*7;i++){const ms=start+i*DAY_MS,dt=new Date(ms);
cells.push({date:utcToDay(ms),day:dt.getUTCDate(),inMonth:dt.getUTCFullYear()===y&&dt.getUTCMonth()===mi})}
return cells}
function shiftMonth(y,mi,d){const t=y*12+mi+d;return{year:Math.floor(t/12),monthIndex:((t%12)+12)%12}}
function dayChips(day,scheds){
const out=[];
scheds.forEach(x=>{
const pos=chipPositionForDay(x.sch,day);
if(pos){
const ch=el("span","cal-rowchip "+pos,"#"+x.c.id+" "+truncate(x.c.t,42));
ch.style.background=x.c.arch?ARCHC:ccol(x.c.s);if(x.c.arch)ch.style.opacity=".6";
ch.setAttribute("data-mapnode",String(x.c.id));
let tm="";
if(x.sch.kind==="single")tm=x.sch.time||"";
else if(x.sch.kind==="range"){if(day===x.sch.endDay)tm=x.sch.endTime||"";else if(day===x.sch.startDay)tm=x.sch.startTime||""}
out.push({el:ch,time:tm,cid:x.c.id})}
if(x.due===day){
const dc=el("span","cal-rowchip duechip","◆ #"+x.c.id+" "+truncate(x.c.t,38)+" — due");
dc.setAttribute("data-mapnode",String(x.c.id));
out.push({el:dc,time:timePart(x.c.due),cid:x.c.id})}});
return out}
function calTitle(){
if(calSub==="month")return MONTHS[calM]+" "+calY;
const days=subDays();
if(days.length===1)return wdOf(days[0])+" "+weekLabel(days[0])+", "+days[0].slice(0,4);
return weekLabel(days[0])+" – "+weekLabel(days[days.length-1])+", "+days[days.length-1].slice(0,4)}
function renderCalendar(){
const cv=$("calview");cv.replaceChildren();
const tabs=el("div","cal-subtabs");
CALSUBS.forEach(p=>{const b=btn(p[1],"calsub",{sub:p[0]});if(calSub===p[0])b.classList.add("active");tabs.appendChild(b)});
cv.appendChild(tabs);
const head=el("div","cal-head");
head.appendChild(btn("‹","calprev"));
head.appendChild(el("div","cal-title",calTitle()));
head.appendChild(btn("Today","caltoday"));
head.appendChild(btn("›","calnext"));
cv.appendChild(head);
cv.appendChild(statusPills());
const today=todayLocal();
const scheds=visList().map(c=>({c:c,sch:cardSchedule(c),due:dueDayOf(c)}));
if(calSub==="month"){
const grid=el("div","cal-grid");
["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(d=>grid.appendChild(el("div","cal-dow",d)));
monthCells(calY,calM).forEach(cell=>{
const ce=el("div","cal-cell"+(cell.inMonth?"":" out")+(cell.date===today?" today":""));
ce.appendChild(el("div","cal-daynum",String(cell.day)));
const chips=[];
scheds.forEach(x=>{
const pos=chipPositionForDay(x.sch,cell.date);
if(pos){const ch=el("span","cal-chip "+pos,"#"+x.c.id);ch.style.background=x.c.arch?ARCHC:ccol(x.c.s);if(x.c.arch)ch.style.opacity=".6";ch.setAttribute("data-mapnode",String(x.c.id));ch.title="#"+x.c.id+" "+x.c.t;chips.push(ch)}
if(x.due===cell.date){const dc=el("span","cal-chip duechip","◆"+x.c.id);dc.setAttribute("data-mapnode",String(x.c.id));dc.title="#"+x.c.id+" "+x.c.t+" — due";chips.push(dc)}});
chips.slice(0,4).forEach(ch=>ce.appendChild(ch));
if(chips.length>4)ce.appendChild(el("div","cal-more","+"+(chips.length-4)));
grid.appendChild(ce)});
cv.appendChild(grid)}
else if(calSub==="day"){
// One day, bucketed into collapsible hour blocks. A chip's hour
// is the time-of-day of the date that placed it here; date-only = All day.
const day=subDays()[0];
const chips=dayChips(day,scheds);
const blocks=new Map();
chips.forEach(x=>{const key=x.time?(x.time.split(":")[0].padStart(2,"0")+":00"):"all-day";if(!blocks.has(key))blocks.set(key,[]);blocks.get(key).push(x)});
const keys=[...blocks.keys()].sort((a,b)=>a==="all-day"?-1:b==="all-day"?1:a.localeCompare(b));
if(!keys.length)cv.appendChild(el("div","cal-norows","no cards this day"));
keys.forEach(k=>{
const kk=day+"|"+k,open=!!calHrOpen[kk];
const row=el("div","cal-dayrow"+(day===today?" today":""));
const head=el("div","cal-dayhead");head.dataset.calhrtoggle=kk;
head.appendChild(el("span","chev",open?"\\u25be":"\\u25b8"));
head.appendChild(document.createTextNode(k==="all-day"?"All day":k));
head.appendChild(el("span","cnt",String(blocks.get(k).length)));
row.appendChild(head);
if(open)blocks.get(k).forEach(x=>row.appendChild(x.el));
cv.appendChild(row)})}
else{
// Week/3-day rows collapsed by default — header + count.
subDays().forEach(day=>{
const chips=dayChips(day,scheds);
const open=!!calDayOpen[day];
const row=el("div","cal-dayrow"+(day===today?" today":""));
const head=el("div","cal-dayhead");head.dataset.caldaytoggle=day;
head.appendChild(el("span","chev",open?"\\u25be":"\\u25b8"));
head.appendChild(document.createTextNode(wdOf(day)+" "+weekLabel(day)));
head.appendChild(el("span","cnt",String(new Set(chips.map(x=>x.cid)).size)));
row.appendChild(head);
if(open){if(chips.length)chips.forEach(x=>row.appendChild(x.el));else row.appendChild(el("div","cal-norows","no cards"))}
cv.appendChild(row)})}
const hint=el("div","hint");hint.textContent="Tap a chip to open its card · colored = working range · ◆ = due";hint.style.marginTop="8px";
cv.appendChild(hint)}
function rebuild(){
const q=ops.map(o=>Object.assign({},o));
view=JSON.parse(JSON.stringify(DATA));ops=[];nseq=0;
q.forEach(o=>{
if(o.op==="create")queue({op:"create",title:o.title,status:o.status,priority:o.priority,assignee:o.assignee,body:o.body});
else if(o.op==="edit"){const e={op:"edit",id:o.id};if(o.title!==undefined)e.title=o.title;if(o.priority)e.priority=o.priority;if(o.assignee!==undefined)e.assignee=o.assignee;if(o.body!==undefined)e.body=o.body;if(o.fm!==undefined)e.fm=o.fm;queue(e)}
else queue(o)})}
const sc=$("scroll");
// Scroll buttons target the modal's scroll area while a card pop-up is open,
// the board otherwise. The ellipsis cycles THREE stack modes: 0 off
// (default: ellipsis only, everything hidden) -> 1 medium (step arrows) ->
// 2 extended (the full context menu) -> 0. The chosen mode persists per
// page in localStorage (try/catch; anything but 0/1/2 falls back to 0).
let stackMode=(()=>{try{const v=Number(localStorage.getItem("kanbanViewer.stackMode"));return v===0||v===1||v===2?v:0}catch(e){return 0}})();
// Drag switch (kanban.proj #241): default on; only a stored "0" turns it
// off, so a missing key or a blocked/throwing localStorage still reads on.
let dragOn=(()=>{try{return localStorage.getItem("kanbanViewer.drag")!=="0"}catch(e){return true}})();
let dragOverCol=null;
const modalOpen=()=>{const m=$("modal");return !!(m&&m.style.display!=="none")};
const scTgt=()=>modalOpen()?$("modalscroll"):sc;
function syncStack(){
const mo=modalOpen();
// An archived card's read-only sheet is NOT a card context —
// no Archive/Delete on the stack, same footing as the notifications sheet.
const mcc=(!creating&&!notifView&&sel!==null)?find(sel):null;
const cardCtx=mo&&!!mcc&&!mcc.arch;
const ext=stackMode===2,med=stackMode>=1;
$("snew").style.display=(ext&&!mo)?"":"none";
$("sarch").style.display=(ext&&cardCtx)?"":"none";
$("sdel").style.display=(ext&&cardCtx)?"":"none";
$("stop").style.display=ext?"":"none";
$("sbot").style.display=ext?"":"none";
$("sdrag").style.display=ext?"":"none";
$("sdrag").classList.toggle("off",!dragOn);
$("sup").style.display=med?"":"none";
$("sdn").style.display=med?"":"none";
$("mclose").style.display=(med&&mo)?"":"none";
$("sdel").classList.toggle("armed",ext&&cardCtx&&delArm!==null&&String(delArm)===String(sel))}
const step=dir=>{const t=scTgt();t.scrollBy({top:dir*Math.round(t.clientHeight*0.8),behavior:"smooth"})};
$("sup").addEventListener("click",()=>step(-1));
$("sdn").addEventListener("click",()=>step(1));
$("stop").addEventListener("click",()=>{const t=scTgt();t.scrollTo({top:0,behavior:"smooth"})});
$("sbot").addEventListener("click",()=>{const t=scTgt();t.scrollTo({top:t.scrollHeight,behavior:"smooth"})});
function closeCard(){sel=null;creating=false;notifView=false;ren=false;descEd=false;delArm=null;pillEd=null;fmOpen=false;render()}
// Shared by the sheet's own "Dependency tree"/"Dependency path"
// buttons (the act==="graphfocus" branch below) AND the right-click card
// menu's matching items — one path, not two, per the tree:/path: contract:
// overwrite the query box, focus the graph, close whatever sheet is open.
function graphFocus(gk,id){
const term=gk+":"+id;
$("q").value=term;
qTerms=resolveGraphTerms(String(term).trim().split(/\\s+/).filter(Boolean).map(parseTerm).filter(Boolean));
focusRoot=id;
closeCard();
renderMap();renderGantt();renderCalendar()}
// Right-click card menu (desktop only — see fineMQ above). Open/Move/
// Archive/Delete queue through the SAME queue() ops machinery the detail
// sheet's title tap / $sarch / $sdel buttons use — no parallel write path.
// Move riding queue() is what gives the menu the doing entry gate for
// free: queue() refuses a move to doing on an unresolved/blocked card and
// leaves the reason in note, so the menu never needs its own copy.
function closeCtxMenu(){if(ctxMenuEl){ctxMenuEl.remove();ctxMenuEl=null}}
function ctxOpen(id){sel=id;focusRoot=null;ren=false;descEd=false;delArm=null;pillEd=null;fmOpen=false;render()}
function ctxArchive(id){const c=find(id);if(!c||c.arch)return;queue({op:"archive",id:id});
if(String(sel)===String(id)){sel=null;delArm=null;pillEd=null}render()}
function ctxDelete(id){queue({op:"delete",id:id});
if(String(sel)===String(id)){sel=null;delArm=null;pillEd=null}render()}
function ctxMove(id,to){queue({op:"move",id:id,to:to});delArm=null;pillEd=null;render()}
function openCtxMenu(id,x,y){
closeCtxMenu();
const c=find(id);
if(!c||c.arch)return;
const m=el("div","ctxmenu");m.id="ctxmenu";
let armed=false;
const item=(label,run)=>{const b=el("button","ctxitem",label);b.type="button";
b.addEventListener("click",ev=>{ev.stopPropagation();run()});m.appendChild(b);return b};
item("Open",()=>{closeCtxMenu();ctxOpen(id)});
COLS.filter(x=>x!==c.s).forEach(x=>item("Move to "+cname(x),()=>{closeCtxMenu();ctxMove(id,x)}));
m.appendChild(el("div","ctxsep"));
item("Archive",()=>{closeCtxMenu();ctxArchive(id)});
const delBtn=item("Delete",()=>{
if(!armed){armed=true;delBtn.textContent="Delete?";delBtn.classList.add("armed");return}
closeCtxMenu();ctxDelete(id)});
if(!isProv(id)){
item("Dependency tree",()=>{closeCtxMenu();graphFocus("tree",id)});
item("Dependency path",()=>{closeCtxMenu();graphFocus("path",id)})}
document.body.appendChild(m);
ctxMenuEl=m;
const r=m.getBoundingClientRect();
const left=Math.max(4,Math.min(x,window.innerWidth-r.width-4));
const top=Math.max(4,Math.min(y,window.innerHeight-r.height-4));
m.style.left=left+"px";m.style.top=top+"px"}
// Delegated like the click handler above it: one listener, gated per-event
// on fineMQ so a coarse-pointer device's own contextmenu/long-press is
// NEVER intercepted (no preventDefault runs unless the gate + a live,
// non-archived board card both resolve first). Archived cards are excluded
// v1 — the native menu still shows for them.
document.body.addEventListener("contextmenu",e=>{
if(!fineMQ.matches)return;
const card=e.target.closest("#board [data-card]");
const c=card?find(card.dataset.card):null;
if(!c||c.arch){if(ctxMenuEl)closeCtxMenu();return}
e.preventDefault();
openCtxMenu(c.id,e.clientX,e.clientY)});
// Pointer drag (kanban.proj #241): native HTML5 DnD, gated live per-event on
// fineMQ + the Drag switch exactly like the right-click menu above -- never
// decided once at load. Cards keep the draggable attribute unconditionally
// (see cardNode) so a coarse-pointer or Drag-off dragstart still fires; the
// gate cancels it right there with no queued op and no visible drag. A drop
// routes through the SAME queue() path the status pill and "Move to" rows
// use, so it inherits the doing entry gate for free. No touch/pointer
// handlers are registered here -- touch drag is card 242's, deliberately.
document.body.addEventListener("dragstart",e=>{
const card=e.target.closest("#board [data-card]");
const c=card?find(card.dataset.card):null;
if(!c||c.arch||!fineMQ.matches||!dragOn){e.preventDefault();return}
e.dataTransfer.setData("text/plain",String(c.id));
e.dataTransfer.effectAllowed="move"});
document.body.addEventListener("dragover",e=>{
const col=e.target.closest("#board .boardcol[data-status]");
if(!col)return;
e.preventDefault();
e.dataTransfer.dropEffect="move";
if(dragOverCol!==col){if(dragOverCol)dragOverCol.classList.remove("drag-over");dragOverCol=col;col.classList.add("drag-over")}});
document.body.addEventListener("dragleave",e=>{
const col=e.target.closest("#board .boardcol[data-status]");
if(!col||col!==dragOverCol||col.contains(e.relatedTarget))return;
col.classList.remove("drag-over");dragOverCol=null});
document.body.addEventListener("drop",e=>{
const col=e.target.closest("#board .boardcol[data-status]");
if(!col)return;
e.preventDefault();
if(dragOverCol){dragOverCol.classList.remove("drag-over");dragOverCol=null}
const id=e.dataTransfer.getData("text/plain");
const c=id?find(id):null;
const to=col.dataset.status;
if(!c||c.s===to)return;
queue({op:"move",id:id,to:to});pillEd=null;render()});
document.body.addEventListener("dragend",()=>{if(dragOverCol){dragOverCol.classList.remove("drag-over");dragOverCol=null}});
$("smore").addEventListener("click",()=>{stackMode=(stackMode+1)%3;try{localStorage.setItem("kanbanViewer.stackMode",String(stackMode))}catch(e){}syncStack()});
$("sdrag").addEventListener("click",()=>{dragOn=!dragOn;try{localStorage.setItem("kanbanViewer.drag",dragOn?"1":"0")}catch(e){}syncStack();render()});
$("mclose").addEventListener("click",closeCard);
$("sarch").addEventListener("click",()=>{if(!modalOpen()||creating)return;const cc=find(sel);if(!cc||cc.arch)return;queue({op:"archive",id:sel});sel=null;delArm=null;pillEd=null;render()});
$("sdel").addEventListener("click",()=>{if(!modalOpen()||creating)return;const cc=find(sel);if(!cc||cc.arch)return;
if(String(delArm)===String(sel)){queue({op:"delete",id:sel});sel=null;delArm=null;pillEd=null;render()}
else{delArm=sel;syncStack()}});
$("snew").addEventListener("click",()=>{nfMore=false;creating=true;sel=null;ren=false;descEd=false;delArm=null;pillEd=null;render()});
// Tapping the pending pill (kanban.proj #252) does what the tray's
// Copy changes button does, so a human who only ever taps the pill still
// gets the payload on their clipboard -- the scroll-to-tray behavior is
// unchanged and always runs, even if the copy itself fails, so a blocked
// clipboard never strands the human without a way to see the payload.
// A later SUCCESSFUL copy clears its own blocked-note again, so the tray
// can never read "Copied" and "Copy blocked" at the same time; notes set
// by queue() (a blocked move, say) are left alone.
$("pill").addEventListener("click",()=>{if(!ops.length)return;
sc.scrollTo({top:sc.scrollHeight,behavior:"smooth"});
copyPayload(ok=>{const m="Copy blocked \\u2014 use the text box below to copy the payload";
if(!ok)note=m;else if(note===m)note="";render()})});
$("bell").addEventListener("click",()=>{const open=!notifView;sel=null;creating=false;ren=false;descEd=false;delArm=null;pillEd=null;fmOpen=false;notifView=open;render()});
$("q").addEventListener("input",()=>{
focusRoot=null;
qTerms=resolveGraphTerms(String($("q").value||"").trim().split(/\\s+/).filter(Boolean).map(parseTerm).filter(Boolean));
render();renderMap();renderGantt();renderCalendar()});
sc.addEventListener("touchmove",e=>e.stopPropagation(),{passive:true});
sc.addEventListener("scroll",()=>{if(ctxMenuEl)closeCtxMenu()},{passive:true});
// Thin sticky header: toggle .hdr.thin only when crossing the threshold,
// not on every scroll tick — one classList write per state change, no
// extra layout reads beyond the scrollTop the scroll event already carries.
let hdrThin=false;
sc.addEventListener("scroll",()=>{
const thin=sc.scrollTop>8;
if(thin!==hdrThin){hdrThin=thin;$("hdr").classList.toggle("thin",thin)}
},{passive:true});
document.body.addEventListener("change",e=>{
const t=e.target;
if(t.dataset&&t.dataset.act==="asg"){const card=t.closest("[data-card]");if(card){queue({op:"edit",id:card.dataset.card,assignee:t.value});pillEd=null;render()}}});
document.body.addEventListener("input",e=>{
const t=e.target;
if(t.id==="fm-blocked")t.style.borderColor=blkTxt(t.value)!==null?"var(--high)":"";
if(t.id==="fm-review")t.style.borderColor=blkTxt(t.value)!==null?"var(--rev)":""});
document.body.addEventListener("click",e=>{
// Ctx-menu item clicks stopPropagation() before they ever reach here
// (see openCtxMenu), so any click that DOES reach this listener while the
// menu is open is by definition "elsewhere" — close it (any click on a
// non-item part of the menu itself is a no-op, not a close).
if(ctxMenuEl&&!e.target.closest("#ctxmenu"))closeCtxMenu();
const t=e.target.closest("button,select,input,textarea,[data-card],[data-mapnode],[data-coltoggle],[data-tap],[data-caldaytoggle],[data-calhrtoggle]");
if(!t)return;
if(t.dataset&&t.dataset.view!==undefined){switchView(t.dataset.view);return}
if(t.dataset&&t.dataset.coltoggle!==undefined){colOpen[t.dataset.coltoggle]=!colOpen[t.dataset.coltoggle];render();return}
if(t.dataset&&t.dataset.caldaytoggle!==undefined){calDayOpen[t.dataset.caldaytoggle]=!calDayOpen[t.dataset.caldaytoggle];renderCalendar();return}
if(t.dataset&&t.dataset.calhrtoggle!==undefined){calHrOpen[t.dataset.calhrtoggle]=!calHrOpen[t.dataset.calhrtoggle];renderCalendar();return}
if(t.dataset&&t.dataset.act==="spill"){const k=t.dataset.st;statusVis[k]=!isVis(k);render();renderMap();renderGantt();renderCalendar();return}
// The map's "Epics" chip — same control-row-checked-first
// reasoning as the "spill" status pills above; toggles epic: in #q like
// $("q")'s own input listener does, then re-renders every view (epic:
// filters board/map/gantt/calendar alike, not just the map it's tapped from).
if(t.dataset&&t.dataset.act==="epicchip"){
const toks=String($("q").value||"").trim().split(/\\s+/).filter(Boolean);
const on=toks.some(x=>/^epic:/i.test(x));
const next=on?toks.filter(x=>!/^epic:/i.test(x)):toks.concat("epic:");
$("q").value=next.join(" ");
focusRoot=null;
qTerms=resolveGraphTerms(next.map(parseTerm).filter(Boolean));
render();renderMap();renderGantt();renderCalendar();return}
if(t.dataset&&t.dataset.tap==="ren"){ren=true;descEd=false;pillEd=null;render();return}
if(t.dataset&&t.dataset.act==="pill"){pillEd=pillEd===t.dataset.pill?null:t.dataset.pill;ren=false;descEd=false;render();return}
if(t.getAttribute&&t.getAttribute("data-mapnode")!==null){
const mid=t.getAttribute("data-mapnode");
const mcCard=find(mid);
if(mcCard){sel=mid;focusRoot=null;ren=false;descEd=false;delArm=null;pillEd=null;fmOpen=false;render()}
return}
if(t.id==="newbtn"){nfMore=false;creating=true;sel=null;focusRoot=null;ren=false;descEd=false;delArm=null;pillEd=null;render();return}
if(t.id==="payload"){t.select();return}
if(t.dataset&&t.dataset.stop)return;
if(t.dataset&&t.dataset.rm!==undefined){ops.splice(+t.dataset.rm,1);rebuild();render();return}
const act=t.dataset?t.dataset.act:null;
if(act==="ncadd"){const ti=$("nc-t").value.trim();if(!ti)return;const bd=$("nc-b")?$("nc-b").value.trim():"";queue({op:"create",title:ti,status:$("nc-s")?$("nc-s").value:undefined,priority:$("nc-p").value,assignee:$("nc-a").value,body:bd||undefined});
const nst=view[view.length-1].s;colOpen[nst]=true;
if(COLS.includes(nst)&&!isVis(nst)){statusVis[nst]=true;renderMap();renderGantt();renderCalendar()}
creating=false;nfMore=false;render();return}
if(act==="ncmore"){nfMore=true;render();return}
if(act==="nccancel"){creating=false;nfMore=false;render();return}
if(act==="apply"){if(!ops.length)return;copyPayload(()=>render());return}
if(act==="discard"){ops=[];note="";rebuild();render();return}
if(act==="calsub"){const to=t.dataset.sub;
if(to!==calSub){
if(to==="month"){const p=calAnchor.split("-").map(Number);calY=p[0];calM=p[1]-1}
else if(calSub==="month"){const tp=todayLocal().split("-").map(Number);
calAnchor=(tp[0]===calY&&tp[1]-1===calM)?todayLocal():calY+"-"+pad2(calM+1)+"-01"}
calSub=to}
renderCalendar();return}
if(act==="calprev"||act==="calnext"){const dir=act==="calprev"?-1:1;
if(calSub==="month"){const s=shiftMonth(calY,calM,dir);calY=s.year;calM=s.monthIndex}
else{const stepDays={week:7,"3day":3,day:1}[calSub];calAnchor=addDays(calAnchor,dir*stepDays)}
renderCalendar();return}
if(act==="caltoday"){const n=new Date();calY=n.getFullYear();calM=n.getMonth();calAnchor=todayLocal();renderCalendar();return}
const card=t.closest("[data-card]");
if(!card)return;
const id=card.dataset.card;
if(act==="graphfocus"){graphFocus(t.dataset.gk,id);return}
if(act==="move"){queue({op:"move",id:id,to:t.dataset.to});delArm=null;pillEd=null;render();return}
if(act==="prio"){queue({op:"edit",id:id,priority:t.dataset.p});pillEd=null;render();return}
if(act==="ren"){ren=true;descEd=false;pillEd=null;render();return}
if(act==="rensave"){const v=$("renin").value.trim();if(v)queue({op:"edit",id:id,title:v});ren=false;render();return}
if(act==="rencancel"){ren=false;render();return}
if(act==="desc"){descEd=true;ren=false;pillEd=null;render();return}
if(act==="fmtoggle"){fmOpen=!fmOpen;render();return}
if(act==="fmsave"){const k=t.dataset.key;const inp=document.getElementById("fm-"+k);if(inp){const obj={};obj[k]=inp.value.trim();queue({op:"edit",id:id,fm:obj})}render();return}
if(act==="descsave"){queue({op:"edit",id:id,body:$("descin").value.trim()});descEd=false;render();return}
if(act==="desccancel"){descEd=false;render();return}
if(!act){if(t.closest("#modal"))return;sel=String(sel)===String(id)?null:id;focusRoot=null;ren=false;descEd=false;delArm=null;pillEd=null;fmOpen=false;render()}});
$("modal").addEventListener("click",e=>{if(e.target.id==="modal")closeCard()});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(ctxMenuEl){closeCtxMenu();return}
if(sel!==null||creating||notifView)closeCard()}});
render();
renderMap();
renderGantt();
renderCalendar();
</script></body></html>"""


if __name__ == "__main__":
    main()

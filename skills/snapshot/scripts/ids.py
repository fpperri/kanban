"""The snapshot's copy of the id module (docs/adr/0014), written to the same rule as
skills/web/web/ids.js: the one place that parses, compares and formats an id and owns
the mention pattern. An id is a prefix (an optional `_` and uppercase letters) and a
number, `656`, `G3`, `_12`; the whole pair is the identity, so `#7` and `#G7` are two
things. Both copies run skills/web/test/ids-cases.json, so they cannot drift.

An id goes in as a string ('G3', '0003'), a plain int (7) or a parsed
{"prefix", "number"} dict; whatever is not an id comes back None. Numbers stop at 15
digits so JS and Python read the same value.
"""
import re

MAX_NUMBER = 999999999999999
DEFAULT_DIGITS = 4
_ID_RE = re.compile(r"(_?[A-Z]*)([0-9]{1,15})", re.ASCII)
_PREFIX_RE = re.compile(r"_?[A-Z]*", re.ASCII)

# Groups: 1 board, 2 prefix, 3 digits. The very string the web module holds.
MENTION_SOURCE = r"(?<![A-Za-z0-9_#])(?:([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])?)(?=#))?#(_?[A-Z]*)([0-9]{1,15})\b"
_MENTION_RE = re.compile(MENTION_SOURCE, re.ASCII)


def parse_id(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        m = _ID_RE.fullmatch(value)
        return {"prefix": m.group(1), "number": int(m.group(2))} if m else None
    if isinstance(value, int):
        return {"prefix": "", "number": value} if 0 <= value <= MAX_NUMBER else None
    if isinstance(value, dict):
        prefix, number = value.get("prefix"), value.get("number")
        ok = (isinstance(prefix, str) and _PREFIX_RE.fullmatch(prefix)
              and isinstance(number, int) and not isinstance(number, bool)
              and 0 <= number <= MAX_NUMBER)
        return {"prefix": prefix, "number": number} if ok else None
    return None


def id_key(value):
    i = parse_id(value)
    return None if i is None else "%s%d" % (i["prefix"], i["number"])


def compare_ids(a, b):
    """-1, 0 or 1: prefix first (plain ids before prefixed ones, then by character),
    then number. What is not an id sorts after every id, by its text."""
    x, y = parse_id(a), parse_id(b)
    if x and y:
        if x["prefix"] != y["prefix"]:
            return -1 if x["prefix"] < y["prefix"] else 1
        return (x["number"] > y["number"]) - (x["number"] < y["number"])
    if x:
        return -1
    if y:
        return 1
    s, t = str(a), str(b)
    return (s > t) - (s < t)


def sort_ids(values):
    from functools import cmp_to_key
    return sorted(values, key=cmp_to_key(compare_ids))


def format_id(value, digits=None):
    """The id as a file name holds it: the number padded to the board's idDigits,
    never cut when it is wider."""
    i = parse_id(value)
    if i is None:
        return None
    width = digits if isinstance(digits, int) and not isinstance(digits, bool) and digits >= 0 else DEFAULT_DIGITS
    return i["prefix"] + str(i["number"]).rjust(width, "0")


def _mention_from(m):
    return {"match": m.group(0), "board": m.group(1), "prefix": m.group(2),
            "number": int(m.group(3)), "start": m.start(), "end": m.end()}


def parse_mention(text):
    m = re.fullmatch(MENTION_SOURCE, str(text), re.ASCII)
    return _mention_from(m) if m else None


def find_mentions(text):
    return [_mention_from(m) for m in _MENTION_RE.finditer(str(text))]

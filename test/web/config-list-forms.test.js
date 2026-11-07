const { test } = require('node:test');
const assert = require('node:assert');
const { parseConfig } = require('../../plugin/skills/web/scripts/config-store');

// Entry-form tables for the config lists the page reads: card types (a name, a color, an icon), pills (a label and a
// query), the hierarchy, the priority order and the statuses. Each row is a config.yaml text and what parseConfig reads
// from it, the malformed forms included.

const TYPES = [
  ["block entries with colors", "name: b\ntypes:\n  - name: objective\n    color: \"#a371f7\"\n  - name: epic\n    color: orange\n", [{"name":"objective","color":"#a371f7"},{"name":"epic","color":"orange"}]],
  ["a quoted color with a trailing comment", "name: b\ntypes:\n  - name: \"two words\" # label\n    color: \"#a371f7\" # purple\n", [{"name":"two words","color":"#a371f7"}]],
  ["an escaped quote in a name", "name: b\ntypes:\n  - name: \"say \\\"hi\\\"\"\n", [{"name":"say \"hi\"","color":""}]],
  ["a bare hex color", "name: b\ntypes:\n  - name: objective\n    color: #ff00ff\n  - name: story\n", [{"name":"objective","color":"#ff00ff"},{"name":"story","color":""}]],
  ["bare entries", "name: b\ntypes:\n  - epic\n  - story\n", [{"name":"epic","color":""},{"name":"story","color":""}]],
  ["a mix of block and bare entries, with a trailing comment", "name: b\ntypes:\n  - name: objective # the big one\n    color: red\n  - story\n  - name: \"\"\n  - name: task\n", [{"name":"objective","color":"red"},{"name":"story","color":""},{"name":"task","color":""}]],
  ["an inline list", "name: b\ntypes: [objective, \"two words\", story]\n", [{"name":"objective","color":""},{"name":"two words","color":""},{"name":"story","color":""}]],
  ["an empty inline list", "name: b\ntypes: []\n", []],
  ["keys after the list", "name: b\ntypes:\n  - name: epic\n    color: red\nstatuses: [todo, done]\n", [{"name":"epic","color":"red"}]],
  ["a comment after the key", "name: b\ntypes:   # suggested card types\n  - name: objective\n    color: \"#a371f7\"\n  - story\n", [{"name":"objective","color":"#a371f7"},{"name":"story","color":""}]],
  ["no types key", "name: b\nstatuses: [todo, done]\n", []],
  ["a type with no icon beside one with an icon", "name: b\ntypes:\n  - name: goal\n    color: red\n  - name: epic\n    icon: star\n", [{"name":"goal","color":"red"},{"name":"epic","color":"","icon":"star"}]],
  ["a mixed-case icon, bare and quoted", "name: b\ntypes:\n  - name: a\n    icon: Star\n  - name: b\n    icon: \"HEXAGON\"\n  - name: c\n    icon: 'Diamond'\n", [{"name":"a","color":"","icon":"star"},{"name":"b","color":"","icon":"hexagon"},{"name":"c","color":"","icon":"diamond"}]],
  ["an icon with a trailing comment", "name: b\ntypes:\n  - name: a\n    icon: star   # five points\n  - name: b\n    icon: \"square\" # four\n", [{"name":"a","color":"","icon":"star"},{"name":"b","color":"","icon":"square"}]],
  ["an unknown icon name", "name: b\ntypes:\n  - name: a\n    icon: Blob\n  - name: b\n    icon: 3d-cube\n", [{"name":"a","color":"","icon":"blob"},{"name":"b","color":"","icon":"3d-cube"}]],
  ["a blank icon, a comment-only icon and an icon written before its name", "name: b\ntypes:\n  - name: a\n    icon:\n  - name: b\n    icon: \"\"\n  - name: c\n    icon: # none yet\n  - icon: square\n    name: d\n", [{"name":"a","color":""},{"name":"b","color":""},{"name":"c","color":""},{"name":"d","color":"","icon":"square"}]],
  ["an icon on an entry with no name", "name: b\ntypes:\n  - icon: star\n  - name: epic\n", [{"name":"epic","color":""}]],
  ["an icon line under an assignee and under a pill, not under a type", "name: b\nassignees:\n  - handle: \"@human\"\n    icon: star\ntypes:\n  - name: goal\npills:\n  - next: x\n    icon: star\n", [{"name":"goal","color":""}]],
  ["an inline types list", "name: b\ntypes: [goal, epic]\n", [{"name":"goal","color":""},{"name":"epic","color":""}]],
];

const PILLS = [
  ["quoted queries, a bare query and one-key maps", "name: b\npills:\n  - \"assignee:@human\"\n  - 'status:doing'\n  - blocked\n  - next: 'tags:\"next-up\"'\n  - \"review it\": \"review:\"\n", [{"label":"assignee:@human","query":"assignee:@human"},{"label":"status:doing","query":"status:doing"},{"label":"blocked","query":"blocked"},{"label":"next","query":"tags:\"next-up\""},{"label":"review it","query":"review:"}]],
  ["assignee:@human and tags:* bare and quoted stay queries", "name: b\npills:\n  - assignee:@human\n  - tags:*\n  - \"tags:*\"\n", [{"label":"assignee:@human","query":"assignee:@human"},{"label":"tags:*","query":"tags:*"},{"label":"tags:*","query":"tags:*"}]],
  ["a colon followed by a space makes a map: \"- tags: grill\" is the label tags with the query grill", "name: b\npills:\n  - tags: grill\n", [{"label":"tags","query":"grill"}]],
  ["a map value that is quoted, bare or has a trailing comment, with colons inside", "name: b\npills:\n  - mine: assignee:@human   # who I am\n  - both: \"tags:a tags:b\"  # two tags\n  - note: 'title:\"fix: auth\"'\n", [{"label":"mine","query":"assignee:@human"},{"label":"both","query":"tags:a tags:b"},{"label":"note","query":"title:\"fix: auth\""}]],
  ["a name key is a literal label like any other word", "name: b\npills:\n  - name: tags:x\n  - \"name\": \"tags:y\"\n", [{"label":"name","query":"tags:x"},{"label":"name","query":"tags:y"}]],
  ["an empty label, an empty query and comment-only entries are skipped", "name: b\npills:\n  -\n  - \"\"\n  - \"\": tags:x\n  - next:\n  - next: \"\"\n  - # only a comment\n  # a comment line\n  - next: # only a comment\n  - tags: grill\n", [{"label":"tags","query":"grill"}]],
  ["extra keys on a map are ignored", "name: b\npills:\n  - next: 'tags:\"next-up\"'\n    color: red\n    query: ignored\n  - \"assignee:@human\"\n", [{"label":"next","query":"tags:\"next-up\""},{"label":"assignee:@human","query":"assignee:@human"}]],
  ["a scalar value answers none", "name: b\npills: tags:*\n", []],
  ["an inline list answers none", "name: b\npills: [\"tags:*\", \"assignee:@human\"]\n", []],
  ["an empty inline list answers none", "name: b\npills: []\n", []],
  ["an empty key answers none", "name: b\npills:\n", []],
  ["no pills key answers none", "name: b\nstatuses: [todo, done]\n", []],
  ["a comment after the key opens the block", "name: b\npills:   # one-click queries\n  - next: x\n", [{"label":"next","query":"x"}]],
  ["CRLF text that stops at the next top-level key", "name: b\r\npills:\r\n  - next: \"tags:next-up\"\r\nstatuses: [todo, done]\r\n  - stray\r\n", [{"label":"next","query":"tags:next-up"}]],
  ["an unindented list is skipped, as for every other list", "name: b\npills:\n- next: x\n  - \"assignee:@human\"\n- tags:*\n", [{"label":"assignee:@human","query":"assignee:@human"}]],
  ["a single-quoted entry keeps YAML's doubled quote as it is", "name: b\npills:\n  - 'it''s'\n  - 'it''s': 'a''b'\n  - n: 'a''b'\n", [{"label":"it","query":"it"},{"label":"it","query":"it"},{"label":"n","query":"a"}]],
  ["backslash escapes apply in both quote styles", "name: b\npills:\n  - \"say \\\"hi\\\"\": \"title:\\\"x\\\"\"\n  - 'a\\\\b': 'c\\\\d'\n  - \"tags:\\\\x\"\n", [{"label":"say \"hi\"","query":"title:\"x\""},{"label":"a\\b","query":"c\\d"},{"label":"tags:\\x","query":"tags:\\x"}]],
  ["an unterminated quote", "name: b\npills:\n  - \"next: x\n  - 'tags:y\n  - \"ok\": \"tags:z\n", [{"label":"\"next","query":"x"},{"label":"'tags:y","query":"'tags:y"},{"label":"ok","query":"\"tags:z"}]],
  ["a quoted label with nothing after the colon, and a quoted query ending in a colon", "name: b\npills:\n  - \"next\":\n  - \"blocked:\"\n  - \"review it\": \"review:\"\n  - blocked:\n", [{"label":"blocked:","query":"blocked:"},{"label":"review it","query":"review:"}]],
  ["a hash that is part of a query, and one that starts a comment", "name: b\npills:\n  - tags:#x\n  - next: tags:#y # note\n  - tags:z # note\n  - \"tags:#w\" # note\n", [{"label":"tags:#x","query":"tags:#x"},{"label":"next","query":"tags:#y"},{"label":"tags:z","query":"tags:z"},{"label":"tags:#w","query":"tags:#w"}]],
  ["a label with spaces and a query with markup", "name: b\npills:\n  - review it: title:<b>x</b>\n  - \"<i>label</i>\": \"body:\\\"<script>\\\"\"\n", [{"label":"review it","query":"title:<b>x</b>"},{"label":"<i>label</i>","query":"body:\"<script>\""}]],
  ["two pills keys in one file", "name: b\npills:\n  - a: x\nstatuses: [todo, done]\npills:\n  - b: y\n", [{"label":"a","query":"x"},{"label":"b","query":"y"}]],
  ["pills between the other lists", "name: b\ntypes:\n  - name: goal\n    icon: star\npills:\n  - next: \"tags:next-up\"\n  - \"assignee:@human\"\nhierarchy: [goal, epic]\nstatuses: [todo, done]\n", [{"label":"next","query":"tags:next-up"},{"label":"assignee:@human","query":"assignee:@human"}]],
];

const HIERARCHY = [
  ["an inline list", "name: b\nhierarchy: [goal, strategy, objective, epic]\n", ["goal","strategy","objective","epic"]],
  ["an inline list with quotes, spaces and a trailing comment", "name: b\nhierarchy: [goal, \"Strategy\", 'objective' ,epic]   # top first\n", ["goal","Strategy","objective","epic"]],
  ["a block list", "name: b\nhierarchy:\n  - goal\n  - strategy\n  - objective\n", ["goal","strategy","objective"]],
  ["a block list with quotes and trailing comments", "name: b\nhierarchy:\n  - goal # the why\n  - \"Strategy\"\n  - 'objective' # the middle\n  - epic\n", ["goal","Strategy","objective","epic"]],
  ["a comment after the key opens the block", "name: b\nhierarchy:   # top first\n  - goal\n  - epic\n", ["goal","epic"]],
  ["a scalar value answers none", "name: b\nhierarchy: goal\n", []],
  ["a quoted scalar with a comma answers none", "name: b\nhierarchy: \"goal, epic\"\n", []],
  ["an empty inline list answers none", "name: b\nhierarchy: []\n", []],
  ["an empty key answers none", "name: b\nhierarchy:\n", []],
  ["no hierarchy key answers none", "name: b\nstatuses: [todo, done]\n", []],
  ["a board that declares types but no hierarchy answers none", "name: b\ntypes:\n  - name: goal\n  - name: epic\n", []],
  ["mixed-case duplicates are kept as written, for the slices module to fold", "name: b\nhierarchy: [goal, Epic, goal, Goal, EPIC]\n", ["goal","Epic","goal","Goal","EPIC"]],
  ["mixed-case duplicates in a block", "name: b\nhierarchy:\n  - Goal\n  - goal\n  - Epic\n  - EPIC\n", ["Goal","goal","Epic","EPIC"]],
  ["blank entries in an inline list are skipped", "name: b\nhierarchy: [goal, , epic, \"\", goal]\n", ["goal","epic","goal"]],
  ["blank, empty, comment-only and comment-line entries in a block are skipped", "name: b\nhierarchy:\n  - goal\n  -\n  - \"\"\n  - epic\n  # a comment line\n  - # only a comment\n  - goal\n", ["goal","epic","goal"]],
  ["an unterminated quote", "name: b\nhierarchy:\n  - \"goal\n  - 'epic\n  - ok\n", ["\"goal","'epic","ok"]],
  ["CRLF text that stops at the next top-level key", "name: b\r\nhierarchy:\r\n  - goal\r\n  - epic\r\nstatuses: [todo, done]\r\n  - stray\r\n", ["goal","epic"]],
  ["an unindented list is skipped, as for every other list", "name: b\nhierarchy:\n- goal\n  - epic\n- story\n", ["epic"]],
  ["keys after the list", "name: b\nhierarchy: [goal, epic]\nstatuses: [todo, done]\ntypes: [goal, epic]\n", ["goal","epic"]],
  ["an inline key, then a block key, adds to it", "name: b\nhierarchy: [goal]\nstatuses: [todo, done]\nhierarchy:\n  - epic\n", ["goal","epic"]],
  ["an inline key after a block key replaces it", "name: b\nhierarchy:\n  - epic\nstatuses: [todo, done]\nhierarchy: [goal]\n", ["goal"]],
  ["an inline key twice, then a block, then a scalar", "name: b\nhierarchy: [goal]\nhierarchy: [epic]\nhierarchy:\n  - story\nhierarchy: task\n", []],
  ["a hierarchy between the other lists", "name: b\ntypes:\n  - name: goal\n    icon: star\nhierarchy:\n  - goal\n  - epic\npills:\n  - next: \"tags:next-up\"\nstatuses: [todo, done]\n", ["goal","epic"]],
  ["a name that looks like markup", "name: b\nhierarchy: [\"</script><b>\", epic]\n", ["</script><b>","epic"]],
];

const STATUSES = [
  ["statuses", "name: b\nstatuses: [todo, done]\n", ["todo","done"]],
  ["statuses", "name: b\nstatuses: [todo, \"in review\", done] # columns\n", ["todo","in review","done"]],
  ["statuses", "name: b\nstatuses:\n  - todo\n  - \"done\" # last\n", ["todo","done"]],
  ["statuses", "name: b\nstatuses:   # columns\n  - todo\n  - done\n", ["todo","done"]],
  ["statuses", "name: b\nstatuses: []\nnextId: 4\n", []],
  ["statuses", "name: b\n", []],
];

const PRIORITIES = [
  ["priorities", "name: b\npriorities: [Urgent, High, Normal]\n", ["Urgent","High","Normal"]],
  ["priorities", "name: b\npriorities:\n  - Urgent\n  - \"High\"\n", ["Urgent","High"]],
  ["priorities", "name: b\npriorities:   # high first\n  - Urgent\n  - Normal\n", ["Urgent","Normal"]],
  ["priorities", "name: b\n", []],
];

for (const [label, config, expected] of TYPES) test(`types: ${label}`, () => assert.deepStrictEqual(parseConfig(config).types, expected));
for (const [label, config, expected] of PILLS) test(`pills: ${label}`, () => assert.deepStrictEqual(parseConfig(config).pills, expected));
for (const [label, config, expected] of HIERARCHY) test(`hierarchy: ${label}`, () => assert.deepStrictEqual(parseConfig(config).hierarchy, expected));
for (const [, config, expected] of STATUSES) test(`statuses: ${JSON.stringify(config)}`, () => assert.deepStrictEqual(parseConfig(config).statuses, expected));
for (const [, config, expected] of PRIORITIES) test(`priorities: ${JSON.stringify(config)}`, () => assert.deepStrictEqual(parseConfig(config).priorities, expected));

test('a type carries an icon only when one is set, lowercased and with any trailing comment stripped', () => {
  const config = ['name: b', 'types:', '  - name: goal', '    color: "#a371f7"', '    icon: Star # the big one', '  - name: epic', '    color: orange', '  - story', '  - name: task', '    icon: "TRIANGLE"', ''].join('\n');
  assert.deepStrictEqual(parseConfig(config).types, [
    { name: 'goal', color: '#a371f7', icon: 'star' },
    { name: 'epic', color: 'orange' },
    { name: 'story', color: '' },
    { name: 'task', color: '', icon: 'triangle' },
  ]);
});

test('hierarchy names keep the order and the letter case they are written in', () => {
  assert.deepStrictEqual(parseConfig(['name: b', 'hierarchy:', '  - Goal', '  - strategy', '  - OBJECTIVE', ''].join('\n')).hierarchy, ['Goal', 'strategy', 'OBJECTIVE']);
});

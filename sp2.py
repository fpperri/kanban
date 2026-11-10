def sub(path, pairs):
    s=open(path,encoding='utf-8').read()
    for a,b in pairs:
        assert a in s,(path,a[:60])
        s=s.replace(a,b,1)
    open(path,'w',encoding='utf-8',newline='').write(s)
s=open('notes.test.js',encoding='utf-8').read()
a=s.index("test('the card last noted is kept in the browser")
b=s.index("test('the palette")
s=s[:a]+s[b:]
open('notes.test.js','w',encoding='utf-8',newline='').write(s)
sub('notes-range.test.js',[
("no card, else the card last noted', () =>","no card, and no card for nothing', () =>"),
("  assert.deepStrictEqual(n.noteSubjectTarget(none, '22'), { id: '22' }, 'what Enter would write on');\n  assert.deepStrictEqual(n.noteSubjectTarget(none, ''), { id: '' });\n","  assert.deepStrictEqual(n.noteSubjectTarget(none), { id: '' }, 'nothing aimed at is no card');\n"),
("noteSubjectTarget({ kind: 'none', day: CTX.today, noCard: true }, '22')","noteSubjectTarget({ kind: 'none', day: CTX.today, noCard: true })"),
("about nothing, whatever card was last noted', () =>","about nothing', () =>"),
("  assert.strictEqual(plan('x', none).target, '7', 'without the choice it is the card last noted');\n","  assert.strictEqual(plan('x', none).target, '', 'without the choice it is still no card');\n"),
("leaves no card, whatever card was last noted'","leaves no card'"),
("'a note about nothing, not the card last noted'","'a note about nothing'"),
("noteSubjectTarget(cleared, '7')","noteSubjectTarget(cleared)"),
("const CTX = { today: '2026-10-21', now: '16:40', lastNoted: '7' };","const CTX = { today: '2026-10-21', now: '16:40' };"),
])
sub('notes-clock.test.js',[("const at = (today, now) => ({ today, now, lastNoted: '7' });","const at = (today, now) => ({ today, now });")])
sub('notes-groups.test.js',[("const CTX = { today: '2026-10-16', now: '16:40', lastNoted: '7' };","const CTX = { today: '2026-10-16', now: '16:40' };")])
sub('notes-palette-range-page.test.js',[
("the picker shows the card Enter would write on, the card last noted, else no card', async () => {\n  const p = await open({ stored: { 'kanban.kanban.lastnoted': '22' } });\n  p.page.run('openNotes({})');\n  assert.strictEqual(p.ui().pick.value, '#22 Cut over the data layer');\n  const q = await open();\n  q.page.run('openNotes({})');\n  assert.strictEqual(q.ui().pick.value, 'no card');",
 "the picker shows no card', async () => {\n  const q = await open({ stored: { 'kanban.kanban.lastnoted': '22' } });\n  q.page.run('openNotes({})');\n  assert.strictEqual(q.ui().pick.value, 'no card');"),
("writes a note about nothing, whatever card was last noted', async () => {\n  const p = await open({ stored: { 'kanban.kanban.lastnoted': '22' } });","writes a note about nothing', async () => {\n  const p = await open();"),
])

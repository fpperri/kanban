'use strict';
// The coloured Markdown boxes, on the scratchpad board (the groups board with a scratchpad: line and a page for
// card 7). The Scratchpad's Edit box and the card form's description are drawn in colour while they are
// typed in: a copy of the text sits behind the textarea, whose own text is transparent and whose caret stays.
// What this scenario proves that no stand-in can is where the copy's lines sit: its box is the textarea's box
// to the pixel and it wraps into as many lines, in the palette, in the card form, full screen, at phone width, with a
// scrollbar on the textarea (the copy gives up the bar's width) and after a manual resize; its scroll follows
// the textarea's; each kind has the colour of its token and nothing but a colour (a weight, style or size
// would move a line). The text stays the textarea's: typing goes in with the browser's own insert, Tab and
// Ctrl+B still edit it, Ctrl+Enter saves exactly what was typed. Colour Markdown while editing in the
// preferences sheet turns it off (the boxes are as they were, the textarea the same size in the same place,
// and the choice survives a reload) and on again. Each step waits on the page, never on a fixed sleep.

const KINDS = ['heading', 'bold', 'italic', 'strike', 'code', 'link', 'marker', 'tag', 'mention'];

// One of each kind, no blank line, so each visual line of the copy has a box to measure.
const KINDS_TEXT = [
  '# A heading with `code` in it',
  'Some **bold words**, *italic words*, ~~struck words~~ and a [link](https://example.test/x) with #12 and `kanban#7 a title` beside <u>tagged</u> words.',
  '- [ ] a list item',
  '> a quote',
].join('\n');

// A long wrapped paragraph, a long unbroken address and a list: lines that break in many places.
const WRAP_LINE = `${'wordy words that wrap and wrap again '.repeat(14)}https://example.test/a/very/long/address/that/has/no/breaks/anywhere/in/it/${'x'.repeat(60)}`;
const WRAP_TEXT = [WRAP_LINE, '- an item that wraps too because it has a good many words in it, enough to fill a line or two at any width', WRAP_LINE].join('\n');
const MANY_LINES = Array.from({ length: 70 }, (_, i) => `line ${i} with **some** words in it that make it long enough to wrap in a narrow box, ${'and more '.repeat(i % 7)}`).join('\n');

const jq = (s) => JSON.stringify(s);

module.exports = {
  name: 'markdown-edit',
  board: 'scratchpad',
  timeoutMs: 110000,
  async run(page) {
    const { ev, send, open, waitFor, centre, click, key, check, shot } = page;

    const PAL = `document.getElementById('notes-palette')`;
    const PAL_GONE = `!${PAL}||${PAL}.classList.contains('hidden')`;
    const TEXT = `document.querySelector('#notes-palette .sp-text')`;
    const READY = `(()=>{const t=${TEXT};return !!t&&!t.disabled})()`;
    const FORM = `document.getElementById('f-body')`;

    const menuUp = () => waitFor(`!document.getElementById('context-menu').classList.contains('hidden')`, 2500);
    const clickOn = async (sel) => {
      await ev(`document.querySelector(${jq(sel)}).scrollIntoView({block:'nearest'})`);
      const p = await centre(sel);
      if (!p) throw new Error(`nothing matches ${sel}`);
      await click(p.x, p.y);
    };
    const closePalette = async () => {
      for (let i = 0; i < 3; i++) {
        await key('Escape');
        if (await waitFor(PAL_GONE, i < 2 ? 700 : 2500)) return true;
      }
      return false;
    };
    const openPad = async () => {
      await page.rightClick(`#board .card-el[data-id="7"]`);
      if (!(await menuUp())) return false;
      await ev(`document.querySelector('#ctx-scratch').click()`);
      return waitFor(READY, 4000);
    };
    // Replaces the box's text with `text` by the browser's own insert, as typing does.
    const typeInto = async (sel, text) => {
      await ev(`(()=>{const t=document.querySelector(${jq(sel)});t.focus();t.select();return true})()`);
      await send('Input.insertText', { text });
    };
    const valueOf = (sel) => `document.querySelector(${jq(sel)}).value`;
    const copyText = (sel) => `(()=>{const b=document.querySelector(${jq(sel)}).closest('.md-edit').querySelector('.md-edit-back');return b.textContent})()`;
    // The copy holds the textarea's text, and a space after a last newline so that empty line is drawn.
    const copyIsValue = (sel) => `(()=>{const t=document.querySelector(${jq(sel)}),v=t.value;return t.closest('.md-edit').querySelector('.md-edit-back').textContent===v+(v.endsWith(String.fromCharCode(10))?' ':'')})()`;

    // Where the copy's lines sit against the textarea's: the same box, the same width inside it, the same
    // height of text, and as many lines as that height holds.
    const geometry = (sel) => `(()=>{
      const ta=document.querySelector(${jq(sel)}), wrap=ta.closest('.md-edit'), back=wrap.querySelector('.md-edit-back');
      const a=ta.getBoundingClientRect(), b=back.getBoundingClientRect(), w=wrap.getBoundingClientRect();
      const near=(x,y)=>Math.abs(x-y)<0.5;
      const cs=getComputedStyle(ta), bs=getComputedStyle(back);
      const width=(e)=>e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft)-parseFloat(getComputedStyle(e).paddingRight);
      const r=document.createRange(); r.selectNodeContents(back);
      const tops=[...new Set([...r.getClientRects()].filter((q)=>q.width>0).map((q)=>Math.round(q.top*4)/4))].sort((x,y)=>x-y);
      const pitch=tops.length>1?(tops[tops.length-1]-tops[0])/(tops.length-1):0;
      const content=ta.scrollHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
      return {
        box: near(a.left,b.left)&&near(a.top,b.top)&&near(a.width,b.width)&&near(a.height,b.height),
        wrap: near(a.width,w.width)&&near(a.height,w.height)&&near(a.left,w.left)&&near(a.top,w.top),
        inside: width(back)===width(ta)&&back.clientHeight===ta.clientHeight,
        height: back.scrollHeight===ta.scrollHeight,
        font: cs.fontFamily===bs.fontFamily&&cs.fontSize===bs.fontSize&&cs.lineHeight===bs.lineHeight&&cs.whiteSpace===bs.whiteSpace&&cs.overflowWrap===bs.overflowWrap,
        lines: tops.length, pitch, content,
        fit: tops.length>0&&pitch>0&&tops.length*pitch<=content+2&&(ta.scrollHeight<=ta.clientHeight+1||Math.abs(tops.length*pitch-content)<2),
        bar: ta.offsetWidth-ta.clientWidth-2*parseFloat(cs.borderLeftWidth),
      };
    })()`;
    // A resize is answered by the copy in the frame that lays it out, before it is painted; the check waits for that frame.
    const frames = () => ev(`new Promise((done)=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))`);
    const same = async (label, sel, { needsLines = true } = {}) => {
      await frames();
      const g = await ev(geometry(sel));
      check(`markdown-edit: ${label}: the copy's box is the textarea's box and the wrapper is no bigger`, g.box && g.wrap, JSON.stringify(g));
      check(`markdown-edit: ${label}: the copy wraps in the same width and holds the same height of text`, g.inside && g.height, JSON.stringify(g));
      check(`markdown-edit: ${label}: the copy takes the textarea's font and wrapping`, g.font, JSON.stringify(g));
      if (needsLines) check(`markdown-edit: ${label}: the copy has as many lines as the textarea's text is tall (${g.lines} of ${g.pitch})`, g.fit, JSON.stringify(g));
      return g;
    };

    // The resolved colour of a token, read through an element so a var() chain is followed.
    const colourOf = (tok) => `(()=>{const p=document.createElement('i');p.style.color='var(${tok})';document.body.append(p);const c=getComputedStyle(p).color;p.remove();return c})()`;
    const KIND_TOKEN = { heading: '--md-edit-heading', bold: '--md-edit-bold', italic: '--md-edit-italic', strike: '--md-edit-strike', code: '--md-edit-code', link: '--md-edit-link', marker: '--md-edit-marker', tag: '--md-edit-tag', mention: '--md-edit-mention' };

    await open('/?view=board');
    check('markdown-edit: the board is drawn with its scratchpad', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!state.scratchpad`, 10000));

    // --- the Scratchpad's Edit box --------------------------------------------------------------------------------------
    check('markdown-edit: card 7\'s page opens', await openPad());
    check('markdown-edit: the Edit box is wrapped, coloured and has a hidden copy behind it', await ev(`(()=>{const t=${TEXT},w=t.closest('.md-edit');return !!w&&w.classList.contains('on')&&w.firstElementChild===t&&w.lastElementChild.classList.contains('md-edit-back')&&w.lastElementChild.getAttribute('aria-hidden')==='true'})()`));
    check('markdown-edit: the page that was loaded is drawn in the copy as it is in the box', await ev(copyIsValue('#notes-palette .sp-text')), await ev(`JSON.stringify([${copyText('#notes-palette .sp-text')},${valueOf('#notes-palette .sp-text')}])`));
    check('markdown-edit: the textarea\'s own text is transparent, its caret is the ink and plain text in the copy is the ink', await ev(`(()=>{const t=${TEXT},cs=getComputedStyle(t),ink=${colourOf('--ink')};return /rgba\\(0, 0, 0, 0\\)|transparent/.test(cs.color)&&cs.caretColor===ink&&getComputedStyle(t.closest('.md-edit').querySelector('.md-edit-back')).color===ink})()`));
    check('markdown-edit: the box keeps the paper it had, now on the wrapper', await ev(`(()=>{const t=${TEXT},paper=${colourOf('--paper')};return getComputedStyle(t.closest('.md-edit')).backgroundColor===paper&&getComputedStyle(t).backgroundColor==='rgba(0, 0, 0, 0)'})()`));
    const selection = await ev(`(()=>{const s=getComputedStyle(${TEXT},'::selection');return {bg:s.backgroundColor,fg:s.color,tok:${colourOf('--md-edit-selection')}}})()`);
    check('markdown-edit: a selection is washed with the box\'s own colour and keeps the text readable', selection.bg === selection.tok && /rgba\(0, 0, 0, 0\)|transparent/.test(selection.fg), JSON.stringify(selection));

    await typeInto('#notes-palette .sp-text', KINDS_TEXT);
    check('markdown-edit: typing goes into the textarea and the textarea alone holds the text', await ev(`${valueOf('#notes-palette .sp-text')}===${jq(KINDS_TEXT)}`));
    check('markdown-edit: the copy is the same text', await ev(copyIsValue('#notes-palette .sp-text')), await ev(copyText('#notes-palette .sp-text')));
    const kindColours = await ev(`(()=>{const back=${TEXT}.closest('.md-edit').querySelector('.md-edit-back'),out={};for(const kind of ${jq(KINDS)}){const el=back.querySelector('.md-edit-'+kind);out[kind]=el?getComputedStyle(el).color:null}return out})()`);
    const wanted = {};
    for (const kind of KINDS) wanted[kind] = await ev(colourOf(KIND_TOKEN[kind]));
    for (const kind of KINDS) check(`markdown-edit: a ${kind} is drawn in --md-edit-${kind}`, kindColours[kind] === wanted[kind], `${kindColours[kind]} vs ${wanted[kind]}`);
    check('markdown-edit: a mention has the chip\'s ground, a link is underlined and a strike has a line through it', await ev(`(()=>{const b=${TEXT}.closest('.md-edit').querySelector('.md-edit-back'),q=(k)=>getComputedStyle(b.querySelector('.md-edit-'+k));return q('mention').backgroundColor===${colourOf('--md-edit-mention-bg')}&&q('link').textDecorationLine.includes('underline')&&q('strike').textDecorationLine.includes('line-through')})()`));
    check('markdown-edit: a colour is only a colour: no kind changes weight, style, size, spacing or family', await ev(`(()=>{const b=${TEXT}.closest('.md-edit').querySelector('.md-edit-back'),base=getComputedStyle(b);return [...b.querySelectorAll('span')].length>=9&&[...b.querySelectorAll('span')].every((s)=>{const c=getComputedStyle(s);return ['fontWeight','fontStyle','fontSize','fontFamily','letterSpacing','wordSpacing','lineHeight','textTransform'].every((p)=>c[p]===base[p])&&c.paddingLeft==='0px'&&c.borderLeftWidth==='0px'&&c.marginLeft==='0px'})})()`));
    await shot('kinds-in-the-scratchpad');
    await same('the Scratchpad box', '#notes-palette .sp-text');

    await typeInto('#notes-palette .sp-text', WRAP_TEXT);
    const wrapGeo = await same('the Scratchpad box with long wrapped lines', '#notes-palette .sp-text');
    check('markdown-edit: the text does wrap (the lines are more than the lines of text)', wrapGeo.lines > 8, JSON.stringify(wrapGeo));

    await typeInto('#notes-palette .sp-text', MANY_LINES);
    const scrollGeo = await ev(geometry('#notes-palette .sp-text'));
    check('markdown-edit: with 70 lines the textarea has a scrollbar and its text is taller than its box', scrollGeo.bar > 3 && await ev(`${TEXT}.scrollHeight>${TEXT}.clientHeight+50`), JSON.stringify(scrollGeo));
    await same('the Scratchpad box with a scrollbar (the copy gives up its width)', '#notes-palette .sp-text', { needsLines: false });
    await ev(`${TEXT}.scrollTop=300`);
    check('markdown-edit: scrolling the textarea scrolls the copy by as much', await waitFor(`(()=>{const t=${TEXT};return t.scrollTop>0&&t.closest('.md-edit').querySelector('.md-edit-back').scrollTop===t.scrollTop})()`, 2500));
    await ev(`${TEXT}.scrollTop=${TEXT}.scrollHeight`);
    check('markdown-edit: and at the end of the text', await waitFor(`(()=>{const t=${TEXT};return t.scrollTop>300&&t.closest('.md-edit').querySelector('.md-edit-back').scrollTop===t.scrollTop})()`, 2500));
    await shot('scrolled');

    await ev(`${TEXT}.style.height='340px'`);
    check('markdown-edit: after a manual resize the copy is the textarea\'s new box', await waitFor(`(()=>{const t=${TEXT},b=t.closest('.md-edit').querySelector('.md-edit-back');return Math.abs(b.getBoundingClientRect().height-t.getBoundingClientRect().height)<0.5&&t.getBoundingClientRect().height>=339})()`, 2500));
    await same('the Scratchpad box after a resize', '#notes-palette .sp-text', { needsLines: false });
    await ev(`${TEXT}.style.height=''`);

    // --- the keys still edit the textarea ------------------------------------------------------------------------------------
    await typeInto('#notes-palette .sp-text', 'plain word');
    await ev(`${TEXT}.setSelectionRange(6,10)`);
    await key('b', { ctrl: true });
    check('markdown-edit: Ctrl+B wraps the selection and the copy shows it bold', await waitFor(`${valueOf('#notes-palette .sp-text')}==='plain **word**'&&${TEXT}.closest('.md-edit').querySelector('.md-edit-bold')&&${TEXT}.closest('.md-edit').querySelector('.md-edit-bold').textContent==='**word**'`, 2500));
    await key('z', { ctrl: true });
    check('markdown-edit: Undo takes it back in one step and the copy follows', await waitFor(`${valueOf('#notes-palette .sp-text')}==='plain word'&&!${TEXT}.closest('.md-edit').querySelector('.md-edit-bold')`, 2500));
    await typeInto('#notes-palette .sp-text', '- item');
    await ev(`${TEXT}.setSelectionRange(0,0)`);
    await key('Tab');
    check('markdown-edit: Tab still indents, and the copy has the indent', await waitFor(`${valueOf('#notes-palette .sp-text')}==='  - item'&&${copyText('#notes-palette .sp-text')}==='  - item'`, 2500), await ev(`JSON.stringify([${valueOf('#notes-palette .sp-text')},${copyText('#notes-palette .sp-text')},document.activeElement.className])`));
    await typeInto('#notes-palette .sp-text', 'saved **as typed**\n\n# and this');
    await key('Enter', { ctrl: true });
    check('markdown-edit: Ctrl+Enter saves, and the page holds exactly what was typed', await waitFor(`document.querySelector('#notes-palette .sp-status').textContent==='Saved'`, 4000)
      && await ev(`fetch('/api/scratchpad/7').then((r)=>r.json()).then((d)=>d.pad.body)`) === 'saved **as typed**\n\n# and this');

    await clickOn('#notes-palette .sp-mode:last-child');
    check('markdown-edit: Preview hides the box and its copy with it, Edit brings both back', await waitFor(`getComputedStyle(${TEXT}.closest('.md-edit')).display==='none'`, 2500));
    await clickOn('#notes-palette .sp-mode:first-child');
    check('markdown-edit: and Edit shows the copy again, drawn', await waitFor(`getComputedStyle(${TEXT}.closest('.md-edit')).display!=='none'&&!!${TEXT}.closest('.md-edit').querySelector('.md-edit-heading')`, 2500));
    check('markdown-edit: Esc closes the palette', await closePalette());

    // --- the card form's description ------------------------------------------------------------------------------------------
    const openForm = async () => {
      await open('/?card=7');
      if (!(await waitFor(`!!document.querySelector('#detail-edit-btn')&&!document.getElementById('detail-modal').classList.contains('hidden')`, 10000))) return false;
      await clickOn('#detail-edit-btn');
      return waitFor(`!document.getElementById('modal').classList.contains('hidden')&&document.getElementById('f-title').value.length>0`, 5000);
    };
    check('markdown-edit: card 7\'s edit form opens', await openForm());
    check('markdown-edit: the description sits in the wrapper where it was, inside its label, coloured', await ev(`(()=>{const t=${FORM},w=t.closest('.md-edit');return !!w&&w.classList.contains('on')&&w.parentElement.classList.contains('modal-desc')&&w.parentElement.tagName==='LABEL'})()`));
    check('markdown-edit: the description card 7 carries is in the copy as it is in the box', await ev(copyIsValue('#f-body')) && await ev(`${valueOf('#f-body')}.length>0`), await ev(`JSON.stringify([${copyText('#f-body')},${valueOf('#f-body')}])`));

    await typeInto('#f-body', KINDS_TEXT);
    check('markdown-edit: the form\'s box takes the colours too', await ev(`['heading','bold','italic','strike','code','link','marker','tag','mention'].every((k)=>!!${FORM}.closest('.md-edit').querySelector('.md-edit-'+k))`));
    await typeInto('#f-body', WRAP_TEXT);
    const formGeo = await same('the card form', '#f-body');
    check('markdown-edit: the text wraps in the form', formGeo.lines > 6, JSON.stringify(formGeo));
    await typeInto('#f-body', WRAP_TEXT + '\n' + WRAP_TEXT + '\n' + WRAP_TEXT);
    await same('the card form after the box grew with its text', '#f-body');
    await shot('card-form');

    await clickOn('#modal-fullscreen-btn');
    check('markdown-edit: the form goes full screen', await waitFor(`document.getElementById('card-form').classList.contains('fullscreen')`, 2500));
    await waitFor(`${FORM}.getBoundingClientRect().width>900`, 2500);
    await same('the card form full screen', '#f-body');
    await typeInto('#f-body', MANY_LINES);
    await same('the card form full screen with more lines than the screen holds', '#f-body', { needsLines: false });
    await typeInto('#f-body', 'short');
    check('markdown-edit: a short text in full screen leaves the box as tall as the screen gives it, and the copy is that box', await waitFor(`${FORM}.getBoundingClientRect().height>300`, 2500) && (await ev(geometry('#f-body'))).box);
    await shot('card-form-fullscreen');
    await clickOn('#modal-fullscreen-btn');
    await waitFor(`!document.getElementById('card-form').classList.contains('fullscreen')`, 2500);

    await typeInto('#f-body', WRAP_TEXT);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    check('markdown-edit: at phone width the form fills the screen', await waitFor(`document.getElementById('card-form').getBoundingClientRect().width<=390`, 4000));
    await waitFor(`parseFloat(getComputedStyle(${FORM}).fontSize)===16`, 2500);
    await waitFor(`(()=>{const g=${FORM};const b=g.closest('.md-edit').querySelector('.md-edit-back');return getComputedStyle(b).fontSize==='16px'})()`, 2500);
    const phoneGeo = await same('the card form at phone width', '#f-body');
    check('markdown-edit: at phone width the text is 16px in both and wraps in more lines', phoneGeo.lines > formGeo.lines, JSON.stringify([phoneGeo.lines, formGeo.lines]));
    await shot('card-form-phone');
    await send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
    await waitFor(`${FORM}.getBoundingClientRect().width>300&&getComputedStyle(${FORM}).fontSize!=='16px'`, 4000);
    await same('the card form back at desktop width', '#f-body');

    await key('s', { ctrl: true });
    check('markdown-edit: Ctrl+S in the description saves the form', await waitFor(`document.getElementById('modal').classList.contains('hidden')`, 5000));
    check('markdown-edit: and the card holds what was typed', await ev(`fetch('/api/board').then((r)=>r.json()).then((d)=>d.active.find((c)=>String(c.id)==='7').body.trim())`) === WRAP_TEXT);

    const rectOf = `(()=>{const r=${FORM}.getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round)})()`;
    check('markdown-edit: the form opens again on the saved text', await openForm());
    const formOn = await ev(rectOf);
    await key('Escape');
    check('markdown-edit: and closes', await waitFor(`document.getElementById('modal').classList.contains('hidden')`, 2500));

    // --- the switch ---------------------------------------------------------------------------------------------------------------
    const openSheet = async () => {
      await clickOn('#prefs-btn');
      if (!(await waitFor(`!document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500))) return false;
      return waitFor(`document.querySelector('.prefs-sheet').getAnimations().length===0`, 2500);
    };
    const closeSheet = async () => { await key('Escape'); return waitFor(`document.getElementById('prefs-sheet').classList.contains('hidden')`, 2500); };
    await open('/?view=board');
    await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    check('markdown-edit: the preferences sheet opens', await openSheet());
    check('markdown-edit: Colour Markdown while editing is there and on', await ev(`(()=>{const c=document.getElementById('prefs-md-colour');return !!c&&c.checked&&c.parentElement.textContent.trim()==='Colour Markdown while editing'})()`));
    await clickOn('#prefs-md-colour');
    check('markdown-edit: turned off it is remembered in the browser', await waitFor(`!document.getElementById('prefs-md-colour').checked`, 2500) && await ev(`JSON.parse(localStorage.getItem('kanban.scratchpad.prefs')).mdColour===false`));
    check('markdown-edit: the sheet closes', await closeSheet());
    check('markdown-edit: the form opens with its box plain: the wrapper has no box, the text is the ink and the copy is empty', await openForm() && await ev(`(()=>{const t=${FORM},w=t.closest('.md-edit');return !w.classList.contains('on')&&getComputedStyle(w).display==='contents'&&getComputedStyle(t).color===${colourOf('--ink')}&&getComputedStyle(t).backgroundColor===${colourOf('--paper')}&&w.querySelector('.md-edit-back').childNodes.length===0&&getComputedStyle(w.querySelector('.md-edit-back')).display==='none'})()`));
    const formOff = await ev(rectOf);
    check('markdown-edit: off, the textarea is the size it was and in the same place as with the colours on', JSON.stringify(formOff) === JSON.stringify(formOn), JSON.stringify([formOn, formOff]));
    await typeInto('#f-body', '**plain** text');
    check('markdown-edit: typing off the colours is just typing, and nothing is drawn behind it', await ev(`${valueOf('#f-body')}==='**plain** text'&&${FORM}.closest('.md-edit').querySelector('.md-edit-back').childNodes.length===0`));
    await open('/?view=board');
    await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000);
    check('markdown-edit: after a reload the Scratchpad\'s box is still plain', await openPad() && await ev(`!${TEXT}.closest('.md-edit').classList.contains('on')&&getComputedStyle(${TEXT}).color===${colourOf('--ink')}`));
    await typeInto('#notes-palette .sp-text', '**plain**');
    check('markdown-edit: and draws nothing behind its text', await ev(`${TEXT}.closest('.md-edit').querySelector('.md-edit-back').childNodes.length===0`));
    check('markdown-edit: Esc closes the palette', await closePalette());

    check('markdown-edit: the sheet shows it off after the reload', await openSheet() && await ev(`!document.getElementById('prefs-md-colour').checked`));
    await clickOn('#prefs-md-colour');
    check('markdown-edit: turned on again, the choice is remembered', await waitFor(`document.getElementById('prefs-md-colour').checked`, 2500) && await ev(`JSON.parse(localStorage.getItem('kanban.scratchpad.prefs')).mdColour===true`));
    check('markdown-edit: the sheet closes again', await closeSheet());
    check('markdown-edit: a box opened now is coloured again', await openPad() && await ev(`${TEXT}.closest('.md-edit').classList.contains('on')`));
    await typeInto('#notes-palette .sp-text', '**bold**');
    check('markdown-edit: and draws its text', await ev(`!!${TEXT}.closest('.md-edit').querySelector('.md-edit-bold')`));
    await closePalette();
  },
};

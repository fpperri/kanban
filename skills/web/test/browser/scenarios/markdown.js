'use strict';
// Rich Markdown in a card body, on the markdown board (the fixture board plus card 22, whose body holds a
// fourth-level heading, bold, strike, underline, a bare address, an ordered list with a bullet under a
// number, a quote holding a bullet, a ```c# block, a fence shown by a longer one and a closed section). The popup draws
// each as the element it should be, a typed block shows its language and a Copy button that copies the
// block's text, an untyped block has neither, and nothing from the body is a live tag. Each step waits on
// the page, never on a fixed sleep.

module.exports = {
  name: 'markdown',
  board: 'markdown',
  async run(page) {
    const { ev, open, waitFor, centre, click, check, shot } = page;
    const body = (sel) => `document.querySelector('#detail-body ${sel}')`;
    const text = (sel) => `(${body(sel)}||{textContent:null}).textContent`;

    await open('/?card=22');
    check('markdown: card 22 opens with its body drawn', await waitFor(`!!${body('h4')}`, 10000));
    check('markdown: #### is a fourth-level heading', await ev(`${text('h4')}==='A fourth-level heading'`));
    check('markdown: bold, strike and underline are elements', await ev(`${text('strong')}==='bold'&&${text('del')}==='struck'&&${text('u')}==='underlined'`));
    check('markdown: a bare address is a link that opens elsewhere safely', await ev(`(()=>{const a=${body('a')};return !!a&&a.getAttribute('href')==='https://example.test/docs'&&a.target==='_blank'&&a.rel==='noopener noreferrer'})()`));
    check('markdown: 1. and 2. are a numbered list with a bullet under the first', await ev(`document.querySelectorAll('#detail-body ol > li').length===2&&!!${body('ol > li > ul > li')}`));
    check('markdown: the > lines are a quote that holds a bullet', await ev(`${text('blockquote p')}==='quoted words'&&${text('blockquote ul li')}==='and a quoted bullet'`));

    check('markdown: the c# block shows its language and keeps it on the block', await ev(`${text('.md-code .md-code-lang')}==='c#'&&${body('.md-code pre')}.getAttribute('data-lang')==='c#'&&${text('.md-code pre code')}==='var answer = 42;'`));
    check('markdown: the fence shown by a longer one is plain code with the inner fence in it', await ev(`(()=>{const pres=[...document.querySelectorAll('#detail-body pre')].filter((p)=>!p.closest('.md-code'));return pres.length===1&&pres[0].textContent.startsWith('\`\`\`')&&!pres[0].closest('.md-code')})()`));
    check('markdown: an untyped block has no Copy button', await ev(`document.querySelectorAll('#detail-body .md-code-copy').length===1`));
    check('markdown: nothing in the body is a live script or handler', await ev(`document.querySelectorAll('#detail-body script, #detail-body [onclick]').length===0`));
    check('markdown: a <details> section is drawn closed, with its summary showing and its text hidden', await ev(`(()=>{const d=${body('details')};return !!d&&d.open===false&&${text('details > summary')}==='Open me'&&d.querySelector('p').getBoundingClientRect().height===0})()`));
    await ev(`${body('details > summary')}.scrollIntoView({block:'nearest'})`);
    const sum = await centre('#detail-body details > summary');
    await click(sum.x, sum.y);
    check('markdown: a click on the summary opens the section and shows its Markdown', await waitFor(`${body('details')}.open===true`, 2500) && await ev(`${text('details p')}==='hidden words'&&!!${body('details p strong')}&&${body('details p')}.getBoundingClientRect().height>0`));
    await click(sum.x, sum.y);
    check('markdown: and a second click closes it again', await waitFor(`${body('details')}.open===false`, 2500));
    await shot('markdown-detail');

    await ev(`window.__copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:(t)=>{window.__copied.push(t);return Promise.resolve()}})`);
    await ev(`document.querySelector('#detail-body .md-code-copy').scrollIntoView({block:'nearest'})`);
    const at = await centre('#detail-body .md-code-copy');
    await click(at.x, at.y);
    check('markdown: Copy copies the block\'s text, not its label', await waitFor(`window.__copied.length===1`, 3000) && await ev(`window.__copied[0]==='var answer = 42;'`), await ev(`JSON.stringify(window.__copied)`));
    check('markdown: and the button says so, then goes back', await waitFor(`${text('.md-code-copy')}==='Copied'`, 3000) && await waitFor(`${text('.md-code-copy')}==='Copy'`, 4000));
  },
};

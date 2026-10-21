'use strict';
// Rich Markdown in a card body, on the markdown board (the fixture board plus card 22, whose body holds a
// fourth-level heading, bold, strike, underline, a bare address, an ordered list with a bullet under a
// number, a quote holding a bullet, a ```c# block, a fence shown by a longer one and a closed section). The popup draws
// each as the element it should be, a typed block shows its language and a Copy button that copies the
// block's text, an untyped block has neither, and nothing from the body is a live tag. Then the libraries:
// a page with no typed block asks for neither file; card 22's ```c# block is coloured by highlight.js (and
// only that library is asked for); card 23's ```mermaid block is drawn in the sandboxed frame (and only
// that); card 24's broken diagram stays a labelled block with a one-line error and the body after it
// is drawn. Each step waits on the page, never on a fixed sleep. What the frame draws is inside its own
// sandbox, out of the page's reach, so a drawn diagram is read from the height the frame reported.

module.exports = {
  name: 'markdown',
  board: 'markdown',
  timeoutMs: 100000,
  async run(page) {
    const { ev, open, waitFor, centre, click, check, shot } = page;
    const body = (sel) => `document.querySelector('#detail-body ${sel}')`;
    const text = (sel) => `(${body(sel)}||{textContent:null}).textContent`;

    const asked = `performance.getEntriesByType('resource').map((e)=>new URL(e.name).pathname).filter((p)=>/^\\/(vendor\\/|mermaid-frame)/.test(p))`;

    await open('/?view=board');
    check('markdown: the board is drawn', await waitFor(`document.querySelectorAll('#board .card-el').length>20`, 10000));
    check('markdown: a page with no typed block asks for neither library', await ev(`${asked}.length===0`), await ev(`JSON.stringify(${asked})`));

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
    const sectionH = `${body('details')}.getBoundingClientRect().height`;
    const closedH = await ev(sectionH);
    check('markdown: a <details> section is drawn closed, with only its summary showing', await ev(`(()=>{const d=${body('details')};return !!d&&d.open===false&&${text('details > summary')}==='Open me'})()`) && closedH > 0 && closedH < 90, closedH);
    const clickSummary = async () => {
      await ev(`${body('details > summary')}.scrollIntoView({block:'center'})`);
      const at = await centre('#detail-body details > summary');
      await click(at.x, at.y);
    };
    await clickSummary();
    check('markdown: a click on the summary opens the section and shows its Markdown', await waitFor(`${body('details')}.open===true`, 2500) && await ev(`${text('details p')}==='hidden words'&&!!${body('details p strong')}&&${sectionH}>${closedH + 10}`));
    await clickSummary();
    check('markdown: and a second click closes it again', await waitFor(`${body('details')}.open===false`, 2500) && await ev(`${sectionH}<${closedH + 2}`));
    await shot('markdown-detail');

    // --- highlight.js: card 22's ```c# block --------------------------------------------------------------------------------------
    check('markdown: the c# block is coloured, and still says c# and still has its text', await waitFor(`document.querySelectorAll('#detail-body .md-code pre code.hljs span[class^="hljs-"]').length>0`, 6000) && await ev(`${text('.md-code .md-code-lang')}==='c#'&&${text('.md-code pre code')}==='var answer = 42;'`));
    check('markdown: only highlight.js was asked for, from the plugin\'s own files', await ev(`${asked}.some((p)=>p==='/vendor/highlight.js/highlight.min.js')&&!${asked}.some((p)=>/mermaid/.test(p))`), await ev(`JSON.stringify(${asked})`));
    check('markdown: the page takes the theme it is in', await ev(`(()=>{const dark=matchMedia('(prefers-color-scheme: dark)').matches;const l=document.querySelector('link[href$="github.min.css"]'),d=document.querySelector('link[href$="github-dark.min.css"]');return !!l&&!!d&&l.disabled===dark&&d.disabled===!dark})()`));
    await ev(`window.__copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:(t)=>{window.__copied.push(t);return Promise.resolve()}})`);
    await ev(`document.querySelector('#detail-body .md-code-copy').scrollIntoView({block:'nearest'})`);
    const at = await centre('#detail-body .md-code-copy');
    await click(at.x, at.y);
    check('markdown: Copy copies the block\'s text, not its label', await waitFor(`window.__copied.length===1`, 3000) && await ev(`window.__copied[0]==='var answer = 42;'`), await ev(`JSON.stringify(window.__copied)`));
    check('markdown: and the button says so, then goes back', await waitFor(`${text('.md-code-copy')}==='Copied'`, 3000) && await waitFor(`${text('.md-code-copy')}==='Copy'`, 4000));

    await ev(`document.documentElement.setAttribute('data-theme','dark')`);
    check('markdown: and the other when the root says so', await waitFor(`document.querySelector('link[href$="github-dark.min.css"]').disabled===false&&document.querySelector('link[href$="github.min.css"]').disabled===true`, 3000));
    await ev(`document.documentElement.removeAttribute('data-theme')`);

    // --- mermaid: card 23's diagram ------------------------------------------------------------------------------------------------
    await open('/?card=23');
    check('markdown: card 23 opens', await waitFor(`!!${body('.md-code')}`, 10000));
    check('markdown: its diagram is drawn in a sandboxed frame that can run scripts and nothing else', await waitFor(`(()=>{const f=${body('iframe.md-diagram')};return !!f&&f.getAttribute('sandbox')==='allow-scripts'&&!f.classList.contains('md-diagram-pending')&&parseInt(f.style.height,10)>40})()`, 20000), await ev(`(${body('iframe.md-diagram')}||{outerHTML:'no frame'}).outerHTML`));
    check('markdown: the diagram replaces the block', await ev(`${body('.md-code')}.hidden===true`));
    check('markdown: only the frame and its own library were asked for, and not highlight.js', await ev(`${asked}.includes('/mermaid-frame.html')&&!${asked}.some((p)=>/highlight/.test(p))`), await ev(`JSON.stringify(${asked})`));
    await shot('markdown-diagram');

    // --- a diagram that does not parse ------------------------------------------------------------------------------------------------
    await open('/?card=24');
    check('markdown: card 24 opens', await waitFor(`!!${body('.md-code')}`, 10000));
    check('markdown: a diagram that does not parse leaves the labelled block with one line of error under it', await waitFor(`!!${body('.md-diagram-error')}&&/^Diagram error: \\S/.test(${text('.md-diagram-error')})`, 20000) && await ev(`${body('.md-code')}.hidden===false&&${text('.md-code .md-code-lang')}==='mermaid'&&!${body('iframe.md-diagram')}&&!/\\n/.test(${text('.md-diagram-error')})`), await ev(`${text('.md-diagram-error')}`));
    check('markdown: and the text after it is drawn', await ev(`${text('p')}==='Still here after it.'`));
    await shot('markdown-diagram-error');
    await ev(`window.__copied=[];Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:(t)=>{window.__copied.push(t);return Promise.resolve()}})`);
    const bad = await centre('#detail-body .md-code-copy');
    await click(bad.x, bad.y);
    check('markdown: the block that would not draw still copies its own text', await waitFor(`window.__copied.length===1`, 3000) && await ev(`window.__copied[0]==='this is not a diagram'`), await ev(`JSON.stringify(window.__copied)`));

  },
};

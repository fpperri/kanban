'use strict';
// A Markdown image in a card body, on the images board (the fixture board plus card 25, whose body holds
// a png beside the card files, an svg that is there, a png that is not, and a remote address). The card
// details draw the png as a picture inside a link that opens it full size, loaded from the board server's
// own route and at most the body's width; the svg (never sent), the missing file are each the alt text
// as a plain label, with no broken picture left behind; the remote address stays an ordinary link and no
// request leaves the board server for it. Each step waits on the page, never on a fixed sleep.

module.exports = {
  name: 'images',
  board: 'images',
  timeoutMs: 60000,
  expectedErrors: [/status of 404 \(Not Found\).*\/api\/cards\/25\/image\?path=(pic\.svg|nope\.png)/],
  async run(page) {
    const { ev, open, waitFor, check, shot } = page;
    const body = (sel) => `document.querySelector('#detail-body ${sel}')`;
    const labels = `[...document.querySelectorAll('#detail-body .md-img-alt')].map((e)=>e.textContent)`;

    await open('/?card=25');
    check('images: card 25 opens with its body drawn', await waitFor(`!!${body('p')}`, 10000));
    check('images: the png is loaded as a picture, from this board server\'s route for card 25', await waitFor(`(()=>{const i=${body('img.md-img-pic')};return !!i&&i.complete&&i.naturalWidth===160&&new URL(i.src).pathname==='/api/cards/25/image'&&new URL(i.src).origin===location.origin})()`, 10000));
    check('images: the picture sits in a link that opens the same file in another tab', await ev(`(()=>{const a=${body('a.md-img')};return !!a&&a.target==='_blank'&&a.rel==='noopener noreferrer'&&a.href===a.querySelector('img').src})()`));
    check('images: the picture is at most the body\'s width', await ev(`(()=>{const i=${body('img.md-img-pic')};return i.getBoundingClientRect().width<=document.getElementById('detail-body').getBoundingClientRect().width+1&&i.getBoundingClientRect().width>0})()`));
    check('images: the svg and the missing file become their alt text as a plain label, and no picture of theirs stays', await waitFor(`${labels}.length===2`, 10000) && await ev(`${labels}.join('|')==='A vector picture|A missing picture'&&document.querySelectorAll('#detail-body img').length===1`), await ev(`JSON.stringify(${labels})`));
    check('images: the remote address stays a link and is never loaded', await ev(`(()=>{const a=[...document.querySelectorAll('#detail-body a:not(.md-img)')].find((x)=>x.href==='https://example.test/r.png');return !!a&&a.textContent==='A remote picture'&&!performance.getEntriesByType('resource').some((e)=>e.name.includes('example.test'))})()`));
    check('images: the text after the pictures is drawn', await ev(`/After the pictures\./.test(document.getElementById('detail-body').textContent)`));
    await shot('images-detail');
  },
};

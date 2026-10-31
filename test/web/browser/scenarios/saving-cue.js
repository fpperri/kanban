'use strict';
// The cue that a save is on its way, on the desk Web: a card dropped on Doing sends its save through a
// fetch the scenario holds back, and until the server answers the header shows the thin activity mark and
// leaving the page asks first (the page's askBeforeLeaving, handed a stand-in event, prevents it). When the answer arrives the
// mark goes, the card is in Doing and leaving asks nothing. The desk's Refresh keeps its word and still
// reloads from disk. The file side of the guard (a queue not yet copied) and the "Board as of" Refresh are
// checked in the artifact scenario, which builds the files.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js): api, askBeforeLeaving.

module.exports = {
  name: 'saving-cue',
  board: 'fixture',
  async run(page) {
    const { ev, open, waitFor, check, expectRefusedRequest } = page;
    const MARK = `(()=>{const m=document.getElementById('saving-mark');return !!m&&!m.classList.contains('hidden')&&getComputedStyle(m).display!=='none'&&m.getBoundingClientRect().height>0})()`;
    const MARK_GONE = `document.getElementById('saving-mark').classList.contains('hidden')`;
    const ASKS = `(()=>{const e={defaultPrevented:false,returnValue:'',preventDefault(){this.defaultPrevented=true}};askBeforeLeaving(e);return e.defaultPrevented})()`;
    const inDoing = `!!document.querySelector('#board .column[data-col="doing"] .card-el[data-id="7"]')`;
    const drop = (id, col) => ev(`(()=>{const card=document.querySelector('#board .card[data-id="${id}"]');const col=document.querySelector('#board .column[data-col="${col}"]');if(!card||!col)return false;const dt=new DataTransfer();const fire=(type,el)=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt,clientY:col.getBoundingClientRect().top+8}));fire('dragstart',card);fire('dragover',col);fire('drop',col);fire('dragend',card);return true})()`);

    await open('/');
    check('the board draws', await waitFor(`document.querySelectorAll('#board .card-el').length>0`, 10000));
    check('with no save in flight there is no mark', await ev(MARK_GONE));
    check('with no save in flight leaving asks nothing', (await ev(ASKS)) === false);
    check('the desk Refresh reads Refresh', (await ev(`document.querySelector('#refresh-btn .btn-label').textContent`)) === 'Refresh');

    await ev(`(()=>{window.__held=new Promise((r)=>{window.__release=r});window.__fetch=window.fetch;window.__answered=false;const f=window.fetch;window.fetch=(u,o)=>(o&&o.method==='PATCH'?window.__held.then(()=>f(u,o)).then((r)=>{window.__answered=true;return r}):f(u,o));return true})()`);
    check('card 7 starts in Todo', await ev(`!!document.querySelector('#board .column[data-col="todo"] .card-el[data-id="7"]')`));
    await drop('7', 'doing');
    check('a slow save shows the mark', await waitFor(MARK, 6000));
    check('and leaving asks first', (await ev(ASKS)) === true);
    check('the mark stays while the save is unanswered', (await ev(`window.__answered`)) === false && (await ev(MARK)) === true);

    await ev(`(()=>{window.__release();return true})()`);
    check('the server answers', await waitFor(`window.__answered===true`, 6000));
    check('the mark goes once it has', await waitFor(MARK_GONE, 6000));
    check('the card is in Doing', await waitFor(inDoing, 6000));
    check('leaving asks nothing again', (await ev(ASKS)) === false);

    // a refused save ends too
    await ev(`window.__answered=false`);
    await ev(`api('PATCH','/api/cards/6',{status:'doing'}).catch((e)=>{window.__refused=e.status})`);
    check('a save the server refuses ends the mark as well', await waitFor(`window.__answered===true&&window.__refused===422&&${MARK_GONE}`, 6000), await ev(`String(window.__refused)`));
    check('the browser logged that refusal, and only that', await expectRefusedRequest(422, '/api/cards/6'));
    await ev(`(()=>{window.fetch=window.__fetch;return true})()`);

    // Refresh at the desk is unchanged: it reloads from disk, no toast about rebuilding
    await ev(`document.getElementById('refresh-btn').click()`);
    check('the desk Refresh still reloads and asks nobody to rebuild', await waitFor(inDoing, 6000) && !/rebuild/i.test(await ev(`document.getElementById('toast').textContent`)));
  },
};

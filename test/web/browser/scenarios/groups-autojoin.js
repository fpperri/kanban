'use strict';
// Auto-join, on the groups board. The scenario makes three dated groups by the page's own local date
// (two running today, one with auto_join and one without, and one that ended), then makes a card in the New card form: the card lands in
// the auto-join group only and the flash names it. Each step waits on the page,
// never on a fixed sleep.
//
// Page globals this scenario reads (listed in test/web/browser-globals.test.js):
// state, toast (the page's #toast element, by its id).

const GROUPS = `state.groups.list`;
const group = (name) => `${GROUPS}.find((g)=>g.name===${JSON.stringify(name)})`;
const TOAST = `document.getElementById('toast')`;

module.exports = {
  name: 'groups-autojoin',
  board: 'groups',
  timeoutMs: 40000,
  async run(page) {
    const { ev, open, waitFor, check } = page;
    await open('/?view=board');
    check('autojoin: the board is drawn with its groups', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&state.groups&&${GROUPS}.length>0`, 10000));

    const made = await ev(`(async()=>{
      const p=(n)=>String(n).padStart(2,'0');
      const day=(off)=>{const d=new Date();d.setDate(d.getDate()+off);return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
      const post=async(body)=>{const r=await fetch('/api/groups',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.status};
      const a=await post({name:'running-auto',start_date:day(-1),end_date:day(1),auto_join:true});
      const b=await post({name:'running-manual',start_date:day(-1),end_date:day(1),auto_join:false});
      const c=await post({name:'ended-auto',start_date:day(-9),end_date:day(-2),auto_join:true});
      return [a,b,c].join();
    })()`);
    check('autojoin: three dated groups are made, only one of them running with auto_join', made === '201,201,201', made);

    await open('/?view=board');
    check('autojoin: the board is drawn again with the new groups', await waitFor(`document.querySelectorAll('#board .card-el').length>20&&!!${group('running-auto')}&&!!${group('running-manual')}&&!!${group('ended-auto')}`, 10000));

    await ev(`document.getElementById('new-btn').click()`);
    check('autojoin: the New card form opens', await waitFor(`!document.getElementById('modal').classList.contains('hidden')&&document.getElementById('f-id').value===''`, 3000));
    await ev(`(()=>{const t=document.getElementById('f-title');t.value='Joins on creation';t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('card-form').requestSubmit();return true})()`);
    check('autojoin: the new card is on the board', await waitFor(`state.active.some((c)=>c.title==='Joins on creation')`, 5000));
    const id = await ev(`String(state.active.find((c)=>c.title==='Joins on creation').id)`);
    check('autojoin: it is in the running auto_join group', await waitFor(`${group('running-auto')}.cards.includes(${JSON.stringify(id)})`, 4000), id);
    check('autojoin: and in no dated group without auto_join, and none that ended', await ev(`!${group('running-manual')}.cards.includes(${JSON.stringify(id)})&&!${group('ended-auto')}.cards.includes(${JSON.stringify(id)})`));
    check('autojoin: the flash says which group it joined', await waitFor(`/Joined .*running-auto/.test(${TOAST}.textContent)`, 2500), await ev(`${TOAST}.textContent`));
    check('autojoin: the card wears the group as a badge', await waitFor(`[...document.querySelectorAll('#board .card-el[data-id="${id}"] .group-badge')].some((b)=>/running-auto/.test(b.textContent))`, 4000));
  },
};

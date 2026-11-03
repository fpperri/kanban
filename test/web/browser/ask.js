'use strict';
// The speedbump's question (ask-ui.js), as a scenario sees it: the page's own #ask dialog, not a native
// confirm(). A scenario waits for it, reads the message, and answers it with a real click on the button, so
// the check that a button can be tapped is a check on where the button is drawn. It also keeps a native
// confirm() out of the page: nativeConfirmsSeen() counts the calls that reach window.confirm after
// refuseNativeConfirm() replaced it.

const ASK_UP = `!document.getElementById('ask').classList.contains('hidden')`;
const ASK_GONE = `document.getElementById('ask').classList.contains('hidden')`;
const ASK_TEXT = `document.getElementById('ask-text').textContent`;
const ASK_YES_LABEL = `document.getElementById('ask-yes').textContent`;

// Whether the ask is drawn on top at its middle and at the middle of both buttons, inside the window: what a tap
// on it would reach. Answers { fits, onTop, buttons } as plain values.
const ASK_REACHABLE = `(()=>{const w=innerWidth,h=innerHeight;const dlg=document.querySelector('#ask .ask-modal').getBoundingClientRect();const hit=(id)=>{const r=document.getElementById(id).getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;const el=document.elementFromPoint(x,y);return {inside:r.left>=0&&r.top>=0&&r.right<=w&&r.bottom<=h,reached:!!el&&el.closest('#'+id)!==null}};const yes=hit('ask-yes'),no=hit('ask-no'),close=hit('ask-close');return {fits:dlg.left>=0&&dlg.top>=0&&dlg.right<=w&&dlg.bottom<=h,onTop:document.elementFromPoint(dlg.left+dlg.width/2,dlg.top+8)!==null&&document.elementFromPoint(dlg.left+dlg.width/2,dlg.top+8).closest('#ask')!==null,buttons:yes.inside&&yes.reached&&no.inside&&no.reached&&close.inside&&close.reached}})()`;

const askUp = (page, ms = 3000) => page.waitFor(ASK_UP, ms);
const askGone = (page, ms = 3000) => page.waitFor(ASK_GONE, ms);
const askText = (page) => page.ev(ASK_TEXT);

// Press a button of the ask with a click at its middle.
async function askPress(page, id) {
  const p = await page.centre(`#${id}`);
  if (!p) throw new Error(`the ask has no ${id} to press`);
  await page.click(p.x, p.y);
}

const askYes = (page) => askPress(page, 'ask-yes');
const askNo = (page) => askPress(page, 'ask-no');

function refuseNativeConfirm(page) {
  return page.ev(`(()=>{window.__nativeConfirms=0;window.confirm=()=>{window.__nativeConfirms++;return false};return true})()`);
}
const nativeConfirmsSeen = (page) => page.ev('window.__nativeConfirms');

module.exports = {
  ASK_UP, ASK_GONE, ASK_TEXT, ASK_YES_LABEL, ASK_REACHABLE,
  askUp, askGone, askText, askPress, askYes, askNo, refuseNativeConfirm, nativeConfirmsSeen,
};

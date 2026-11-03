'use strict';
// A page of another origin around the Board artifact, as an artifact viewer holds it: an iframe whose sandbox
// lacks allow-top-navigation, so the frame may not traverse the tab history onto the viewer's own entry. The
// viewer page asks the frame what it holds with window.q(expression), a promise of the answer (the frame shares
// the viewer's address bar and nothing else, so it can only be asked by message), and the frame answers through
// the script the scenario adds to its page. Not a scenario: it lives beside the harness so the scenarios folder
// keeps its rule that every timer there is the harness's.

const VIEWER_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads';

// Goes at the end of the frame's page: it evaluates what the viewer posts it and posts the answer back.
const FRAME_ANSWERS = `<script>addEventListener('message',async(e)=>{if(!e.data||e.data.q===undefined)return;let v;try{v=await (0,eval)(e.data.q)}catch(x){v='ERR '+x.message}try{e.source.postMessage({id:e.data.id,v:JSON.stringify(v===undefined?null:v)},'*')}catch(x){}});</script>`;

// The viewer's page: the frame fills it, and window.q(expression) asks the frame (answering 'NO ANSWER' after 4 s).
const viewerHtml = (frameUrl) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>html,body{margin:0;height:100%}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body>
<iframe id="f" sandbox="${VIEWER_SANDBOX}" src="${frameUrl}"></iframe>
<script>window.__n=0;window.q=(expr)=>new Promise((res)=>{const id=++window.__n;const on=(e)=>{if(e.data&&e.data.id===id){removeEventListener('message',on);res(JSON.parse(e.data.v))}};addEventListener('message',on);document.getElementById('f').contentWindow.postMessage({q:expr,id},'*');setTimeout(()=>res('NO ANSWER'),4000)});</script>
</body></html>`;

module.exports = { VIEWER_SANDBOX, FRAME_ANSWERS, viewerHtml };

'use strict';
// The diagram frame's script (docs/web.md, Markdown). A ```mermaid block is drawn here, in a frame of
// its own that the server sandboxes (server.js, FRAME_CSP): the page cannot let mermaid write the
// inline styles it needs, so the frame is where it may, with an opaque origin and no way to the page or
// the network. The page posts { type: 'render', id, source, theme } and the frame answers
// { type: 'rendered', id, height } or { type: 'error', id, message }; { type: 'ready' } says it can be
// asked, and { type: 'size', id, height } follows a change of width. Only the page that embeds this
// frame is listened to, and mermaid runs with securityLevel 'strict'.

const diagramFrame = (() => {
  const out = document.getElementById('out');
  const send = (message) => parent.postMessage(message, '*');
  const measure = () => Math.ceil(out.getBoundingClientRect().height);
  const oneLine = (err) => String((err && err.message) || err || 'could not draw this diagram').split('\n')[0].trim().slice(0, 200);
  let drawn = 0;
  let current = null;

  new ResizeObserver(() => { if (current !== null && out.firstChild) send({ type: 'size', id: current, height: measure() }); }).observe(out);

  window.addEventListener('message', async (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || m.type !== 'render' || typeof m.source !== 'string' || typeof m.id !== 'number') return;
    const dark = m.theme === 'dark';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    try {
      if (typeof mermaid === 'undefined') throw new Error('the diagram library did not load');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', suppressErrorRendering: true });
      const { svg } = await mermaid.render(`diagram-${++drawn}`, m.source);
      out.innerHTML = svg;
      current = m.id;
      send({ type: 'rendered', id: m.id, height: measure() });
    } catch (err) {
      out.textContent = '';
      current = null;
      send({ type: 'error', id: m.id, message: oneLine(err) });
    }
  });

  send({ type: 'ready' });
})();

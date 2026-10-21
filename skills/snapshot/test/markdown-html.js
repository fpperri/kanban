// Two renderings of one Markdown body written the same way, so they can be compared: the nodes the
// snapshot builds (in the page harness), and the HTML string kanban-web writes. Attributes come out
// sorted and the web's numeric tick entities as the glyphs the snapshot writes; a card mention's
// click hook is the one place the two differ on purpose (the web's data-card-id, the snapshot's
// data-mapnode). Not a test file (the suite runs *.test.js only).
const { escapeHtml } = require('../../web/web/assignee-badge');

const VOID = new Set(['br', 'hr', 'img', 'input']);
const REFLECTED = ['href', 'target', 'rel', 'type'];

function attrString(pairs) {
  return pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
}

function nodesToHtml(node) {
  if (node.nodeType === 3) return escapeHtml(node.data);
  const tag = node.tagName.toLowerCase();
  const pairs = Object.entries(node.attrs);
  if (node.className) pairs.push(['class', node.className]);
  for (const [k, v] of Object.entries(node.dataset)) pairs.push([`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v]);
  for (const k of REFLECTED) if (typeof node[k] === 'string' && node[k]) pairs.push([k, node[k]]);
  const open = `<${tag}${attrString(pairs)}>`;
  if (VOID.has(tag)) return open;
  return `${open}${node._text ? escapeHtml(node._text) : ''}${node.children.map(nodesToHtml).join('')}</${tag}>`;
}

function webToHtml(html) {
  return html
    .replace(/&#9745;/g, '☑')
    .replace(/&#9744;/g, '☐')
    .replace(/ data-card-id="([^"]*)" tabindex="0" role="link"/g, ' data-mapnode="$1"')
    .replace(/<([a-z0-9]+)((?: [a-z-]+="[^"]*")+)>/g, (m, tag, attrs) => {
      const pairs = [...attrs.matchAll(/ ([a-z-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]);
      return `<${tag}${pairs.sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => ` ${k}="${v}"`).join('')}>`;
    });
}

module.exports = { nodesToHtml, webToHtml };

'use strict';
// The Graph view: every card as a dot, joined by its relations. Stub for now —
// renderGraphView() must stay a full idempotent rebuild (the 5s poll re-runs
// it), and resetGraphViewState() drops per-board memos on a board switch or
// status change. Plain <script> sharing one global scope with app.js, so every
// top-level name here is graph-prefixed.

function renderGraphView() {
  const host = document.getElementById('graph-view');
  host.textContent = '';
  const p = document.createElement('p');
  p.className = 'graph-placeholder';
  p.textContent = 'Graph view';
  host.appendChild(p);
}

function resetGraphViewState() {}

window.addEventListener('DOMContentLoaded', () => {
  $('#graph-toggle-btn').addEventListener('click', () => toggleView('graph'));
});

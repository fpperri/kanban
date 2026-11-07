'use strict';
// The 3D Hierarchy's compass in the stage's corner: a dial that turns and tilts with the camera
// (graph3dCompass); a press eases the camera back to north up, seen from straight above, the 2D
// Hierarchy's picture, keeping where it looks and how near.

function graph3dBuildCompass(hier) {
  const compass = document.createElement('button');
  compass.type = 'button';
  compass.className = 'graph-3d-compass';
  compass.title = GRAPH3D_COMPASS_TIP;
  compass.setAttribute('aria-label', GRAPH3D_COMPASS_TIP);
  const face = graphEl('svg', { viewBox: '-22 -22 44 44', 'aria-hidden': 'true' });
  const dial = graphEl('g', null, 'graph-3d-compass-dial');
  dial.append(
    graphEl('circle', { r: 13 }, 'graph-3d-compass-ring'),
    graphEl('polygon', { points: '0,11 3.5,0 -3.5,0' }, 'graph-3d-compass-south'),
    graphEl('polygon', { points: '0,-11 3.5,0 -3.5,0' }, 'graph-3d-compass-north'),
  );
  const north = graphEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'graph-3d-compass-n');
  north.textContent = 'N';
  face.append(dial, north);
  compass.appendChild(face);
  compass.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!graph3dReady(hier)) return;
    graph3dEndHint(hier);
    hier.zoom = null;
    graph3dFlyTo(hier, { phi: 0, theta: graph3dNorthUp(hier.cam.theta) }, false);
  });
  Object.assign(hier, { compass, dial, north });
  return compass;
}

// The dial as the camera sees the plan; written only when it changes.
function graph3dPaintCompass(hier) {
  const k = graph3dCompass(hier.cam.theta, hier.cam.phi);
  if (k.dial === hier.compassAt) return;
  hier.compassAt = k.dial;
  hier.dial.setAttribute('transform', k.dial);
  hier.north.setAttribute('x', graph3dRound2(17.5 * k.north[0]));
  hier.north.setAttribute('y', graph3dRound2(17.5 * k.north[1]));
}

// The delivery path, and the rules that keep it comfortable on Meta VR Glasses.
//
// Coordinates are in the viewer's frame: x to the right, y up from the eye, z negative straight ahead. The scene is placed
// so that frame follows the seated player's eye position, so a delivery looks the same whatever their height.
//
// The handoff baseline ended the ball at x = +-1.7 m only 2 m away, which is about 40 degrees to the side. The glasses
// show 37 degrees left and right, 25 up and 43 down, so that ball left the view and the player had to turn the head, which
// defeats "head still, eyes follow". The end point is now capped at ~18 degrees sideways, and everything stays inside the
// glasses' view with a margin. This is a deliberate change to the baseline and is called out in the README.

import { clamp } from './engine.js';

export const FOV = Object.freeze({ left: 37, right: 37, up: 25, down: 43 }); // Meta VR Glasses, degrees

export const PATH = Object.freeze({
  releaseZ: -18, // the bowler's hand
  endZ: -2.6, // the ball stops well short of the player's face
  releaseY: 0.9, // release point above the eye (m)
  bounceY: -1.1, // pitch surface below the eye at the bounce (m)
  endY: -0.35, // end height below the eye (m)
  bounceAt: 0.6, // share of the flight at which the ball bounces
  maxLateralDeg: 18, // sideways angle at the end for the left/right lanes
  maxCurveM: 0.25, // extra random swing
});

const deg = (r) => (r * 180) / Math.PI;

// Position of the ball at t01 (0 = release, 1 = end). lane: -1 left, 0 straight, +1 right. curve: small swing in metres.
export function ballPosition(t01, lane = 0, curve = 0) {
  const t = clamp(Number.isFinite(t01) ? t01 : 0, 0, 1);
  const l = clamp(Math.round(lane), -1, 1);
  const c = clamp(Number.isFinite(curve) ? curve : 0, -PATH.maxCurveM, PATH.maxCurveM);
  const z = PATH.releaseZ + (PATH.endZ - PATH.releaseZ) * t;
  const xEnd = Math.tan((PATH.maxLateralDeg * Math.PI) / 180) * -PATH.endZ;
  const x = l * xEnd * t + c * Math.sin(Math.PI * t);
  let y;
  if (t <= PATH.bounceAt) {
    const s = t / PATH.bounceAt;
    y = PATH.releaseY + (PATH.bounceY - PATH.releaseY) * s * s; // falling
  } else {
    const s = (t - PATH.bounceAt) / (1 - PATH.bounceAt);
    y = PATH.bounceY + (PATH.endY - PATH.bounceY) * (1 - (1 - s) * (1 - s)); // rising after the bounce, easing at the end
  }
  return [x, y, z];
}

// Angles (degrees) of a viewer-frame point from straight ahead. Same measure as the glasses' field-of-view mask.
export function viewAngles([x, y, z]) {
  const d = -z;
  return { horizontal: deg(Math.atan2(x, d)), vertical: deg(Math.atan2(y, d)) };
}

// Whether the whole path of a delivery fits inside the glasses' view with `marginDeg` to spare.
export function pathFitsView(lane, curve, marginDeg = 5, steps = 120) {
  for (let i = 0; i <= steps; i++) {
    const a = viewAngles(ballPosition(i / steps, lane, curve));
    if (a.horizontal > FOV.right - marginDeg || a.horizontal < -(FOV.left - marginDeg)) return false;
    if (a.vertical > FOV.up - marginDeg || a.vertical < -(FOV.down - marginDeg)) return false;
  }
  return true;
}

// The real ball is 7 cm across. At 18 m that is a fraction of a degree, too small to follow, so the drawn ball never gets
// smaller than `minAngularDeg` as seen from the viewer. The ring around it is a fixed angle too.
export function drawnRadius(distance, realRadius = 0.036, minAngularDeg = 0.9) {
  const d = Math.max(0.1, Number.isFinite(distance) ? distance : 0.1);
  return Math.max(realRadius, d * Math.tan((minAngularDeg * Math.PI) / 180));
}
export function ringRadius(distance, ringAngularDeg = 3.4) {
  const d = Math.max(0.1, Number.isFinite(distance) ? distance : 0.1);
  return d * Math.tan((ringAngularDeg * Math.PI) / 180);
}

// A shuffled set of deliveries: roughly balanced left / straight / right, each with a small random swing.
// rng: () => number in [0, 1). Injected so tests are deterministic; the app passes a crypto-backed source.
export function makeDeliveries(count, rng) {
  const lanes = [];
  for (let i = 0; i < count; i++) lanes.push([-1, 0, 1][i % 3]);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.map((lane) => ({ lane, curve: (rng() * 2 - 1) * PATH.maxCurveM }));
}

export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

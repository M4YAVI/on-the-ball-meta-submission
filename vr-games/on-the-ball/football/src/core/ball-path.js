// The shot path for FOOTBALL, seen from the GOALKEEPER's eyes, and the rules that keep it comfortable on Meta VR Glasses.
//
// Product direction: the player sits in goal and watches 20 shots come at them from the edge of the penalty area. They never
// save, catch or touch the ball: they only watch it, and the eyes are the input (deck: "Watch the ball. Get the count.").
//
// Coordinates are in the viewer's frame, the same as cricket: x to the right, y up from the eye, z negative straight ahead.
// The scene is placed so that frame follows the seated player's eye position, so a shot looks the same whatever their height.
//
// One shot is real ball flight, not a drawn curve. The striker hits the ball from the ground at the chosen speed in km/h. In
// the air it falls under gravity, slows with air drag, and swerves sideways a little (a bent shot). It arrives about 1.2 m in
// front of the eyes, between knee and head height, where a keeper's hands would meet it, and is gone. It never reaches the face.
// Left / centre / right shots end up to 16 degrees to the side: far enough that a head held straight is NOT on the ball while
// the eyes can be (the case eye tracking exists for), and still inside the glasses' 37 / 37 / 25 / 43 degree view with a margin.

import { clamp } from '../../../src/core/engine.js';
import { FOV, viewAngles, cryptoRng, drawnRadius as drawnRadiusOf, ringRadius } from '../../../src/core/ball-path.js';

export { FOV, viewAngles, cryptoRng, ringRadius };

// Where things stand, in the eye frame (metres). Real distances: the goal line is the keeper's line, the penalty spot is 11 m
// from it, the edge of the penalty area 16.5 m. The seated keeper's eyes are a little in front of the goal line.
export const FIELD = Object.freeze({
  ground: -1.2, // the floor of a seated player, below the eyes
  goalLineZ: 0.6, // just behind the player
  goalDepth: 2.0, // net runs this far behind the goal line
  goalHalfWidth: 3.66, // 7.32 m between the posts
  goalHeight: 2.44,
  sixYardZ: 0.6 - 5.5,
  spotZ: 0.6 - 11,
  boxZ: 0.6 - 16.5, // edge of the penalty area
  strikerZ: -16.55, // where the striker stands when he hits it
});

export const PATH = Object.freeze({
  releaseZ: -16.0, // the ball, on the ground just in front of the striker's foot
  releaseX: -0.12, // a right-footed striker, facing the keeper, has the ball slightly to the keeper's left
  releaseY: FIELD.ground + 0.11, // the ball's centre when it sits on the grass
  endZ: -1.2, // arrival: where a keeper's hands would meet it
  maxLateralDeg: 16, // sideways angle at arrival for the left / right lanes
  maxCurveM: 0.5, // extra swerve in the air (football bends more than a cricket ball)
  maxDipM: 0.28, // a shot that floats up or knuckles down on the way
  // Arrival height above the eyes, in metres, for height -1 (a low drive) ... +1 (a chest-high shot). The low end is where the
  // ball is 25 degrees below the eyes at 1.2 m: the lowest the eyes comfortably go, clear of the heads-up strip.
  lowY: -0.5,
  highY: 0.2,
  arrivalFloorDeg: 25,
});

// Air drag: 0.5 * air density 1.225 * drag coefficient 0.25 * cross-section 0.0380 m^2 / mass 0.43 kg = 0.0135 per metre.
export const PHYS = Object.freeze({
  g: 9.81,
  drag: 0.0135,
  ballRadius: 0.11, // a size-5 football is 22 cm across
});

// Release speeds a keeper really faces (amateur to strong). Scores at different speeds are not comparable, so the speed id is
// stored with each session. "Fast" is the deck's half-second ball.
export const SPEED_OPTIONS = Object.freeze([
  { id: 'gentle', kmh: 50, label: 'Gentle 50 km/h' },
  { id: 'easy', kmh: 70, label: 'Easy 70 km/h' },
  { id: 'medium', kmh: 90, label: 'Medium 90 km/h' },
  { id: 'fast', kmh: 110, label: 'Fast 110 km/h' },
]);
export const DEFAULT_KMH = 70;

const cleanKmh = (kmh) => clamp(Number.isFinite(kmh) ? kmh : DEFAULT_KMH, 30, 130);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// Arrival height above the eyes for a height value in -1 ... +1.
export function arrivalY(height = 0) {
  const h = clamp(num(height), -1, 1);
  return PATH.lowY + ((h + 1) / 2) * (PATH.highY - PATH.lowY);
}

// The whole flight of one shot, solved once. Forward motion with drag: s(t) = ln(1 + k v t) / k, so the time to cover d is
// (e^(k d) - 1) / (k v). Gravity then fixes the upward speed that brings the ball to its arrival height at exactly that time.
export function flight(height = 0, kmh = DEFAULT_KMH) {
  const k = PHYS.drag;
  const v0 = cleanKmh(kmh) / 3.6;
  const d = PATH.endZ - PATH.releaseZ;
  const total = (Math.exp(k * d) - 1) / (k * v0);
  const yEnd = arrivalY(height);
  const vy0 = (yEnd - PATH.releaseY + 0.5 * PHYS.g * total * total) / total;
  const vEnd = v0 * Math.exp(-k * d);
  return { v0, total, yEnd, vy0, vEnd, endZ: PATH.endZ, apex: PATH.releaseY + (vy0 * vy0) / (2 * PHYS.g) };
}

// Flight time of one shot in milliseconds.
export function flightMs(height = 0, kmh = DEFAULT_KMH) {
  return flight(height, kmh).total * 1000;
}

// Position of the ball at t01 (0 = struck, 1 = arrival). lane: -1 left, 0 centre, +1 right. curve: swerve in metres.
// height: -1 low ... +1 high. dip: float / knuckle in metres. kmh: release speed.
export function ballPosition(t01, lane = 0, curve = 0, height = 0, kmh = DEFAULT_KMH, dip = 0) {
  const l = clamp(Number.isFinite(lane) ? Math.round(lane) : 0, -1, 1);
  const c = clamp(num(curve), -PATH.maxCurveM, PATH.maxCurveM);
  const dp = clamp(num(dip), -PATH.maxDipM, PATH.maxDipM);
  const f = flight(height, kmh);
  const u = clamp(num(t01), 0, 1);
  const t = u * f.total;
  const k = PHYS.drag;
  const z = u >= 1 ? PATH.endZ : PATH.releaseZ + Math.log(1 + k * f.v0 * t) / k; // exact arrival, no rounding drift
  let y = PATH.releaseY + f.vy0 * t - 0.5 * PHYS.g * t * t + dp * Math.sin(Math.PI * u);
  y = Math.max(y, FIELD.ground + PHYS.ballRadius); // never through the grass
  if (u >= 1) y = f.yEnd; // the dip is zero here anyway
  // Sideways: a straight line from the foot to the lane's end point, plus a swerve that peaks mid-flight. The end point keeps
  // the full lane angle, so side shots still need the eyes, not a straight head.
  const s = (z - PATH.releaseZ) / (PATH.endZ - PATH.releaseZ);
  const xEnd = Math.tan((PATH.maxLateralDeg * Math.PI) / 180) * -PATH.endZ;
  const x = PATH.releaseX * (1 - s) + l * xEnd * s + c * Math.sin(Math.PI * s);
  return [x, y, z];
}

// Whether the whole path of a shot fits inside the glasses' view with `marginDeg` to spare.
export function pathFitsView(lane, curve, marginDeg = 5, steps = 120, height = 0, kmh = DEFAULT_KMH, dip = 0) {
  for (let i = 0; i <= steps; i++) {
    const a = viewAngles(ballPosition(i / steps, lane, curve, height, kmh, dip));
    if (a.horizontal > FOV.right - marginDeg || a.horizontal < -(FOV.left - marginDeg)) return false;
    if (a.vertical > FOV.up - marginDeg || a.vertical < -(FOV.down - marginDeg)) return false;
  }
  return true;
}

// The drawn ball is never smaller than ~1 degree across, so it can be followed from the edge of the area.
export const drawnRadius = (distance) => drawnRadiusOf(distance, PHYS.ballRadius, 1.0);

// A shuffled set of shots: balanced left / centre / right, each with its own swerve, height and dip.
// rng: () => number in [0, 1). Injected so tests are deterministic; the app passes a crypto-backed source.
export function makeDeliveries(count, rng) {
  const lanes = [];
  for (let i = 0; i < count; i++) lanes.push([-1, 0, 1][i % 3]);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.map((lane) => ({
    lane,
    curve: (rng() * 2 - 1) * PATH.maxCurveM,
    height: rng() * 2 - 1,
    dip: (rng() * 2 - 1) * PATH.maxDipM,
  }));
}

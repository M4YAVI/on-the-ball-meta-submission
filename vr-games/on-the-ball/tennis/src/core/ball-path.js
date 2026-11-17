// The serve path for TENNIS, seen from the RECEIVER's eyes, and the rules that keep it comfortable on Meta VR Glasses.
//
// Product direction (deck slide 6, "Tennis and football. Same ring. You still do not pinch."): the player sits on the baseline as
// the receiver. The server stands on the far baseline, about 23 m away, tosses the ball, strikes it, and it comes to you. It
// bounces ONCE in the service box, rises, and is gone about 1.2 m in front of the eyes. You never hit, catch or touch it: you
// only watch it, and the eyes are the input ("Watch the ball. Get the count.").
//
// Coordinates are in the viewer's frame, the same as cricket and football: x to the right, y up from the eye, z negative
// straight ahead. The scene is placed so that frame follows the seated player's eye position.
//
// One serve is real ball flight, not a drawn curve. Before the bounce the ball falls under gravity and slows with air drag.
// At the bounce it keeps 72% of its downward speed (flipped upward) and 78% of its forward speed (a tennis ball on a hard
// court), then flies on to the arrival point. Nothing is fitted: the arrival height is what the physics gives, and the tests
// check that it is comfortable for every speed, direction and depth.
//
// Directions, from the receiver's deuce-court seat (the receiver faces the server; the server is on his own deuce side):
//   Wide (+1): the ball ends to the receiver's right, 16 degrees off straight ahead, toward the sideline.
//   Body (0) : the ball ends straight at the receiver.
//   T    (-1): the ball ends to the receiver's left, 16 degrees off, toward the centre line (the T).
// Left / right balls end far enough to the side that a head held straight is NOT on the ball while the eyes can be (the case
// eye tracking exists for), and still inside the glasses' 37 / 37 / 25 / 43 degree view with a margin.

import { clamp } from '../../../src/core/engine.js';
import { FOV, viewAngles, cryptoRng, drawnRadius as drawnRadiusOf, ringRadius as ringRadiusOf } from '../../../src/core/ball-path.js';

export { FOV, viewAngles, cryptoRng };

// Where things stand, in the eye frame (metres). Real court: 23.77 m long, singles 8.23 m wide, net 0.914 m at the centre,
// service line 6.40 m from the net. The seated receiver's eyes are just in front of their own baseline.
export const COURT = Object.freeze({
  length: 23.77,
  singlesWidth: 8.23,
  doublesWidth: 10.97,
  serviceDepth: 6.4,
  netHeight: 0.914,
  netPostHeight: 1.07,
  baselineNearZ: 0.3, // the receiver's baseline passes just behind the chair
  centreLineX: -2.0, // the receiver sits in the middle of the deuce half: the centre line (the T) is 2 m to the left
});
export const FIELD = Object.freeze({
  ground: -1.2, // the floor of a seated player, below the eyes
  baselineNearZ: COURT.baselineNearZ,
  baselineFarZ: COURT.baselineNearZ - COURT.length,
  netZ: COURT.baselineNearZ - COURT.length / 2,
  serviceLineZ: COURT.baselineNearZ - COURT.length / 2 + COURT.serviceDepth, // the service line nearest the receiver
  serverZ: COURT.baselineNearZ - COURT.length - 0.03, // the server's toes on the back edge of the far baseline
  serverX: -3.0, // the server's deuce side, a metre from the centre mark
});

export const PATH = Object.freeze({
  releaseX: -3.3, // the contact point: above his hitting side (the receiver's left), a little in front of the server
  releaseY: 1.2, // 2.4 m above the ground: where a server strikes the ball
  releaseZ: -23.05,
  endZ: -1.2, // arrival: where the ball stops, in front of the receiver
  bounceNearZ: -5.5, // the shortest serve bounces just inside the service line
  bounceFarZ: -6.3, // the deepest bounce still clears the net with room to spare at every speed
  maxLateralDeg: 16, // sideways angle at arrival for the Wide and T lanes
  maxCurveM: 0.18, // a little slice or kick on the way
  arrivalFloorDeg: 25,
});

// Which half of the court the receiver sits in for one try of 20 serves. DEUCE (+1) is the original view: the server on the
// receiver's left, serving into the receiver's right-hand box. AD (-1) is the mirror: the server on the receiver's right, and the
// receiver in the other half of the court. A try never changes side half way; the next try uses the other one.
export const SIDE = Object.freeze({ DEUCE: 1, AD: -1 });
export const cleanSide = (side) => (Number.isFinite(side) && side < 0 ? SIDE.AD : SIDE.DEUCE);
export const otherSide = (side) => -cleanSide(side);
export const sideName = (side) => (cleanSide(side) === SIDE.AD ? 'ad' : 'deuce');
// Where the server stands, and where he strikes the ball, for a side. The strike is always on his hitting (right-hand) side,
// so it keeps the same offset from his body on both sides.
export const serverXFor = (side) => cleanSide(side) * FIELD.serverX;
export const releaseXFor = (side) => serverXFor(side) + (PATH.releaseX - FIELD.serverX);
// How far the whole court slides sideways under the seated receiver, so that he sits in the middle of the right half.
export const courtShiftX = (side) => (cleanSide(side) - 1) * COURT.centreLineX + 0; // + 0 turns -0 into 0
// The centre line (the T) and the singles sideline on the receiver's far side, in the eye frame, for a side.
export const centreLineXFor = (side) => COURT.centreLineX + courtShiftX(side);

// Air drag: 0.5 * air density 1.225 * drag coefficient 0.55 * cross-section 0.00353 m^2 / mass 0.057 kg = 0.0209 per metre.
export const PHYS = Object.freeze({
  g: 9.81,
  drag: 0.0209,
  ballRadius: 0.0335, // a tennis ball is 6.7 cm across
  restitution: 0.72, // share of the downward speed that comes back up after the bounce
  keepPace: 0.78, // share of the forward speed kept after the bounce
});

// Serve speeds. Scores at different speeds are not comparable, so the speed id is stored with each session. "Fast" is the
// deck's half-second ball (about 0.6 s here, from the strike to the arrival).
export const SPEED_OPTIONS = Object.freeze([
  { id: 'slow', kmh: 100, label: 'Slow 100 km/h' },
  { id: 'medium', kmh: 130, label: 'Medium 130 km/h' },
  { id: 'fast', kmh: 170, label: 'Fast 170 km/h' },
]);
export const DEFAULT_KMH = 130;

export const DIRECTIONS = Object.freeze([
  { id: 'wide', lane: 1, label: 'Wide' },
  { id: 'body', lane: 0, label: 'Body' },
  { id: 't', lane: -1, label: 'T' },
]);

const cleanKmh = (kmh) => clamp(Number.isFinite(kmh) ? kmh : DEFAULT_KMH, 60, 200);
const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
const cleanLane = (lane) => clamp(Number.isFinite(lane) ? Math.round(lane) : 0, -1, 1);

// Where the ball bounces for a depth value in -1 (short) ... +1 (deep).
export function bounceZ(depth = 0) {
  const u = (clamp(num(depth), -1, 1) + 1) / 2;
  return PATH.bounceNearZ + u * (PATH.bounceFarZ - PATH.bounceNearZ);
}

// The whole flight of one serve, solved once. Forward motion with drag: s(t) = ln(1 + k v t) / k, so the time to cover d is
// (e^(k d) - 1) / (k v). Gravity then fixes the vertical speed that brings the ball down onto the court at the bounce point.
// After the bounce the same two rules apply with the speeds the bounce leaves.
export function flight(depth = 0, kmh = DEFAULT_KMH) {
  const k = PHYS.drag;
  const v0 = cleanKmh(kmh) / 3.6;
  const zb = bounceZ(depth);
  const yb = FIELD.ground + PHYS.ballRadius; // the ball's centre when it touches the court
  const d1 = zb - PATH.releaseZ;
  const t1 = (Math.exp(k * d1) - 1) / (k * v0);
  const vy0 = (yb - PATH.releaseY + 0.5 * PHYS.g * t1 * t1) / t1; // launch: slightly down for a fast serve
  const vyB = vy0 - PHYS.g * t1; // downward speed just before the bounce (negative)
  const hB = v0 * Math.exp(-k * d1); // forward speed just before the bounce
  const h2 = hB * PHYS.keepPace;
  const vy2 = -vyB * PHYS.restitution; // upward speed just after the bounce
  const d2 = PATH.endZ - zb;
  const t2 = (Math.exp(k * d2) - 1) / (k * h2);
  const yEnd = yb + vy2 * t2 - 0.5 * PHYS.g * t2 * t2;
  return { v0, zb, yb, t1, t2, total: t1 + t2, vy0, vyB, vy2, hB, h2, yEnd, vEnd: h2 * Math.exp(-k * d2), endZ: PATH.endZ };
}

// Flight time of one serve in milliseconds.
export function flightMs(depth = 0, kmh = DEFAULT_KMH) {
  return flight(depth, kmh).total * 1000;
}

// Fraction of the flight (0..1) at which the ball touches the court.
export function bounceT(depth = 0, kmh = DEFAULT_KMH) {
  const f = flight(depth, kmh);
  return f.t1 / f.total;
}

// Position of the ball at t01 (0 = struck, 1 = arrival). lane: -1 T, 0 Body, +1 Wide. curve: slice in metres.
// depth: -1 short ... +1 deep. kmh: strike speed. side: SIDE.DEUCE (default) or SIDE.AD.
export function ballPosition(t01, lane = 0, curve = 0, depth = 0, kmh = DEFAULT_KMH, side = SIDE.DEUCE) {
  const sd = cleanSide(side);
  const l = cleanLane(lane) * sd; // Wide ends to the receiver's right on the deuce side and to his left on the ad side
  const c = clamp(num(curve), -PATH.maxCurveM, PATH.maxCurveM) * sd;
  const f = flight(depth, kmh);
  const u = clamp(num(t01), 0, 1);
  const t = u * f.total;
  const k = PHYS.drag;
  let z;
  let y;
  if (u >= 1) {
    z = PATH.endZ; // exact arrival, no rounding drift
    y = f.yEnd;
  } else if (t <= f.t1) {
    z = PATH.releaseZ + Math.log(1 + k * f.v0 * t) / k;
    y = PATH.releaseY + f.vy0 * t - 0.5 * PHYS.g * t * t;
  } else {
    const s = t - f.t1; // seconds since the bounce
    z = f.zb + Math.log(1 + k * f.h2 * s) / k;
    y = f.yb + f.vy2 * s - 0.5 * PHYS.g * s * s;
  }
  y = Math.max(y, FIELD.ground + PHYS.ballRadius); // never through the court
  // Sideways: a straight line (seen from above) from the server's contact point to the lane's end point, plus a little slice
  // that peaks mid-flight. The end point keeps the full lane angle, so Wide and T balls still need the eyes, not a straight head.
  const s = (z - PATH.releaseZ) / (PATH.endZ - PATH.releaseZ);
  const xEnd = Math.tan((PATH.maxLateralDeg * Math.PI) / 180) * -PATH.endZ;
  const x = releaseXFor(sd) * (1 - s) + l * xEnd * s + c * Math.sin(Math.PI * s);
  return [x, y, z];
}

// Whether the whole path of a serve fits inside the glasses' view with `marginDeg` to spare.
export function pathFitsView(lane, curve, marginDeg = 5, steps = 120, depth = 0, kmh = DEFAULT_KMH, side = SIDE.DEUCE) {
  for (let i = 0; i <= steps; i++) {
    const a = viewAngles(ballPosition(i / steps, lane, curve, depth, kmh, side));
    if (a.horizontal > FOV.right - marginDeg || a.horizontal < -(FOV.left - marginDeg)) return false;
    if (a.vertical > FOV.up - marginDeg || a.vertical < -(FOV.down - marginDeg)) return false;
  }
  return true;
}

// The drawn ball is its real size (6.7 cm across) from about 7.7 m in, which includes the bounce and the whole last half of the
// flight. Farther out a real ball would be a speck (0.17 degrees across at the far baseline), so it is drawn no smaller than
// half a degree across (a radius of 0.25 degrees): about 3 times real size at the server, and shrinking to real as it comes.
// Scoring does not use the drawn size: it measures the angle to the ball's centre.
export const MIN_BALL_DEG = 0.25;
export const drawnRadius = (distance) => drawnRadiusOf(distance, PHYS.ballRadius, MIN_BALL_DEG);

// The ring that marks the live ball is a fixed angle around it (deck slide 5): 1.5 degrees, less than half the cricket ring, so
// it marks the ball without hiding the court. Feedback only.
export const RING_DEG = 1.5;
// Close in, a real ball is wider than 1.5 degrees (3.2 degrees across at 1.2 m), so the ring never shrinks below 1.6 times the ball.
export const ringRadius = (distance) => Math.max(ringRadiusOf(distance, RING_DEG), 1.6 * drawnRadius(distance));

// The toss. tRel: seconds relative to the strike (negative before). The ball leaves the server's raised free hand at TOSS.start,
// rises, drifts across to the hitting side, and is struck on its way down at 0. Pure gravity: no drag worth modelling over a 3 m rise.
const TOSS_APEX_T = -0.3; // the ball peaks 0.3 s before it is struck
const TOSS_APEX_Y = PATH.releaseY + 0.5 * PHYS.g * TOSS_APEX_T * TOSS_APEX_T;
const TOSS_HAND = Object.freeze([-2.6, 0.6, -23.4]); // the raised free hand (the receiver's right of the server's body), 1.8 m up
export const TOSS = Object.freeze({
  apexT: TOSS_APEX_T,
  hand: TOSS_HAND,
  handY: TOSS_HAND[1],
  start: TOSS_APEX_T - Math.sqrt((2 * (TOSS_APEX_Y - TOSS_HAND[1])) / PHYS.g), // when the ball leaves the hand (about -0.76 s)
});
export function tossPosition(tRel, side = SIDE.DEUCE) {
  const sd = cleanSide(side);
  const handX = serverXFor(sd) + (TOSS_HAND[0] - FIELD.serverX);
  const strikeX = releaseXFor(sd);
  const t = clamp(num(tRel), TOSS.start, 0);
  const u = (t - TOSS.start) / -TOSS.start; // 0 at the hand, 1 at the strike
  const y = TOSS_APEX_Y - 0.5 * PHYS.g * (t - TOSS_APEX_T) * (t - TOSS_APEX_T);
  if (u >= 1) return [strikeX, PATH.releaseY, PATH.releaseZ];
  return [handX + (strikeX - handX) * u, y, TOSS_HAND[2] + (PATH.releaseZ - TOSS_HAND[2]) * u];
}

// A shuffled set of serves: exactly balanced Wide / Body / T, each with its own slice and bounce depth.
// rng: () => number in [0, 1). Injected so tests are deterministic; the app passes a crypto-backed source.
export function makeDeliveries(count, rng) {
  const lanes = [];
  for (let i = 0; i < count; i++) lanes.push([1, 0, -1][i % 3]);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.map((lane) => ({
    lane,
    curve: (rng() * 2 - 1) * PATH.maxCurveM,
    depth: rng() * 2 - 1,
  }));
}

// The delivery path, seen from the BATSMAN's eyes, and the rules that keep it comfortable on Meta VR Glasses.
//
// Product direction (Nov 16): the player takes guard as the batsman. They stand (sit) at the batting crease with their own
// stumps BEHIND them, face the bowler 20 m away, and only watch the ball come to them. They never catch or hit it.
// (The handoff baseline and an earlier build put the stumps in front of the chair, which is the wicketkeeper's view.)
//
// Coordinates are in the viewer's frame: x to the right, y up from the eye, z negative straight ahead. The scene is placed
// so that frame follows the seated player's eye position, so a delivery looks the same whatever their height.
//
// One delivery is real ball flight, not a drawn curve. The bowler releases the ball from about 2.15 m (right arm, a little to
// the batsman's left) at the chosen speed in km/h. In the air it falls under gravity and slows with air drag. It pitches on
// a length, loses height and pace on the bounce (a cricket ball keeps about half its downward speed and most of its forward
// speed), then rises to the batsman and is gone about 1.2 m in front of the eyes, below waist height, where a bat would meet
// it, or a little earlier if it would otherwise drop more than 25 degrees below eye level (see PATH.arrivalFloorDeg).
// It never reaches the face. Left / straight / right lanes end up to 16 degrees to the side: far enough that a head held
// straight is NOT on the ball while the eyes can be (the case eye tracking exists for), and still inside the glasses' 37 / 37
// / 25 / 43 degree view with a margin.

import { clamp } from './engine.js';

export const FOV = Object.freeze({ left: 37, right: 37, up: 25, down: 43 }); // Meta VR Glasses, degrees

export const PATH = Object.freeze({
  releaseZ: -18.2, // the bowler's hand, just in front of the far popping crease (22 yards between the stumps)
  releaseX: -0.22, // a right-arm bowler's hand, over the wicket, is slightly to the batsman's left
  releaseY: 0.95, // about 2.15 m above the ground
  endZ: -1.2, // arrival: where the bat would meet the ball, in front of the batting crease
  bounceZ: -5.0, // a good length pitches about 6 m in front of the batsman's stumps
  lengthSpreadM: 1.5, // full balls pitch up to this much closer, short balls this much further away
  maxLateralDeg: 16, // sideways angle at arrival for the left / right lanes
  maxCurveM: 0.22, // extra swing in the air
  // Lowest the ball is ever drawn, in degrees below straight ahead. A full ball at pace skids through at knee height and
  // would reach 37 deg down at the bat: past where eyes comfortably rotate (~25 deg), where eye trackers are least accurate,
  // through the heads-up strip (its top edge is ~27 deg down) and only 6 deg inside the glasses' 43 deg lower edge. So a
  // delivery "arrives" at the bat or at this angle, whichever comes first. The physics up to that point is unchanged.
  arrivalFloorDeg: 25,
});

// Ball flight. Drag: 0.5 * air density 1.225 * drag coefficient 0.45 * cross-section 0.00407 m^2 / mass 0.156 kg.
// Bounce: a cricket ball dropped on a hard surface keeps about 0.5 to 0.58 of its downward speed (coefficient of restitution),
// and a ball pitching at speed loses some forward pace to friction with the pitch.
export const PHYS = Object.freeze({
  g: 9.81, // m/s^2
  drag: 0.0072, // per metre: speed falls by exp(-drag * distance)
  restitution: 0.52, // share of the downward speed that comes back up after pitching
  keepPace: 0.88, // share of the forward speed kept after pitching
  ballRadius: 0.036, // m
});

// Where things stand on the field, in the same eye frame (metres). Real cricket distances: 20.12 m between the two sets of
// stumps, popping crease 1.22 m in front of each set. The batsman's eyes are just behind their popping crease, so their own
// stumps are BEHIND them (positive z) and out of view; the bowler's stumps are at the far end.
export const FIELD = Object.freeze({
  ground: -1.2, // the floor of a seated player, below the eyes
  battingCreaseZ: -0.35, // the popping crease line, just in front of the batsman's feet
  batsmanStumpsZ: 0.87, // behind the batsman
  bowlerStumpsZ: -19.25, // the far end
  bowlerZ: -18.7, // where the bowler model stands at release
});

// Release speeds a batsman really faces. Scores at different speeds are not comparable, so the speed id is stored with each
// session. "Fast" is the deck's half-second ball. Spin is the default: quick enough to feel real, slow enough that one blink
// does not push most balls under the 75% tracking minimum.
export const SPEED_OPTIONS = Object.freeze([
  { id: 'gentle', kmh: 60, label: 'Gentle 60 km/h' },
  { id: 'spin', kmh: 85, label: 'Spin 85 km/h' },
  { id: 'medium', kmh: 115, label: 'Medium 115 km/h' },
  { id: 'fast', kmh: 140, label: 'Fast 140 km/h' },
]);
export const DEFAULT_KMH = 85;

const deg = (r) => (r * 180) / Math.PI;
const cleanKmh = (kmh) => clamp(Number.isFinite(kmh) ? kmh : DEFAULT_KMH, 40, 160);
const cleanLength = (length) => clamp(Number.isFinite(length) ? length : 0, -1, 1);

// Where the ball pitches. length: -1 short ... 0 good ... +1 full.
export function bounceZ(length = 0) {
  return PATH.bounceZ + cleanLength(length) * PATH.lengthSpreadM;
}

// The whole flight of one delivery, solved once: how long each part takes and the speeds it needs.
export function flight(length = 0, kmh = DEFAULT_KMH) {
  const k = PHYS.drag;
  const v0 = cleanKmh(kmh) / 3.6;
  const zb = bounceZ(length);
  const d1 = zb - PATH.releaseZ; // release to the pitching point
  const d2 = PATH.endZ - zb; // pitching point to the bat
  const yb = FIELD.ground + PHYS.ballRadius; // ball centre when it touches the pitch
  // Forward motion with drag: distance s(t) = ln(1 + k v t) / k, so the time to cover d is (e^(k d) - 1) / (k v).
  const t1 = (Math.exp(k * d1) - 1) / (k * v0);
  // Pick the release angle that lands the ball on its length: y(t1) = yb under gravity.
  const vy0 = (yb - PATH.releaseY + 0.5 * PHYS.g * t1 * t1) / t1;
  const vyImpact = vy0 - PHYS.g * t1;
  const vy1 = -PHYS.restitution * vyImpact;
  const vb = v0 * Math.exp(-k * d1); // forward speed when it pitches
  const v1 = PHYS.keepPace * vb;
  const tBat = (Math.exp(k * d2) - 1) / (k * v1);
  // After the bounce: stop at the bat, or earlier where the ball first drops below the arrival floor.
  const zAt = (u) => zb + Math.log(1 + k * v1 * u) / k;
  const yAt = (u) => yb + vy1 * u - 0.5 * PHYS.g * u * u;
  const floor = Math.tan((PATH.arrivalFloorDeg * Math.PI) / 180);
  const below = (u) => yAt(u) < -floor * -zAt(u);
  let t2 = tBat;
  const STEPS = 64;
  for (let i = 1; i <= STEPS; i++) {
    const u = (tBat * i) / STEPS;
    if (!below(u)) continue;
    let lo = (tBat * (i - 1)) / STEPS;
    let hi = u;
    for (let j = 0; j < 40; j++) {
      const mid = (lo + hi) / 2;
      if (below(mid)) hi = mid;
      else lo = mid;
    }
    t2 = lo;
    break;
  }
  const endZ = t2 === tBat ? PATH.endZ : zAt(t2);
  const vEnd = v1 * Math.exp(-k * (endZ - zb));
  return { v0, zb, yb, t1, t2, total: t1 + t2, vy0, vy1, v1, vb, vEnd, endZ };
}

// Flight time of one delivery in milliseconds.
export function flightMs(length = 0, kmh = DEFAULT_KMH) {
  return flight(length, kmh).total * 1000;
}

// Share of the flight at which the ball pitches.
export function bounceT(length = 0, kmh = DEFAULT_KMH) {
  const f = flight(length, kmh);
  return f.t1 / f.total;
}

// Position of the ball at t01 (0 = release, 1 = arrival). lane: -1 left, 0 straight, +1 right. curve: swing in metres.
// length: -1 short, 0 good, +1 full. kmh: release speed.
export function ballPosition(t01, lane = 0, curve = 0, length = 0, kmh = DEFAULT_KMH) {
  const l = clamp(Number.isFinite(lane) ? Math.round(lane) : 0, -1, 1);
  const c = clamp(Number.isFinite(curve) ? curve : 0, -PATH.maxCurveM, PATH.maxCurveM);
  const f = flight(length, kmh);
  const k = PHYS.drag;
  const t = clamp(Number.isFinite(t01) ? t01 : 0, 0, 1) * f.total;
  let z;
  let y;
  if (t <= f.t1) {
    z = PATH.releaseZ + Math.log(1 + k * f.v0 * t) / k;
    y = PATH.releaseY + f.vy0 * t - 0.5 * PHYS.g * t * t;
  } else {
    const u = Math.min(t, f.total) - f.t1;
    z = f.zb + Math.log(1 + k * f.v1 * u) / k;
    y = f.yb + f.vy1 * u - 0.5 * PHYS.g * u * u;
  }
  if (t >= f.total) z = f.endZ; // exact arrival, no rounding drift
  // Sideways: a straight line from the hand to the lane's end point, plus a swing that peaks mid-flight. The end point keeps
  // the full lane angle even when the ball arrives early at the floor, so side balls still need the eyes, not a straight head.
  const s = (z - PATH.releaseZ) / (f.endZ - PATH.releaseZ);
  const xEnd = Math.tan((PATH.maxLateralDeg * Math.PI) / 180) * -f.endZ;
  const x = PATH.releaseX * (1 - s) + l * xEnd * s + c * Math.sin(Math.PI * s);
  return [x, y, z];
}

// Angles (degrees) of a viewer-frame point from straight ahead. Same measure as the glasses' field-of-view mask.
export function viewAngles([x, y, z]) {
  const d = -z;
  return { horizontal: deg(Math.atan2(x, d)), vertical: deg(Math.atan2(y, d)) };
}

// Whether the whole path of a delivery fits inside the glasses' view with `marginDeg` to spare.
export function pathFitsView(lane, curve, marginDeg = 5, steps = 120, length = 0, kmh = DEFAULT_KMH) {
  for (let i = 0; i <= steps; i++) {
    const a = viewAngles(ballPosition(i / steps, lane, curve, length, kmh));
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

// A shuffled set of deliveries: roughly balanced left / straight / right, each with a small random swing and length.
// rng: () => number in [0, 1). Injected so tests are deterministic; the app passes a crypto-backed source.
export function makeDeliveries(count, rng) {
  const lanes = [];
  for (let i = 0; i < count; i++) lanes.push([-1, 0, 1][i % 3]);
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.map((lane) => ({ lane, curve: (rng() * 2 - 1) * PATH.maxCurveM, length: rng() * 2 - 1 }));
}

export function cryptoRng() {
  const buf = new Uint32Array(1);
  return () => {
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

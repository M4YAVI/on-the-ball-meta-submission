// The delivery path, seen from the BATSMAN's eyes, and the rules that keep it comfortable on Meta VR Glasses.
//
// Product direction (Nov 16): the player takes guard as the batsman. They stand (sit) at the batting crease with their own
// stumps BEHIND them, face the bowler 20 m away, and only watch the ball come to them. They never catch or hit it.
// (The handoff baseline and an earlier build put the stumps in front of the chair, which is the wicketkeeper's view.)
//
// Coordinates are in the viewer's frame: x to the right, y up from the eye, z negative straight ahead. The scene is placed
// so that frame follows the seated player's eye position, so a delivery looks the same whatever their height.
//
// One delivery is real ball flight, not a drawn curve. The bowler releases the ball from about 2.0 m (right arm, a little to
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
  releaseZ: -18.28, // the bowler's hand, just in front of the far popping crease (22 yards between the stumps)
  releaseX: -0.24, // a right-arm bowler's hand, over the wicket, is slightly to the batsman's left
  releaseY: 0.78, // about 2.0 m above the ground: the hand's reach at release, so the ball leaves it, not the air above it
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

// The bowler's run-up, in the same eye frame (metres and seconds relative to release). A real fast bowler runs in from a
// mark 10-15 strides back, builds to about 5 m/s by back-foot contact, then brakes hard on a braced front leg over the last
// 0.26 s before release (README of the research: run-up speeds 4.8-6.8 m/s, front foot contact to release ~0.13 s). The
// gait here is a medium-pace action: a straight, gradually accelerating run, a short bound, a braced front leg, then a
// follow-through past the stumps. `leadIn` is the whole sequence from standing on his mark to the ball leaving the hand, so
// the game waits exactly that long before the ball exists (LEAD_IN in game.js reads it); it equals -startLead.
//
// The run is split into four timed segments, each with its own speed, so the body arrives at the crease moving rather than
// sliding: accelerate (0 -> speed), cruise, bound (slight slow-down into the jump), and brake (front foot down -> release).
// Distances are integrated exactly, so the mark sits `markM` behind the bowler's release spot and the timing stays true
// whatever the geometry says.
const RUN_T = Object.freeze({
  accel: 0.9, // s from the mark to cruise speed
  cruise: 1.15, // s at full pace
  bound: 0.36, // s from take-off to front-foot contact (the delivery stride)
  brake: 0.26, // s from front-foot contact to release
  speed: 5.4, // m/s at the end of the run-in
  braceSpeed: 4.9, // m/s when the front foot lands
  releaseSpeed: 2.2, // m/s of the body at release, after the front leg has braked
  windUp: 0.7, // s from release to the end of the follow-through
  stride: 2.35, // metres of ground per full stride (a left and a right step)
});
const RUN_LEAD = RUN_T.accel + RUN_T.cruise + RUN_T.bound + RUN_T.brake; // 2.67 s
const RUN_MARK =
  (RUN_T.speed * RUN_T.accel) / 2 + // smoothstep acceleration: average speed is half the cruise
  RUN_T.speed * RUN_T.cruise +
  ((RUN_T.speed + RUN_T.braceSpeed) / 2) * RUN_T.bound +
  ((RUN_T.braceSpeed + RUN_T.releaseSpeed) / 2) * RUN_T.brake; // 11.4 m

export const RUN_UP = Object.freeze({
  startX: -0.55, // a right-arm over-the-wicket line, wide of the stumps
  startZ: FIELD.bowlerZ - RUN_MARK, // the mark, out beyond the far stumps
  markM: RUN_MARK,
  startLead: -RUN_LEAD, // s before release: he is standing on his mark
  boundLead: -(RUN_T.bound + RUN_T.brake), // s before release: take-off into the delivery stride
  braceLead: -RUN_T.brake, // s before release: front foot contact, the leg braces
  leadIn: RUN_LEAD, // s from the start of the run to release
  strideM: RUN_T.stride,
  windUp: RUN_T.windUp, // s from release to the end of the follow-through
  accelT: RUN_T.accel,
  cruiseT: RUN_T.cruise,
  boundT: RUN_T.bound,
  brakeT: RUN_T.brake,
  speed: RUN_T.speed,
  braceSpeed: RUN_T.braceSpeed,
  releaseSpeed: RUN_T.releaseSpeed,
  followM: (RUN_T.releaseSpeed * RUN_T.windUp) / 2, // metres carried past the crease
});

// Ground covered from the mark at tRel (seconds relative to release). Exact integrals of the speed profile above, so the
// body's speed is continuous and the feet never skate: 0 on the mark, RUN_UP.markM at release, +followM at the end.
export function runDistance(tRel) {
  const t = Number.isFinite(tRel) ? tRel : RUN_UP.startLead;
  const lead = -RUN_UP.startLead;
  const a = RUN_UP.accelT;
  const b = RUN_UP.boundT;
  const r = RUN_UP.brakeT;
  const v = RUN_UP.speed;
  const vb = RUN_UP.braceSpeed;
  const vr = RUN_UP.releaseSpeed;
  const dAccel = (v * a) / 2;
  const dCruise = v * RUN_UP.cruiseT;
  const dBound = ((v + vb) / 2) * b;
  const dBrake = ((vb + vr) / 2) * r;
  if (t <= -lead) return 0;
  if (t < -lead + a) {
    const k = (t + lead) / a;
    return v * a * (k * k * k - 0.5 * k * k * k * k); // integral of smoothstep
  }
  if (t <= RUN_UP.boundLead) return dAccel + v * (t + lead - a);
  if (t <= RUN_UP.braceLead) {
    const s = t - RUN_UP.boundLead;
    return dAccel + dCruise + v * s - (0.5 * (v - vb) * s * s) / b;
  }
  if (t <= 0) {
    const s = t - RUN_UP.braceLead;
    return dAccel + dCruise + dBound + vb * s - (0.5 * (vb - vr) * s * s) / r;
  }
  const s = Math.min(t, RUN_UP.windUp);
  return RUN_UP.markM + vr * s - (0.5 * vr * s * s) / RUN_UP.windUp;
}

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
export function ringRadius(distance, ringAngularDeg = 2.7) {
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

// After the ball reaches its arrival point it does not vanish: it carries on past the player, lands behind them, bounces, rolls
// and comes to rest, and stays there until the next shot. posAt(u) is the game's own ballPosition for this delivery.
// The ball keeps its arrival velocity and is steered so it passes at least `passClearM` to the side of the head (never through
// the face). Scoring is finished at arrival and does not read any of this.
const ROLL = Object.freeze({ g: 9.81, wallZ: 2.6, wallX: 3.4, groundY: -1.2, restitution: 0.42, rollFriction: 1.6, radius: 0.05 });

// clearIn3d (cricket batting): steer only when the ball would really pass within passClearM of the eyes, counting its height
// too. A ball arriving below the waist then carries straight on through the batting zone, where the bat can meet it, instead
// of sliding sideways past the bat. The other sports keep the original sideways clearance.
export function startRoll(posAt, durMs, passClearM = 0.5, clearIn3d = false) {
  const eps = 0.02;
  const p1 = posAt(1);
  const p0 = posAt(1 - eps);
  const T = (eps * durMs) / 1000;
  let vx = (p1[0] - p0[0]) / T;
  const vy = (p1[1] - p0[1]) / T;
  const vz = Math.max((p1[2] - p0[2]) / T, 4);
  const tz = Math.max(1e-3, -p1[2] / vz);
  const xPass = p1[0] + vx * tz;
  const yPass = p1[1] + vy * tz - 0.5 * ROLL.g * tz * tz;
  const near = clearIn3d ? Math.hypot(xPass, yPass) < passClearM : Math.abs(xPass) < passClearM;
  if (near) {
    const side = xPass !== 0 ? Math.sign(xPass) : p1[0] !== 0 ? Math.sign(p1[0]) : 1;
    vx = (side * passClearM - p1[0]) / tz;
  }
  return { p: [p1[0], p1[1], p1[2]], v: [vx, vy, vz], rest: false };
}

// Advance the ball by dt seconds (sub-stepped). Returns the state; state.rest is true once it has stopped.
export function stepRoll(st, dt) {
  if (st.rest) return st;
  const n = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    st.v[1] -= ROLL.g * h;
    st.p[0] += st.v[0] * h;
    st.p[1] += st.v[1] * h;
    st.p[2] += st.v[2] * h;
    if (st.p[2] > ROLL.wallZ) { // the net / back wall: the ball drops
      st.p[2] = ROLL.wallZ;
      st.v[2] = 0; // dead in the net
      st.v[0] *= 0.3;
    }
    if (Math.abs(st.p[0]) > ROLL.wallX) { // side netting / boards
      st.p[0] = Math.sign(st.p[0]) * ROLL.wallX;
      st.v[0] = 0;
    }
    const floor = ROLL.groundY + ROLL.radius;
    if (st.p[1] <= floor) {
      st.p[1] = floor;
      st.v[1] = Math.abs(st.v[1]) > 0.8 ? -st.v[1] * ROLL.restitution : 0;
      const f = Math.exp(-ROLL.rollFriction * h);
      st.v[0] *= f;
      st.v[2] *= f;
      if (st.v[1] === 0 && Math.hypot(st.v[0], st.v[2]) < 0.05) {
        st.v[0] = st.v[1] = st.v[2] = 0;
        st.rest = true;
        break;
      }
    }
  }
  return st;
}

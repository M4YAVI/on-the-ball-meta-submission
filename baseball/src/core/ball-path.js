// The pitch path for BASEBALL, seen from the CATCHER's eyes, and the rules that keep it comfortable on Meta VR Glasses.
//
// Product direction: the batsman's view belongs to cricket alone. In baseball the player is the catcher, crouched (here: seated)
// behind home plate, with the pitcher on the mound 18.44 m beyond the plate. The pitcher winds up and throws, and the ball comes
// to you and is gone about 1.2 m in front of your eyes, as it crosses the front of the plate. You never catch, hit or touch it:
// you only watch it, and the eyes are the input ("Watch the ball. Get the count."). Same watch-only rules as cricket, football
// and tennis.
//
// Coordinates are in the viewer's frame, the same as the other sports: x to the right, y up from the eye, z negative straight
// ahead. The scene is placed so that frame follows the seated player's eye position, so a pitch looks the same whatever their
// height.
//
// One pitch is real ball flight, not a drawn curve, in the way baseball-xr flies it: from the pitcher's hand to the aim point at
// the plate, under gravity and the acceleration that the pitch's spin adds, solved so the ball arrives exactly where it was aimed.
// The movement is the real number of inches of each pitch (Statcast averages, see pitches.js), whatever the speed.
//
// Lanes, from the catcher's seat (the pitcher is a right-hander, so his arm side is the catcher's left):
//   Left  (-1): the ball ends to the player's left, 16 degrees off straight ahead (inside to a right-handed hitter).
//   Middle (0): the ball ends straight at the player.
//   Right (+1): the ball ends to the player's right, 16 degrees off (away from a right-handed hitter).
// Left / right balls end far enough to the side that a head held straight is NOT on the ball while the eyes can be (the case eye
// tracking exists for), and still inside the glasses' 37 / 37 / 25 / 43 degree view with a margin.

import { clamp } from '../../../src/core/engine.js';
import { FOV, viewAngles, cryptoRng, drawnRadius as drawnRadiusOf, ringRadius } from '../../../src/core/ball-path.js';
import { PITCHES, LEVELS, DEFAULT_LEVEL, levelById, levelLabel, pitchSpeed, breakAccel, flutterAt, flutterParams, choosePitch, MPH } from './pitches.js';

export { FOV, viewAngles, cryptoRng, ringRadius, PITCHES, LEVELS, MPH };

// The park, in metres (real dimensions): the catcher is at the origin facing -z. Home plate's point is 0.8 m in front of the
// eyes, the rubber 18.44 m beyond it (60 ft 6 in), 10 in above the plate. These four are shared with the ballpark and the pitcher.
export const PLATE_Z = -0.8;
export const MOUND_Z = PLATE_Z - 18.44;
export const MOUND_HEIGHT = 0.254;
export const PITCHER_HEIGHT = 1.85;

// Where things stand in the eye frame.
export const FIELD = Object.freeze({
  ground: -1.2, // the floor of a seated player, below the eyes
  plateZ: PLATE_Z, // the plate's point, nearest the catcher
  plateFrontZ: PLATE_Z - 0.432, // the plate is 17 in deep: its front edge, where the pitch is judged
  moundZ: MOUND_Z,
  moundTopY: -1.2 + MOUND_HEIGHT,
  plateHalfWidth: 0.216, // the plate is 17 in wide
});

export const PATH = Object.freeze({
  // Where the ball leaves the pitcher's fingers: over his right shoulder, a little in front of the rubber (measured from his
  // delivery pose, see xr/pitcher.js). The game uses the real hand position at the release frame; this one is for the tests.
  release: Object.freeze([-0.28, 0.57, -17.85]),
  endZ: -1.2, // arrival: as it crosses the front of the plate, 1.2 m in front of the eyes
  zoneY: -0.34, // the strike zone's centre: 0.86 m above a seated player's floor (knees to chest is 0.5 to 1.1 m)
  rowStepM: 0.13, // Low / Level / High rows are this far apart
  jitterM: 0.03, // each pitch is off its spot by up to this much (command)
  maxLateralDeg: 16, // sideways angle at arrival for the Left and Right lanes
  arrivalFloorDeg: 25, // never lower than this below straight ahead (comfortable eye angle, clear of the heads-up strip)
});

export const PHYS = Object.freeze({ g: 9.81, ballRadius: 0.037 }); // a baseball is 7.4 cm across

export const SPEED_OPTIONS = Object.freeze(LEVELS.map((l) => ({ id: l.id, label: levelLabel(l), level: l })));
export const DEFAULT_SPEED_ID = DEFAULT_LEVEL;

export const DIRECTIONS = Object.freeze([
  { id: 'left', lane: -1, label: 'Left' },
  { id: 'middle', lane: 0, label: 'Middle' },
  { id: 'right', lane: 1, label: 'Right' },
]);

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// A delivery as the flow hands it over (or the warm-up, which has only a lane). Anything malformed becomes a plain, comfortable
// pitch: a bad number can never move the ball somewhere uncomfortable.
export function cleanDelivery(d) {
  const lane = clamp(Math.round(num(d?.lane)), -1, 1);
  const row = clamp(Math.round(num(d?.row)), -1, 1);
  const pi = Number.isInteger(d?.pitch) && d.pitch >= 0 && d.pitch < PITCHES.length ? d.pitch : 0;
  const f = d?.flutter;
  const flutter =
    f && ['ax', 'ay', 'wx', 'wy', 'px', 'py'].every((k) => Number.isFinite(f[k])) && PITCHES[pi].flutter
      ? { ax: clamp(f.ax, -0.2, 0.2), ay: clamp(f.ay, -0.2, 0.2), wx: clamp(f.wx, 0, 20), wy: clamp(f.wy, 0, 20), px: f.px, py: f.py }
      : null;
  return {
    lane,
    row,
    pitch: pi,
    dx: clamp(num(d?.dx), -PATH.jitterM, PATH.jitterM),
    dy: clamp(num(d?.dy), -PATH.jitterM, PATH.jitterM),
    dv: clamp(num(d?.dv), -1, 1),
    flutter,
  };
}

// Where the pitch crosses the front of the plate, in the eye frame.
export function aimPoint(delivery) {
  const d = cleanDelivery(delivery);
  const xEnd = Math.tan((PATH.maxLateralDeg * Math.PI) / 180) * -PATH.endZ;
  return [d.lane * xEnd + d.dx, PATH.zoneY + d.row * PATH.rowStepM + d.dy, PATH.endZ];
}

// The whole flight of one pitch, solved once. `from` is where the ball leaves the hand (eye frame). With the aim point, the
// speed and the pitch's movement, constant acceleration a = (break x, break y - g, 0) fixes the launch velocity that makes the
// ball arrive exactly at the aim point after T = distance / speed.
export function flightPlan(delivery, levelOrId = DEFAULT_LEVEL, from = PATH.release) {
  const d = cleanDelivery(delivery);
  const level = typeof levelOrId === 'string' ? levelById(levelOrId) : levelOrId?.velo ? levelOrId : levelById(DEFAULT_LEVEL);
  const pitch = PITCHES[d.pitch];
  // The hand is somewhere a pitcher's hand can be: a bad or forged release point is pulled back into that box, so a bad number can
  // never start the ball somewhere that would make the flight uncomfortable.
  const p0 = [
    clamp(num(from?.[0], PATH.release[0]), -1.5, 1.5),
    clamp(num(from?.[1], PATH.release[1]), -0.2, 1.6),
    clamp(num(from?.[2], PATH.release[2]), -19.5, -15),
  ];
  const aim = aimPoint(d);
  const speed = pitchSpeed(pitch, level, d.dv); // m/s, along the line from the hand to the plate
  const dist = Math.hypot(aim[0] - p0[0], aim[1] - p0[1], aim[2] - p0[2]);
  const T = dist / speed;
  const br = breakAccel(pitch, T);
  const acc = [br.x, br.y - PHYS.g, 0];
  const vel = [0, 1, 2].map((i) => (aim[i] - p0[i]) / T - 0.5 * acc[i] * T);
  return { delivery: d, pitch, level, from: p0, aim, speed, mph: speed * MPH, T, ms: T * 1000, acc, vel, flutter: d.flutter };
}

// Flight time of one pitch in milliseconds.
export function flightMs(delivery, levelOrId = DEFAULT_LEVEL, from = PATH.release) {
  return flightPlan(delivery, levelOrId, from).ms;
}

// Position of the ball at t01 (0 = release, 1 = arrival at the plate).
export function ballPosition(t01, plan) {
  const u = clamp(num(t01), 0, 1);
  if (u >= 1) return [plan.aim[0], plan.aim[1], plan.aim[2]]; // exact arrival, no rounding drift
  const t = u * plan.T;
  const out = [0, 1, 2].map((i) => plan.from[i] + plan.vel[i] * t + 0.5 * plan.acc[i] * t * t);
  if (plan.flutter) {
    const w = flutterAt(plan.flutter, t, plan.T);
    out[0] += w.x;
    out[1] += w.y;
  }
  out[1] = Math.max(out[1], FIELD.ground + PHYS.ballRadius); // never through the ground
  return out;
}

// Whether the whole path of a pitch fits inside the glasses' view with `marginDeg` to spare.
export function pathFitsView(plan, marginDeg = 5, steps = 120) {
  for (let i = 0; i <= steps; i++) {
    const a = viewAngles(ballPosition(i / steps, plan));
    if (a.horizontal > FOV.right - marginDeg || a.horizontal < -(FOV.left - marginDeg)) return false;
    if (a.vertical > FOV.up - marginDeg || a.vertical < -(FOV.down - marginDeg)) return false;
  }
  return true;
}

// The drawn ball is the real 7.4 cm ball, made no smaller than a radius of `minAngularDeg` as seen from the eyes: 0.35 degrees in flight
// (about 11 cm across at the mound, real size inside 6 m) and 0.15 in the pitcher's hand (about 9 cm). The white guide ring, a fixed
// 3.4 degrees, is what marks it from far away, so the ball itself can stay close to its real size.
export const BALL_MIN_DEG = Object.freeze({ flight: 0.35, hand: 0.15 });
export const drawnRadius = (distance, minAngularDeg = BALL_MIN_DEG.flight) => drawnRadiusOf(distance, PHYS.ballRadius, minAngularDeg);

// A shuffled set of pitches: exactly balanced Left / Middle / Right and Low / Level / High (each shuffled on its own), a spread
// of pitch types (never the same twice running), each with its own command miss and speed jitter, and a knuckleball's flutter.
// rng: () => number in [0, 1). Injected so tests are deterministic; the app passes a crypto-backed source.
export function makeDeliveries(count, rng) {
  const shuffled = (values) => {
    const a = [];
    for (let i = 0; i < count; i++) a.push(values[i % values.length]);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const lanes = shuffled([-1, 0, 1]);
  const rows = shuffled([0, 1, -1]);
  const out = [];
  let last = null;
  for (let i = 0; i < count; i++) {
    const pitch = choosePitch(rng, last);
    last = pitch.id;
    out.push({
      lane: lanes[i],
      row: rows[i],
      pitch: PITCHES.indexOf(pitch),
      dx: (rng() * 2 - 1) * PATH.jitterM,
      dy: (rng() * 2 - 1) * PATH.jitterM,
      dv: rng() * 2 - 1,
      flutter: flutterParams(pitch, rng),
    });
  }
  return out;
}

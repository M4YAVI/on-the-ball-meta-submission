// Batting physics: the bat in the player's hand meets the bowled ball, and the ball flies off the bat by the bat's own
// speed and direction. Pure maths (no Three.js, no DOM) so it is unit-tested in Node.
//
// Scoring is NOT here. The eye-tracking score (core/engine.js Trial) is unchanged and still ends at the ball's arrival; this
// module only decides what the ball does after it touches the bat.
//
// Frames: everything is in the scene's eye frame (core/ball-path.js): x right, y up from the eyes, z negative toward the bowler.
// The bat's own frame matches the WebXR grip space it is held in: origin in the fist, -Z along the bat toward the toe (the
// thumb side of the fist), X across the face (the face looks along the palm), Y across the width of the blade.
//
// Numbers from the physics of real bats (R. Cross, "Physics of cricket" and "Bat and ball collisions", Univ. of Sydney; Allen
// et al. finite element study of cricket bats):
//   - a cricket ball off a bat has a coefficient of restitution of about 0.5 to 0.58 at the sweet spot,
//   - the sweet spot is roughly 0.2 m up from the toe, and the bounce falls off toward the toe and the shoulder,
//   - the ball (0.156 kg) is light next to the bat's effective mass (~0.7 to 0.9 kg at the sweet spot), so the bat barely recoils.
// The collision itself lasts about a millisecond, so it is solved as one instant impulse.

import { FIELD, PHYS } from './ball-path.js';

// The bat's size (Laws of Cricket, Law 5: at most 96.52 cm long, 10.8 cm wide, 6.7 cm deep at the spine, edges 4 cm).
export const BAT = Object.freeze({
  handleTopZ: 0.1, // the top of the handle, just above the fist
  bladeTopZ: -0.21, // the shoulders, where the handle meets the blade
  toeZ: -0.77, // the bottom of the blade
  halfWidth: 0.054, // Y: half of 10.8 cm
  halfDepth: 0.033, // X: half the average depth (the face is flat, the back has a spine); used for the hit test
  handleRadius: 0.017,
  sweetZ: -0.56, // about 21 cm up from the toe
});

export const HIT = Object.freeze({
  restitution: 0.56, // at the sweet spot
  restitutionMin: 0.18, // a ball off the very toe or the shoulder dies on the bat
  massRatio: 0.21, // ball mass over the bat's effective mass at the sweet spot
  grip: 0.55, // share of the sliding speed along the face that the ball keeps (friction while it rolls on the face)
  edgeFrom: 0.62, // share of the half width beyond which the curved edge starts to deflect the ball
  edgeTilt: 1.3, // how hard a ball on the very edge is turned away (tangent of the extra angle, at the edge)
  maxBatSpeed: 32, // m/s: tracking noise can make a swing look faster than any arm can move a bat; cap it
  reach: 2.4, // m: no collision test while the ball is further than this from the bat
  stepM: 0.02, // m: the sub-step length of the swept test, so a 140 km/h ball cannot pass through the blade
});

// The playing area, in the eye frame. The rope and the fence are circles around the middle of the ground (the scene draws them
// from these same numbers).
export const GROUND_PLAN = Object.freeze({
  centerX: 0,
  centerZ: (FIELD.batsmanStumpsZ + FIELD.bowlerStumpsZ) / 2,
  ropeR: 27.5,
  fenceR: 30,
  fenceH: 1.1, // a ball lower than this at the fence stops against it
  outR: 60, // a ball that clears the fence is gone once it lands
});

// Timing: when the bat meets the ball. The ball comes in along -z to +z, so the bat meeting it further out front (more negative
// z) than the ideal point is EARLY, and meeting it nearer the body is LATE. Measured as the ball's depth at the touch, so it
// reads the same for a hand swing and the PC control. PERFECT is a narrow band around the ideal point.
export const TIMING = Object.freeze({
  idealZ: -1.0, // m in front of the eyes: where a well-timed shot meets the ball, the bat at full speed
  perfectHalf: 0.24, // m either side of the ideal point that is PERFECT (about 1.5 ball-lengths of travel at the default speed)
  scale: 0.55, // m from the ideal point to the end of the meter
  perfectMinBatSpeed: 4, // m/s: a perfect shot needs a swing, not a dab (a poke or a block is under about 4)
  perfectMinE: 0.36, // the blade must be lively where it met the ball: the middle third of the blade, not the toe or the shoulder
  perfectExit: 36, // m/s (130 km/h): off the middle on a perfect shot
  perfectLoftDeg: 24, // the angle it leaves at: up and over the rope
  perfectMaxYawDeg: 50, // a perfect shot goes into the field in front: anything squarer is brought round to this
});

// Where the touch was in the timing band. off: -1 (as early as the meter shows) .. +1 (as late); zone: 'early' | 'perfect' | 'late'.
export function timingOf(contactZ) {
  const d = contactZ - TIMING.idealZ;
  const zone = Math.abs(d) <= TIMING.perfectHalf ? 'perfect' : d < 0 ? 'early' : 'late';
  return { zone, off: clamp(d / TIMING.scale, -1, 1), dz: d };
}

// Does this touch qualify as a PERFECT shot? Perfect timing, off the middle of the blade (not an edge, not the toe or the
// shoulder), with a real swing.
export function isPerfect(timing, hit, batSpeed) {
  return !!timing && timing.zone === 'perfect' && !!hit && !hit.edge && hit.e >= TIMING.perfectMinE && batSpeed >= TIMING.perfectMinBatSpeed;
}

// A perfectly timed shot off the middle goes out of the ground, always. It goes the way the player played it: the heading the
// bat sent the ball (left or right of straight), or, when the ball came off the face going square or back (a face a little
// open, a ball that rode up the blade), the way the bat itself was swinging. Either is brought into the field in front (within
// perfectMaxYawDeg of straight). It leaves fast and high enough to clear the rope on the full. Returns the new velocity, or null
// when the touch does not qualify. batV: the blade's velocity at the touch (optional).
export function perfectLaunch(v, timing, hit, batSpeed, batV = null) {
  if (!isPerfect(timing, hit, batSpeed)) return null;
  let dir = null;
  if (v[2] < 0 && Math.hypot(v[0], v[2]) > 1e-6) dir = [v[0], -v[2]];
  else if (batV && batV[2] < 0 && Math.hypot(batV[0], batV[2]) > 1e-6) dir = [batV[0], -batV[2]];
  else dir = [0, 1]; // straight back past the bowler
  const maxYaw = (TIMING.perfectMaxYawDeg * Math.PI) / 180;
  const yaw = clamp(Math.atan2(dir[0], dir[1]), -maxYaw, maxYaw);
  const e = (TIMING.perfectLoftDeg * Math.PI) / 180;
  const s = clamp(len(v), TIMING.perfectExit, TIMING.perfectExit * 1.25);
  return [Math.sin(yaw) * Math.cos(e) * s, Math.sin(e) * s, -Math.cos(yaw) * Math.cos(e) * s];
}

const FLY = Object.freeze({
  bounceKeepUp: 0.42, // outfield grass is softer than the pitch
  bounceKeepPace: 0.72,
  rollDecel: 0.9, // m/s^2 of rolling friction on mown grass (a 90 km/h drive along the ground still reaches the rope)
  rollDrag: 0.35, // per second
  restSpeed: 0.12,
  rollVy: 1.0, // below this upward speed after a bounce the ball rolls instead
});

// ------------------------------------------------------------------ small vector helpers (arrays of 3)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Quaternions are [x, y, z, w], as in Three.js.
export function rotate(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}
const conj = (q) => [-q[0], -q[1], -q[2], q[3]];

export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0;
  let k1;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  const r = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
}

// A point in the bat's frame -> the scene frame, for a bat pose {p, q}.
export function batToWorld(pose, local) {
  return add(pose.p, rotate(pose.q, local));
}
export function worldToBat(pose, world) {
  return rotate(conj(pose.q), sub(world, pose.p));
}

// ------------------------------------------------------------------ contact
// Does a ball of radius r centred at `local` (bat frame) touch the blade? Returns the contact normal in the bat frame
// (pointing from the blade to the ball) or null.
export function bladeContact(local, r = PHYS.ballRadius) {
  const hx = BAT.halfDepth;
  const hy = BAT.halfWidth;
  const zTop = BAT.bladeTopZ;
  const zToe = BAT.toeZ;
  const cx = clamp(local[0], -hx, hx);
  const cy = clamp(local[1], -hy, hy);
  const cz = clamp(local[2], zToe, zTop);
  const d = [local[0] - cx, local[1] - cy, local[2] - cz];
  const dist = len(d);
  if (dist > r) return null;
  if (dist > 1e-6) return norm(d);
  // The centre is inside the blade (a very fast step): push out through the nearest face.
  const pen = [hx - Math.abs(local[0]), hy - Math.abs(local[1]), Math.min(zTop - local[2], local[2] - zToe)];
  if (pen[0] <= pen[1] && pen[0] <= pen[2]) return [Math.sign(local[0]) || 1, 0, 0];
  if (pen[1] <= pen[2]) return [0, Math.sign(local[1]) || 1, 0];
  return [0, 0, zTop - local[2] < local[2] - zToe ? 1 : -1];
}

// Swept test between two frames. The bat moves from pose0 to pose1 and the ball from b0 to b1 over the same frame; both are
// interpolated in small steps so neither a fast ball nor a fast swing can pass through the blade between frames.
// Returns { s, ball, local, normalLocal, pose } for the first touch (s in 0..1 through the frame), or null.
export function sweepHit(pose0, pose1, b0, b1, r = PHYS.ballRadius) {
  if (!pose0 || !pose1) return null;
  const mid = lerp3(pose0.p, pose1.p, 0.5);
  if (Math.min(len(sub(b0, mid)), len(sub(b1, mid))) > HIT.reach) return null;
  const toe = [0, 0, BAT.toeZ];
  const tipTravel = len(sub(batToWorld(pose0, toe), batToWorld(pose1, toe)));
  const travel = Math.max(len(sub(b1, b0)), tipTravel);
  const n = clamp(Math.ceil(travel / HIT.stepM), 1, 80);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const pose = { p: lerp3(pose0.p, pose1.p, s), q: slerp(pose0.q, pose1.q, s) };
    const ball = lerp3(b0, b1, s);
    const local = worldToBat(pose, ball);
    const nl = bladeContact(local, r);
    if (nl) return { s, ball, local, normalLocal: nl, pose, pad: Math.max(0, r - PHYS.ballRadius) };
  }
  return null;
}

// How lively the blade is at a point along it: best at the sweet spot, dead at the toe and the shoulder.
export function restitutionAt(zLocal) {
  const span = zLocal < BAT.sweetZ ? BAT.sweetZ - BAT.toeZ : BAT.bladeTopZ - BAT.sweetZ;
  const u = clamp((zLocal - BAT.sweetZ) / span, -1, 1);
  return HIT.restitutionMin + (HIT.restitution - HIT.restitutionMin) * (1 - u * u);
}

// The bounce off the bat. ballV: the ball's velocity, batV: the velocity of the blade at the contact point (both scene frame).
// contact: a result of sweepHit. Returns the ball's new velocity and what kind of hit it was.
export function batBounce(ballV, batV, contact) {
  const { local, normalLocal, pose } = contact;
  let bv = batV;
  const bs = len(bv);
  if (bs > HIT.maxBatSpeed) bv = scale(bv, HIT.maxBatSpeed / bs);

  // The face is flat but the edges are rounded: near an edge the normal turns toward that edge, so a ball on the edge flies
  // off sideways (an outside edge, a thick edge), as it does off a real bat.
  // (A forgiving contact size widens the zone that counts as a hit, so the extra width is not read as "on the edge".)
  const across = Math.abs(local[1]) / (BAT.halfWidth + (contact.pad ?? 0));
  let nl = normalLocal;
  let edge = false;
  if (Math.abs(nl[0]) > 0.5 && across > HIT.edgeFrom) {
    const k = (clamp(across, 0, 1) - HIT.edgeFrom) / (1 - HIT.edgeFrom);
    nl = norm([nl[0], Math.sign(local[1]) * k * HIT.edgeTilt, 0]);
    edge = k > 0.45;
  } else if (Math.abs(nl[1]) > 0.5) {
    edge = true; // right on the side of the blade
  }
  let n = norm(rotate(pose.q, nl));
  let rel = sub(ballV, bv);
  let un = dot(rel, n);
  if (un > 0) {
    // Relative to the bat the ball is not moving into this face (the bat caught it from behind in a sub-step); use the other side.
    n = scale(n, -1);
    un = -un;
  }
  const e = restitutionAt(local[2]) * (edge ? 0.75 : 1);
  // Impulse for a ball on a much heavier bat that the hands hold: the ball's normal speed relative to the bat reverses and
  // shrinks by e, less a little for the bat's recoil (mass ratio).
  const dn = (-(1 + e) * un) / (1 + HIT.massRatio);
  const vt = sub(rel, scale(n, un)); // sliding along the face
  const out = add(add(bv, scale(n, un + dn)), scale(vt, HIT.grip));
  // Batted ball, relative to the scene: bat velocity + normal rebound + kept slide. (un + dn) is the new relative normal speed.
  const sweet = Math.abs(local[2] - BAT.sweetZ) < 0.09 && !edge;
  const impact = Math.abs(un); // closing speed: how hard it felt
  return { v: out, edge, sweet, impact, normal: n, e };
}

// ------------------------------------------------------------------ the ball after the bat
// A batted ball's state. p and v in the scene frame. bounced: it has touched the grass; crossed: it passed the rope (4 or 6).
export function launch(p, v) {
  return { p: p.slice(), v: v.slice(), bounced: false, crossed: null, rest: false, t: 0, carry: null, maxH: p[1] };
}

const ropeDist = (p) => Math.hypot(p[0] - GROUND_PLAN.centerX, p[2] - GROUND_PLAN.centerZ);

// Advance a batted ball by dt seconds: gravity, air drag (the same drag as the bowled ball), bounces on the outfield, rolling
// friction, the boundary rope and the fence. Sub-stepped so it is exact enough at any frame rate.
export function stepBatted(st, dt) {
  if (st.rest) return st;
  const n = Math.max(1, Math.ceil(dt / 0.006));
  const h = dt / n;
  const floor = FIELD.ground + PHYS.ballRadius;
  for (let i = 0; i < n; i++) {
    st.t += h;
    const v = st.v;
    const sp = len(v);
    const airborne = st.p[1] > floor + 1e-4 || v[1] > 0;
    if (airborne) {
      const k = Math.exp(-PHYS.drag * sp * h); // speed falls by exp(-drag * distance)
      v[0] *= k;
      v[1] *= k;
      v[2] *= k;
      v[1] -= PHYS.g * h;
    } else {
      // rolling on the grass
      const hs = Math.hypot(v[0], v[2]);
      const ns = Math.max(0, hs * Math.exp(-FLY.rollDrag * h) - FLY.rollDecel * h);
      const f = hs > 1e-6 ? ns / hs : 0;
      v[0] *= f;
      v[2] *= f;
      v[1] = 0;
      if (ns < FLY.restSpeed) {
        v[0] = v[1] = v[2] = 0;
        st.rest = true;
        break;
      }
    }
    st.p[0] += v[0] * h;
    st.p[1] += v[1] * h;
    st.p[2] += v[2] * h;
    st.maxH = Math.max(st.maxH, st.p[1]);
    if (st.p[1] <= floor) {
      st.p[1] = floor;
      if (!st.bounced) st.carry = ropeDist(st.p);
      if (v[1] < 0) {
        const up = -v[1] * FLY.bounceKeepUp;
        st.bounced = true;
        v[1] = up > FLY.rollVy ? up : 0;
        v[0] *= FLY.bounceKeepPace;
        v[2] *= FLY.bounceKeepPace;
      }
    }
    const r = ropeDist(st.p);
    if (!st.crossed && r >= GROUND_PLAN.ropeR) st.crossed = st.bounced ? 'four' : 'six';
    if (r >= GROUND_PLAN.fenceR && st.p[1] - FIELD.ground < GROUND_PLAN.fenceH && r < GROUND_PLAN.fenceR + 0.5) {
      // Against the boards: it drops dead at the fence.
      const k = GROUND_PLAN.fenceR / r;
      st.p[0] = GROUND_PLAN.centerX + (st.p[0] - GROUND_PLAN.centerX) * k;
      st.p[2] = GROUND_PLAN.centerZ + (st.p[2] - GROUND_PLAN.centerZ) * k;
      v[0] = v[2] = 0;
      if (st.p[1] <= floor + 1e-3) {
        v[1] = 0;
        st.rest = true;
        break;
      }
    }
    if (r >= GROUND_PLAN.outR && st.p[1] <= floor + 1e-3) {
      v[0] = v[1] = v[2] = 0;
      st.rest = true;
      break;
    }
  }
  return st;
}

// What the shot was, for the call-out and the crowd only (it is never part of the eye-tracking score).
//   'six' / 'four': over or along the ground to the rope. 'edge': off an edge. 'block': a dead bat, the ball stays close.
//   'shot': hit into the field. null: not decided yet.
export function shotKind(st, hit) {
  if (st.crossed) return st.crossed;
  if (hit.edge) return 'edge';
  const exit = len(hit.v);
  if (exit < 9) return 'block';
  if (st.rest || st.t > 2.6) return 'shot';
  return null;
}

// Pure helper for the haptics: how strong (0..1) and how long (ms) the pulse in the hand should be.
export function hapticFor(hit) {
  if (hit.edge) return { intensity: 0.35, ms: 28 };
  const k = clamp(hit.impact / 40, 0, 1);
  if (hit.sweet) return { intensity: 0.55 + 0.35 * k, ms: 45 }; // clean and short: it feels like nothing touched the bat
  return { intensity: 0.7 + 0.3 * k, ms: 85 }; // off the toe or shoulder: a longer sting
}

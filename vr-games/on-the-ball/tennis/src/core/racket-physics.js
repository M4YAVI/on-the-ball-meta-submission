// Racket physics for ON THE BALL · Tennis: the racket in the receiver's hand meets the serve, and the ball goes back over the
// net by the racket's own speed and direction. Pure maths (no Three.js, no DOM) so it is unit-tested in Node.
//
// Scoring is NOT here. The eye-tracking score (core/engine.js Trial) is unchanged and still ends at the ball's arrival; this
// module only decides what the ball does after it touches the racket, and where the return lands.
//
// Frames: everything is in the scene's eye frame (core/ball-path.js): x right, y up from the eyes, z negative toward the server.
// The racket's own frame is the WebXR grip space it is held in (nothing added): origin in the fist, the shaft along -Z toward
// the head (out of the thumb side of the fist), the strings in the Y-Z plane, so the face looks along +X or -X, the way the
// palm looks (an eastern forehand grip: the palm is behind the strings). Both faces of a racket hit the same.
//
// Numbers:
//   - ITF Rules of Tennis, Appendix II: a racket is at most 73.7 cm long, its strung area at most 39.4 x 29.2 cm. A common
//     100 sq in racket: 68.6 cm long, head about 34 x 26 cm outside the frame, frame beam about 24 mm deep, 300 g.
//   - R. Cross, "Impact of a ball with a bat or racket" (Am. J. Phys. 67, 1999) and Cross & Lindsey, "Technical Tennis": the
//     ball on the strings has a coefficient of restitution of about 0.85 near the middle; the effective mass of a hand-held
//     racket is about 0.2 to 0.25 kg there (ball 0.057 kg) and falls toward the tip, so a hit off the tip is weak. Seen as a
//     whole (the "apparent" COR of a held racket) the ball comes back at about 0.4 of its incoming speed at the sweet spot.
//   - Spin: the ball grips the strings and rolls off them, so a racket brushing up the back of the ball gives it topspin.
//     Lift on a spinning tennis ball: C_L = 1 / (2 + v / (r w)) (J. Stepanek, 1988; used by Cross & Lindsey).
// The impact lasts about 4 ms, so it is solved as one instant impulse.

import { ballPosition, centreLineXFor, COURT, FIELD, PHYS } from './ball-path.js';
import { rotate, slerp, batToWorld, worldToBat } from '../../../src/core/bat-physics.js';

export { slerp };
export const racketToWorld = batToWorld; // the same rigid-body maths as the cricket bat
export const worldToRacket = worldToBat;

// The racket, in its own frame (metres). The fist is at the origin; the butt cap is just below the little finger.
export const RACKET = Object.freeze({
  buttZ: 0.075, // the butt cap
  gripTopZ: -0.115, // the top of the grip, where the throat's two beams start
  headZ: -0.44, // the middle of the head
  headA: 0.17, // half the head's length outside the frame (along the shaft)
  headB: 0.13, // half its width outside the frame (across)
  stringA: 0.152, // half the strung area's length
  stringB: 0.112, // half its width
  halfDepth: 0.012, // half the frame beam's depth (the strings lie in the middle plane)
  sweetZ: -0.41, // the sweet spot: a little below the middle of the head, toward the throat
  handleR: 0.0145,
});
export const RACKET_LENGTH = RACKET.buttZ - (RACKET.headZ - RACKET.headA);

export const HIT = Object.freeze({
  restitution: 0.86, // ball on the strings, at the sweet spot
  restitutionDrop: 0.3, // how much of that is lost at the edge of the strings
  frameE: 0.3, // a ball off the frame dies on it
  massRatio: 0.25, // ball mass over the racket's effective mass at the sweet spot
  massGrow: 1.8, // the effective mass falls off toward the tip and the sides (the racket twists): ratio * (1 + grow * u^2)
  grip: 0.3, // share of the sliding speed across the strings the ball keeps
  spinK: 0.6, // spin off the strings: share of (sliding speed / ball radius) that becomes spin
  maxSpin: 330, // rad/s (about 3200 rpm: a big topspin forehand)
  frameTilt: 1.0, // how hard a ball off the frame is turned aside
  maxRacketSpeed: 40, // m/s: tracking noise can make a swing look faster than any arm; cap it
  reach: 2.2, // m: no collision test while the ball is further than this from the hand
  stepM: 0.012, // m: sub-step length of the swept test, so neither a 170 km/h serve nor a fast swing can pass through the face
});

// Lift: 0.5 * air density 1.225 * cross-section 0.00353 m^2 / mass 0.057 kg = 0.0379 per metre (the same numbers as the drag).
const LIFT_K = 0.0379;
const COURT_BOUNCE = Object.freeze({ keepUp: PHYS.restitution, keepPace: PHYS.keepPace, rollVy: 0.8, rollDecel: 1.2, rollDrag: 0.3, rest: 0.1 });

// The court as the returned ball meets it, for the side the receiver sits on (core/ball-path.js SIDE). The screens are where the
// scene draws them (xr/tennis-scene.js: a 6.2 m run-off behind each baseline, 8.5 m beside the doubles lines).
export function courtPlan(side) {
  const cx = centreLineXFor(side);
  return {
    cx,
    halfSingles: COURT.singlesWidth / 2,
    netZ: FIELD.netZ,
    farZ: FIELD.baselineFarZ,
    netHalfSpan: COURT.doublesWidth / 2 + 0.914, // the posts stand 0.914 m outside the doubles lines
    backZ: FIELD.baselineFarZ - 6.2 + 0.25,
    sideHalf: COURT.doublesWidth / 2 + 8.5 - 0.25,
  };
}

// Height of the top of the net (eye frame) at x: 0.914 m in the middle, rising to 1.07 m at the posts.
export function netTopY(x, side) {
  const pl = courtPlan(side);
  const u = clamp(Math.abs(x - pl.cx) / pl.netHalfSpan, 0, 1);
  return FIELD.ground + COURT.netHeight + (COURT.netPostHeight - COURT.netHeight) * u;
}

// Whether a first bounce at (x, z) is in the opponent's singles court. A ball touching the line is in (lines are 5 cm wide;
// the baseline up to 10 cm).
export function landsIn(x, z, side) {
  const pl = courtPlan(side);
  return Math.abs(x - pl.cx) <= pl.halfSingles + 0.03 && z <= pl.netZ && z >= pl.farZ - 0.05;
}

// ------------------------------------------------------------------ timing
// When the racket meets the ball. The serve comes in along +z, so meeting it further out in front (more negative z) than the
// ideal point is EARLY, and nearer the body is LATE (cramped). Same idea and same meter as cricket's batting.
export const TIMING = Object.freeze({
  // m in front of the eyes: the contact point out in front, where an arm still reaches it with the trunk turned into the shot
  // (shoulder joint to the hand at most about 0.58 m, ANSUR II; core/arm.js)
  idealZ: -0.55,
  perfectHalf: 0.25, // a generous PERFECT: 50 cm of the ball's path (it was 30 cm, which a fast serve crosses in about 10 ms)
  scale: 0.45,
  perfectMinRacketSpeed: 8, // m/s: a perfect return needs a swing, not a block
  perfectMaxU: 0.6, // and the strings near the middle (u: 0 sweet spot .. 1 edge of the strings)
  perfectExit: 31, // m/s (112 km/h)
  perfectSpin: 170, // rad/s of topspin
  perfectDepth: 1.6, // m inside the baseline: deep
  sideMargin: 0.7, // m inside the singles sideline
  perfectMaxYawDeg: 40,
  winnerSpeed: 32, // m/s (115 km/h): an IN return this fast is a winner too
});

export function timingOf(contactZ) {
  const d = contactZ - TIMING.idealZ;
  const zone = Math.abs(d) <= TIMING.perfectHalf ? 'perfect' : d < 0 ? 'early' : 'late';
  return { zone, off: clamp(d / TIMING.scale, -1, 1), dz: d };
}

// ------------------------------------------------------------------ small vector helpers (arrays of 3)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, 0];
};
function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

// ------------------------------------------------------------------ contact
// Does a ball of radius r centred at `local` (racket frame) touch the head? The head is an elliptical slab: the frame outside,
// the strings inside. Returns the contact normal in the racket frame (from the racket toward the ball) and where on the head
// it touched, or null. (The throat and the handle are not hit surfaces: a ball there is a miss.)
export function headContact(local, r = PHYS.ballRadius) {
  const dy = local[1];
  const dz = local[2] - RACKET.headZ;
  const rho = Math.hypot(dy / RACKET.headB, dz / RACKET.headA);
  let py = dy;
  let pz = dz;
  if (rho > 1) {
    // outside the frame's outline: the nearest point of the rim (radial projection; exact enough for a ball on a slim ellipse)
    py /= rho;
    pz /= rho;
  }
  const px = clamp(local[0], -RACKET.halfDepth, RACKET.halfDepth);
  const d = [local[0] - px, dy - py, dz - pz];
  const dist = len(d);
  if (dist > r) return null;
  let normalLocal;
  if (dist > 1e-6) normalLocal = norm(d);
  else normalLocal = [Math.sign(local[0]) || 1, 0, 0]; // the centre is inside the slab (a very fast step): out through the face
  const inner = Math.hypot(py / RACKET.stringB, pz / RACKET.stringA);
  const onStrings = rho <= 1 && inner <= 1;
  // u: how far from the sweet spot (0) to the edge of the strings (1), measured on the face
  const u = Math.hypot(py / RACKET.stringB, (pz + RACKET.headZ - RACKET.sweetZ) / RACKET.stringA);
  return { normalLocal, onStrings, u, at: [px, py, pz + RACKET.headZ] };
}

// Swept test between two frames. The racket moves from pose0 to pose1 and the ball from b0 to b1 over the same frame; both are
// interpolated in small steps. Returns { s, ball, local, normalLocal, onStrings, u, pose, pad } for the first touch, or null.
export function sweepRacket(pose0, pose1, b0, b1, r = PHYS.ballRadius) {
  if (!pose0 || !pose1) return null;
  const mid = lerp3(pose0.p, pose1.p, 0.5);
  if (Math.min(len(sub(b0, mid)), len(sub(b1, mid))) > HIT.reach) return null;
  const tip = [0, 0, RACKET.headZ - RACKET.headA];
  const tipTravel = len(sub(racketToWorld(pose0, tip), racketToWorld(pose1, tip)));
  const travel = Math.max(len(sub(b1, b0)), tipTravel);
  const n = clamp(Math.ceil(travel / HIT.stepM), 1, 90);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const pose = { p: lerp3(pose0.p, pose1.p, s), q: slerp(pose0.q, pose1.q, s) };
    const ball = lerp3(b0, b1, s);
    const local = worldToRacket(pose, ball);
    const c = headContact(local, r);
    if (c) return { s, ball, local, ...c, pose, pad: Math.max(0, r - PHYS.ballRadius) };
  }
  return null;
}

// ------------------------------------------------------------------ easy play: the reach of a swing
// Meeting a 130 km/h serve with the strings exactly is very hard (the ball crosses the head's depth in about 2 ms), so a SWINGING
// racket also meets the ball when its sweet spot passes within `reach` of it during the frame. A racket held still never gets
// this: a block still needs the strings (sweepRacket). Hand play only; the eye score never sees it.
export const ASSIST = Object.freeze({
  reach: 0.3, // m, a real hand (headset)
  reachPc: 0.42, // m, the PC wheel swing (cruder than an arm)
  minSpeed: 2.0, // m/s at the sweet spot: a swing, not a racket held in the way
  backward: 0.4, // a swing moving away from the server faster than this share of its speed is a take-back, not a shot
  nearZ: 0.35, // m: the hitting zone runs from just behind the eyes...
  farZ: -1.8, // ...to this far out in front
});

// Where the ball passes nearest the sweet spot of a swinging racket during one frame, as a contact like sweepRacket's (on the
// strings near the sweet spot, the face toward the ball), or null. swingV: the sweet spot's velocity (scene frame).
export function assistContact(pose0, pose1, b0, b1, reach, swingV) {
  if (!pose0 || !pose1 || !swingV) return null;
  const sp = len(swingV);
  if (!(sp >= ASSIST.minSpeed) || swingV[2] > ASSIST.backward * sp) return null;
  if (Math.max(b0[2], b1[2]) < ASSIST.farZ || Math.min(b0[2], b1[2]) > ASSIST.nearZ) return null;
  const sweet = [0, 0, RACKET.sweetZ];
  const n = clamp(Math.ceil(Math.max(len(sub(b1, b0)), len(sub(racketToWorld(pose0, sweet), racketToWorld(pose1, sweet)))) / HIT.stepM), 1, 90);
  let best = null;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const pose = { p: lerp3(pose0.p, pose1.p, s), q: slerp(pose0.q, pose1.q, s) };
    const ball = lerp3(b0, b1, s);
    const d = len(sub(ball, racketToWorld(pose, sweet)));
    if (!best || d < best.d) best = { d, s, pose, ball };
  }
  if (best.d > reach || best.ball[2] < ASSIST.farZ || best.ball[2] > ASSIST.nearZ) return null;
  const local = worldToRacket(best.pose, best.ball);
  return {
    s: best.s,
    ball: best.ball,
    local,
    normalLocal: [local[0] >= 0 ? 1 : -1, 0, 0], // racketBounce turns it to the face the ball is coming into
    onStrings: true,
    u: 0.5 * clamp(best.d / reach, 0, 1),
    at: sweet.slice(),
    pose: best.pose,
    pad: 0,
    assisted: true,
    miss: best.d,
  };
}

// When and where a serve nobody hits crosses the contact depth (TIMING.idealZ): t in seconds from the strike, p the point, speed
// its speed there. d: { lane, curve, depth, kmh, side }, durMs: its flight time. The PC swing aims and times itself from this.
export function contactPoint(d, durMs) {
  const T = durMs / 1000;
  const st = startCarry(ballPosition(1, d.lane, d.curve, d.depth, d.kmh, d.side), serveVelocity(1, d, durMs));
  let t = T;
  const h = 0.001;
  for (let i = 0; i < 2000 && st.p[2] < TIMING.idealZ && !st.rest; i++) {
    const before = st.p.slice();
    stepCarry(st, h);
    t += h;
    if (st.p[2] >= TIMING.idealZ) {
      const k = (TIMING.idealZ - before[2]) / (st.p[2] - before[2] || 1);
      return { t: t - h + k * h, p: lerp3(before, st.p, k), speed: len(st.v) };
    }
  }
  return { t, p: st.p.slice(), speed: len(st.v) };
}

// How lively the strings are at u (0 sweet spot .. 1 edge of the strings).
export function restitutionAt(u) {
  const k = clamp(u, 0, 1.2);
  return Math.max(0.4, HIT.restitution - HIT.restitutionDrop * k * k);
}

// The bounce off the racket. ballV: the ball's velocity; racketV: the velocity of the racket at the contact point (scene frame);
// contact: a result of sweepRacket. Returns the ball's new velocity and spin (rad/s, scene frame) and what kind of hit it was.
export function racketBounce(ballV, racketV, contact) {
  const { normalLocal, pose } = contact;
  let rv = racketV;
  const rs = len(rv);
  if (rs > HIT.maxRacketSpeed) rv = scale(rv, HIT.maxRacketSpeed / rs);
  const frame = !contact.onStrings;
  let nl = normalLocal;
  if (frame && Math.abs(nl[0]) > 0.5) {
    // On the frame's flat side: the round beam turns the ball aside, outward from the head (a shank).
    const out = norm([0, contact.at[1], contact.at[2] - RACKET.headZ]);
    nl = norm([nl[0], out[1] * HIT.frameTilt, out[2] * HIT.frameTilt]);
  }
  let n = norm(rotate(pose.q, nl));
  const rel = sub(ballV, rv);
  let un = dot(rel, n);
  if (un > 0) {
    // relative to the racket the ball is not moving into this face (caught from behind in a sub-step): the other face
    n = scale(n, -1);
    un = -un;
  }
  const u = clamp(contact.u ?? 0, 0, 1.4);
  const e = frame ? HIT.frameE : restitutionAt(u);
  const m = HIT.massRatio * (1 + HIT.massGrow * u * u) * (frame ? 1.6 : 1);
  const dn = (-(1 + e) * un) / (1 + m);
  const vt = sub(rel, scale(n, un)); // the ball sliding across the strings, relative to the racket
  const v = add(add(rv, scale(n, un + dn)), scale(vt, HIT.grip));
  // Spin: the strings grip the ball and roll it the way the racket brushes past it. The contact point is on the ball's side
  // toward the racket (-n r); the ball turns so that point moves with the racket: w = k (n x vt) / r.
  let w = scale(cross(n, vt), (frame ? 0.3 : HIT.spinK) / PHYS.ballRadius);
  const ws = len(w);
  if (ws > HIT.maxSpin) w = scale(w, HIT.maxSpin / ws);
  const sweet = !frame && u < 0.35;
  return { v, w, frame, sweet, impact: Math.abs(un), normal: n, e, u };
}

// ------------------------------------------------------------------ the serve after its arrival point
// Scoring ends at the arrival point (1.2 m out), but the ball flies on, and the receiver plays it there. So it must carry on
// along its own path (gravity and drag, nothing added) through the hitting zone. Only once it is past where any racket could
// reach it (CARRY.clearFromZ) is it turned aside, if it would otherwise pass within CARRY.passClear of the eyes: nobody wants a
// ball through the face. p, v: the ball's position and velocity at the arrival point (eye frame).
export const CARRY = Object.freeze({ clearFromZ: -0.42, passClear: 0.5, aimClear: 0.7, endZ: 1.0 }); // aims wide of passClear: drag and gravity bend it back a little

// The serve's velocity (m/s, eye frame) at t01 of its flight (0 strike .. 1 arrival), from its own path (core/ball-path.js).
// d: { lane, curve, depth, kmh, side }, durMs: its flight time.
export function serveVelocity(t01, d, durMs) {
  const eps = 1e-4;
  const a = clamp(t01 - eps, 0, 1);
  const b = clamp(t01 + eps, 0, 1);
  const pa = ballPosition(a, d.lane, d.curve, d.depth, d.kmh, d.side);
  const pb = ballPosition(b, d.lane, d.curve, d.depth, d.kmh, d.side);
  const T = ((b - a) * durMs) / 1000;
  return [(pb[0] - pa[0]) / T, (pb[1] - pa[1]) / T, (pb[2] - pa[2]) / T];
}

export function startCarry(p, v) {
  return { p: p.slice(), v: v.slice(), turned: false, rest: false, bounced: false };
}

export function stepCarry(st, dt) {
  if (st.rest) return st;
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  const floor = FIELD.ground + PHYS.ballRadius;
  for (let i = 0; i < n; i++) {
    const v = st.v;
    if (!st.turned && st.p[2] >= CARRY.clearFromZ) {
      st.turned = true;
      const tz = Math.max(1e-3, -st.p[2] / Math.max(v[2], 1));
      const x = st.p[0] + v[0] * tz;
      const y = st.p[1] + v[1] * tz - 0.5 * PHYS.g * tz * tz;
      if (Math.hypot(x, y) < CARRY.passClear) {
        const side = x !== 0 ? Math.sign(x) : st.p[0] !== 0 ? Math.sign(st.p[0]) : 1;
        v[0] = (side * Math.sqrt(Math.max(0, CARRY.aimClear * CARRY.aimClear - y * y)) - st.p[0]) / tz;
      }
    }
    const k = Math.exp(-PHYS.drag * len(v) * h);
    v[0] *= k;
    v[1] *= k;
    v[2] *= k;
    v[1] -= PHYS.g * h;
    st.p[0] += v[0] * h;
    st.p[1] += v[1] * h;
    st.p[2] += v[2] * h;
    if (st.p[1] <= floor && v[1] < 0) {
      st.p[1] = floor;
      st.bounced = true;
      v[1] = -v[1] * PHYS.restitution > 0.8 ? -v[1] * PHYS.restitution : 0;
      v[0] *= PHYS.keepPace;
      v[2] *= PHYS.keepPace;
    }
    if (st.p[2] >= CARRY.endZ) {
      st.rest = true;
      break;
    }
  }
  return st;
}

// ------------------------------------------------------------------ the returned ball
// result: null until it is decided; then 'in' (first bounce in the opponent's singles court), 'out', 'net' (into the net, or
// it never got there), 'back' (it went behind the player).
export function launchReturn(p, v, w = [0, 0, 0]) {
  return { p: p.slice(), v: v.slice(), w: w.slice(), t: 0, crossed: false, netted: false, bounces: 0, landing: null, result: null, rest: false, maxH: p[1] };
}

// Advance a returned ball by dt seconds: gravity, air drag, lift from its spin, the net, bounces on the court, rolling, and
// the screens round the court. Sub-stepped so it is exact enough at any frame rate.
export function stepReturn(st, dt, side) {
  if (st.rest) return st;
  const pl = courtPlan(side);
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  const r = PHYS.ballRadius;
  const floor = FIELD.ground + r;
  for (let i = 0; i < n; i++) {
    st.t += h;
    const v = st.v;
    const sp = len(v);
    const airborne = st.p[1] > floor + 1e-4 || v[1] > 0;
    if (airborne) {
      const ws = len(st.w);
      if (ws > 1 && sp > 0.5) {
        const cl = 1 / (2 + sp / (r * ws));
        const dir = norm(cross(st.w, v));
        const a = LIFT_K * cl * sp * sp * h;
        v[0] += dir[0] * a;
        v[1] += dir[1] * a;
        v[2] += dir[2] * a;
      }
      const k = Math.exp(-PHYS.drag * sp * h);
      v[0] *= k;
      v[1] *= k;
      v[2] *= k;
      v[1] -= PHYS.g * h;
    } else {
      const hs = Math.hypot(v[0], v[2]);
      const ns = Math.max(0, hs * Math.exp(-COURT_BOUNCE.rollDrag * h) - COURT_BOUNCE.rollDecel * h);
      const f = hs > 1e-6 ? ns / hs : 0;
      v[0] *= f;
      v[2] *= f;
      v[1] = 0;
      if (ns < COURT_BOUNCE.rest) {
        v[0] = v[1] = v[2] = 0;
        st.rest = true;
        break;
      }
    }
    const prev = st.p.slice();
    st.p[0] += v[0] * h;
    st.p[1] += v[1] * h;
    st.p[2] += v[2] * h;
    st.maxH = Math.max(st.maxH, st.p[1]);

    // The net: the ball crosses the net's line on its way over, or it is stopped by it (a ball that clips the tape and drops
    // on this side counts as the net too).
    if (!st.crossed && !st.netted && prev[2] > pl.netZ && st.p[2] <= pl.netZ) {
      const s = (prev[2] - pl.netZ) / (prev[2] - st.p[2]);
      const x = prev[0] + (st.p[0] - prev[0]) * s;
      const y = prev[1] + (st.p[1] - prev[1]) * s;
      if (Math.abs(x - pl.cx) <= pl.netHalfSpan && y < netTopY(x, side) + r * 0.5) {
        st.netted = true;
        st.result ??= 'net';
        st.p = [x, Math.max(floor, y), pl.netZ + r];
        st.v = [v[0] * 0.1, Math.min(0, v[1]) * 0.3, 0.8];
        st.w = [0, 0, 0];
        continue;
      }
      st.crossed = true;
    }

    if (st.p[1] <= floor) {
      st.p[1] = floor;
      if (v[1] < 0) {
        st.bounces += 1;
        if (st.bounces === 1) {
          st.landing = [st.p[0], st.p[2]];
          if (!st.result) st.result = !st.crossed ? 'net' : landsIn(st.p[0], st.p[2], side) ? 'in' : 'out';
        }
        const up = -v[1] * COURT_BOUNCE.keepUp;
        v[1] = up > COURT_BOUNCE.rollVy ? up : 0;
        v[0] *= COURT_BOUNCE.keepPace;
        v[2] *= COURT_BOUNCE.keepPace;
        st.w = scale(st.w, 0.5);
      }
    }
    // the screens round the court: the ball drops dead against them
    if (st.p[2] <= pl.backZ) {
      st.p[2] = pl.backZ;
      st.result ??= 'out';
      v[2] = Math.abs(v[2]) * 0.12;
      v[0] *= 0.4;
    }
    if (Math.abs(st.p[0] - pl.cx) >= pl.sideHalf) {
      st.p[0] = pl.cx + Math.sign(st.p[0] - pl.cx) * pl.sideHalf;
      st.result ??= 'out';
      v[0] = -v[0] * 0.12;
    }
    if (st.p[2] > 2.5) {
      // behind the player: gone
      st.result ??= 'back';
      v[0] = v[1] = v[2] = 0;
      st.rest = true;
      break;
    }
  }
  if (st.t > 8) st.rest = true;
  return st;
}

// Where a return will end up, without moving the real one: a copy is flown until its result is known.
export function predictReturn(st, side) {
  const c = { ...st, p: st.p.slice(), v: st.v.slice(), w: st.w.slice(), landing: st.landing && st.landing.slice() };
  while (!c.result && !c.rest) stepReturn(c, 0.02, side);
  return { result: c.result ?? 'out', landing: c.landing };
}

// What the return was, for the call-out and the hand-play line only (never the eye-tracking score).
//   'winner': in, and perfectly timed or hit hard. 'in': a good return. 'out' / 'net'. 'framed': off the frame and not in.
//   null: not decided yet.
export function returnKind(st, hit) {
  let res = st.result;
  if (!res) {
    if (!st.rest) return null;
    res = 'out';
  }
  if (res === 'in') return hit.perfect || len(hit.v0 ?? hit.v) >= TIMING.winnerSpeed ? 'winner' : 'in';
  if (hit.frame) return 'framed';
  return res === 'back' ? 'out' : res;
}

// The flight of a ball until its first bounce (no net), for the perfect return's aim. Returns the bounce point's z.
function landingZ(p, v, w, side) {
  const st = launchReturn(p, v, w);
  st.crossed = true; // ignore the net here
  st.result = 'aim';
  for (let i = 0; i < 600 && st.bounces === 0 && !st.rest; i++) stepReturn(st, 0.01, side);
  return st.landing ? st.landing[1] : st.p[2];
}

// A perfectly timed return off the strings goes back deep and fast with topspin, in the direction the player sent it (left or
// right of straight, kept inside the singles lines). Returns { v, w } or null when the shot does not qualify.
export function perfectReturn(v, timing, hit, racketSpeed, from, side) {
  if (!timing || timing.zone !== 'perfect' || !hit || hit.frame || !(hit.u <= TIMING.perfectMaxU)) return null;
  if (!(racketSpeed >= TIMING.perfectMinRacketSpeed)) return null;
  if (!(v[2] < -1)) return null; // not going toward the server
  const yaw0 = Math.atan2(v[0], -v[2]);
  if (Math.abs(yaw0) > (TIMING.perfectMaxYawDeg * Math.PI) / 180) return null;
  const pl = courtPlan(side);
  const zT = pl.farZ + TIMING.perfectDepth;
  const dist = from[2] - zT;
  const lim = pl.halfSingles - TIMING.sideMargin;
  const xT = clamp(from[0] + Math.tan(yaw0) * dist, pl.cx - lim, pl.cx + lim);
  const yaw = Math.atan2(xT - from[0], dist);
  const speed = clamp(Math.max(TIMING.perfectExit, len(v)), 0, HIT.maxRacketSpeed);
  const dir = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const w = scale(cross([0, 1, 0], dir), TIMING.perfectSpin); // topspin: the top of the ball turns toward the server
  const vel = (el) => [dir[0] * Math.cos(el) * speed, Math.sin(el) * speed, dir[2] * Math.cos(el) * speed];
  // the bounce moves deeper as the ball is launched higher (in this range), so the angle is found by bisection
  let lo = (-4 * Math.PI) / 180;
  let hi = (22 * Math.PI) / 180;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (landingZ(from, vel(mid), w, side) > zT) lo = mid;
    else hi = mid;
  }
  let el = (lo + hi) / 2;
  // make sure it clears the net (it always should, deep and with this pace); lift it a degree at a time if not
  for (let i = 0; i < 12; i++) {
    const p = predictReturn(launchReturn(from, vel(el), w), side);
    if (p.result !== 'net') break;
    el += Math.PI / 180;
  }
  return { v: vel(el), w };
}

// ------------------------------------------------------------------ easy play: every return goes in
// Hand play is for fun: any ball the racket meets goes back over the net and lands in. The timing still shapes it: PERFECT goes
// back deep and fast with heavy topspin (a winner); early is pulled cross-court, late pushed the other way, a little shorter and
// slower. The player's own swing still picks the side when it sends the ball forward.
export const EASY = Object.freeze({
  maxYawDeg: 20, // at most this far off straight
  timingYawDeg: 12, // early / late at the edge of the timing scale turns the ball this much
  depth: [1.6, 3.6], // m inside the far baseline: perfect .. the edge of the timing scale
  speed: [31, 21], // m/s exit speed: perfect .. the edge (a perfect one is a winner, TIMING.winnerSpeed is not reached by the rest)
  minSpeed: 20,
  spin: [170, 120], // rad/s topspin
  sideMargin: 0.6, // m inside the singles sidelines
});

// Launch from `from` toward (xT, zT) at `speed` with topspin `spinMag`: the elevation is found by bisection so the first bounce
// is at zT, then lifted a degree at a time if the net would stop it. Returns { v, w }.
function aimReturn(from, xT, zT, speed, spinMag, side) {
  const dist = from[2] - zT;
  const yaw = Math.atan2(xT - from[0], dist);
  const dir = [Math.sin(yaw), 0, -Math.cos(yaw)];
  const w = scale(cross([0, 1, 0], dir), spinMag);
  const vel = (el) => [dir[0] * Math.cos(el) * speed, Math.sin(el) * speed, dir[2] * Math.cos(el) * speed];
  let lo = (-4 * Math.PI) / 180;
  let hi = (32 * Math.PI) / 180;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (landingZ(from, vel(mid), w, side) > zT) lo = mid;
    else hi = mid;
  }
  let el = (lo + hi) / 2;
  for (let i = 0; i < 12; i++) {
    const p = predictReturn(launchReturn(from, vel(el), w), side);
    if (p.result !== 'net') break;
    el += Math.PI / 180;
  }
  return { v: vel(el), w };
}

// physV: the ball's velocity straight off the racket (racketBounce); timing: timingOf(...); from: where it leaves the racket.
// Returns { v, w, perfect } for a return that lands in.
export function easyReturn(physV, timing, from, side) {
  const pl = courtPlan(side);
  const perfect = timing?.zone === 'perfect';
  const off = timing ? clamp(timing.off, -1, 1) : 0;
  const k = perfect ? 0 : Math.abs(off);
  const maxYaw = (EASY.maxYawDeg * Math.PI) / 180;
  let yaw = physV[2] < -2 ? Math.atan2(physV[0], -physV[2]) : 0;
  if (!perfect) yaw += (off * EASY.timingYawDeg * Math.PI) / 180; // early (off < 0) to the left, late to the right
  yaw = clamp(yaw, -maxYaw, maxYaw);
  const zT = pl.farZ + EASY.depth[0] + (EASY.depth[1] - EASY.depth[0]) * k;
  const lim = pl.halfSingles - EASY.sideMargin;
  const xT = clamp(from[0] + Math.tan(yaw) * (from[2] - zT), pl.cx - lim, pl.cx + lim);
  let speed = perfect ? clamp(Math.max(EASY.speed[0], len(physV)), 0, HIT.maxRacketSpeed) : clamp(EASY.speed[0] + (EASY.speed[1] - EASY.speed[0]) * Math.max(0.5, k), EASY.minSpeed, TIMING.winnerSpeed - 2);
  const spin = EASY.spin[0] + (EASY.spin[1] - EASY.spin[0]) * k;
  let best = null;
  for (let i = 0; i < 5; i++) {
    const r = aimReturn(from, xT, zT, speed, spin, side);
    best = r;
    if (predictReturn(launchReturn(from, r.v, r.w), side).result === 'in') break;
    speed = Math.max(EASY.minSpeed - 4, speed * 0.88); // slower always lands shorter and clears the net higher
  }
  return { ...best, perfect };
}

// The pulse in the hand: how strong (0..1) and how long (ms).
export function hapticFor(hit) {
  if (hit.frame) return { intensity: 0.4, ms: 30 };
  const k = clamp(hit.impact / 45, 0, 1);
  if (hit.sweet) return { intensity: 0.5 + 0.35 * k, ms: 40 }; // clean: the strings pocket the ball, little shock
  return { intensity: 0.7 + 0.3 * k, ms: 80 }; // off-centre: the racket twists, a longer buzz
}

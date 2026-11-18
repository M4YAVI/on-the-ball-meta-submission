// The racket swing of the PC control (desktop emulator only), as pure maths: where the racket and the free hand are for one swing
// value. A headset never uses this: there the racket follows the real hand. The game's own physics (core/racket-physics.js) then
// treats this racket exactly like a held one.
//
// One number drives the whole swing, `th` (radians in the hitting zone), moved only by the player (the wheel):
//   BACK (-1.7) the take-back: racket back beside the right hip, head up, out of view
//   READY (-1.05) the ready position between serves: racket up in front on the right, the free hand out in front (what a receiver
//                 sees of himself, like a first-person photo from the baseline)
//   0 contact: the sweet spot exactly on the look line at the ideal contact depth (TIMING.idealZ), the face square to the net
//   FINISH (2.6) the follow-through over the left shoulder, out of view; RECOVER (4.0) back to READY, low on the left and across
// Through the hitting zone (zone0..zone1) the racket turns about a fixed axis, the way a forearm and shoulder turn it: at contact
// the shaft points out to the side with the head a little above the wrist and the face moves straight at the ball, so meeting the
// ball early sends it cross-court (and off the outer strings), late sends it the other way. The racket also rises through the
// zone (low to high), which brushes up the back of the ball: topspin, as in a real forehand.
//
// The take-back path and the ready path differ: after a full take-back (`armed`) the forward swing goes straight from the
// take-back into the hitting zone; without one, the racket moves between READY and the zone. Both paths are the same pose at
// BACK and in the hitting zone, so switching between them never makes the racket jump.
//
// Forehand on the right (sgn +1) or two-handed backhand on the left (sgn -1, a mirror image, the free hand on the handle).

import { RACKET, TIMING } from './racket-physics.js';

export const SWING = Object.freeze({
  elevDeg: 26, // the shaft above horizontal at contact: the head a little above the wrist (a chest-high ball, seated)
  radius: 0.64, // m from the turning axis to the sweet spot
  wrap: 0, // past contact the arc's forward reach shrinks (1 + wrap * phi^2)...
  pull: 0, // ...and it comes back toward the body (pull * radius * (1 - cos phi)): the follow-through comes round, not out
  lift: 0.15, // m the racket rises per radian of turn through the hitting zone (low to high)
  liftMin: -0.12,
  liftMax: 0.2,
  closeDeg: -5, // the face a touch open at contact (negative: open), so a softer return still clears the net
  faceTurn: 0.3, // through the hitting zone the face turns this fraction as fast as the arc...
  faceTurnAfter: 0.3, // ...and this fraction once past contact (the forearm rolls over: the hand stays in, the head comes round)
  zone0: -0.6,
  zone1: 0.7,
  BACK: -1.7,
  READY: -1.05,
  FINISH: 2.6,
  RECOVER: 4.0,
  armBelow: -1.6, // a take-back this far arms the swing path
  backhandBelowX: -0.1, // look line left of this (m, at the contact depth): backhand
  lookX: [-0.75, 0.85],
  lookY: [-0.6, 0.15],
});

const SWEET = -RACKET.sweetZ; // hand to sweet spot along the shaft

// ------------------------------------------------------------------ small maths (arrays)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? scale(a, 1 / l) : [0, 0, -1];
};
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const ease = (u) => {
  const k = clamp(u, 0, 1);
  return k * k * (3 - 2 * k);
};
const mirror = (v) => [-v[0], v[1], v[2]];
const rad = (d) => (d * Math.PI) / 180;

// Rotate v about the unit axis a by angle t (Rodrigues).
function rotAxis(v, a, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return add(add(scale(v, c), scale(cross(a, v), s)), scale(a, dot(a, v) * (1 - c)));
}

// Quaternion [x, y, z, w] from an orthonormal basis (the columns X, Y, Z).
export function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m01 = Y[0], m02 = Z[0];
  const m10 = X[1], m11 = Y[1], m12 = Z[1];
  const m20 = X[2], m21 = Y[2], m22 = Z[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function slerpQ(a, b, t) {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  const r = [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
  const l = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0] / l, r[1] / l, r[2] / l, r[3] / l];
}

// A forehand-space pose: the hand (racket origin) p, the shaft direction s (hand to head), the face normal n (the side that
// faces the net). The racket frame of a forehand is X = -n (the palm behind the strings), Z = -s.
function frameQ(s, n, sgn) {
  const Z = scale(norm(s), -1);
  let X = sgn > 0 ? scale(n, -1) : n;
  X = norm(sub(X, scale(Z, dot(X, Z))));
  const Y = cross(Z, X);
  return quatFromBasis(X, Y, Z);
}
const blend = (a, b, t) => ({ p: lerp3(a.p, b.p, t), q: slerpQ(a.q, b.q, t) });

// Pose from a hand position and a shaft direction, with the face looking toward `toward` (made square to the shaft).
function keyPose(p, s, toward = [0, 0, -1]) {
  const sh = norm(s);
  const n = norm(sub(toward, scale(sh, dot(toward, sh))));
  return { p, s: sh, n };
}

// The fixed poses (forehand, eye frame). The look line never moves them; only the hitting zone follows the look.
const KEYS = {
  ready: keyPose([0.24, -0.4, -0.42], [-0.26, 0.86, -0.44]), // up in front on the right, the strings toward the net
  back: keyPose([0.52, -0.42, 0.08], [0.32, 0.62, 0.72], [-0.6, 0, -0.8]), // back beside the hip, head up, behind the view
  finish: keyPose([-0.38, -0.3, 0.05], [-0.2, 0.75, 0.63], [0.7, 0, 0.7]), // by the left shoulder, head up behind it, out of view
  down: keyPose([-0.06, -0.56, -0.22], [-0.8, -0.35, -0.5], [0.4, 0, -0.9]), // on the way back: low on the left, head down
};

// The racket on the turning arc at angle phi, for a forehand looking at (xl, yl).
// The axis is upright, so the face stays upright at every angle of the turn: an early or a late hit goes left or right, not up
// or down. (The shaft keeps its slope.)
// Through the hitting zone the sweet spot runs round the arc, but the face turns only `faceTurn` as fast: the wrist holds the
// face toward the target while the hand drives through the ball, as good players do ("hitting through the ball"). Outside the
// zone the face catches up with the arc.
function arcPose(phi, xl, yl) {
  const e = rad(SWING.elevDeg);
  const ce = Math.cos(e);
  const R = SWING.radius * ce; // the sweet spot's distance from the upright axis
  const inZone = clamp(phi, SWING.zone0, SWING.zone1);
  const ft = phi > 0 ? SWING.faceTurnAfter : SWING.faceTurn;
  const turn = phi - (1 - ft) * inZone; // the face's own turn
  const s = [ce * Math.cos(turn), Math.sin(e), -ce * Math.sin(turn)];
  let n = [-Math.sin(turn), 0, -Math.cos(turn)];
  const c = rad(SWING.closeDeg);
  if (c) n = rotAxis(n, norm(s), -c); // roll the racket about its shaft so the face looks a touch down (closed)
  const lift = clamp(SWING.lift * phi, SWING.liftMin, SWING.liftMax);
  // past contact the arc wraps round toward the body (the arm cannot carry the racket on forward; it comes across and up)
  const Rz = phi > 0 ? R / (1 + SWING.wrap * phi * phi) : R;
  const back = phi > 0 ? SWING.pull * R * (1 - Math.cos(phi)) : 0;
  const S = [xl - R * (1 - Math.cos(phi)), yl + lift, TIMING.idealZ - Rz * Math.sin(phi) + back];
  return { p: sub(S, scale(s, SWEET)), s, n };
}

function toPose(k, sgn) {
  if (sgn > 0) return { p: k.p, q: frameQ(k.s, k.n, 1) };
  return { p: mirror(k.p), q: frameQ(mirror(k.s), mirror(k.n), -1) };
}

// The racket's pose (anchor / eye frame, {p, q}) for swing value th. armed: the swing path (after a take-back). look: [x, y]
// where the look line crosses the contact depth. sgn: +1 forehand, -1 backhand.
// Two forehand-space poses mixed: the hand moves straight between them, and the shaft and the face turn between them (the
// directions are mixed and squared up again, which never flips the way a quaternion's shortest path can).
function blendK(a, b, t) {
  const s = norm(lerp3(a.s, b.s, t));
  const n0 = lerp3(a.n, b.n, t);
  const n = norm(sub(n0, scale(s, dot(n0, s))));
  return { p: lerp3(a.p, b.p, t), s, n };
}

// Outside the hitting zone the arc runs on a little (the racket keeps its speed into the follow-through and comes into the
// zone with speed) before the fixed poses take over; it never runs on round in front of the face.
const RUN_ON = 0.35;
const ACROSS = [0, -0.12, -0.1]; // m: how far below and out the follow-through passes, at most

function racketKey(th, armed, xl, yl) {
  const { zone0, zone1, BACK, READY, FINISH, RECOVER } = SWING;
  const K = KEYS;
  const arc = (phi) => arcPose(phi, xl, yl);
  if (th <= BACK) return K.back;
  if (th >= RECOVER) return K.ready;
  if (th > FINISH) {
    // back to the ready position: first down and away from the face on the left, then low across to the right, never up across
    // the middle of the view (the server is there)
    const u = (th - FINISH) / (RECOVER - FINISH);
    return u < 0.5 ? blendK(K.finish, K.down, ease(u * 2)) : blendK(K.down, K.ready, ease(u * 2 - 1));
  }
  if (th > zone1) {
    // into the finish: the hand comes across below the chin and out in front, not straight past the face
    const u = (th - zone1) / (FINISH - zone1);
    const k = blendK(arc(Math.min(th, zone1 + RUN_ON)), K.finish, ease(u));
    return { ...k, p: add(k.p, scale(ACROSS, Math.sin(Math.PI * Math.min(1, u)))) };
  }
  if (th >= zone0) return arc(th);
  // both paths reach the take-back exactly where a take-back arms the swing (armBelow), so the switch never shows
  const arm = SWING.armBelow;
  if (th <= arm) return K.back;
  if (armed) return blendK(arc(Math.max(th, zone0 - RUN_ON)), K.back, ease((zone0 - th) / (zone0 - arm)));
  if (th >= READY) return blendK(arc(zone0), K.ready, ease((zone0 - th) / (zone0 - READY)));
  return blendK(K.ready, K.back, ease((READY - th) / (READY - arm)));
}

export function racketPose(th, armed, look, sgn = 1) {
  const xl = clamp(look[0], ...SWING.lookX) * sgn; // a backhand is worked out as a mirrored forehand
  const yl = clamp(look[1], ...SWING.lookY);
  return toPose(racketKey(th, armed, xl, yl), sgn);
}

// The free (left) hand. Its frame is the left hand's grip space: palm toward +X, fingers along -Y. shape: 'open' (out in front,
// then tucked in through the shot) or 'fist' (a two-handed backhand: on the handle just above the right hand).
const hand = (p, f, palm) => {
  const X = norm(palm);
  const Y = norm(sub(scale(f, -1), scale(X, dot(scale(f, -1), X))));
  return { p, q: quatFromBasis(X, Y, cross(X, Y)) };
};
const FREE = {
  ready: hand([-0.2, -0.42, -0.5], [0.22, 0.12, -1], [0.25, -0.95, 0.1]), // relaxed, out in front, low on the left
  back: hand([-0.06, -0.3, -0.6], [0.12, 0.28, -1], [0.3, -0.92, 0.25]), // the unit turn: the arm out toward the ball
  contact: hand([-0.42, -0.62, -0.16], [0.2, -0.3, -1], [0.6, -0.6, 0.4]), // pulled in to the left side, out of view
  finish: hand([-0.27, -0.3, 0.0], [0.45, 0.65, -0.25], [0.8, 0.1, 0.55]), // at the chest, under the racket
};
const BH_GRIP = 0.095; // m up the handle from the right hand to the left (two-handed backhand)

export function freeHandPose(th, armed, look, sgn = 1) {
  if (sgn < 0) {
    const r = racketPose(th, armed, look, sgn);
    // the left hand's grip frame on the handle is the racket's own frame, a hand's width toward the head
    const Zr = rotateQ(r.q, [0, 0, 1]);
    return { p: sub(r.p, scale(Zr, BH_GRIP)), q: r.q, shape: 'fist' };
  }
  const { zone0, zone1, BACK, READY, FINISH, RECOVER } = SWING;
  let o;
  if (th <= BACK) o = FREE.back;
  else if (th >= RECOVER) o = FREE.ready;
  else if (th > FINISH) o = blend(FREE.finish, FREE.ready, ease((th - FINISH) / (RECOVER - FINISH)));
  else if (th > zone1) o = blend(FREE.contact, FREE.finish, ease((th - zone1) / (FINISH - zone1)));
  else if (th >= zone0) o = FREE.contact;
  else if (armed) o = blend(FREE.back, FREE.contact, ease((th - BACK) / (zone0 - BACK)));
  else if (th >= READY) o = blend(FREE.ready, FREE.contact, ease((th - READY) / (zone0 - READY)));
  else o = blend(FREE.back, FREE.ready, ease((th - BACK) / (READY - BACK)));
  return { ...o, shape: 'open' };
}

export function rotateQ(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

// ------------------------------------------------------------------ the PC swing's motion and its timing help
// The swing value follows the wheel's target through a stiff spring with a top speed (xr/mouse-racket.js).
export const DRIVE = Object.freeze({
  spring: 30, // 1/s: how fast the racket follows the wheel
  maxRate: 26, // rad/s: the fastest the PC swing turns (a hard club forehand at the sweet spot, about 17 m/s)
  // Easy timing: a forward roll up to `buffer` s before the swing must start is held (the racket waits in the take-back) and
  // let go so the racket meets the ball. Up to `perfectBuffer` s early it meets it at the ideal point; earlier than that it
  // meets it a little out in front (an EARLY hit: `earlyM` metres out). A later roll swings at once (it may be LATE).
  buffer: 1.0,
  perfectBuffer: 0.5,
  earlyM: 0.5,
  perfectM: -0.1, // m: an on-time roll is let go this much later (the strings reach the ball a touch before the sweet spot does)
  recoverRate: 3.5, // rad/s: after a held swing, the finish comes back round to the ready position by itself
});

// Move the swing state { th, w } toward target for dt seconds (sub-stepped, so any frame rate gives the same motion).
export function driveSwing(st, target, dt) {
  if (!(dt > 0)) return st;
  const n = Math.ceil(dt / 0.004);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = DRIVE.spring * DRIVE.spring * (target - st.th) - 2 * DRIVE.spring * st.w;
    st.w = clamp(st.w + a * h, -DRIVE.maxRate, DRIVE.maxRate);
    st.th += st.w * h;
  }
  return st;
}

// Seconds a full swing (target FINISH) takes from { th, w } until the racket reaches contact (th = 0).
export function timeToContact(th, w = 0) {
  if (th >= 0) return 0;
  const st = { th, w };
  const h = 0.001;
  let t = 0;
  while (st.th < 0 && t < 1) {
    driveSwing(st, SWING.FINISH, h);
    t += h;
  }
  return t;
}

// The PC swing value with its timing help. roll(d): the wheel moved d radians (positive: forward). setBall(key, eta, speed):
// the live serve (key: anything that changes from one serve to the next; eta: seconds until it reaches the contact depth at the
// end of the coming step; speed: m/s there), or setBall(null) when none. step(dt): move on dt seconds.
export class PcSwing {
  constructor() {
    this.reset();
  }

  reset() {
    this.st = { th: SWING.READY, w: 0 };
    this.target = SWING.READY;
    this.armed = false;
    this.ball = null;
    this.hold = null;
    this.used = false;
    this.recover = false;
  }

  get th() {
    return this.st.th;
  }

  get w() {
    return this.st.w;
  }

  setBall(key, eta = 0, speed = 25) {
    if (key == null) {
      this.ball = null;
      this.hold = null;
      return;
    }
    if (!this.ball || this.ball.key !== key) {
      this.used = false;
      this.hold = null;
    }
    this.ball = { key, eta, speed };
  }

  roll(d) {
    if (!(d !== 0) || this.hold) return;
    if (d > 0 && this.ball && !this.used && this.st.th < SWING.zone0) {
      const early = this.ball.eta - timeToContact(SWING.BACK);
      if (early > 0 && early <= DRIVE.buffer) {
        // held: the racket goes into the take-back and waits for the ball
        this.used = true;
        this.hold = { shift: (early > DRIVE.perfectBuffer ? DRIVE.earlyM : DRIVE.perfectM) / Math.max(5, this.ball.speed) };
        this.target = SWING.BACK;
        return;
      }
    }
    this.target = clamp(this.target + d, SWING.BACK, SWING.RECOVER);
  }

  step(dt) {
    if (!(dt > 0)) return;
    let rest = dt;
    if (this.hold && this.ball) {
      // let go at the moment that brings the racket to contact when the ball gets there (sub-frame exact)
      const lead = timeToContact(this.st.th, this.st.w);
      const wait = this.ball.eta + dt - this.hold.shift - lead; // eta is for the END of this step
      if (wait < dt) {
        if (wait > 0) driveSwing(this.st, this.target, wait);
        rest = dt - Math.max(0, wait);
        this.hold = null;
        this.target = SWING.FINISH;
        this.recover = true;
      }
    }
    // after a held swing the racket comes back to the ready position by itself, at an easy pace
    if (this.recover && !this.hold && this.st.th >= SWING.FINISH - 0.05) this.target = Math.min(SWING.RECOVER, Math.max(this.target, SWING.FINISH) + DRIVE.recoverRate * dt);
    driveSwing(this.st, this.target, rest);
    if (this.ball) this.ball.eta -= dt;
    // past the recovery the racket is back at the ready position: the same pose, so the swing value wraps round
    if (this.st.th >= SWING.RECOVER - 0.02 && this.target >= SWING.RECOVER - 0.02) {
      this.st.th = this.target = SWING.READY;
      this.st.w = 0;
      this.recover = false;
    }
    if (this.st.th <= SWING.armBelow) this.armed = true;
    else if (this.st.th >= SWING.zone0) this.armed = false;
  }
}

// Which stroke the look line asks for, with a little hysteresis so it does not flicker on a ball down the middle.
export function strokeFor(lookX, current = 1) {
  const edge = SWING.backhandBelowX;
  if (current > 0) return lookX < edge - 0.04 ? -1 : 1;
  return lookX > edge + 0.04 ? 1 : -1;
}

// The sweet spot (eye frame) of a racket pose.
export function sweetSpot(pose) {
  return add(pose.p, rotateQ(pose.q, [0, 0, RACKET.sweetZ]));
}

// The PC (desktop emulator) bat swing as pure maths: where the bat is for a look line and a swing angle. src/xr/mouse-bat.js
// reads the mouse and the wheel and calls this; the tests and the offline batting simulator call it directly. A headset never
// uses it: there the bat follows the real hand.
//
// Frames: the scene's eye frame (x right, y up from the eyes, z negative toward the bowler). The bat frame is bat-physics.js's:
// -Z along the blade toward the toe, -X the way the face looks.
//
// What a batsman sees of his own bat (first person, eyes on the bowler, a headset's 90 degree view): his gloves at the very
// bottom of the view, cut off by its lower edge, big because they are close, and the bat going away from them forward and out
// over the pitch, foreshortened. Never a whole bat in the middle of the view. The hands are at the waist, a little in front of
// the body: about 0.5 m below the eyes and 0.55 m forward, which is right at the lower edge of the view.
//
// The swing angle th (degrees): 0 = blade hanging down (and out to the side, LEAN), + = swung forward, - = lifted back.
//   - backlift (th < STANCE): the bat turns about the hands, up behind, and the hands go back to the back hip;
//   - the stance (th = STANCE): the blade forward and down over the pitch, the gloves at the bottom edge of the view;
//   - the hit zone (STANCE .. FINISH_FROM): the hands PUSH THROUGH along the ball's line, down the pitch, while the blade stays
//     nearly upright, as a batsman's do in a drive. (An earlier version only kept turning the bat about the hands: by the time it
//     reached the ball the blade pointed at the bowler and the face looked at the sky, so a middled ball flew straight up or
//     back over the batsman's head.) Now the face meets the ball square and only a little open, the bat travels toward the
//     bowler, and a well-timed ball goes back past him;
//   - the follow-through (past FINISH_FROM): the hands go up and across to the front shoulder and the bat over it, out of view.
// Nothing here moves by itself: th and the look line come from the player's wheel and eyes (or head).

import { BAT, batToWorld } from './bat-physics.js';

export const PC_SWING = Object.freeze({
  PLANE_Z: -1.0, // m in front of the eyes: where the look line is read (about where the ball is played)
  HANDS_Y: -0.46,
  HANDS_Z: -0.55,
  X_MIN: -0.75,
  X_MAX: 0.85,
  LEAN: 40, // degrees the blade leans out to the off side in the stance (gloves on the left, blade out to the right)
  LEAN_HIT: 22, // and in the hit zone, where the bat comes more upright
  STANCE: 30,
  BACKLIFT_MAX: -100,
  FOLLOW_THROUGH: 125, // the end of the wheel: just past where the bat has left the view
  LIFT_HANDS: Object.freeze({ dx: 0.1, dy: -0.1, dz: 0.4 }), // at the top of the backlift: by the back hip, below the view
  // Hit zone: from the stance to FINISH_FROM the hands push PUSH m down the pitch and drop DROP m, the blade only tips forward
  // from STANCE to HIT_TILT degrees and comes more upright (LEAN to LEAN_HIT).
  PUSH: 0.6,
  DROP: 0.04,
  REACH_DOWN: 0.2, // m the hands can go down (a half-volley at the knee) or up (a ball at the hip) to the looked-at height
  REACH_UP: 0.15,
  HIT_TILT: 34,
  FINISH_FROM: 80, // degrees: the end of the hit zone
  FINISH_SPAN: 45,
  // Two key poses (anchor frame, absolute): halfway, the hands across in front of the chest and the bat swung up to the left;
  // at the finish, the hands beside the front shoulder and the blade up and back over it, out of the view.
  FINISH_KEYS: Object.freeze([
    Object.freeze({ hands: { x: -0.3, y: -0.36, z: -0.42 }, dir: { x: -0.75, y: 0.55, z: -0.2 }, face: { x: -0.2, y: -0.3, z: -0.9 } }),
    Object.freeze({ hands: { x: -0.36, y: -0.2, z: 0.02 }, dir: { x: -0.35, y: 0.62, z: 0.7 }, face: { x: -0.8, y: -0.4, z: 0.1 } }),
  ]),
  DEG_PER_PX: 0.55, // swing per pixel of scroll (one mouse-wheel notch is about 100 px, so one notch is a real swing, two a full one)
  SPRING: 85, // 1/s: how fast the bat follows the wheel (a hard flick gives a fast shot, a slow roll a gentle one)
  YAW_PER_M: 55, // degrees the swing turns toward the side the bat is on, per metre off centre (off / leg side shots)
  // Where the bat goes for a look line, measured with the offline batting simulator over every lane, length, swing and speed:
  // a ball wide of the stumps is met a little further out than the eyes' line at the bat's depth (AIM_GAIN; the face turns
  // toward that side), and a few cm toward the off side (AIM_OFFSET, m) centres the band of looks that still hit on the ball.
  // With these every lane is as easy as the others, and a look up to 8 cm off the ball still hits.
  AIM_GAIN: 1.15,
  AIM_OFFSET: 0.035,
});

const D = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const ease = (u) => u * u * (3 - 2 * u);

// Rotation (quaternion [x, y, z, w]) whose columns are the given orthonormal axes (as Three.js makeBasis + setFromRotationMatrix).
export function quatFromBasis(X, Y, Z) {
  const [m11, m21, m31] = X;
  const [m12, m22, m32] = Y;
  const [m13, m23, m33] = Z;
  const tr = m11 + m22 + m33;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

// The bat's rotation for a blade direction (toward the toe) and a face direction (made perpendicular to the blade).
function batQuat(bd, face) {
  const f = norm(add(face, sc(bd, -dot(face, bd))));
  const Z = sc(bd, -1);
  const X = sc(f, -1);
  return quatFromBasis(X, cross(Z, X), Z);
}

function slerp(a, b, t) {
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
  const l = Math.hypot(...r) || 1;
  return r.map((c) => c / l);
}

const KEYS = PC_SWING.FINISH_KEYS.map((k) => ({
  h: k.hands,
  q: batQuat(norm([k.dir.x, k.dir.y, k.dir.z]), [k.face.x, k.face.y, k.face.z]),
}));

// The look line -> the bat's line across the pitch: where a ray from the eyes (o, d in the eye frame) crosses the depth z.
// The ball is looked at along a slanting line (it is below and to the side of the eyes), so the depth matters: read it where
// the middle of the bat is now, and the middle of the bat is on the ball's line wherever the bat meets it.
export function lookX(o, d, z = PC_SWING.PLANE_Z) {
  let x = 0;
  if (d[2] < -1e-3) x = o[0] + ((z - o[2]) / d[2]) * d[0];
  return clamp(x, PC_SWING.X_MIN, PC_SWING.X_MAX);
}

// Depth (eye frame z) of the bat's sweet spot at a swing angle, kept to the hitting area in front of the body.
export function sweetDepth(thDeg, S = PC_SWING) {
  const z = batToWorld(pcBatPose(0, thDeg, S), [0, 0, BAT.sweetZ])[2];
  return clamp(z, -1.6, -0.5);
}

// The bat's pose for a look ray (o, d in the eye frame) and a swing angle. The look ray is read at the depth of the bat's
// middle: there it gives the line across (x) and the height (y) of what the player looks at. The middle of the bat goes on that
// line, and through the hit zone the hands reach up or down so the middle is at that height too: look at the ball and swing,
// and the middle of the bat meets it. The stance and the backlift never move with the look's height.
export function pcBatPoseFromLook(o, d, thDeg, S = PC_SWING) {
  const z = sweetDepth(thDeg, S);
  const x = clamp(lookX(o, d, z) * (S.AIM_GAIN ?? 1) + (S.AIM_OFFSET ?? 0), S.X_MIN, S.X_MAX);
  if (!(d[2] < -1e-3)) return pcBatPose(x, thDeg, S);
  const y = o[1] + ((z - o[2]) / d[2]) * d[1];
  const sweetY = batToWorld(pcBatPose(x, thDeg, S), [0, 0, BAT.sweetZ])[1];
  const hit = clamp((thDeg - S.STANCE) / (S.FINISH_FROM - S.STANCE), 0, 1);
  const push = ease(hit);
  // pcBatPose scales the reach by the push (none in the stance, all of it at the end of the hit zone)
  const reach = push > 1e-3 ? (y - sweetY) / push : 0;
  return pcBatPose(x, thDeg, S, reach);
}

// The bat's pose {p: hands [x, y, z], q: [x, y, z, w]} for a look line x (m across at PLANE_Z) and a swing angle th (degrees).
// reach: metres the hands go up (+) or down (-) through the hit zone, toward the height the player looks at (0 in the stance).
export function pcBatPose(x, thDeg, S = PC_SWING, reach = 0) {
  const hit = clamp((thDeg - S.STANCE) / (S.FINISH_FROM - S.STANCE), 0, 1); // 0 at the stance .. 1 at the end of the hit zone
  const push = ease(hit);
  // Blade angle forward from hanging: the swing angle itself up to the stance, then only a little more through the hit zone.
  const phiDeg = thDeg <= S.STANCE ? thDeg : S.STANCE + (S.HIT_TILT - S.STANCE) * push;
  const phi = phiDeg * D;
  const leanDeg = S.LEAN + (S.LEAN_HIT - S.LEAN) * push;
  const lean = leanDeg * D;
  const cl = Math.cos(lean);
  const psi = clamp(x * S.YAW_PER_M, -30, 30) * D;
  const f = [Math.sin(psi), 0, -Math.cos(psi)]; // forward, down the ball's line
  const r = [Math.cos(psi), 0, Math.sin(psi)]; // across, to the off side
  // toward the toe: down-and-out (the lean) at phi = 0, tipped forward or back about the hands
  const bd = add(add([0, -cl * Math.cos(phi), 0], sc(r, Math.sin(lean) * Math.cos(phi))), sc(f, Math.sin(phi)));
  // the face: square to the ball's line (no sideways tilt), perpendicular to the blade, leading the swing
  const bn = norm(add([0, Math.sin(phi), 0], sc(f, cl * Math.cos(phi))));
  let q = batQuat(bd, bn);
  // The sweet spot sits on the look line: the hands shift across so it does, whatever the swing angle (so the middle of the bat
  // travels straight down the ball's line and the face stays square: the lean is a look, it does not pull shots sideways).
  const p = [x - bd[0] * -BAT.sweetZ, S.HANDS_Y, S.HANDS_Z];
  const lift = ease(clamp(-thDeg / -S.BACKLIFT_MAX, 0, 1));
  p[0] += S.LIFT_HANDS.dx * lift;
  p[1] += S.LIFT_HANDS.dy * lift;
  p[2] += S.LIFT_HANDS.dz * lift;
  // the push through: straight down the pitch (so the middle of the bat stays on the look line), a little down, and up or down
  // to the height the player is looking at (a half-volley is met with the hands low, a ball at the hip with them higher)
  p[1] += (clamp(reach, -S.REACH_DOWN, S.REACH_UP) - S.DROP) * push;
  p[2] -= S.PUSH * push;
  // Follow-through: from the end of the hit zone through the two key poses, then held there.
  const u = clamp((thDeg - S.FINISH_FROM) / S.FINISH_SPAN, 0, 1);
  if (u > 0) {
    const seg = u < 0.5 ? 0 : 1;
    const k = ease(seg === 0 ? u * 2 : u * 2 - 1);
    if (seg === 1) {
      const a = KEYS[0];
      p[0] = a.h.x;
      p[1] = a.h.y;
      p[2] = a.h.z;
      q = a.q.slice();
    }
    const b = KEYS[seg];
    q = slerp(q, b.q, k);
    p[0] += (b.h.x - p[0]) * k;
    p[1] += (b.h.y - p[1]) * k;
    p[2] += (b.h.z - p[2]) * k;
  }
  return { p, q };
}

// The wheel's spring: the bat follows the wheel's target like a quick, critically damped spring (a hand has weight too), in
// small steps so it is steady at any frame rate. state: {th, w}. Never moves without a target from the wheel.
export function springStep(state, target, dt, spring = PC_SWING.SPRING) {
  if (!(dt > 0)) return state;
  const n = Math.ceil(Math.min(dt, 0.1) / 0.004);
  const h = Math.min(dt, 0.1) / n;
  for (let i = 0; i < n; i++) {
    const a = spring * spring * (target - state.th) - 2 * spring * state.w;
    state.w += a * h;
    state.th += state.w * h;
  }
  return state;
}

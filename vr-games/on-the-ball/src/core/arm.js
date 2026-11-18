// Where the player's arm is, from where the hand is (pure; no three.js). A controller or a tracked hand only
// says where the HAND is, so the elbow and the shoulder are solved the way a body works, from real body measurements.
//
// Measurements: ANSUR II (the US Army's 2012 anthropometric survey), means of its 4,082 men:
//   radiale-stylion length (elbow to wrist)            268 mm  -> forearm
//   acromion-radiale length (shoulder tip to elbow)    335 mm  -> 315 mm from the shoulder JOINT's centre
//   biacromial breadth                                  416 mm  -> joint centres 180 mm either side of the middle
//   acromion below ear / eye level (stature - tragion-to-top-of-head - acromial height)  184 mm -> joint centre 220 mm below
//   wrist circumference 176 mm, forearm (flexed) 310 mm, biceps (flexed) 358 mm  -> the arm's thickness (xr/hands.js)
// Frame: the eye frame (x right, y up, z back toward the player; the court is toward -z), metres.

export const BODY = Object.freeze({
  forearm: 0.268,
  upper: 0.315,
  shoulderX: 0.18,
  shoulderY: -0.22,
  shoulderZ: 0.07, // the shoulder joint sits a little behind the eyes
  // Near full reach the shoulder comes toward the hand: the trunk turns into the shot (about 45 degrees takes the shoulder
  // 0.13 m forward), the trunk bends forward a little and the shoulder blade slides forward. Never more than this.
  lean: 0.25,
  leanFrom: 0.8, // of full reach, where the lean starts
  forward: 0.15, // m: the most the shoulder comes forward of where it stands (it never floats out in front of the eyes)
});

const smooth = (x) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

// wrist: [x,y,z] (eye frame); side: 'right' | 'left'; head: [x,y,z] the head's offset from the eye frame's origin (the body
// stands under the head), or null. Returns { shoulder, elbow, outOfReach, reach }. The forearm (the part a player sees) always
// keeps its length. If the hand is further than any arm reaches (an emulator can put it anywhere: outOfReach), the arm is
// straight and the drawn upper arm spans on to the shoulder, which is out of view below and behind the eyes.
export function solveArm(wrist, side, head = null) {
  const sx = side === 'left' ? -1 : 1;
  const s = [sx * BODY.shoulderX, BODY.shoulderY, BODY.shoulderZ];
  if (head) for (let i = 0; i < 3; i++) s[i] += head[i];
  const base = s.slice();
  const a = BODY.forearm;
  const b = BODY.upper;
  const reach = a + b;
  let u = [s[0] - wrist[0], s[1] - wrist[1], s[2] - wrist[2]];
  let d = Math.hypot(u[0], u[1], u[2]) || 1e-6;
  u = u.map((c) => c / d);
  // the lean: the shoulder comes toward the hand as the arm nears full reach
  const from = BODY.leanFrom * reach;
  const shift = BODY.lean * smooth((d - from) / (reach + BODY.lean - from));
  for (let i = 0; i < 3; i++) s[i] -= u[i] * shift;
  // the trunk can bring the shoulder only so far forward while the head stays where it is
  if (s[2] < base[2] - BODY.forward) s[2] = base[2] - BODY.forward;
  u = [s[0] - wrist[0], s[1] - wrist[1], s[2] - wrist[2]];
  d = Math.hypot(u[0], u[1], u[2]) || 1e-6;
  u = u.map((c) => c / d);
  // a hand right at the shoulder (closer than a fully bent arm allows): the shoulder gives way
  const nearest = b - a + 1e-3;
  if (d < nearest) {
    for (let i = 0; i < 3; i++) s[i] = wrist[i] + u[i] * nearest;
    d = nearest;
  }
  const elbow = [0, 0, 0];
  const outOfReach = d >= reach - 1e-4;
  if (outOfReach) {
    // out of reach: a straight arm of its real length from the hand back toward the shoulder (it ends short of it)
    for (let i = 0; i < 3; i++) elbow[i] = wrist[i] + u[i] * a;
  } else {
    // two bones: the elbow hangs down, a little out and back (the natural elbow; never a raised "chicken wing")
    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    let p = [0.3 * sx, -1, 0.35];
    let dot = p[0] * u[0] + p[1] * u[1] + p[2] * u[2];
    p = p.map((c, i) => c - dot * u[i]);
    let pl = Math.hypot(p[0], p[1], p[2]);
    if (pl < 1e-3) {
      p = [sx, 0, 0];
      dot = p[0] * u[0];
      p = p.map((c, i) => c - dot * u[i]);
      pl = Math.hypot(p[0], p[1], p[2]) || 1;
    }
    for (let i = 0; i < 3; i++) elbow[i] = wrist[i] + u[i] * a * cosA + (p[i] / pl) * a * sinA;
  }
  return { shoulder: s, elbow, outOfReach, reach: d / reach };
}

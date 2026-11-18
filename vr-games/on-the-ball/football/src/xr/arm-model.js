// The keeper's arms: a dark goalkeeper jersey sleeve that runs from the glove's cuff up to the elbow and the shoulder, so the
// gloves are on a body and not floating. Seen from behind, like the picture it follows: a plain deep-navy sleeve with a soft
// fabric sheen and one pale sky-blue stripe near the cuff, and the glove's own backhand beyond it.
//
// Two parts, because a real wrist bends and a glove model that is rigid cannot:
//   - the STUB: a short straight length of sleeve that is a child of the glove (see glove-model.js), so the cuff always has an
//     arm coming out of it, whichever way the glove turns;
//   - the ARM: forearm and upper arm in the scene anchor's frame, solved every frame with two-bone IK between the shoulder (below
//     and beside the head) and the end of the stub, so the elbow hangs low and out like a real one. When the hands are further
//     than a real arm reaches (the PC control puts them about a metre out) the shoulder leans in, then only the out-of-view
//     upper arm spans the rest: the forearm in view always keeps its real length, and the arm never comes apart.
//
// Purely drawn: nothing here is used by the save test.

import { CylinderGeometry, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from '@iwsdk/core';
import { BODY } from '../../../src/core/arm.js';

// The whole glove model is drawn this much bigger than its modelled size: a pro keeper glove is bulky, and the latex
// palm and roll fingers are well past the hand. Only drawing: the save test uses GLOVE in core/goalkeeping.js.
export const GLOVE_SCALE = 1.12;

// The glove's local frame (see glove-model.js, before GLOVE_SCALE): the wrist cuff ends at y = -0.12; the stub carries on.
export const STUB = Object.freeze({ top: -0.115, len: 0.055, z: -0.013 });
export const STUB_END = Object.freeze([0, STUB.top - STUB.len, STUB.z]); // the glove-local point the arm joins

const OVAL_X = 1.14; // a forearm is wider than it is deep, the same oval as the cuff
const OVAL_Z = 0.8;
const R_WRIST = 0.0405; // in the glove's frame (the stub); the forearm meets it at R_WRIST * GLOVE_SCALE
const R_FORE_WRIST = R_WRIST * GLOVE_SCALE;
const R_ELBOW = 0.058;
const R_SHOULDER = 0.064;
// Real adult proportions, the same body as cricket and tennis (../../../src/core/arm.js, ANSUR II means of 4,082 men).
// Elbow to the centre of the grip (ANSUR "forearm-center of grip length") is 0.349 m; the end of the sleeve stub is already
// (0.115 + 0.055) * GLOVE_SCALE = 0.19 m down the arm from the palm centre, so the forearm drawn from there to the elbow is
// the rest: 0.159 m. Shoulder joint to elbow: 0.315 m. Shoulders 0.18 m either side, 0.22 m below the eyes; a keeper's set
// position leans forward, so they sit only a little behind the eyes.
const L_UPPER = BODY.upper;
const L_FORE = 0.349 - 0.19;
const MAX_LEAN = 0.3; // m the shoulder may come forward when a hand reaches further than the arm (a keeper stretching)
const SHOULDER_DROP = -BODY.shoulderY; // m below the eyes
const SHOULDER_SIDE = BODY.shoulderX; // m to each side of the head
const SHOULDER_BACK = 0.03; // m behind the eyes

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // A clean, plain jersey sleeve: deep navy, with the soft sheen of a sports fabric at the edges (no printed pattern: at arm's
  // length any pattern turns to noise in a headset).
  const sleeve = new MeshPhysicalMaterial({ color: '#141c33', roughness: 0.62, metalness: 0, sheen: 0.7, sheenRoughness: 0.55, sheenColor: '#4b5f94' });
  // one pale sky-blue stripe round the sleeve near the cuff, like a keeper's jersey
  const stripe = new MeshStandardMaterial({ color: '#bfe3f7', roughness: 0.5, metalness: 0 });
  // unit tubes along +Y from y = 0 to y = 1 (scaled to length per use): a tapered forearm and a round upper arm
  const fore = new CylinderGeometry(R_FORE_WRIST, R_ELBOW, 1, 28, 1, false);
  fore.translate(0, 0.5, 0);
  const upper = new CylinderGeometry(R_ELBOW, R_SHOULDER, 1, 24, 1, false);
  upper.translate(0, 0.5, 0);
  const stub = new CylinderGeometry(R_WRIST, R_WRIST, 1, 24, 1, false); // hangs down from y = 0 to y = -1
  stub.translate(0, -0.5, 0);
  // the stripe: a short wide band hugging the stub (open cylinder a hair bigger than it)
  const band = new CylinderGeometry(R_WRIST + 0.0012, R_WRIST + 0.0012, 1, 28, 1, true);
  SHARED = {
    sleeve,
    stripe,
    fore,
    upper,
    stub,
    band,
    ball: new SphereGeometry(1, 24, 16),
  };
  return SHARED;
}

// The straight sleeve stub for a glove model: from the cuff's lower edge, straight along the glove's -Y, with the two bands.
// A child of the glove, in its local frame.
export function createSleeveStub() {
  const S = shared();
  const g = new Group();
  g.name = 'sleeve-stub';
  // hangs down from the cuff's lower edge, the same radius all the way so it joins the forearm cleanly
  const tube = new Mesh(S.stub, S.sleeve);
  tube.scale.set(OVAL_X, STUB.len, OVAL_Z);
  tube.position.set(0, STUB.top, STUB.z);
  g.add(tube);
  const stripe = new Mesh(S.band, S.stripe);
  stripe.scale.set(OVAL_X, 0.014, OVAL_Z); // 1.4 cm wide
  stripe.position.set(0, STUB.top - 0.03, STUB.z);
  g.add(stripe);
  return g;
}

const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();

// Stand a unit tube on `a` pointing at `b`, its X axis kept as close to xHint as the direction allows (so the oval lines up).
function place(mesh, a, b, xHint, thick = 1) {
  _y.subVectors(b, a);
  const len = _y.length();
  if (len < 1e-5) return;
  _y.divideScalar(len);
  _x.copy(xHint).addScaledVector(_y, -xHint.dot(_y));
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position.copy(a);
  mesh.scale.set(thick, len, thick);
}

/** One arm: forearm + elbow + upper arm, solved between a shoulder and the end of the glove's sleeve stub. */
export class Arm {
  constructor(side) {
    const S = shared();
    this.side = side;
    this.out = side === 'left' ? -1 : 1; // which way is outward (x, in the anchor frame)
    this.group = new Group();
    this.group.name = `otb-arm-${side}`;
    this.fore = new Mesh(S.fore, S.sleeve);
    this.upper = new Mesh(S.upper, S.sleeve);
    this.elbow = new Mesh(S.ball, S.sleeve);
    this.wrist = new Mesh(S.ball, S.sleeve);
    this.shoulderBall = new Mesh(S.ball, S.sleeve); // rounds off the top of the upper arm: no cut-off tube end from any angle
    this.group.add(this.fore, this.upper, this.elbow, this.wrist, this.shoulderBall);
    this.group.visible = false;
    this.e = new Vector3(); // the elbow, anchor frame
    this.s = new Vector3(); // the shoulder actually used (brought forward when the hand reaches far)
    this.dir = new Vector3();
    this.perp = new Vector3();
    this.pole = new Vector3();
    this.xHint = new Vector3(1, 0, 0);
  }

  /**
   * @param {Vector3} shoulder anchor frame
   * @param {Vector3} joint where the glove's sleeve stub ends, anchor frame
   * @param {Vector3} xHint the glove's own x axis (anchor frame), so the oval sleeve lines up with the cuff
   */
  update(shoulder, joint, xHint) {
    this.dir.subVectors(joint, shoulder);
    let d = this.dir.length();
    if (!(d > 1e-4) || !Number.isFinite(d)) {
      this.group.visible = false;
      return;
    }
    this.dir.divideScalar(d);
    // The arm is always a real arm's length. A hand further out than it reaches brings the shoulder forward (a keeper leans and
    // stretches), so the arm never grows; only past that lean is it drawn straight.
    const reach = 0.985 * (L_UPPER + L_FORE);
    let d2 = d;
    this.s.copy(shoulder);
    if (d2 > reach) {
      const lean = Math.min(MAX_LEAN, d2 - reach);
      this.s.addScaledVector(this.dir, lean);
      d2 -= lean;
    }
    shoulder = this.s;
    d = d2;
    // Past even that (the PC control can put a hand anywhere) the arm is straight: the forearm, the part in view, keeps its
    // real length and only the upper arm, out of view toward the shoulder, spans the rest. Never a stretched forearm.
    const l2 = L_FORE;
    const l1 = Math.max(L_UPPER, d / 0.985 - L_FORE);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    // the elbow bends down and out, and a touch back
    this.pole.set(this.out * 0.55, -1, 0.35);
    this.perp.copy(this.pole).addScaledVector(this.dir, -this.pole.dot(this.dir));
    if (this.perp.lengthSq() < 1e-6) this.perp.set(0, -1, 0);
    this.perp.normalize();
    this.e.copy(shoulder).addScaledVector(this.dir, a).addScaledVector(this.perp, h);
    this.xHint.copy(xHint);
    place(this.upper, shoulder, this.e, this.xHint);
    place(this.fore, this.e, joint, this.xHint);
    // the forearm's oval, and a rounded elbow and wrist so the bends have no gap
    this.fore.scale.x *= OVAL_X;
    this.fore.scale.z *= OVAL_Z;
    this.elbow.position.copy(this.e);
    this.elbow.scale.setScalar(R_ELBOW * 1.02);
    this.wrist.position.copy(joint);
    this.wrist.scale.set(R_FORE_WRIST * OVAL_X, R_FORE_WRIST, R_FORE_WRIST * OVAL_Z);
    this.wrist.quaternion.copy(this.fore.quaternion);
    this.shoulderBall.position.copy(shoulder);
    this.shoulderBall.scale.setScalar(R_SHOULDER * 1.02);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }
}

/**
 * Where a shoulder is, from the head. head: Vector3 and yaw (rad, 0 = looking along -Z) in the anchor frame.
 * @returns {Vector3} written into `out`
 */
export function shoulderFrom(head, yaw, side, out) {
  const s = side === 'left' ? -1 : 1;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return out.set(head.x + rx * s * SHOULDER_SIDE - fx * SHOULDER_BACK, head.y - SHOULDER_DROP, head.z + rz * s * SHOULDER_SIDE - fz * SHOULDER_BACK);
}

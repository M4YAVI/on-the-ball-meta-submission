// The batsman's arms, as he sees them: from each batting glove's cuff, a forearm and an upper arm in long cricket-white sleeves
// back to his shoulders, so the bat is held by HIM, never floating in front of him. Look only: the ball is hit by the blade.
//
// A controller or a tracked hand only says where the hands are; the elbows and the shoulders are solved from real body
// measurements (core/arm.js, ANSUR II means): bones of their real length, the elbow hanging down, the
// shoulders under the head (so leaning or crouching keeps the arms on). Thickness: the arm's (ANSUR II circumferences) plus the
// shirt over it.

import { Group, LatheGeometry, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, Vector3 } from '@iwsdk/core';
import { BODY, solveArm } from '../core/arm.js';

const UP = new Vector3(0, 1, 0);
const WHITE = '#f1f3f5'; // the glove's
const NAVY = '#0f2a5c';
const SLEEVE = '#f4f1e8'; // cricket whites

let MATS = null;
function mats() {
  MATS ??= {
    glove: new MeshStandardMaterial({ color: WHITE, roughness: 0.78, metalness: 0 }),
    navy: new MeshStandardMaterial({ color: NAVY, roughness: 0.7, metalness: 0 }),
    sleeve: new MeshStandardMaterial({ color: SLEEVE, roughness: 0.92, metalness: 0 }),
  };
  return MATS;
}

// A solid of revolution along +Y from the near joint (y = 0), from [radius, y] points in metres.
const limb = (profile, mat) => new Mesh(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 24), mat);

export class SleeveArm {
  constructor() {
    const m = mats();
    const a = BODY.forearm;
    const b = BODY.upper;
    this.group = new Group();
    this.group.name = 'otb-arm';
    // forearm, from the wrist (y = 0) to the elbow: the glove's padded cuff, its strap, then the sleeve over the forearm
    this.fore = new Group();
    this.fore.add(
      limb([[0, -0.004], [0.04, 0], [0.045, 0.012], [0.047, 0.085], [0.044, 0.095], [0.03, 0.1]], m.glove),
      limb([[0.044, 0.02], [0.0465, 0.022], [0.0465, 0.04], [0.044, 0.042]], m.navy),
      limb(
        [[0.03, 0.08], [0.041, 0.088], [0.042, 0.12], [0.045, 0.17], [0.048, 0.215], [0.047, a - 0.015], [0.038, a + 0.012], [0, a + 0.02]],
        m.sleeve,
      ),
    );
    this.elbow = new Mesh(new SphereGeometry(0.043, 18, 12), m.sleeve);
    // upper arm, elbow (y = 0) to the shoulder joint: biceps and triceps under the shirt, then the round of the deltoid
    this.upper = limb([[0, -0.01], [0.042, -0.004], [0.047, 0.05], [0.052, 0.14], [0.054, 0.24], [0.054, b], [0.038, b + 0.03], [0, b + 0.04]], m.sleeve);
    this.group.add(this.fore, this.elbow, this.upper);
    this.w = [0, 0, 0];
    this.p0 = new Vector3();
    this.p1 = new Vector3();
    this.dir = new Vector3();
  }

  // wrist: anchor frame; side: 'right' | 'left' (whose shoulder); head: the head's offset in the anchor frame, or null.
  update(wrist, side, head) {
    this.w[0] = wrist.x;
    this.w[1] = wrist.y;
    this.w[2] = wrist.z;
    const sol = solveArm(this.w, side, head);
    this.p0.copy(wrist);
    this.p1.fromArray(sol.elbow);
    this.place(this.fore, this.p0, this.p1);
    this.elbow.position.copy(this.p1);
    this.p0.fromArray(sol.shoulder);
    this.place(this.upper, this.p1, this.p0);
    // out of reach (an emulator can put the hand anywhere): the upper arm spans on to the shoulder, out of view, rather than
    // ending in mid-air; the forearm, the part in view, keeps its length
    this.upper.scale.y = sol.outOfReach ? Math.max(1, this.p1.distanceTo(this.p0) / BODY.upper) : 1;
    this.group.visible = true;
  }

  place(obj, from, to) {
    this.dir.copy(to).sub(from).normalize();
    obj.quaternion.setFromUnitVectors(UP, this.dir);
    obj.position.copy(from);
  }
}

// Where the head is now, from where it was when the scene was placed (anchor frame; position only: the body faces the pitch and
// the head turns on the neck). Null off-headset (the flat-screen preview has no real head) or for an implausible jump.
export function headOffset(world, anchor, outV, outA) {
  const head = world.player?.head;
  if (!head || !world.renderer?.xr?.isPresenting) return null;
  head.updateWorldMatrix(true, false);
  head.getWorldPosition(outV);
  anchor.worldToLocal(outV);
  if (outV.length() > 0.6) return null;
  outA[0] = outV.x;
  outA[1] = outV.y;
  outA[2] = outV.z;
  return outA;
}

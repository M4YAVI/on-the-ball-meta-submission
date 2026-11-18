// The batsman's gloves on the bat handle: what a batsman sees of his own hands, two padded batting gloves (white, blue trim)
// gripping the top of the handle, one hand right under the other. They are part of the bat's look only: never part of the hit
// test (the ball is hit by the blade), and they move with the bat, which moves only with the player's hand.
//
// Built like a real batting glove seen from the batsman's eyes: the fingers are padded rolls that curl right round the handle
// (the ribbed fist you see in a first-person photo), a padded back of the hand behind them, the thumb guard along the handle,
// a blue side bar on the outside of the hand. The cuffs, the sleeves and the arms are xr/arms.js. The colours stay clean:
// white, one blue.
//
// Frame: the bat's own (see core/bat-physics.js): the handle runs along Z (top of the handle at +Z), the face of the blade looks
// toward -X, so +X is the back of the bat, the side toward the batsman, where his forearms come from.

import { CapsuleGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3 } from '@iwsdk/core';
import { BAT } from '../core/bat-physics.js';

const WHITE = '#f1f3f5';
const ROLL = '#e7eaee'; // the finger rolls, a shade off the white so the ribs read
const BLUE = '#1f5fd6';

// Where each glove sits along the handle (the middle of its fingers): the top hand just under the cap, the bottom hand right
// below it, touching, as a batsman grips (hands together near the top of the handle).
const TOP_Z = BAT.handleTopZ - 0.06;
const BOTTOM_Z = TOP_Z - 0.105;
const ROLL_STEP = 0.0235; // finger to finger along the handle
// From the wrist toward the elbow, in the bat's frame: back toward the batsman (+X) and a little toward the blade's end of the
// bat (the way the wrists cock in a grip).
const FOREARM = new Vector3(1, 0.15, -0.55).normalize();
const WRIST_AT = 0.06; // m from the handle's axis to the wrist, along FOREARM

function glove(zc, mats, geos) {
  const g = new Group();
  const axis = new Vector3(0, 0, zc); // the handle's axis at the middle of this hand
  // the fingers: four padded rolls curled round the handle; the gap is on the thumb side (-Y), where the finger tips meet the
  // palm. The little finger is at the blade end, a touch thinner.
  for (let i = 0; i < 4; i++) {
    const roll = new Mesh(i === 0 ? geos.rollSmall : geos.roll, mats.roll);
    roll.rotation.z = (-90 + 38) * (Math.PI / 180); // arc from here round through +X, +Y and -X, leaving -Y open
    roll.position.set(0, 0, zc + (i - 1.5) * ROLL_STEP);
    g.add(roll);
  }
  // the palm under the finger tips, filling the gap so the fist is closed
  const palm = new Mesh(geos.palm, mats.white);
  palm.scale.set(0.026, 0.02, 0.05);
  palm.position.set(-0.004, -0.03, zc);
  g.add(palm);
  // the back of the hand: a padded plate from the knuckles back toward the wrist
  const back = new Mesh(geos.palm, mats.white);
  back.scale.set(0.036, 0.03, 0.05);
  back.position.copy(axis).addScaledVector(FOREARM, 0.045);
  back.position.y += 0.012;
  back.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), FOREARM);
  g.add(back);
  // the thumb guard: a roll along the handle on the thumb side, over the finger tips
  const thumb = new Mesh(geos.thumb, mats.white);
  thumb.rotation.x = Math.PI / 2;
  thumb.position.set(0.016, -0.042, zc + 0.006);
  g.add(thumb);
  // blue side bar along the outside of the hand (the little-finger side of the back of the hand)
  const bar = new Mesh(geos.bar, mats.blue);
  bar.rotation.x = Math.PI / 2;
  const barAt = axis.clone().addScaledVector(FOREARM, 0.04);
  bar.position.set(barAt.x, 0.044, barAt.z);
  g.add(bar);
  // the wrist, where the arm takes over (xr/arms.js draws the padded cuff, its strap and the sleeve along the real forearm)
  g.userData.wrist = axis.clone().addScaledVector(FOREARM, WRIST_AT);
  return g;
}

export function makeGloves() {
  const mats = {
    white: new MeshStandardMaterial({ color: WHITE, roughness: 0.78, metalness: 0 }),
    roll: new MeshStandardMaterial({ color: ROLL, roughness: 0.82, metalness: 0 }),
    blue: new MeshStandardMaterial({ color: BLUE, roughness: 0.6, metalness: 0 }),
  };
  const arc = (290 * Math.PI) / 180;
  const R = BAT.handleRadius + 0.0125; // the rolls' centre line, round the handle
  const geos = {
    roll: new TorusGeometry(R, 0.0128, 12, 28, arc),
    rollSmall: new TorusGeometry(R - 0.0008, 0.0115, 12, 28, arc),
    palm: new SphereGeometry(1, 18, 12),
    thumb: new CapsuleGeometry(0.0125, 0.05, 6, 12),
    bar: new CapsuleGeometry(0.008, 0.075, 4, 10),
  };
  const g = new Group();
  g.name = 'otb-gloves';
  const top = glove(TOP_Z, mats, geos);
  const bottom = glove(BOTTOM_Z, mats, geos);
  g.add(top, bottom);
  // the wrists in the bat's frame: the top hand (a right-hander's left) and the bottom hand (his right)
  g.userData.wrists = { top: top.userData.wrist, bottom: bottom.userData.wrist };
  return g;
}

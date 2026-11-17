// The batsman's gloves on the bat handle: what a batsman sees of his own hands, two padded batting gloves (white, blue trim)
// gripping the top and the bottom of the handle. They are part of the bat's look only: never part of the hit test (the ball is
// hit by the blade), and they move with the bat, which moves only with the player's hand.
//
// Frame: the bat's own (see core/bat-physics.js): the handle runs along Z (top of the handle at +Z), the face of the blade looks
// toward -X, so +X is the back of the bat, the side toward the batsman, where his forearms come from.

import { CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { BAT } from '../core/bat-physics.js';

const WHITE = '#eef1f4';
const BLUE = '#1f5fd6';
const NAVY = '#0f2a5c';
const PALM = '#c9ced6';

// Where each glove sits along the handle (its middle): the top hand just under the cap, the bottom hand right below it, as a
// batsman grips (hands together near the top of the handle).
const TOP_Z = BAT.handleTopZ - 0.052;
const BOTTOM_Z = TOP_Z - 0.098;
const UP = new Vector3(0, 1, 0);
const FOREARM = new Vector3(1, 0, -0.75).normalize(); // from the wrist toward the elbow, in the bat's frame

function glove(zc, mats) {
  const g = new Group();
  // the fist around the handle: a padded rounded body
  const fist = new Mesh(new SphereGeometry(1, 20, 14), mats.white);
  fist.scale.set(0.048, 0.054, 0.05);
  fist.position.set(0.012, 0, zc);
  g.add(fist);
  // the palm side, a little darker where it wraps the face side of the handle
  const palm = new Mesh(new SphereGeometry(1, 16, 10), mats.palm);
  palm.scale.set(0.03, 0.046, 0.044);
  palm.position.set(-0.014, 0, zc);
  g.add(palm);
  // the finger rolls: four padded sausages across the back of the fingers, the look of a real batting glove
  for (let i = 0; i < 4; i++) {
    const roll = new Mesh(new CapsuleGeometry(0.0128, 0.07, 6, 12), mats.white);
    roll.position.set(0.05, 0.004, zc + (i - 1.5) * 0.0235);
    g.add(roll);
  }
  // the thumb roll, along the handle on the near side
  const thumb = new Mesh(new CapsuleGeometry(0.0135, 0.042, 6, 12), mats.white);
  thumb.rotation.x = Math.PI / 2;
  thumb.position.set(0.034, -0.05, zc + 0.008);
  g.add(thumb);
  // blue side bar along the outside of the hand
  const bar = new Mesh(new CapsuleGeometry(0.009, 0.07, 4, 10), mats.blue);
  bar.rotation.x = Math.PI / 2;
  bar.position.set(0.04, 0.058, zc);
  g.add(bar);
  // the cuff, along the forearm: back toward the batsman and down toward the blade's end of the bat (the way the wrists bend in
  // a grip), so from the eyes it runs down out of the bottom of the view instead of pointing at the face
  const cuff = new Mesh(new CylinderGeometry(0.05, 0.04, 0.07, 16, 1, false), mats.white);
  cuff.quaternion.setFromUnitVectors(UP, FOREARM);
  cuff.position.set(0.012, 0, zc).addScaledVector(FOREARM, 0.075);
  g.add(cuff);
  const strap = new Mesh(new CylinderGeometry(0.046, 0.046, 0.018, 16, 1, false), mats.navy);
  strap.quaternion.copy(cuff.quaternion);
  strap.position.set(0.012, 0, zc).addScaledVector(FOREARM, 0.052);
  g.add(strap);
  return g;
}

export function makeGloves() {
  const mats = {
    white: new MeshStandardMaterial({ color: WHITE, roughness: 0.78, metalness: 0 }),
    palm: new MeshStandardMaterial({ color: PALM, roughness: 0.9, metalness: 0 }),
    blue: new MeshStandardMaterial({ color: BLUE, roughness: 0.6, metalness: 0 }),
    navy: new MeshStandardMaterial({ color: NAVY, roughness: 0.7, metalness: 0 }),
  };
  const g = new Group();
  g.name = 'otb-gloves';
  g.add(glove(TOP_Z, mats), glove(BOTTOM_Z, mats));
  return g;
}

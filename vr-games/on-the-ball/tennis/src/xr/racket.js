// The tennis racket in the receiver's hand. It follows the hand's grip pose exactly (controller or tracked hand): nothing moves
// it but the player. The controller is the racket's grip: hold it like a racket (eastern forehand: the palm behind the strings)
// and the racket is at the same angle as the hand. The free hand follows the other controller.
//
// What is drawn is what a player sees of himself: the racket, his right hand round the grip with a sweatband, and his left
// hand. The tracking, the pose history (for the racket's speed) and the haptics are the cricket bat's (../../src/xr/bat.js),
// shared as they are; only the racket, the hands and the grip offset (none: the racket's frame IS the grip space) are tennis's.

import { CanvasTexture, CircleGeometry, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, SphereGeometry, SRGBColorSpace, TorusGeometry, TubeGeometry, CatmullRomCurve3, Vector3, BoxGeometry } from '@iwsdk/core';
import { Bat } from '../../../src/xr/bat.js';
import { RACKET } from '../core/racket-physics.js';
import { Arm, makeGripHand, makeOpenHand } from './hands.js';

const FRAME_BLACK = '#15181d';
const FRAME_BLUE = '#1d6fe0';
const FREE_FIST_SNAP = 0.1; // m: a free hand this close to the handle is drawn holding it (two-handed backhand)

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// The string bed: 16 mains by 19 crosses, off-white, the rest see-through (the ball and the court show through it).
function stringsTex() {
  return canvasTex(512, 512, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.strokeStyle = 'rgba(238,240,228,0.95)';
    x.lineWidth = 3.2;
    for (let i = 0; i < 16; i++) {
      const px = ((i + 0.5) / 16) * w;
      x.beginPath();
      x.moveTo(px, 0);
      x.lineTo(px, h);
      x.stroke();
    }
    x.strokeStyle = 'rgba(225,228,214,0.9)';
    for (let i = 0; i < 19; i++) {
      const py = ((i + 0.5) / 19) * h;
      x.beginPath();
      x.moveTo(0, py);
      x.lineTo(w, py);
      x.stroke();
    }
  });
}

// White overgrip with a dark spiral seam.
function gripTex() {
  const t = canvasTex(128, 512, (x, w, h) => {
    x.fillStyle = '#eef0ee';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(70,80,90,0.55)';
    x.lineWidth = 3;
    for (let y = -w; y < h + w; y += 40) {
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(w, y + w * 0.45);
      x.stroke();
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export class Racket extends Bat {
  constructor(world) {
    super(world);
    this.group.name = 'otb-racket';
    // the racket's frame is the grip space itself, in either hand (a racket has two equal faces)
    this.gripOffset = new Quaternion();
    this.gripOffsetLeft = new Quaternion();
    // the free hand and both arms live beside the racket in the anchor (in ody), not on it
    this.body = new Group();
    this.body.name = 'otb-body';
    this.armRacket = new Arm();
    this.armFree = new Arm();
    this.body.add(this.armRacket.group, this.armFree.group);
    this.wristW = new Vector3();
    this.headW = new Vector3();
    this.headA = [0, 0, 0];
    this.free = new Group();
    this.free.name = 'otb-free-hand';
    this.free.visible = false;
    this.freeOpen = makeOpenHand();
    this.freeFist = makeGripHand(-1);
    this.free.add(this.freeOpen, this.freeFist);
    this.body.add(this.free);
    this.freeOverride = null; // () => {p, q, shape} (anchor frame) for the PC control
    this.fm = new Matrix4();
    this.fv = new Vector3();
    this.fq = new Quaternion();
    this.fs = new Vector3();
    this.loc = new Vector3();
  }

  build() {
    const black = new MeshStandardMaterial({ color: FRAME_BLACK, roughness: 0.32, metalness: 0.15 });
    const blue = new MeshStandardMaterial({ color: FRAME_BLUE, roughness: 0.3, metalness: 0.2 });
    const a = RACKET.headA - 0.008;
    const b = RACKET.headB - 0.008;
    // The head: a torus squashed to the head's ellipse, with a beam 24 mm deep and about 15 mm wide.
    const ring = (tube, arc, mat, rot = 0) => {
      const g = new TorusGeometry(1, tube, 10, 96, arc);
      g.rotateZ(rot);
      g.rotateY(Math.PI / 2); // into the strings' plane (Y-Z), the beam's depth along X
      g.scale(RACKET.halfDepth / tube, b, a);
      g.translate(0, 0, RACKET.headZ);
      return new Mesh(g, mat);
    };
    const head = ring(0.07, Math.PI * 2, black);
    // blue paint on the sides of the head (a little proud of the black so it shows)
    const paintL = ring(0.074, 1.0, blue, -0.5 + Math.PI / 2 - 0.15);
    const paintR = ring(0.074, 1.0, blue, -0.5 - Math.PI / 2 + 0.15);
    // the strings
    const sg = new CircleGeometry(1, 64);
    sg.rotateY(Math.PI / 2);
    sg.scale(1, RACKET.stringB, RACKET.stringA);
    sg.translate(0, 0, RACKET.headZ);
    const strings = new Mesh(sg, new MeshStandardMaterial({ map: stringsTex(), transparent: true, alphaTest: 0.08, side: DoubleSide, roughness: 0.5, depthWrite: false }));
    strings.renderOrder = 2;
    // a little vibration dampener on the strings above the throat
    const damp = new Mesh(new BoxGeometry(0.02, 0.022, 0.014), new MeshStandardMaterial({ color: '#f2c230', roughness: 0.7 }));
    damp.position.set(0, 0, RACKET.headZ + RACKET.stringA - 0.022);
    // the open throat: two beams from the top of the grip out to the sides of the head
    const throatEnd = (side) => {
      const t = 0.58; // where on the head's lower edge the beam joins (angle from the bottom)
      return new Vector3(0, side * b * Math.sin(t), RACKET.headZ + a * Math.cos(t));
    };
    const beams = [];
    for (const side of [-1, 1]) {
      const c = new CatmullRomCurve3([new Vector3(0, side * 0.006, RACKET.gripTopZ + 0.01), new Vector3(0, side * 0.03, RACKET.gripTopZ - 0.06), throatEnd(side)]);
      const tg = new TubeGeometry(c, 16, 0.009, 8, false);
      tg.scale(1.3, 1, 1); // deeper than wide, like the head
      beams.push(new Mesh(tg, side > 0 ? blue : black));
    }
    // the shaft collar and the grip
    const collar = new Mesh(new CylinderGeometry(0.012, RACKET.handleR, 0.03, 8), black);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = RACKET.gripTopZ - 0.005;
    const gripLen = RACKET.buttZ - RACKET.gripTopZ;
    const gripGeo = new CylinderGeometry(RACKET.handleR, RACKET.handleR * 1.04, gripLen, 8);
    gripGeo.rotateX(Math.PI / 2);
    gripGeo.translate(0, 0, (RACKET.buttZ + RACKET.gripTopZ) / 2);
    const grip = new Mesh(gripGeo, new MeshStandardMaterial({ map: gripTex(), roughness: 0.85 }));
    const butt = new Mesh(new CylinderGeometry(RACKET.handleR * 1.12, RACKET.handleR * 1.12, 0.012, 8), black);
    butt.rotation.x = Math.PI / 2;
    butt.position.z = RACKET.buttZ;
    this.visual.add(head, paintL, paintR, strings, damp, ...beams, collar, grip, butt);
    this.meshes = [head, strings, grip];
    // the right hand round the grip
    this.hand = makeGripHand(1);
    this.visual.add(this.hand);
  }

  // Which hand holds the racket: the hand drawn round the grip is that hand.
  setHandSide() {
    const left = this.side === 'left';
    this.hand.scale.x = left ? -1 : 1;
  }

  // Speed (m/s) of the sweet spot.
  tipSpeed(time) {
    const v = this.velocityAt([0, 0, RACKET.sweetZ], time);
    return Math.hypot(v[0], v[1], v[2]);
  }

  update(anchor, dt, time) {
    const on = super.update(anchor, dt, time);
    this.setHandSide();
    this.updateFree(anchor, on);
    this.updateArms(anchor);
    return on;
  }

  // Each arm from its hand's wrist back to its shoulder (xr/hands.js Arm). The racket hand's shoulder is the side it is held in.
  updateArms(anchor) {
    const racketSide = this.side === 'left' ? 'left' : 'right';
    const freeSide = racketSide === 'left' ? 'right' : 'left';
    anchor.updateWorldMatrix(true, false);
    const head = this.headOffset(anchor);
    const wristIn = (hand, arm, shoulder) => {
      if (!hand.visible || !hand.parent?.visible || !hand.parent.parent?.visible) {
        arm.group.visible = false;
        return;
      }
      hand.updateWorldMatrix(true, false);
      this.wristW.copy(hand.userData.wrist);
      hand.localToWorld(this.wristW);
      anchor.worldToLocal(this.wristW);
      arm.update(this.wristW, shoulder, head);
    };
    if (this.group.visible) wristIn(this.hand, this.armRacket, racketSide);
    else this.armRacket.group.visible = false;
    const freeHand = this.freeFist.visible ? this.freeFist : this.freeOpen;
    if (this.free.visible) wristIn(freeHand, this.armFree, freeSide);
    else this.armFree.group.visible = false;
  }

  // Where the head is now, from where it was when the scene was placed (anchor frame; position only: the body faces the court
  // and the head turns on the neck). The shoulders stand under the head, so leaning or crouching keeps the arms attached.
  // Null off-headset (the flat-screen preview has no real head) or for an implausible jump (a tracking glitch).
  headOffset(anchor) {
    const head = this.world.player?.head;
    if (!head || !this.world.renderer?.xr?.isPresenting) return null;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(this.headW);
    anchor.worldToLocal(this.headW);
    if (this.headW.length() > 0.6) return null;
    this.headA[0] = this.headW.x;
    this.headA[1] = this.headW.y;
    this.headA[2] = this.headW.z;
    return this.headA;
  }

  // The free hand: the PC control's pose, or the other controller. Drawn round the handle when it is on it.
  updateFree(anchor, racketOn) {
    if (!racketOn || !this.enabled) {
      this.free.visible = false;
      return;
    }
    const forced = this.freeOverride?.();
    if (forced) {
      this.free.position.copy(forced.p);
      this.free.quaternion.copy(forced.q);
      this.showShape(forced.shape);
      return;
    }
    const other = this.side === 'right' ? 'left' : 'right';
    const grip = this.world.player?.gripSpaces?.[other];
    if (!grip || !this.isTracked(other)) {
      this.free.visible = false;
      return;
    }
    grip.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    this.fm.copy(anchor.matrixWorld).invert().multiply(grip.matrixWorld);
    this.fm.decompose(this.fv, this.fq, this.fs);
    // near the handle: the hand is drawn on it, just above the racket hand (where a two-handed grip holds it)
    this.loc.copy(this.fv).sub(this.group.position).applyQuaternion(this.q.copy(this.group.quaternion).invert());
    const onHandle = Math.hypot(this.loc.x, this.loc.y) < FREE_FIST_SNAP && this.loc.z < 0.02 && this.loc.z > -0.25;
    if (onHandle) {
      this.free.position.copy(this.group.position);
      this.free.quaternion.copy(this.group.quaternion);
      this.free.translateZ(Math.max(-0.12, Math.min(-0.085, this.loc.z)));
      this.showShape('fist');
    } else {
      this.free.position.copy(this.fv);
      this.free.quaternion.copy(this.fq);
      this.showShape('open');
    }
    // the free hand is the other hand: a left one, unless the racket is in the left hand
    const mirror = other === 'right' ? -1 : 1;
    this.free.scale.x = mirror;
  }

  showShape(shape) {
    this.free.visible = true;
    this.freeOpen.visible = shape !== 'fist';
    this.freeFist.visible = shape === 'fist';
  }

  setEnabled(on) {
    super.setEnabled(on);
    if (!on && this.free) {
      this.free.visible = false;
      this.armRacket.group.visible = false;
      this.armFree.group.visible = false;
    }
  }
}

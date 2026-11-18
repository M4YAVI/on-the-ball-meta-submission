// The receiver's own hands, as a player sees them from his eyes: a bare right hand round the racket's grip with a white
// sweatband on the wrist, and the free left hand (open, out in front for balance, or round the handle for a two-handed
// backhand). Each forearm runs back out of the bottom of the view; nothing else of the body is drawn. Look only: the ball is hit
// by the strings (core/racket-physics.js), never by a hand.
//
// Frames: each hand is built in its own WebXR grip space (the frame the controller or tracked hand reports), so it sits where
// the real hand is. Grip space: -Z along the held handle toward the thumb side (toward the racket head), the palm toward -X on
// the right hand and +X on the left. A left hand is the right hand mirrored in X. The arms are drawn apart from the hands (Arm).

import { CanvasTexture, CapsuleGeometry, CatmullRomCurve3, Group, LatheGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector2, Vector3 } from '@iwsdk/core';
import { BODY, solveArm } from '../core/arm.js';

const SKIN = '#c98d66';
const UP = new Vector3(0, 1, 0);

let MATS = null;
function mats() {
  if (MATS) return MATS;
  // terry cloth: white with a fine loop texture and a thin stripe
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#f3f4f2';
  x.fillRect(0, 0, 128, 128);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2200; i++) {
    const v = 205 + Math.floor(rnd() * 45);
    x.fillStyle = `rgb(${v},${v},${v - 3})`;
    x.fillRect(rnd() * 128, rnd() * 128, 2, 2);
  }
  x.fillStyle = '#1f4fbf';
  x.fillRect(0, 58, 128, 6);
  const terry = new CanvasTexture(c);
  terry.colorSpace = SRGBColorSpace;
  terry.wrapS = terry.wrapT = RepeatWrapping;
  MATS = {
    skin: new MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0 }),
    knuckle: new MeshStandardMaterial({ color: '#c08262', roughness: 0.6, metalness: 0 }),
    nail: new MeshStandardMaterial({ color: '#e9c3ae', roughness: 0.35, metalness: 0 }),
    band: new MeshStandardMaterial({ map: terry, roughness: 0.95, metalness: 0 }),
    shirt: new MeshStandardMaterial({ color: '#f4f6f8', roughness: 0.85, metalness: 0 }), // a white tennis shirt
  };
  return MATS;
}

const v3 = (a) => new Vector3(a[0], a[1], a[2]);

// A finger or a thumb: a tube along the given points, with a rounded tip and a nail.
function digit(points, r, m, mirror) {
  const pts = points.map((p) => v3([p[0] * mirror, p[1], p[2]]));
  const g = new Group();
  const curve = new CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
  const tube = new Mesh(new TubeGeometry(curve, 14, r, 10, false), m.skin);
  g.add(tube);
  const base = new Mesh(new SphereGeometry(r * 1.08, 12, 8), m.knuckle);
  base.position.copy(pts[0]);
  const tip = new Mesh(new SphereGeometry(r * 0.96, 12, 8), m.skin);
  tip.position.copy(pts[pts.length - 1]);
  g.add(base, tip);
  return g;
}

// A limb's shape: a solid of revolution along +Y from 0 (the near joint) out to `len`, from [radius, y] points in metres.
function limb(profile, mat) {
  const pts = profile.map(([r, y]) => new Vector2(r, y));
  return new Mesh(new LatheGeometry(pts, 24), mat);
}

// The arm: forearm with the sweatband, elbow and upper arm, laid out every frame from where the hand is (core/arm.js solves the
// elbow and the shoulder from real body measurements, ANSUR II means). The forearm always keeps its real length.
// Thickness from the same survey: the wrist about 176 mm round, the forearm swelling to about 280 mm round below the elbow
// (relaxed), the upper arm about 320 mm round.
export class Arm {
  constructor() {
    const m = mats();
    this.group = new Group();
    this.group.name = 'otb-arm';
    const a = BODY.forearm;
    // forearm, wrist (y = 0) to elbow (y = a): slim at the wrist, the muscle swelling in its upper third, narrowing to the elbow
    this.fore = limb(
      [
        [0, -0.006],
        [0.022, -0.004],
        [0.025, 0.01],
        [0.026, 0.04],
        [0.028, 0.08],
        [0.032, 0.12],
        [0.038, 0.165],
        [0.042, 0.205],
        [0.043, 0.235],
        [0.039, a - 0.008],
        [0.03, a + 0.012],
        [0, a + 0.02],
      ],
      m.skin,
    );
    // the sweatband round the wrist, 75 mm wide, standing a little proud of the skin, with rolled edges
    this.band = limb(
      [
        [0.024, 0.022],
        [0.03, 0.024],
        [0.0315, 0.03],
        [0.032, 0.06],
        [0.0335, 0.09],
        [0.0325, 0.096],
        [0.027, 0.098],
      ],
      m.band,
    );
    this.fore.add(this.band);
    this.elbow = new Mesh(new SphereGeometry(0.036, 18, 12), m.skin);
    // upper arm, elbow (y = 0) to the shoulder joint (y = BODY.upper): biceps and triceps, then the deltoid's round
    const b = BODY.upper;
    this.upper = limb(
      [
        [0, -0.01],
        [0.034, -0.004],
        [0.039, 0.03],
        [0.045, 0.08],
        [0.049, 0.14],
        [0.05, 0.2],
        [0.051, 0.26],
        [0.048, b],
        [0.032, b + 0.03],
        [0, b + 0.04],
      ],
      m.skin,
    );
    // the short sleeve of his tennis shirt over the top half of the upper arm, standing a little off the skin, with a hem
    this.sleeve = limb(
      [
        [0.058, 0.135],
        [0.061, 0.14],
        [0.061, 0.155],
        [0.062, 0.24],
        [0.064, b],
        [0.045, b + 0.04],
        [0, b + 0.05],
      ],
      m.shirt,
    );
    this.upper.add(this.sleeve);
    this.group.add(this.fore, this.elbow, this.upper);
    this.w = [0, 0, 0];
    this.dir = new Vector3();
    this.p0 = new Vector3();
    this.p1 = new Vector3();
  }

  // wrist: the wrist point (anchor frame); side: 'right' | 'left'; head: the head's offset in the anchor frame (or null).
  update(wrist, side, head = null) {
    this.w[0] = wrist.x;
    this.w[1] = wrist.y;
    this.w[2] = wrist.z;
    const sol = solveArm(this.w, side, head);
    this.p0.copy(wrist);
    this.p1.fromArray(sol.elbow);
    this.place(this.fore, this.p0, this.p1, 1);
    this.elbow.position.copy(this.p1);
    this.p0.fromArray(sol.shoulder);
    this.place(this.upper, this.p1, this.p0);
    // out of reach (an emulator can put the hand anywhere): the upper arm spans on to the shoulder, out of view, rather than
    // ending in mid-air; the forearm, the part in view, keeps its length
    this.upper.scale.y = sol.outOfReach ? Math.max(1, this.p1.distanceTo(this.p0) / BODY.upper) : 1;
    this.group.visible = true;
  }

  // a limb from its near joint toward the far one, at its own length (the meshes are built to size; nothing is scaled)
  place(mesh, from, to) {
    this.dir.copy(to).sub(from).normalize();
    mesh.quaternion.setFromUnitVectors(UP, this.dir);
    mesh.position.copy(from);
  }
}
// The right hand round the grip (mirror = -1 gives the left hand, for a two-handed backhand). The handle runs along Z through
// the origin; the palm lies against its +X side (palm toward -X), the fingers wrap round under it and come up on the far side,
// the thumb lies diagonally across them toward the head, index finger nearest the head.
export function makeGripHand(mirror = 1) {
  const m = mats();
  const g = new Group();
  g.name = mirror > 0 ? 'otb-hand-right' : 'otb-hand-left-grip';
  // the back of the hand and the palm: one padded body beside the handle
  const palm = new Mesh(new SphereGeometry(1, 22, 16), m.skin);
  palm.scale.set(0.02, 0.046, 0.047);
  palm.position.set(0.03 * mirror, 0.028, 0.006);
  palm.rotation.x = -0.22;
  g.add(palm);
  // the heel of the hand and the ball of the thumb
  const heel = new Mesh(new SphereGeometry(1, 16, 12), m.skin);
  heel.scale.set(0.02, 0.026, 0.03);
  heel.position.set(0.016 * mirror, 0.052, 0.022);
  g.add(heel);
  const thenar = new Mesh(new SphereGeometry(1, 16, 12), m.skin);
  thenar.scale.set(0.018, 0.026, 0.022);
  thenar.position.set(0.012 * mirror, 0.04, -0.03);
  g.add(thenar);
  // four fingers round the handle, index nearest the head, each a little further down it
  const fz = [-0.031, -0.008, 0.014, 0.034];
  const fr = [0.0092, 0.0096, 0.009, 0.008];
  fz.forEach((z, i) => {
    const k = i === 3 ? 0.88 : 1;
    g.add(
      digit(
        [
          [0.036, -0.004, z],
          [0.03 * k, -0.022 * k, z - 0.002],
          [0.008, -0.028 * k, z - 0.004],
          [-0.017 * k, -0.02 * k, z - 0.006],
          [-0.025 * k, -0.002, z - 0.008],
        ],
        fr[i],
        m,
        mirror,
      ),
    );
  });
  // the thumb: from the ball of the thumb, round the far side of the handle and along it toward the head
  g.add(
    digit(
      [
        [0.008, 0.038, -0.038],
        [-0.012, 0.02, -0.05],
        [-0.024, 0.004, -0.062],
        [-0.021, -0.006, -0.076],
      ],
      0.0105,
      m,
      mirror,
    ),
  );
  // the wrist, where the arm (Arm) joins: a round joint so the hand and the arm meet cleanly
  g.userData.wrist = new Vector3(0.036 * mirror, 0.05, 0.03);
  const joint = new Mesh(new SphereGeometry(0.026, 16, 12), m.skin);
  joint.position.copy(g.userData.wrist);
  g.add(joint);
  return g;
}

// The free left hand, open and relaxed (palm toward +X, fingers along -Y, thumb toward -Z), fingers a little curled.
export function makeOpenHand() {
  const m = mats();
  const g = new Group();
  g.name = 'otb-hand-left-open';
  const palm = new Mesh(new SphereGeometry(1, 22, 16), m.skin);
  palm.scale.set(0.016, 0.05, 0.044);
  palm.position.set(0, 0.0, 0.004);
  g.add(palm);
  const fingers = [
    { z: -0.03, L: 0.074, r: 0.0088, spread: -0.006 },
    { z: -0.01, L: 0.082, r: 0.0092, spread: -0.002 },
    { z: 0.01, L: 0.077, r: 0.0088, spread: 0.002 },
    { z: 0.029, L: 0.062, r: 0.0078, spread: 0.007 },
  ];
  for (const f of fingers) {
    const b = -0.045;
    g.add(
      digit(
        [
          [0.0, b, f.z],
          [0.006, b - f.L * 0.38, f.z + f.spread * 0.5],
          [0.014, b - f.L * 0.72, f.z + f.spread],
          [0.026, b - f.L, f.z + f.spread * 1.3],
        ],
        f.r,
        m,
        1,
      ),
    );
  }
  g.add(
    digit(
      [
        [0.008, 0.026, -0.034],
        [0.018, 0.0, -0.058],
        [0.026, -0.026, -0.072],
        [0.03, -0.046, -0.078],
      ],
      0.0105,
      m,
      1,
    ),
  );
  // the knuckles' ridge on the back of the hand
  const ridge = new Mesh(new CapsuleGeometry(0.009, 0.05, 4, 10), m.knuckle);
  ridge.rotation.x = Math.PI / 2;
  ridge.position.set(-0.006, -0.043, 0.0);
  g.add(ridge);
  g.userData.wrist = new Vector3(0, 0.05, 0.002);
  const joint = new Mesh(new SphereGeometry(0.024, 16, 12), m.skin);
  joint.position.copy(g.userData.wrist);
  g.add(joint);
  return g;
}

// The practice-nets scene from deck slide 5, seen from the BATSMAN's crease: a dark net tunnel, a tan 22-yard pitch with real
// crease markings, the batsman's own stumps BEHIND the chair (out of view, as when you take guard), and the bowler with his
// stumps at the far end. Distances come from FIELD in core/ball-path.js so the tests check them. Everything is placed in the viewer's eye frame (origin at the eyes, -z straight ahead), and the
// ground sits GROUND metres below the eyes, which is where a seated player's floor is.
//
// Cheap on purpose (Quest needs 60 fps or better): no lights except one directional, no shadows, baked light pools on the
// floor, and three net panels drawn with a mipmapped cord texture.

import {
  AmbientLight,
  AnimationMixer,
  AssetManager,
  Box3,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LinearMipmapLinearFilter,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from '@iwsdk/core';

import { FIELD } from '../core/ball-path.js';

export const GROUND = FIELD.ground; // metres below the eyes
const PITCH_W = 3.05; // 10 ft between the return creases
const PITCH_NEAR = 2.2; // the pitch runs on behind the batsman
const PITCH_FAR = FIELD.bowlerStumpsZ - 1.3;
const ARM = Object.freeze({ start: -0.34, end: 0.32 }); // seconds around the release: one full turn of the bowling arm

function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

function netTexture() {
  const t = new CanvasTexture(
    canvas(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(120,138,130,0.55)';
      c.lineWidth = 3;
      c.strokeRect(0, 0, w, h);
    }),
  );
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}

function groundTexture() {
  const t = new CanvasTexture(
    canvas(512, 1024, (c, w, h) => {
      c.fillStyle = '#101417';
      c.fillRect(0, 0, w, h);
      // faint light pools: near the stumps (bottom) and near the bowler (top)
      for (const [y, r, a] of [[h * 0.97, h * 0.34, 0.2], [h * 0.07, h * 0.24, 0.34]]) {
        const g = c.createRadialGradient(w / 2, y, 0, w / 2, y, r);
        g.addColorStop(0, `rgba(80,96,88,${a})`);
        g.addColorStop(1, 'rgba(80,96,88,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
      // rubber speckle
      for (let i = 0; i < 4000; i++) {
        c.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }),
  );
  t.colorSpace = SRGBColorSpace;
  return t;
}

function pitchTexture() {
  const t = new CanvasTexture(
    canvas(256, 1024, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#7e6f4a');
      g.addColorStop(0.5, '#9a8a5f');
      g.addColorStop(1, '#a8975f');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,240,200'},${Math.random() * 0.06})`;
        c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 1);
      }
    }),
  );
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class CricketScene {
  constructor() {
    this.root = new Group();
    this.root.name = 'cricket-nets';
    this.mixer = null;
    this.arm = null;
    this.armRest = null;

    const ground = new Mesh(new PlaneGeometry(10, 30), new MeshBasicMaterial({ map: groundTexture(), toneMapped: false }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, GROUND, -10);
    this.root.add(ground);

    const pitchLen = PITCH_NEAR - PITCH_FAR;
    const pitch = new Mesh(new PlaneGeometry(PITCH_W, pitchLen), new MeshBasicMaterial({ map: pitchTexture(), toneMapped: false }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, GROUND + 0.004, PITCH_NEAR - pitchLen / 2);
    this.root.add(pitch);

    // crease markings, both ends: bowling crease through the stumps, popping crease 1.22 m in front, return creases
    const chalk = new MeshBasicMaterial({ color: '#e9e4d6', toneMapped: false });
    const line = (w, d, x, z) => {
      const m = new Mesh(new PlaneGeometry(w, d), chalk);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, GROUND + 0.007, z);
      this.root.add(m);
    };
    for (const [stumps, dir] of [[FIELD.batsmanStumpsZ, -1], [FIELD.bowlerStumpsZ, 1]]) {
      const popping = stumps + dir * 1.22;
      line(PITCH_W + 0.6, 0.05, 0, popping); // popping crease runs past the pitch edges
      line(2.64, 0.05, 0, stumps); // bowling crease
      for (const side of [-1, 1]) line(0.05, 2.44 + 0.3, side * 1.32, stumps + dir * 1.22 - dir * (2.44 + 0.3) / 2 + dir * 0.15);
    }

    // net tunnel: two side walls, a roof, and a back wall
    const net = (w, h, cell) => {
      const tex = netTexture();
      tex.repeat.set(w / cell, h / cell);
      return new Mesh(
        new PlaneGeometry(w, h),
        new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false }),
      );
    };
    const near = 3.2; // the tunnel closes just behind the batsman's stumps
    const far = PITCH_FAR - 1.5;
    const len = near - far;
    const width = 4.2;
    const height = 3.6;
    for (const side of [-1, 1]) {
      const wall = net(len, height, 0.12);
      wall.rotation.y = Math.PI / 2;
      wall.position.set((side * width) / 2, GROUND + height / 2, near - len / 2);
      this.root.add(wall);
    }
    const roof = net(width, len, 0.12);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(0, GROUND + height, near - len / 2);
    this.root.add(roof);
    for (const z of [far, near]) {
      const end = net(width, height, 0.12);
      end.position.set(0, GROUND + height / 2, z);
      this.root.add(end);
    }

    // two sets of stumps and bails (wood, lit by the one directional light): the batsman's behind the chair, the bowler's far away
    const wood = new MeshStandardMaterial({ color: '#c79f68', roughness: 0.55, metalness: 0 });
    for (const z of [FIELD.batsmanStumpsZ, FIELD.bowlerStumpsZ]) {
      for (const x of [-0.114, 0, 0.114]) {
        const s = new Mesh(new CylinderGeometry(0.0195, 0.0195, 0.711, 12), wood);
        s.position.set(x, GROUND + 0.3555, z);
        this.root.add(s);
      }
      for (const x of [-0.057, 0.057]) {
        const b = new Mesh(new CylinderGeometry(0.0075, 0.0075, 0.112, 8), wood);
        b.rotation.z = Math.PI / 2;
        b.position.set(x, GROUND + 0.718, z);
        this.root.add(b);
      }
    }

    const sun = new DirectionalLight('#dfe9e2', 1.8);
    sun.position.set(1.5, 5, 2);
    this.root.add(sun);
    this.root.add(new AmbientLight('#cfd8d2', 0.55)); // lifts the bowler off the dark back net (no shadows, no cost)

    this.loadBowler();
  }

  loadBowler() {
    let gltf = null;
    try {
      gltf = AssetManager.getGLTF('bowler');
    } catch (_) {
      gltf = null;
    }
    if (!gltf) return; // the scene works without him (nets, pitch and stumps still draw)
    const model = gltf.scene;
    const box = new Box3().setFromObject(model);
    const scale = 1.86 / (box.max.y - box.min.y);
    model.position.set(0, -box.min.y, 0);
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned: bind-pose bounds do not follow the pose
    });
    const holder = new Group();
    holder.add(model);
    holder.scale.setScalar(scale);
    holder.position.set(0, GROUND, FIELD.bowlerZ);
    this.root.add(holder);
    this.bowler = holder;
    this.mixer = new AnimationMixer(model);
    const idle = gltf.animations.find((a) => a.name === 'Idle_Loop');
    if (idle) this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();
    this.arm = model.getObjectByName('upperarm_r');
    this.forearm = model.getObjectByName('lowerarm_r');
  }

  // tRel: seconds relative to the moment the ball leaves the hand (negative before, positive after); null = standing.
  // No run-up: the bowler stands at the crease and bowls one straight-arm windmill. The arm starts hanging down, swings back
  // and up, passes just beyond vertical at release (where real bowlers let go), and follows through down past the front of
  // the body to where it started. The swing eases in and out and is fastest at release, like a real action.
  setDelivery(tRel) {
    this.deliveryT = tRel;
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    const t = this.deliveryT;
    if (this.arm && t != null && t > ARM.start && t < ARM.end) {
      const u = (t - ARM.start) / (ARM.end - ARM.start);
      const turn = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI); // 0..1, zero speed at both ends
      this.arm.rotation.x += 2 * Math.PI * turn; // back and up first, then over the top and down across the front
    }
  }
}

// The green cricket ground, seen from the BATSMAN's crease: a mown outfield, a clay 22-yard pitch with real crease markings,
// the batsman's own stumps BEHIND the chair (out of view, as when you take guard), and the bowler with his stumps at the far
// end. A boundary rope, fence, hedge and tree line close the ground in, and a dark sightscreen stands behind the bowler so the
// red ball and its white ring stand out at release. Distances come from FIELD in core/ball-path.js so the tests check them.
// Everything is placed in the viewer's eye frame (origin at the eyes, -z straight ahead), and the ground sits GROUND metres
// below the eyes, which is where a seated player's floor is.
//
// Cheap on purpose (Quest needs 60 fps or better): one directional light plus a hemisphere fill, no shadows, ground textures
// drawn once in code, and every repeated model (fence panels, bushes, trees, rocks) batched into instanced meshes.

import {
  AnimationMixer,
  AssetManager,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  LoopRepeat,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';

import { FIELD } from '../core/ball-path.js';

export const GROUND = FIELD.ground; // metres below the eyes
const PITCH_W = 3.05; // 10 ft between the return creases
const PITCH_NEAR = FIELD.batsmanStumpsZ + 1.3; // the pitch runs on behind the batsman
const PITCH_FAR = FIELD.bowlerStumpsZ - 1.3;
const PITCH_MID = (PITCH_NEAR + PITCH_FAR) / 2;
const CENTER_Z = (FIELD.batsmanStumpsZ + FIELD.bowlerStumpsZ) / 2; // middle of the ground: the pitch sits on it
const ROPE_R = 27.5;
const FENCE_R = 30;
const ARM = Object.freeze({ start: -0.34, end: 0.32 }); // seconds around the release: one full turn of the bowling arm

// Small seeded generator so the ground looks the same on every run.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Grass: an 8 m tile of fine blade noise with two mowing stripes that run along the pitch.
function grassTexture() {
  const t = canvasTexture(512, 512, (g, S) => {
    g.fillStyle = '#4c9a40';
    g.fillRect(0, 0, S, S);
    const band = g.createLinearGradient(0, 0, S, 0);
    band.addColorStop(0, 'rgba(255,255,220,0.0)');
    band.addColorStop(0.02, 'rgba(255,255,220,0.09)');
    band.addColorStop(0.48, 'rgba(255,255,220,0.09)');
    band.addColorStop(0.5, 'rgba(0,30,0,0.06)');
    band.addColorStop(0.98, 'rgba(0,30,0,0.06)');
    band.addColorStop(1, 'rgba(255,255,220,0.0)');
    g.fillStyle = band;
    g.fillRect(0, 0, S, S);
    const rand = seeded(21);
    for (let i = 0; i < 22000; i++) {
      const x = rand() * S;
      const y = rand() * S;
      g.fillStyle = rand() < 0.5 ? `rgba(20,60,15,${0.18 + rand() * 0.2})` : `rgba(170,215,110,${0.12 + rand() * 0.18})`;
      g.fillRect(x, y, 1, 2 + rand() * 3);
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// Pitch: rolled clay with greener edges, worn patches at both ends, and the creases painted to the Laws' measurements
// (5 cm white lines: bowling crease through the stumps, popping crease 1.22 m in front, return creases to the stumps and on).
function pitchTexture() {
  const W = 256;
  const H = 2048;
  const len = PITCH_NEAR - PITCH_FAR;
  const zToY = (z) => ((PITCH_NEAR - z) / len) * H;
  const xToX = (x) => (x / PITCH_W + 0.5) * W;
  const pxX = W / PITCH_W;
  const pxZ = H / len;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#cfb680';
    g.fillRect(0, 0, W, H);
    const edge = g.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, 'rgba(90,140,60,0.55)');
    edge.addColorStop(0.08, 'rgba(90,140,60,0.0)');
    edge.addColorStop(0.92, 'rgba(90,140,60,0.0)');
    edge.addColorStop(1, 'rgba(90,140,60,0.55)');
    g.fillStyle = edge;
    g.fillRect(0, 0, W, H);
    const rand = seeded(9);
    for (let i = 0; i < 14000; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(120,95,50,${0.06 + rand() * 0.1})` : `rgba(240,225,180,${0.05 + rand() * 0.1})`;
      g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
    }
    // worn, darker patches where the batsman stands and where the bowler lands
    for (const z of [FIELD.batsmanStumpsZ - 1.2, FIELD.bowlerStumpsZ + 1.2]) {
      for (let i = 0; i < 70; i++) {
        const x = (rand() - 0.5) * 1.6;
        const zz = z + (rand() - 0.5) * 2.2;
        g.fillStyle = `rgba(110,80,40,${0.05 + rand() * 0.08})`;
        g.beginPath();
        g.ellipse(xToX(x), zToY(zz), 3 + rand() * 6, 5 + rand() * 9, rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = '#f7f5ee';
    const LINE = 0.05;
    const across = (z, x0, x1) => g.fillRect(xToX(x0), zToY(z) - (LINE * pxZ) / 2, (x1 - x0) * pxX, Math.max(2, LINE * pxZ));
    const along = (x, zA, zB) => {
      const y0 = zToY(Math.max(zA, zB));
      const y1 = zToY(Math.min(zA, zB));
      g.fillRect(xToX(x) - (LINE * pxX) / 2, y0, LINE * pxX, y1 - y0);
    };
    for (const [stumps, dir] of [[FIELD.batsmanStumpsZ, -1], [FIELD.bowlerStumpsZ, 1]]) {
      const popping = stumps + dir * 1.22;
      across(stumps, -1.32, 1.32);
      across(popping, -PITCH_W / 2, PITCH_W / 2);
      for (const x of [-1.32, 1.32]) along(x, popping, stumps - dir * 1.22);
    }
  });
}

// Ground layers lie a few millimetres apart and run out to 90 m, where a headset's depth buffer cannot separate them. So they
// are drawn in a fixed order (grass, square, pitch) and each later layer is pulled towards the camera in the depth test.
// They still write depth, so the sky dome and everything else sort against them normally.
function groundLayer(mesh, order) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = order;
  if (order > 0) {
    mesh.material.polygonOffset = true;
    mesh.material.polygonOffsetFactor = -order;
    mesh.material.polygonOffsetUnits = -order * 4;
  }
  return mesh;
}

const box = new Box3();
const size = new Vector3();

// A model's scene, or null if it did not load (the ground still draws without it).
function gltfScene(key) {
  try {
    return AssetManager.getGLTF(key)?.scene ?? null;
  } catch (_) {
    return null;
  }
}

export class CricketScene {
  constructor() {
    this.root = new Group();
    this.root.name = 'cricket-ground';
    this.mixer = null;
    this.arm = null;

    this.buildLights();
    this.buildGround();
    this.buildStumps();
    this.buildSightscreen();
    this.buildScenery();
    this.loadBowler();
  }

  // Afternoon sun from behind the batsman's left, plus a sky/grass fill so nothing goes black on the shade side.
  buildLights() {
    const sun = new DirectionalLight('#fff1d6', 1.7);
    sun.position.set(-10, 24, 4);
    sun.target.position.set(0, GROUND, CENTER_Z);
    this.root.add(sun, sun.target);
    this.root.add(new HemisphereLight('#cfe6ff', '#4a7a3a', 0.7));
  }

  buildGround() {
    // Outfield: tiled grass, with a gentle large-scale tone change from vertex colours so the tiling does not read as a repeat.
    const SIZE = 180;
    const geo = new PlaneGeometry(SIZE, SIZE, 45, 45);
    const rand = seeded(4);
    const colors = [];
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = 0.92 + 0.06 * Math.sin(pos.getX(i) * 0.11 + 1.3) * Math.cos(pos.getY(i) * 0.09) + 0.03 * rand();
      colors.push(v, v, v);
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const grassMap = grassTexture();
    grassMap.repeat.set(SIZE / 8, SIZE / 8);
    const grass = groundLayer(new Mesh(geo, new MeshStandardMaterial({ map: grassMap, vertexColors: true, roughness: 0.95 })), 0);
    grass.position.set(0, GROUND, CENTER_Z);
    this.root.add(grass);

    // The square: a closer-mown, lighter rectangle the pitch sits in (same grass, tinted, so there is no see-through layer).
    const squareMap = grassTexture();
    squareMap.repeat.set(9 / 8, 28 / 8);
    const square = groundLayer(new Mesh(new PlaneGeometry(9, 28), new MeshStandardMaterial({ map: squareMap, color: '#d6f0c4', roughness: 0.95 })), 1);
    square.position.set(0, GROUND + 0.004, PITCH_MID);
    this.root.add(square);

    const pitch = groundLayer(new Mesh(new PlaneGeometry(PITCH_W, PITCH_NEAR - PITCH_FAR), new MeshStandardMaterial({ map: pitchTexture(), roughness: 0.92 })), 2);
    pitch.position.set(0, GROUND + 0.008, PITCH_MID);
    this.root.add(pitch);

    // Boundary rope, laid on the grass inside the fence.
    const rope = new Mesh(new TorusGeometry(ROPE_R, 0.045, 6, 220), new MeshStandardMaterial({ color: '#f2efe6', roughness: 0.8 }));
    rope.rotation.x = -Math.PI / 2;
    rope.position.set(0, GROUND + 0.045, CENTER_Z);
    this.root.add(rope);
  }

  // Two sets of stumps and bails: the batsman's behind the chair, the bowler's at the far end.
  buildStumps() {
    const wood = new MeshStandardMaterial({ color: '#e8d6ad', roughness: 0.5 });
    const stump = new CylinderGeometry(0.0195, 0.0195, 0.711, 12);
    const bail = new CylinderGeometry(0.0075, 0.0075, 0.112, 8);
    for (const z of [FIELD.batsmanStumpsZ, FIELD.bowlerStumpsZ]) {
      for (const x of [-0.114, 0, 0.114]) {
        const s = new Mesh(stump, wood);
        s.position.set(x, GROUND + 0.3555, z);
        this.root.add(s);
      }
      for (const x of [-0.057, 0.057]) {
        const b = new Mesh(bail, wood);
        b.rotation.z = Math.PI / 2;
        b.position.set(x, GROUND + 0.718, z);
        this.root.add(b);
      }
    }
  }

  // Sightscreen on the boundary behind the bowler. Dark, as for a white-ball game, so the red ball and the white ring around
  // it are easy to pick up at release.
  buildSightscreen() {
    const board = new MeshStandardMaterial({ color: '#16241c', roughness: 0.85 });
    const steel = new MeshStandardMaterial({ color: '#5d6670', roughness: 0.5, metalness: 0.3 });
    const screen = new Group();
    const panel = new Mesh(new BoxGeometry(10, 4.2, 0.12), board);
    panel.position.y = 0.45 + 2.1;
    screen.add(panel);
    for (const x of [-4.6, -1.5, 1.5, 4.6]) {
      const leg = new Mesh(new BoxGeometry(0.12, 0.6, 0.9), steel);
      leg.position.set(x, 0.3, 0.3);
      screen.add(leg);
    }
    screen.position.set(0, GROUND, CENTER_Z - ROPE_R - 1);
    this.root.add(screen);
  }

  // Repeated models become one instanced mesh per sub-mesh: dozens of trees cost a handful of draw calls.
  // Each item: { angle, radius, height | width, rotY } around the middle of the ground, standing on the grass.
  placeInstanced(key, items) {
    const proto = gltfScene(key);
    if (!proto || !items.length) return;
    proto.position.set(0, 0, 0);
    proto.rotation.set(0, 0, 0);
    proto.scale.set(1, 1, 1);
    proto.updateMatrixWorld(true);
    box.setFromObject(proto);
    box.getSize(size);
    const lift = new Matrix4().makeTranslation(0, -box.min.y, 0);
    const parts = [];
    proto.traverse((o) => {
      if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
    });
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    const m = new Matrix4();
    const up = new Vector3(0, 1, 0);
    for (const part of parts) {
      const inst = new InstancedMesh(part.geometry, part.material, items.length);
      items.forEach(({ angle, radius, height, width, rotY = 0 }, i) => {
        const k = width ? width / size.x : height / size.y;
        p.set(Math.cos(angle) * radius, GROUND, CENTER_Z + Math.sin(angle) * radius);
        q.setFromAxisAngle(up, rotY);
        s.setScalar(k);
        m.compose(p, q, s).multiply(lift).multiply(part.matrix);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      this.root.add(inst);
    }
  }

  buildScenery() {
    const rand = seeded(11);

    // Boundary fence: a ring of panels, each turned to follow the circle.
    const panels = 44;
    const chord = 2 * FENCE_R * Math.sin(Math.PI / panels);
    const fence = [];
    for (let i = 0; i < panels; i++) {
      const angle = (i / panels) * Math.PI * 2;
      fence.push({ angle, radius: FENCE_R, width: chord * 1.02, rotY: Math.atan2(-Math.cos(angle), -Math.sin(angle)) });
    }
    this.placeInstanced('fence', fence);

    // Hedge just outside the fence, then a tree line behind it.
    const bushes = { bush: [], 'bush-large': [] };
    for (let i = 0; i < 46; i++) {
      bushes[rand() < 0.5 ? 'bush' : 'bush-large'].push({
        angle: (i / 46) * Math.PI * 2 + rand() * 0.05,
        radius: 32 + rand() * 2.5,
        height: 1.2 + rand() * 1.1,
        rotY: rand() * Math.PI * 2,
      });
    }
    for (const [key, items] of Object.entries(bushes)) this.placeInstanced(key, items);

    const kinds = ['tree-oak', 'tree-pine', 'tree-pine-tall', 'tree-fat'];
    const trees = Object.fromEntries(kinds.map((k) => [k, []]));
    for (let i = 0; i < 70; i++) {
      trees[kinds[Math.floor(rand() * kinds.length)]].push({
        angle: (i / 70) * Math.PI * 2 + rand() * 0.08,
        radius: 37 + rand() * 12,
        height: 7 + rand() * 6,
        rotY: rand() * Math.PI * 2,
      });
    }
    for (const [key, items] of Object.entries(trees)) this.placeInstanced(key, items);

    // A pavilion tent off to the side and a few rocks as landmarks.
    this.placeInstanced('tent', [{ angle: -0.9, radius: 34.5, height: 4.5, rotY: 0.6 }]);
    const rocks = { 'rock-large': [], 'rock-small': [] };
    for (let i = 0; i < 9; i++) {
      rocks[rand() < 0.5 ? 'rock-large' : 'rock-small'].push({
        angle: rand() * Math.PI * 2,
        radius: 33.5 + rand() * 3,
        height: 0.6 + rand() * 1.2,
        rotY: rand() * Math.PI * 2,
      });
    }
    for (const [key, items] of Object.entries(rocks)) this.placeInstanced(key, items);
  }

  loadBowler() {
    let gltf = null;
    try {
      gltf = AssetManager.getGLTF('bowler');
    } catch (_) {
      gltf = null;
    }
    if (!gltf) return; // the scene works without him (ground, pitch and stumps still draw)
    const model = gltf.scene;
    const b = new Box3().setFromObject(model);
    const scale = 1.86 / (b.max.y - b.min.y);
    model.position.set(0, -b.min.y, 0);
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

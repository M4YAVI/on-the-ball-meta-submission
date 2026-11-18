// The floodlit football ground, seen from the GOALKEEPER's seat: a striped pitch with real markings (goal line, 6-yard box,
// penalty area, spot and arc, halfway line and centre circle), the keeper's own goal BEHIND the chair (out of view, as when you
// stand on your line), and the striker at the edge of the penalty area. Stands run along both touchlines and behind the far
// goal, advertising boards carry the ON THE BALL brand, and four floodlight towers light the night sky so the white ball
// stands out against the dark stands and sky. Distances come from FIELD in core/ball-path.js so the tests check them.
// Everything is placed in the viewer's eye frame (origin at the eyes, -z straight ahead), and the grass sits GROUND metres
// below the eyes, which is where a seated player's floor is.
//
// Cheap on purpose (Quest needs 60 fps or better): one directional light plus a hemisphere fill, no shadows, textures drawn
// once in code, unlit materials for the crowd and the sky, and a handful of meshes for the whole stadium.

import {
  AdditiveBlending,
  AnimationMixer,
  AssetManager,
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from '@iwsdk/core';

import { FIELD, PATH, PHYS } from '../core/ball-path.js';
import { footballTexture } from './ball.js';
import { mergeStatic } from '../../../src/xr/merge-static.js';

export const GROUND = FIELD.ground; // metres below the eyes

// Pitch: 68 x 105 m. The keeper's goal line is at FIELD.goalLineZ, the far goal line 105 m ahead of it.
const PITCH_W = 68;
const PITCH_L = 105;
const NEAR = FIELD.goalLineZ;
const FAR = NEAR - PITCH_L;
const MID = (NEAR + FAR) / 2;
const PX_M = 16; // texture pixels per metre
const LINE = 0.14; // painted line width, metres (a little wider than the real 12 cm so it reads from a headset)

// How the kicker's leg moves around the strike. Seconds relative to the moment the ball leaves the foot.
const KICK = Object.freeze({ start: -0.42, wind: -0.1, contact: 0, end: 0.5 });

// The run-up before it, same clock. He starts a few metres back and to the side, jogs in on a diagonal like a real striker (turning
// his body to the ball as he arrives), the stride settles into the plant, and the kick above takes over. After the strike he
// carries on forward one step. Offsets are metres from where he stands when he hits it; x is the keeper's right (his left).
const RUN = Object.freeze({
  start: -1.55, // s: he starts moving
  end: -0.25, // s: he has arrived beside the ball
  fromX: 1.7,
  fromZ: -3.7, // behind the ball, so the run is toward the keeper
  cadence: 1.45, // full leg cycles per second (about 2.9 steps a second, a jog)
  fadeFrom: -0.66, // s: the stride starts to settle...
  fadeTo: -0.42, // ...and is gone when the kick's draw-back begins
  followThrough: 0.55, // m he carries on forward after the strike
});
const smooth = (u) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * (3 - 2 * x);
};

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function canvasTexture(w, h, draw, { repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// Pitch: mowing stripes across the pitch, fine blade noise, and every marking painted to the Laws' measurements.
function pitchTexture() {
  const W = PITCH_W * PX_M;
  const H = PITCH_L * PX_M;
  // metres (x across, z along; z = NEAR is the keeper's goal line) -> pixels
  const X = (x) => (x + PITCH_W / 2) * PX_M;
  const Y = (z) => (NEAR - z) * PX_M;
  return canvasTexture(W, H, (g) => {
    const stripeLen = PITCH_L / 14;
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i % 2 ? '#3f8a3c' : '#4a9a45';
      g.fillRect(0, i * stripeLen * PX_M, W, stripeLen * PX_M + 1);
    }
    const rand = seeded(5);
    for (let i = 0; i < 90000; i++) {
      g.fillStyle = rand() < 0.5 ? `rgba(15,55,15,${0.1 + rand() * 0.15})` : `rgba(190,235,130,${0.08 + rand() * 0.12})`;
      g.fillRect(rand() * W, rand() * H, 1, 2 + rand() * 2);
    }
    // worn goalmouth and penalty spot
    for (const z of [NEAR - 2, FAR + 2]) {
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(120,95,50,${0.04 + rand() * 0.07})`;
        g.beginPath();
        g.ellipse(X((rand() - 0.5) * 9), Y(z + (rand() - 0.5) * 3.5), 4 + rand() * 9, 4 + rand() * 9, rand() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = '#f4f6f0';
    g.fillStyle = '#f4f6f0';
    g.lineWidth = LINE * PX_M;
    const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Y(z0), (x1 - x0) * PX_M, (z1 - z0) * -PX_M);
    const dotAt = (x, z, r) => {
      g.beginPath();
      g.arc(X(x), Y(z), r * PX_M, 0, Math.PI * 2);
      g.fill();
    };
    rect(-PITCH_W / 2 + LINE / 2, NEAR - LINE / 2, PITCH_W / 2 - LINE / 2, FAR + LINE / 2); // touchlines and goal lines
    g.beginPath(); // halfway line
    g.moveTo(X(-PITCH_W / 2), Y(MID));
    g.lineTo(X(PITCH_W / 2), Y(MID));
    g.stroke();
    g.beginPath(); // centre circle
    g.arc(X(0), Y(MID), 9.15 * PX_M, 0, Math.PI * 2);
    g.stroke();
    dotAt(0, MID, 0.2);
    for (const end of [1, -1]) {
      // end = 1 is the keeper's end, -1 the far end
      const goalLine = end === 1 ? NEAR : FAR;
      const into = end === 1 ? -1 : 1; // direction from the goal line into the pitch
      rect(-9.16, goalLine, 9.16, goalLine + into * 5.5); // 6-yard box
      rect(-20.16, goalLine, 20.16, goalLine + into * 16.5); // penalty area
      const spot = goalLine + into * 11;
      dotAt(0, spot, 0.2);
      // the arc: the part of the 9.15 m circle around the spot that lies outside the penalty area
      const a = Math.acos((16.5 - 11) / 9.15);
      g.beginPath();
      if (end === 1) g.arc(X(0), Y(spot), 9.15 * PX_M, Math.PI / 2 - a, Math.PI / 2 + a); // opens toward the pitch, down the canvas
      else g.arc(X(0), Y(spot), 9.15 * PX_M, -Math.PI / 2 - a, -Math.PI / 2 + a);
      g.stroke();
    }
  });
}

function outfieldTexture() {
  return canvasTexture(
    256,
    256,
    (g, S) => {
      g.fillStyle = '#2f6a31';
      g.fillRect(0, 0, S, S);
      const rand = seeded(8);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rand() < 0.5 ? `rgba(10,40,12,${0.15 + rand() * 0.2})` : `rgba(150,205,110,${0.1 + rand() * 0.15})`;
        g.fillRect(rand() * S, rand() * S, 1, 2 + rand() * 3);
      }
    },
    { repeat: true },
  );
}

// Transparent grass-blade speckle, tiled every 3 m, laid over the pitch for close-up detail.
function detailTexture() {
  return canvasTexture(
    512,
    512,
    (g, S) => {
      g.clearRect(0, 0, S, S);
      const rand = seeded(31);
      for (let i = 0; i < 16000; i++) {
        g.fillStyle = rand() < 0.5 ? `rgba(8,40,10,${0.1 + rand() * 0.16})` : `rgba(200,240,140,${0.08 + rand() * 0.12})`;
        g.fillRect(rand() * S, rand() * S, 1.5, 3 + rand() * 4);
      }
    },
    { repeat: true },
  );
}

// The crowd: dark seats with a speckle of muted shirts and a few bright dots. Kept dark so the white ball always stands out.
function crowdTexture() {
  return canvasTexture(
    512,
    256,
    (g, W, H) => {
      g.fillStyle = '#10161a';
      g.fillRect(0, 0, W, H);
      const rand = seeded(17);
      const shirts = ['#2a3d4a', '#3d2a2e', '#2e4636', '#4a4630', '#303a52', '#5a2d2d', '#d8d8d0', '#3d8f5a'];
      for (let row = 0; row < 32; row++) {
        g.fillStyle = 'rgba(255,255,255,0.03)';
        g.fillRect(0, row * 8, W, 1);
        for (let i = 0; i < 80; i++) {
          if (rand() < 0.12) continue;
          const x = (i + rand() * 0.6) * (W / 80);
          g.fillStyle = shirts[Math.floor(rand() * shirts.length)];
          g.globalAlpha = 0.55 + rand() * 0.35;
          g.fillRect(x, row * 8 + 1, 4.5, 4);
          g.fillStyle = '#c9a88a'; // heads
          g.globalAlpha = 0.5;
          g.fillRect(x + 1, row * 8 - 1, 2.5, 2.5);
        }
      }
      g.globalAlpha = 1;
    },
    { repeat: true },
  );
}

// Advertising board: the brand, in the deck's dark green.
function boardTexture() {
  return canvasTexture(
    1024,
    64,
    (g, W, H) => {
      g.fillStyle = '#0c2418';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#3DDC84';
      g.font = '800 34px "Inter","Segoe UI",Arial,sans-serif';
      g.textBaseline = 'middle';
      g.fillText('ON THE BALL', 24, H / 2 + 1);
      g.fillStyle = '#e8f3ec';
      g.font = '600 26px "Inter","Segoe UI",Arial,sans-serif';
      g.fillText('WATCH THE BALL. GET THE COUNT.', 290, H / 2 + 1);
      g.fillStyle = '#3DDC84';
      g.fillRect(W - 8, 0, 8, H);
    },
    { repeat: true },
  );
}

function skyTexture() {
  return canvasTexture(8, 256, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#04080f');
    grad.addColorStop(0.55, '#0b1c2c');
    grad.addColorStop(0.8, '#15354a');
    grad.addColorStop(1, '#2a5560');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  });
}

function glowSprite(color = '#fff4d8') {
  const t = canvasTexture(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,248,225,0.95)');
    r.addColorStop(0.25, 'rgba(255,240,200,0.4)');
    r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  const s = new Sprite(new SpriteMaterial({ map: t, color, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
  s.renderOrder = 3;
  return s;
}

// A tilted stand: a sloped crowd face, a back wall and a roof. Local +x points away from the pitch, length runs along z.
function stand(length, depth, rise, crowd) {
  const g = new Group();
  const geo = new BufferGeometry();
  const L = length / 2;
  geo.setAttribute('position', new Float32BufferAttribute([0, 0, -L, 0, 0, L, depth, rise, L, depth, rise, -L], 3));
  geo.setAttribute('uv', new Float32BufferAttribute([0, 0, length / 28, 0, length / 28, rise / 5, 0, rise / 5], 2));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  geo.computeVertexNormals();
  const face = new Mesh(geo, new MeshBasicMaterial({ map: crowd, color: '#b8c2c8', side: DoubleSide, fog: false }));
  g.add(face);
  const back = new Mesh(new BoxGeometry(0.6, rise + 2, length), new MeshBasicMaterial({ color: '#0c1116', fog: false }));
  back.position.set(depth + 0.3, (rise + 2) / 2, 0);
  g.add(back);
  const roof = new Mesh(new BoxGeometry(depth + 4, 0.5, length), new MeshBasicMaterial({ color: '#171d23', fog: false }));
  roof.position.set(depth / 2 - 1.5, rise + 4.5, 0);
  g.add(roof);
  return g;
}

export class FootballScene {
  constructor() {
    this.root = new Group();
    this.root.name = 'football-ground';
    this.mixer = null;
    this.leg = null;
    this.deliveryT = null;

    this.buildLights();
    this.buildSky();
    this.buildPitch();
    this.buildGoal();
    this.buildStadium();
    // the pitch, the goal and the stands never move: one draw call per material (Quest budget; src/xr/merge-static.js)
    this.mergedCalls = mergeStatic(this.root);
    this.buildBall();
    this.loadStriker();
  }

  // Floodlit night: a cool hemisphere fill and one strong white light from above the keeper's end.
  buildLights() {
    const lamp = new DirectionalLight('#fff6e4', 2.2);
    lamp.position.set(8, 40, 14);
    lamp.target.position.set(0, GROUND, MID * 0.4);
    this.root.add(lamp, lamp.target);
    this.root.add(new HemisphereLight('#b9d2ff', '#2f6a3a', 1.0));
  }

  buildSky() {
    const sky = new Mesh(new SphereGeometry(190, 24, 16), new MeshBasicMaterial({ map: skyTexture(), side: BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    sky.position.set(0, 0, MID);
    this.root.add(sky);
  }

  buildPitch() {
    const out = outfieldTexture();
    out.repeat.set(30, 30);
    const outer = new Mesh(new PlaneGeometry(240, 260), new MeshStandardMaterial({ map: out, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(0, GROUND - 0.01, MID);
    outer.renderOrder = 0;
    this.root.add(outer);

    const pitch = new Mesh(new PlaneGeometry(PITCH_W, PITCH_L), new MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(0, GROUND, MID);
    pitch.renderOrder = 1;
    // drawn after the outer grass and pulled toward the camera in the depth test: a headset's depth buffer cannot separate
    // layers a centimetre apart at 100 m, so the order is fixed instead
    pitch.material.polygonOffset = true;
    pitch.material.polygonOffsetFactor = -1;
    pitch.material.polygonOffsetUnits = -4;
    this.root.add(pitch);

    // Fine blade detail over the painted pitch: the big texture is only 16 px per metre, which is soft at the keeper's feet.
    const detail = detailTexture();
    detail.repeat.set(PITCH_W / 3, PITCH_L / 3);
    const blades = new Mesh(new PlaneGeometry(PITCH_W, PITCH_L), new MeshBasicMaterial({ map: detail, transparent: true, depthWrite: false, fog: false }));
    blades.rotation.x = -Math.PI / 2;
    blades.position.set(0, GROUND + 0.002, MID);
    blades.renderOrder = 2;
    blades.material.polygonOffset = true;
    blades.material.polygonOffsetFactor = -2;
    blades.material.polygonOffsetUnits = -8;
    this.root.add(blades);
  }

  // The keeper's goal behind the chair and the far goal at the other end. Frame and net, to the Laws' size.
  buildGoal() {
    const white = new MeshStandardMaterial({ color: '#f4f6f0', roughness: 0.4 });
    const netTex = canvasTexture(
      64,
      64,
      (g, S) => {
        g.clearRect(0, 0, S, S);
        g.strokeStyle = 'rgba(240,244,238,0.85)';
        g.lineWidth = 2;
        g.strokeRect(0, 0, S, S);
      },
      { repeat: true },
    );
    const netMat = new MeshBasicMaterial({ map: netTex, transparent: true, side: DoubleSide, depthWrite: false, fog: false });
    const hw = FIELD.goalHalfWidth;
    const gh = FIELD.goalHeight;
    const post = new CylinderGeometry(0.06, 0.06, gh, 12);
    const bar = new CylinderGeometry(0.06, 0.06, hw * 2, 12);
    const makeGoal = (lineZ, depthDir) => {
      const g = new Group();
      for (const x of [-hw, hw]) {
        const p = new Mesh(post, white);
        p.position.set(x, GROUND + gh / 2, lineZ);
        g.add(p);
      }
      const b = new Mesh(bar, white);
      b.rotation.z = Math.PI / 2;
      b.position.set(0, GROUND + gh, lineZ);
      g.add(b);
      const back = new Mesh(new PlaneGeometry(hw * 2, gh), netMat.clone());
      back.material.map = netTex.clone();
      back.material.map.repeat.set(hw * 2 * 4, gh * 4);
      back.material.map.needsUpdate = true;
      back.position.set(0, GROUND + gh / 2, lineZ + depthDir * FIELD.goalDepth);
      g.add(back);
      const top = new Mesh(new PlaneGeometry(hw * 2, FIELD.goalDepth), netMat.clone());
      top.material.map = netTex.clone();
      top.material.map.repeat.set(hw * 2 * 4, FIELD.goalDepth * 4);
      top.material.map.needsUpdate = true;
      top.rotation.x = Math.PI / 2;
      top.position.set(0, GROUND + gh, lineZ + (depthDir * FIELD.goalDepth) / 2);
      g.add(top);
      for (const x of [-hw, hw]) {
        const side = new Mesh(new PlaneGeometry(FIELD.goalDepth, gh), netMat.clone());
        side.material.map = netTex.clone();
        side.material.map.repeat.set(FIELD.goalDepth * 4, gh * 4);
        side.material.map.needsUpdate = true;
        side.rotation.y = Math.PI / 2;
        side.position.set(x, GROUND + gh / 2, lineZ + (depthDir * FIELD.goalDepth) / 2);
        g.add(side);
      }
      this.root.add(g);
    };
    makeGoal(NEAR, 1);
    makeGoal(FAR, -1);
  }

  // Stands on all four sides, advertising boards in front of them, and floodlight towers at the corners.
  buildStadium() {
    const crowd = crowdTexture();
    const boards = boardTexture();
    const sideX = PITCH_W / 2 + 7;
    const endZ = 8;
    const rise = 17;
    const depth = 24;
    // touchline stands (length runs along the pitch)
    for (const sign of [1, -1]) {
      const s = stand(PITCH_L + 16, depth, rise, crowd);
      s.position.set(sign * sideX, GROUND, MID);
      s.rotation.y = sign === 1 ? 0 : Math.PI;
      this.root.add(s);
    }
    // end stands: behind the far goal, and behind the keeper
    for (const [z, rot] of [
      [FAR - endZ, Math.PI / 2],
      [NEAR + endZ, -Math.PI / 2],
    ]) {
      const s = stand(PITCH_W + 14, depth, rise, crowd);
      s.position.set(0, GROUND, z);
      s.rotation.y = rot;
      this.root.add(s);
    }
    // advertising boards: 0.9 m high, a few metres outside the lines
    const board = (len, x, z, rotY) => {
      const t = boards.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 16, 1);
      const m = new Mesh(new PlaneGeometry(len, 0.9), new MeshBasicMaterial({ map: t, side: DoubleSide, fog: false }));
      m.position.set(x, GROUND + 0.45, z);
      m.rotation.y = rotY;
      this.root.add(m);
    };
    board(PITCH_L + 6, PITCH_W / 2 + 3.5, MID, -Math.PI / 2);
    board(PITCH_L + 6, -(PITCH_W / 2 + 3.5), MID, Math.PI / 2);
    board(PITCH_W + 7, 0, FAR - 4, 0);
    board(PITCH_W + 7, 0, NEAR + 4, Math.PI);

    // floodlight towers
    const pole = new MeshStandardMaterial({ color: '#4b535a', roughness: 0.6, metalness: 0.4 });
    const head = new MeshBasicMaterial({ color: '#fffaf0', fog: false });
    for (const x of [-1, 1]) {
      for (const z of [NEAR + 14, FAR - 14]) {
        const tower = new Group();
        const mast = new Mesh(new CylinderGeometry(0.5, 0.8, 38, 8), pole);
        mast.position.y = 19;
        const lamps = new Mesh(new BoxGeometry(9, 4.5, 1), head);
        lamps.position.y = 39;
        lamps.rotation.y = x > 0 ? -Math.PI / 2 : Math.PI / 2; // the light panel faces the pitch
        const halo = glowSprite();
        halo.scale.setScalar(26);
        halo.position.y = 39;
        tower.add(mast, lamps, halo);
        tower.position.set(x * (PITCH_W / 2 + 22), GROUND, z);
        this.root.add(tower);
      }
    }
  }

  // A football resting on the grass where the striker will hit it, shown during the build-up and gone once it is struck.
  buildBall() {
    this.restBall = new Mesh(
      new SphereGeometry(PHYS.ballRadius, 24, 16),
      new MeshStandardMaterial({ map: footballTexture(), roughness: 0.45, emissive: '#d8d8d8', emissiveIntensity: 0.25 }),
    );
    this.restBall.position.set(PATH.releaseX, PATH.releaseY, PATH.releaseZ);
    this.restBall.visible = false;
    this.root.add(this.restBall);
  }

  setBallAtRest(v) {
    this.restBall.visible = v;
  }

  loadStriker() {
    let gltf = null;
    try {
      gltf = AssetManager.getGLTF('striker');
    } catch (_) {
      gltf = null;
    }
    if (!gltf) return; // the scene works without him (pitch, goal and stands still draw)
    const model = gltf.scene;
    const b = new Box3().setFromObject(model);
    const scale = 1.82 / (b.max.y - b.min.y);
    model.position.set(0, -b.min.y, 0);
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned: bind-pose bounds do not follow the pose
    });
    const holder = new Group();
    holder.add(model);
    holder.scale.setScalar(scale);
    holder.position.set(0, GROUND, FIELD.strikerZ);
    this.root.add(holder);
    this.striker = holder;
    this.mixer = new AnimationMixer(model);
    const idle = gltf.animations.find((a) => a.name === 'Idle_Loop');
    if (idle) this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();
    this.thigh = model.getObjectByName('thigh_r');
    this.calf = model.getObjectByName('calf_r');
    this.thighL = model.getObjectByName('thigh_l');
    this.calfL = model.getObjectByName('calf_l');
    this.armR = model.getObjectByName('upperarm_r');
    this.armL = model.getObjectByName('upperarm_l');
    this.spine = model.getObjectByName('spine_01');
    this.baseY = holder.position.y;
  }

  // Where the striker is, which way he faces, and how hard his legs are working, at t seconds from the strike. Pure: the same t
  // always gives the same pose, so a paused or replayed shot cannot drift.
  static runPose(t) {
    const out = { x: 0, z: 0, yaw: 0, phase: 0, amp: 0, bob: 0, lean: 0 };
    if (t == null || !Number.isFinite(t)) return out;
    const { start, end, fromX, fromZ, cadence, fadeFrom, fadeTo, followThrough } = RUN;
    if (t >= 0) {
      out.z = followThrough * (1 - (1 - Math.min(1, t / 0.55)) ** 2); // a step on, slowing
      out.yaw = -0.08 * smooth(t / 0.5);
      return out;
    }
    if (t <= start) {
      const heading = Math.atan2(-fromX, -fromZ);
      out.x = fromX;
      out.z = fromZ;
      out.yaw = heading;
      return out;
    }
    const s = Math.min(1, (t - start) / (end - start));
    const f = 0.4 * s + 0.6 * smooth(s); // jogs off, eases into the ball
    out.x = fromX * (1 - f);
    out.z = fromZ * (1 - f);
    const heading = Math.atan2(-fromX, -fromZ);
    out.yaw = heading * (1 - smooth((t + 0.78) / 0.5)) - 0.08 * smooth((t + 0.5) / 0.5); // body turns square to the ball as he plants
    out.phase = 2 * Math.PI * cadence * (t - start);
    const up = smooth((t - start) / 0.3);
    const down = 1 - smooth((t - fadeFrom) / (fadeTo - fadeFrom));
    out.amp = up * down;
    out.bob = Math.abs(Math.sin(out.phase)) * out.amp;
    out.lean = out.amp * 0.12 * (1 - smooth((t + 0.8) / 0.3) * 0.6);
    return out;
  }

  // tRel: seconds relative to the moment the ball leaves the foot (negative before, positive after); null = standing.
  setDelivery(tRel) {
    this.deliveryT = tRel;
  }

  // 0 = leg at rest, -1 = full back-swing, +1 = full follow-through (before the sign the skeleton needs is applied).
  static legSwing(t) {
    const { start, wind, contact, end } = KICK;
    if (t <= start || t >= end) return { swing: 0, knee: 0 };
    const ease = (u) => u * u * (3 - 2 * u);
    if (t < wind) return { swing: -ease((t - start) / (wind - start)), knee: ease((t - start) / (wind - start)) }; // draw the foot back, knee bends
    if (t < contact + 0.06) {
      const u = ease((t - wind) / (contact + 0.06 - wind)); // whip through: fastest at the ball
      return { swing: -1 + 2 * u, knee: 1 - u };
    }
    const u = ease((t - contact - 0.06) / (end - contact - 0.06)); // follow-through settles
    return { swing: 1 - u, knee: 0.2 * (1 - u) };
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    const t = this.deliveryT;
    if (this.striker) {
      const r = FootballScene.runPose(t);
      this.striker.position.set(r.x, this.baseY + r.bob * 0.035, FIELD.strikerZ + r.z);
      this.striker.rotation.y = r.yaw;
      if (this.thigh && r.amp > 0.001) {
        // Opposite legs: one forward while the other is back. The knee folds most as the leg comes through, and the foot stays
        // lifted on the way back, like a jog. Arms swing against the legs and the body leans into the run.
        const stride = (phase, thigh, calf) => {
          if (thigh) thigh.rotation.x += Math.sin(phase) * 0.62 * r.amp * FootballScene.LEG_SIGN;
          if (calf) calf.rotation.x += (0.12 + Math.max(0, Math.cos(phase)) * 0.85) * r.amp * 1.1 * FootballScene.KNEE_SIGN;
        };
        stride(r.phase, this.thigh, this.calf);
        stride(r.phase + Math.PI, this.thighL, this.calfL);
        if (this.armR) this.armR.rotation.x += Math.sin(r.phase + Math.PI) * 0.5 * r.amp * FootballScene.ARM_SIGN;
        if (this.armL) this.armL.rotation.x += Math.sin(r.phase) * 0.5 * r.amp * FootballScene.ARM_SIGN;
        if (this.spine) this.spine.rotation.x += r.lean * FootballScene.LEAN_SIGN;
      }
    }
    if (this.thigh && t != null) {
      const { swing, knee } = FootballScene.legSwing(t);
      if (swing !== 0 || knee !== 0) {
        this.thigh.rotation.x += swing * 0.95 * FootballScene.LEG_SIGN;
        if (this.calf) this.calf.rotation.x += knee * 1.1 * FootballScene.KNEE_SIGN;
        // a small counter-lean of the planted leg keeps him from looking nailed to the floor
        if (this.thighL) this.thighL.rotation.x -= Math.abs(swing) * 0.08 * FootballScene.LEG_SIGN;
      }
    }
  }
}

// Which way the skeleton's X axis swings a leg forward / bends a knee. Checked against the model (see tests/screens).
FootballScene.LEG_SIGN = 1;
FootballScene.KNEE_SIGN = 1;
FootballScene.ARM_SIGN = 1;
FootballScene.LEAN_SIGN = 1;

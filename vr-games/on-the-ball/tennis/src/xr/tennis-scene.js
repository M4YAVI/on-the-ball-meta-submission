// The floodlit tennis court, seen from the RECEIVER's seat on the baseline: a hard court with every line painted to the real
// measurements (baselines, singles and doubles sidelines, service lines, centre service line, centre marks), the net with its
// posts and white tape, dark-green windscreens carrying the ON THE BALL name, a stand behind the far baseline, an umpire's
// chair, and the server on the far baseline, about 23 m away. The player's own body is not drawn.
// Distances come from COURT / FIELD in core/ball-path.js so the tests check them.
// Everything is placed in the viewer's eye frame (origin at the eyes, -z straight ahead), and the court sits GROUND metres below
// the eyes, which is where a seated player's floor is.
//
// Cheap on purpose (Quest needs 60 fps or better): one directional light plus a hemisphere fill, no shadows, textures drawn once
// in code, unlit materials for the crowd and the sky, and a handful of meshes for the whole venue.

import {
  AnimationMixer,
  AssetManager,
  BackSide,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
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
  TorusGeometry,
} from '@iwsdk/core';

import { COURT, FIELD, PATH, PHYS, SIDE, TOSS, cleanSide, courtShiftX, serverXFor, tossPosition } from '../core/ball-path.js';
import { tennisTexture } from './ball.js';

export const GROUND = FIELD.ground; // metres below the eyes
const CX = COURT.centreLineX;
const NEAR = FIELD.baselineNearZ;
const FAR = FIELD.baselineFarZ;
const MID = (NEAR + FAR) / 2;
const PAD_X = 8.5; // paved run-off beside the doubles lines
const PAD_Z = 6.2; // and behind each baseline
const PX_M = 36; // texture pixels per metre
const LINE = 0.09; // painted line width, metres (a little wider than the real 5 to 10 cm so it reads from a headset)

// The serve action, in seconds relative to the strike. The hitting arm makes one over-the-top swing that passes the vertical at
// the strike; the other arm lifts for the toss and drops after it.
const SERVE = Object.freeze({ start: -0.55, end: 0.55 }); // symmetric, so the arm is straight up exactly at the strike
const TOSS_ARM = Object.freeze({ up0: -1.2, up1: -0.85, down0: -0.2, down1: 0.4 });
const HAND_REST = Object.freeze([-2.65, -0.15, -23.58]); // the free hand hanging at the hip

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

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// The painted court. Canvas top is the far end (most negative z), left is most negative x.
const TEX_X0 = CX - (COURT.doublesWidth / 2 + PAD_X);
const TEX_W = COURT.doublesWidth + 2 * PAD_X;
const TEX_Z0 = FAR - PAD_Z;
const TEX_L = COURT.length + 2 * PAD_Z;
function courtTexture() {
  return canvasTexture(Math.round(TEX_W * PX_M), Math.round(TEX_L * PX_M), (g, W, H) => {
    const px = (x) => (x - TEX_X0) * PX_M;
    const pz = (z) => (z - TEX_Z0) * PX_M;
    g.fillStyle = '#12382a'; // dark-green run-off: the brand colour
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#2c7355'; // the court itself, inside the doubles lines and baselines
    g.fillRect(px(CX - COURT.doublesWidth / 2), pz(FAR), COURT.doublesWidth * PX_M, COURT.length * PX_M);
    g.fillStyle = '#34815f'; // the singles court a shade lighter
    g.fillRect(px(CX - COURT.singlesWidth / 2), pz(FAR), COURT.singlesWidth * PX_M, COURT.length * PX_M);
    g.fillStyle = '#ffffff';
    const hl = (z, x0, x1) => g.fillRect(px(x0), pz(z) - (LINE * PX_M) / 2, (x1 - x0) * PX_M, LINE * PX_M);
    const vl = (x, z0, z1) => g.fillRect(px(x) - (LINE * PX_M) / 2, pz(z0), LINE * PX_M, (z1 - z0) * PX_M);
    const dw = COURT.doublesWidth / 2;
    const sw = COURT.singlesWidth / 2;
    const net = FIELD.netZ;
    const sNear = net + COURT.serviceDepth; // service line nearest the receiver
    const sFar = net - COURT.serviceDepth;
    hl(NEAR, CX - dw, CX + dw); // baselines
    hl(FAR, CX - dw, CX + dw);
    vl(CX - dw, FAR, NEAR); // doubles sidelines
    vl(CX + dw, FAR, NEAR);
    vl(CX - sw, FAR, NEAR); // singles sidelines
    vl(CX + sw, FAR, NEAR);
    hl(sNear, CX - sw, CX + sw); // service lines
    hl(sFar, CX - sw, CX + sw);
    vl(CX, sFar, sNear); // centre service line
    g.fillRect(px(CX) - (LINE * PX_M) / 2, pz(NEAR) - 0.1 * PX_M, LINE * PX_M, 0.1 * PX_M); // centre marks
    g.fillRect(px(CX) - (LINE * PX_M) / 2, pz(FAR), LINE * PX_M, 0.1 * PX_M);
    // a faint wear patch where the receiver sits and where the server stands
    g.fillStyle = 'rgba(0,0,0,0.10)';
    g.beginPath();
    g.ellipse(px(CX + 2), pz(NEAR + 0.4), 1.6 * PX_M, 1.0 * PX_M, 0, 0, Math.PI * 2);
    g.ellipse(px(FIELD.serverX), pz(FAR - 0.4), 1.4 * PX_M, 0.9 * PX_M, 0, 0, Math.PI * 2);
    g.fill();
    // fine hard-court grain
    const rnd = seeded(7);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${(0.02 + rnd() * 0.03).toFixed(3)})`;
      g.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
  });
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

function crowdTexture() {
  return canvasTexture(512, 128, (g, W, H) => {
    g.fillStyle = '#0c1116';
    g.fillRect(0, 0, W, H);
    const rnd = seeded(11);
    const cols = ['#3b4650', '#55616b', '#6f7a83', '#2e6e5a', '#8b9aa3', '#47535c'];
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(rnd() * W, rnd() * H, 3, 3);
    }
  });
}

function boardTexture(text) {
  return canvasTexture(1024, 128, (g, W, H) => {
    g.fillStyle = '#0d2a20';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#3ddc84';
    g.fillRect(0, H - 10, W, 10);
    g.fillStyle = '#ffffff';
    g.font = '700 64px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, H / 2 - 4);
  });
}

function netTexture() {
  return canvasTexture(256, 32, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(20,24,28,0.55)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(235,240,235,0.65)';
    g.lineWidth = 1.2;
    for (let x = 0; x <= W; x += 8) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 0; y <= H; y += 8) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
  });
}

export class TennisScene {
  constructor() {
    this.root = new Group();
    this.root.name = 'tennis-court';
    this.venue = new Group(); // the court, net, screens, stand and sky: slides sideways between tries, the server does not slide with it
    this.venue.name = 'tennis-venue';
    this.root.add(this.venue);
    this.side = SIDE.DEUCE;
    this.mixer = null;
    this.deliveryT = null;
    this.arm = null;
    this.armL = null;

    this.buildLights();
    this.buildSky();
    this.buildCourt();
    this.buildNet();
    this.buildSurround();
    this.buildBall();
    this.loadServer();
  }

  buildLights() {
    const lamp = new DirectionalLight('#fff6e4', 2.2);
    lamp.position.set(CX + 6, 40, MID + 10);
    lamp.target.position.set(CX, GROUND, MID);
    this.venue.add(lamp, lamp.target);
    this.venue.add(new HemisphereLight('#b9d2ff', '#2f6a4a', 1.0));
  }

  buildSky() {
    const sky = new Mesh(new SphereGeometry(190, 24, 16), new MeshBasicMaterial({ map: skyTexture(), side: BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    sky.position.set(CX, 0, MID);
    this.venue.add(sky);
  }

  buildCourt() {
    const court = new Mesh(new PlaneGeometry(TEX_W, TEX_L), new MeshStandardMaterial({ map: courtTexture(), roughness: 0.85 }));
    court.rotation.x = -Math.PI / 2;
    court.position.set(CX, GROUND, TEX_Z0 + TEX_L / 2);
    this.venue.add(court);
    const outer = new Mesh(new PlaneGeometry(260, 260), new MeshStandardMaterial({ color: '#0c241b', roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(CX, GROUND - 0.02, MID);
    this.venue.add(outer);
  }

  // The net hangs on two posts a little outside the doubles lines: 0.914 m high at the centre, 1.07 m at the posts.
  buildNet() {
    const z = FIELD.netZ;
    const w = COURT.doublesWidth + 2 * 0.914;
    const mesh = new Mesh(new PlaneGeometry(w, COURT.netHeight), new MeshBasicMaterial({ map: netTexture(), transparent: true, side: DoubleSide, depthWrite: false, fog: false }));
    mesh.position.set(CX, GROUND + COURT.netHeight / 2, z);
    this.venue.add(mesh);
    const tape = new Mesh(new BoxGeometry(w, 0.07, 0.025), new MeshStandardMaterial({ color: '#f4f6f0', roughness: 0.6 }));
    tape.position.set(CX, GROUND + COURT.netHeight, z);
    this.venue.add(tape);
    const postMat = new MeshStandardMaterial({ color: '#171d23', roughness: 0.5 });
    for (const side of [-1, 1]) {
      const post = new Mesh(new CylinderGeometry(0.05, 0.05, COURT.netPostHeight, 12), postMat);
      post.position.set(CX + (side * w) / 2, GROUND + COURT.netPostHeight / 2, z);
      this.venue.add(post);
    }
    this.netTop = GROUND + COURT.netHeight;
  }

  // Dark-green windscreens round three sides (the player's back is open), a brand board, a stand behind the server, an umpire chair.
  buildSurround() {
    const screenMat = new MeshStandardMaterial({ color: '#0d2a20', roughness: 0.9 });
    const h = 3.2;
    const back = new Mesh(new BoxGeometry(TEX_W, h, 0.1), screenMat);
    back.position.set(CX, GROUND + h / 2, FAR - PAD_Z + 0.2);
    this.venue.add(back);
    for (const side of [-1, 1]) {
      const wall = new Mesh(new BoxGeometry(0.1, h, TEX_L - 0.4), screenMat);
      wall.position.set(CX + side * (TEX_W / 2 - 0.2), GROUND + h / 2, MID);
      this.venue.add(wall);
    }
    // the brand on the far screen and along both sides
    const board = new Mesh(new PlaneGeometry(14, 1.75), new MeshBasicMaterial({ map: boardTexture('ON THE BALL'), fog: false }));
    board.position.set(CX, GROUND + 1.55, FAR - PAD_Z + 0.27);
    this.venue.add(board);
    for (const side of [-1, 1]) {
      const b = board.clone();
      b.scale.setScalar(0.8);
      b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      b.position.set(CX + side * (TEX_W / 2 - 0.3), GROUND + 1.5, MID - 6);
      this.venue.add(b);
    }
    // a raked stand behind the server, above the screen
    const crowd = crowdTexture();
    crowd.wrapS = crowd.wrapT = RepeatWrapping;
    crowd.repeat.set(4, 1);
    const stand = new Mesh(new PlaneGeometry(40, 9), new MeshBasicMaterial({ map: crowd, color: '#b8c2c8', side: DoubleSide, fog: false }));
    stand.position.set(CX, GROUND + h + 3.2, FAR - PAD_Z - 4);
    stand.rotation.x = -0.45;
    this.venue.add(stand);
    const roof = new Mesh(new BoxGeometry(42, 0.4, 5), new MeshBasicMaterial({ color: '#171d23', fog: false }));
    roof.position.set(CX, GROUND + h + 8.2, FAR - PAD_Z - 5.5);
    this.venue.add(roof);
    // umpire's chair beside the net, on the side away from the receiver's deuce box
    const chair = new Group();
    const steel = new MeshStandardMaterial({ color: '#c9d2cc', roughness: 0.5 });
    for (const [dx, dz] of [[-0.35, -0.3], [0.35, -0.3], [-0.35, 0.3], [0.35, 0.3]]) {
      const leg = new Mesh(new CylinderGeometry(0.03, 0.03, 1.8, 8), steel);
      leg.position.set(dx, 0.9, dz);
      chair.add(leg);
    }
    const seat = new Mesh(new BoxGeometry(0.8, 0.12, 0.7), new MeshStandardMaterial({ color: '#171d23' }));
    seat.position.set(0, 1.85, 0);
    const backrest = new Mesh(new BoxGeometry(0.8, 0.6, 0.08), new MeshStandardMaterial({ color: '#171d23' }));
    backrest.position.set(0, 2.2, 0.3);
    chair.add(seat, backrest);
    chair.position.set(CX - (COURT.doublesWidth / 2 + 1.4), GROUND, FIELD.netZ);
    this.venue.add(chair);
  }

  // The ball in the server's hand, tossed and struck; hidden once the live ball takes over.
  buildBall() {
    this.tossBall = new Mesh(
      new SphereGeometry(PHYS.ballRadius, 24, 16),
      new MeshStandardMaterial({ map: tennisTexture(), roughness: 0.6, emissive: '#d8e83a', emissiveIntensity: 0.3 }),
    );
    this.tossBall.visible = false;
    this.tossPos = [...TOSS.hand];
    this.tossBall.position.set(...this.tossPos);
    this.root.add(this.tossBall);
  }

  // Which half of the court the receiver sits in for this try. The court slides under the seated player (the signs on the screens
  // stay readable: nothing is mirrored) and the server walks to the matching side of his baseline.
  setSide(side) {
    this.side = cleanSide(side);
    this.venue.position.x = courtShiftX(this.side);
    if (this.server) this.server.position.x = serverXFor(this.side);
    this.setDelivery(this.deliveryT);
  }

  setBallAtRest(v) {
    this.tossBall.visible = v;
  }

  loadServer() {
    let gltf = null;
    try {
      gltf = AssetManager.getGLTF('server');
    } catch (_) {
      gltf = null;
    }
    if (!gltf) return; // the scene works without him (court, net and stands still draw)
    const model = gltf.scene;
    const b = new Box3().setFromObject(model);
    const scale = 1.95 / (b.max.y - b.min.y); // a tall server: his racket reaches the 2.4 m contact point
    model.position.set(0, -b.min.y, 0);
    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // skinned: bind-pose bounds do not follow the pose
    });
    const holder = new Group();
    holder.add(model);
    holder.scale.setScalar(scale);
    holder.position.set(serverXFor(this.side), GROUND, FIELD.serverZ);
    this.root.add(holder);
    this.server = holder;
    this.mixer = new AnimationMixer(model);
    const idle = gltf.animations.find((a) => a.name === 'Idle_Loop');
    if (idle) this.mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play();
    this.arm = model.getObjectByName('upperarm_r');
    this.armL = model.getObjectByName('upperarm_l');
    const hand = model.getObjectByName('hand_r');
    if (hand) hand.add(this.makeRacket(1 / scale));
  }

  // A racket in the hitting hand: handle, throat and an oval head with strings. Sized for the bone's scale (the model is scaled
  // as a whole, so the racket is made in model units and scaled back to real metres).
  makeRacket(unit) {
    const g = new Group();
    const frame = new MeshStandardMaterial({ color: '#10161b', roughness: 0.4 });
    const handle = new Mesh(new CylinderGeometry(0.016, 0.016, 0.3, 10), frame);
    handle.position.y = 0.15;
    const head = new Mesh(new TorusGeometry(0.17, 0.012, 8, 28), frame);
    head.scale.set(0.82, 1, 1);
    head.position.y = 0.3 + 0.17;
    const strings = new Mesh(new PlaneGeometry(0.28, 0.34), new MeshBasicMaterial({ color: '#dfe6ea', transparent: true, opacity: 0.28, side: DoubleSide, depthWrite: false }));
    strings.position.y = head.position.y;
    g.add(handle, head, strings);
    g.rotation.set(-0.4, 1.0, -0.6); // fitted so the strings meet the ball at the strike (checked in the emulator)
    g.scale.setScalar(unit);
    return g;
  }

  // tRel: seconds relative to the moment the ball leaves the racket (negative before, positive after); null = standing.
  setDelivery(tRel) {
    this.deliveryT = tRel;
    const t = Number.isFinite(tRel) ? tRel : TOSS.start - 1;
    let p = tossPosition(t, this.side);
    if (t < TOSS.start) {
      const dx = serverXFor(this.side) - FIELD.serverX; // the hands move with the server
      const rest = [HAND_REST[0] + dx, HAND_REST[1], HAND_REST[2]];
      const hand = [TOSS.hand[0] + dx, TOSS.hand[1], TOSS.hand[2]];
      // before the toss the ball is held in the free hand, which rises from the hip as the arm lifts
      const k = TennisScene.smooth((t - TOSS_ARM.up0) / (TOSS_ARM.up1 - TOSS_ARM.up0));
      p = [rest[0] + (hand[0] - rest[0]) * k, rest[1] + (hand[1] - rest[1]) * k, rest[2] + (hand[2] - rest[2]) * k];
    }
    this.tossPos = p;
    this.tossBall.position.set(p[0], p[1], p[2]);
  }

  static smooth(u) {
    const c = Math.min(1, Math.max(0, u));
    return c * c * (3 - 2 * c);
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    const t = this.deliveryT;
    if (t == null) return;
    if (this.arm && t > SERVE.start && t < SERVE.end) {
      const u = (t - SERVE.start) / (SERVE.end - SERVE.start);
      const turn = u - Math.sin(2 * Math.PI * u) / (2 * Math.PI); // 0..1, zero speed at both ends; 0.5 (straight up) at the strike
      this.arm.rotation.x += TennisScene.HIT_SIGN * 2 * Math.PI * turn;
    }
    if (this.armL && t > TOSS_ARM.up0 && t < TOSS_ARM.down1) {
      const s = TennisScene.smooth;
      const lift = s((t - TOSS_ARM.up0) / (TOSS_ARM.up1 - TOSS_ARM.up0)) * (1 - s((t - TOSS_ARM.down0) / (TOSS_ARM.down1 - TOSS_ARM.down0)));
      this.armL.rotation.x += TennisScene.TOSS_SIGN * 2.8 * lift; // the free arm points up at the ball, then drops
    }
  }
}

// Which way the skeleton's X axis swings an arm over the top / lifts it forward. Checked against the model (see tests/screens).
TennisScene.HIT_SIGN = 1;
TennisScene.TOSS_SIGN = 1;

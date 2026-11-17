// The goalkeeper's two gloves. Each one follows its own hand's grip pose (a Touch controller or a tracked hand: on Quest both
// give a grip space whose origin is the palm), so nothing moves them but the player. No buttons, no animation, no aim assist.
//
// They live in the scene anchor (the eye frame), the same frame as the ball, so the save test needs no conversions. Each glove
// keeps its palm centre for this frame and the last (the save test is swept: a fast dive cannot pass through the ball between
// two frames) and a short history for the hand's speed (a glove driven at the ball punches it).
//
// How the glove is drawn: always palm toward the play, fingers up when the hand is up and turning down when the hand goes low
// (a keeper's hands at a low shot), leaning a little outward on the side the hand is on. The hand's own wrist roll is not used:
// it keeps the gloves steady and readable, and the save test does not depend on it (core/goalkeeping.js).

import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3, Group } from '@iwsdk/core';
import { FIELD } from '../core/ball-path.js';
import { GLOVE } from '../core/goalkeeping.js';
import { createGloveModel } from './glove-model.js';

const HISTORY = 8;
const SPEED_WINDOW = 0.04; // s over which a hand's speed is measured
const LOST_HIDE = 0.35; // s without tracking before a glove is hidden
const HAND_FOLLOW = 40; // 1/s: a tracked hand's glove eases to it (~25 ms: removes the jitter, no felt lag). Controllers: exact.
const FLOOR_Y = FIELD.ground + 0.04; // a palm never goes through the grass
const LOW_Y = -0.75; // below this (m from the eyes) the fingers have turned down toward the grass
const HIGH_Y = -0.45; // above this they point up

// Two fixed orientations, blended by the hand's height: fingers up, palm to the striker; fingers down (and a little forward).
function basis(side, up, out) {
  const n = new Vector3(out, 0, -1).normalize(); // palm normal: toward the striker, a little to the hand's own side
  const u = new Vector3(...up).normalize();
  u.addScaledVector(n, -u.dot(n)).normalize();
  const x = new Vector3().crossVectors(u, n);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, u, n));
}

class Glove {
  constructor(world, side) {
    this.world = world;
    this.side = side;
    this.group = new Group();
    this.group.name = `otb-glove-${side}`;
    this.group.add(createGloveModel(side));
    this.group.visible = false;
    const s = side === 'left' ? -1 : 1;
    this.qUp = basis(side, [-0.18 * s, 1, 0], 0.12 * s); // fingertips lean in a little toward the other hand ("W")
    this.qDown = basis(side, [0.1 * s, -1, -0.35], 0.12 * s);
    this.ok = false; // tracked this frame
    this.prevOk = false;
    this.lostFor = 0;
    this.palm = new Vector3(); // palm centre, anchor frame, this frame
    this.prevPalm = new Vector3();
    this.grip = new Vector3();
    this.eased = null;
    this.history = []; // [{t, p}]
    this.m = new Matrix4();
    this.inv = new Matrix4();
    this.pos = new Vector3();
    this.rot = new Quaternion();
    this.scl = new Vector3();
    this.q = new Quaternion();
    this.n = new Vector3();
    this.v = new Vector3();
  }

  inputSource() {
    return this.world.input?.xr?.getPrimaryInputSource?.(this.side);
  }

  isTracked() {
    const im = this.world.input?.xr;
    return !!im?.getPrimaryInputSource?.(this.side) && !im.untrackedPrimary?.[this.side];
  }

  clear() {
    this.group.visible = false;
    this.ok = this.prevOk = false;
    this.eased = null;
    this.history.length = 0;
  }

  // forced: {p: Vector3} (anchor frame) from the PC control or the dev keeper, or null for the real hand.
  update(anchor, dt, time, forced) {
    this.prevOk = this.ok;
    this.prevPalm.copy(this.palm);
    let isHand = false;
    if (forced) {
      this.grip.copy(forced.p);
      this.lostFor = 0;
    } else {
      if (!this.isTracked()) {
        this.lostFor += dt;
        this.ok = false; // no saves while untracked
        if (this.lostFor > LOST_HIDE) this.clear();
        return;
      }
      this.lostFor = 0;
      const gs = this.world.player?.gripSpaces?.[this.side];
      if (!gs) {
        this.ok = false;
        return;
      }
      gs.updateWorldMatrix(true, false);
      anchor.updateWorldMatrix(true, false);
      this.inv.copy(anchor.matrixWorld).invert();
      this.m.multiplyMatrices(this.inv, gs.matrixWorld);
      this.m.decompose(this.pos, this.rot, this.scl);
      if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z)) {
        this.ok = false;
        return;
      }
      this.grip.copy(this.pos);
      isHand = !!this.inputSource()?.hand;
    }
    // Tracked hands jitter a few millimetres at rest: ease toward them. Controllers and the PC control are taken exactly.
    if (!isHand || !this.eased) this.eased = this.grip.clone();
    else this.eased.lerp(this.grip, 1 - Math.exp(-HAND_FOLLOW * Math.max(dt, 1e-3)));
    this.eased.y = Math.max(this.eased.y, FLOOR_Y);

    const k = Math.min(1, Math.max(0, (this.eased.y - LOW_Y) / (HIGH_Y - LOW_Y)));
    this.q.slerpQuaternions(this.qDown, this.qUp, k);
    this.n.set(0, 0, 1).applyQuaternion(this.q); // the palm's normal
    this.palm.copy(this.eased).addScaledVector(this.n, GLOVE.palmOut);

    this.group.position.copy(this.eased);
    this.group.quaternion.copy(this.q);
    this.group.visible = true;
    if (!this.prevOk) this.prevPalm.copy(this.palm); // first tracked frame: no sweep from a stale spot
    this.ok = true;
    this.history.push({ t: time, p: this.palm.clone() });
    if (this.history.length > HISTORY) this.history.shift();
  }

  // The palm's velocity (m/s, anchor frame), measured over the last ~40 ms.
  velocity(time) {
    const h = this.history;
    if (h.length < 2) return [0, 0, 0];
    const now = h[h.length - 1];
    let then = h[0];
    for (let i = h.length - 2; i >= 0; i--) {
      then = h[i];
      if (now.t - h[i].t >= SPEED_WINDOW) break;
    }
    const d = now.t - then.t;
    if (!(d > 1e-4) || time - now.t > 0.1) return [0, 0, 0];
    return [(now.p.x - then.p.x) / d, (now.p.y - then.p.y) / d, (now.p.z - then.p.z) / d];
  }

  pulse(intensity, ms) {
    try {
      const gp = this.inputSource()?.gamepad;
      if (!gp) return; // bare hands have nothing to vibrate
      const act = gp.hapticActuators?.[0];
      if (act?.pulse) act.pulse(intensity, ms);
      else gp.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity * 0.6 });
    } catch (_) {
      /* haptics are a nicety */
    }
  }
}

export class PlayerGloves {
  constructor(world) {
    this.world = world;
    this.left = new Glove(world, 'left');
    this.right = new Glove(world, 'right');
    this.group = new Group();
    this.group.name = 'otb-gloves';
    this.group.add(this.left.group, this.right.group);
    this.enabled = false;
    this.pcDriven = false;
    this.override = null; // () => {left: {p}, right: {p}} in the anchor frame, or null (the emulator's PC control / dev keeper)
  }

  get sides() {
    return [this.left, this.right];
  }

  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) for (const g of this.sides) g.clear();
  }

  // Once per frame, before the ball moves, so the save test uses this frame's gloves.
  update(anchor, dt, time) {
    if (!this.enabled || !this.world.session) {
      for (const g of this.sides) g.clear();
      return;
    }
    const forced = this.override?.() ?? null;
    this.pcDriven = !!forced?.pc;
    this.left.update(anchor, dt, time, forced?.left ?? null);
    this.right.update(anchor, dt, time, forced?.right ?? null);
  }

  anyTracked() {
    return this.left.ok || this.right.ok;
  }

  // Both palms close enough to make one "W" behind the ball.
  together() {
    return this.left.ok && this.right.ok && this.left.palm.distanceTo(this.right.palm) <= GLOVE.together;
  }

  pulse(side, intensity, ms) {
    if (side !== 'right') this.left.pulse(intensity, ms);
    if (side !== 'left') this.right.pulse(intensity, ms);
  }
}

// ------------------------------------------------------------------ PC emulator control (a headset never runs this)
// On a PC the mouse is already taken: in the emulator the cursor is where the simulated EYES look (or, in Play mode, it turns
// the HEAD), and the eyes are the score. So, the same deal as cricket's PC bat:
//   - the gloves stand on the line you are looking along (left / right): look at the ball and they are in line with it,
//   - the scroll wheel sets their HEIGHT: roll forward = gloves up, roll back = gloves down. A shot can come in at the knees
//     or at the chest, so the keeper must read it and get the hands there in time.
// Nothing moves by itself: the gloves stay at the height the player left them.
const PC_Z = -0.95; // m in front of the eyes: where the PC gloves meet the ball, just after its arrival point
const PC_X = 0.75;
const PC_Y_MIN = FIELD.ground + 0.12;
const PC_Y_MAX = 0.3;
const PC_STANCE_Y = -0.35;
const PC_HALF_GAP = 0.13; // each palm this far from the middle: the two together make one "W"
const M_PER_PX = 0.0016; // height per pixel of scroll (one wheel notch is ~100 px: ~16 cm)
const PC_SPRING = 45; // 1/s: the gloves follow the wheel quickly, with a hand's weight

export class MouseGloves {
  constructor(world) {
    this.world = world;
    this.nx = 0;
    this.ny = 0.5;
    this.y = PC_STANCE_Y;
    this.target = PC_STANCE_Y;
    this.lastT = 0;
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.o = new Vector3();
    this.d = new Vector3();
    this.inv = new Matrix4();
    this.out = { pc: true, left: { p: new Vector3() }, right: { p: new Vector3() } };
    this.hint = this.makeHint();
    // The cursor is only read (never captured or stopped): the emulator's eye and head controls get every event as before.
    this.onMove = (e) => {
      const r = this.world.renderer?.domElement?.getBoundingClientRect?.();
      if (!r || !r.width || !r.height) return;
      this.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ny = (e.clientY - r.top) / r.height;
    };
    this.onWheel = (e) => {
      if (!this.world.session) return;
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
      this.target = Math.min(PC_Y_MAX, Math.max(PC_Y_MIN, this.target - e.deltaY * scale * M_PER_PX)); // forward (deltaY < 0) = up
    };
    if (MouseGloves.available()) {
      window.addEventListener('pointermove', this.onMove, { capture: true, passive: true });
      window.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
    }
  }

  static available() {
    return typeof window !== 'undefined' && window.IWER_DEVICE !== undefined;
  }

  dispose() {
    window.removeEventListener('pointermove', this.onMove, { capture: true });
    window.removeEventListener('wheel', this.onWheel, { capture: true });
  }

  active() {
    return MouseGloves.available() && !!this.world.session;
  }

  reset() {
    this.y = this.target = PC_STANCE_Y;
    this.lastT = 0;
  }

  camera() {
    const xr = this.world.renderer?.xr;
    const cam = xr?.isPresenting ? xr.getCamera() : this.world.camera;
    let best = null;
    for (const v of cam?.cameras ?? []) if (!best || (v.viewport?.z ?? 0) > (best.viewport?.z ?? 0)) best = v;
    return best ?? cam;
  }

  pose(anchor) {
    if (!this.active()) return null;
    const cam = this.camera();
    if (!cam) return null;
    this.ndc.set(document.pointerLockElement ? 0 : this.nx, document.pointerLockElement ? 0 : -(this.ny * 2 - 1));
    this.ray.setFromCamera(this.ndc, cam);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.o.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    this.d.copy(this.ray.ray.direction).transformDirection(this.inv);
    let x = 0;
    if (this.d.z < -1e-3) x = this.o.x + ((PC_Z - this.o.z) / this.d.z) * this.d.x;
    x = Math.min(PC_X, Math.max(-PC_X, x));
    const now = performance.now() / 1000;
    const dt = this.lastT ? Math.min(0.1, now - this.lastT) : 0;
    this.lastT = now;
    this.y += (this.target - this.y) * (1 - Math.exp(-PC_SPRING * dt));
    this.out.left.p.set(x - PC_HALF_GAP, this.y, PC_Z);
    this.out.right.p.set(x + PC_HALF_GAP, this.y, PC_Z);
    return this.out;
  }

  makeHint() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(8,20,14,0.72)';
    x.beginPath();
    x.roundRect(4, 4, 1016, 120, 60);
    x.fill();
    x.fillStyle = '#ffffff';
    x.font = '700 40px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('PC: look at the ball. Wheel FORWARD = gloves up, BACK = down', 512, 66, 980);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(1.3, 0.1625), new MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 31;
    m.position.set(0, 1.12, -3.2);
    m.visible = false;
    return m;
  }

  showHint(on) {
    this.hint.visible = !!on && this.active();
  }
}

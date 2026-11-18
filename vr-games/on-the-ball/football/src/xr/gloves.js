// The goalkeeper's two gloves. Each one follows its own hand's grip pose (a Touch controller or a tracked hand: on Quest both
// give a grip space whose origin is the palm), so nothing moves them but the player: no aim assist. Each glove is on an arm
// (a jersey sleeve to the elbow and the shoulder, arm-model.js) and its fingers move (open wide while a shot is coming, cupped
// round a caught ball, sprung wide by a parry, and following the player's own fingers). That is all drawing: the save test
// only ever uses the palm centre.
//
// They live in the scene anchor (the eye frame), the same frame as the ball, so the save test needs no conversions. Each glove
// keeps its palm centre for this frame and the last (the save test is swept: a fast dive cannot pass through the ball between
// two frames) and a short history for the hand's speed (a glove driven at the ball punches it).
//
// How the glove is drawn: always palm toward the play, fingers up when the hand is up and turning down when the hand goes low
// (a keeper's hands at a low shot), leaning a little outward on the side the hand is on. The hand's own wrist roll is not used:
// it keeps the gloves steady and readable, and the save test does not depend on it (core/goalkeeping.js).

import { CanvasTexture, Euler, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3, Group } from '@iwsdk/core';
import { FIELD } from '../core/ball-path.js';
import { GLOVE } from '../core/goalkeeping.js';
import { Arm, GLOVE_SCALE, shoulderFrom, STUB_END } from './arm-model.js';
import { createGloveModel } from './glove-model.js';

const HISTORY = 8;
const SPEED_WINDOW = 0.04; // s over which a hand's speed is measured
const LOST_HIDE = 0.35; // s without tracking before a glove is hidden
const HAND_FOLLOW = 40; // 1/s: a tracked hand's glove eases to it (~25 ms: removes the jitter, no felt lag). Controllers: exact.
const FLOOR_Y = FIELD.ground + 0.04; // a palm never goes through the grass
const LOW_Y = -0.75; // below this (m from the eyes) the fingers have turned down toward the grass
const HIGH_Y = -0.45; // above this they point up
const WRIST_FOLLOW = 0.7; // 1/s: how slowly the "neutral" wrist angle follows the real hand (the glove shows the difference)
const WRIST_GAIN = 0.7; // how much of the hand's own tilt and twist the glove shows
const WRIST_MAX = 0.9; // rad: most the glove is turned from its steady pose by the hand
const FLASH = 0.35; // s the fingers spring wide after the ball hits them
// Open-hand distance from the wrist to each fingertip (m), thumb first: a tracked hand's finger is "curled" as it comes in from this.
const OPEN_REACH = [0.13, 0.165, 0.18, 0.165, 0.145];
const TIP_JOINTS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
const RELAXED = [0.12, 0.08, 0.1, 0.11, 0.13]; // a keeper's ready hand is not rigid

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
    this.model = createGloveModel(side);
    this.group.add(this.model);
    this.group.visible = false;
    this.arm = new Arm(side); // lives in the gloves' parent group (the anchor frame), not under this glove
    // the hand: finger curl (thumb first), how wide the fingers are fanned, and what is making it move
    this.curl = RELAXED.slice();
    this.spread = 0.35;
    this.alert = false; // a shot is coming: hands wide open
    this.hold = false; // a ball is held: cupped round it
    this.flashAt = -Infinity; // when the ball last hit this glove
    this.phase = side === 'left' ? 0 : 1.7; // so the two hands do not breathe in step
    this.gripRot = new Quaternion(); // the real hand's own orientation, anchor frame
    this.hasRot = false;
    this.ref = null; // its slow average: the "steady" angle
    this.dq = new Quaternion();
    this.refInv = new Quaternion();
    this.tilt = new Quaternion();
    this.visQ = new Quaternion();
    this.wob = new Quaternion();
    this.wobE = new Euler();
    this.shoulder = new Vector3();
    this.joint = new Vector3();
    this.xAxis = new Vector3();
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
    this.arm.hide();
    this.ok = this.prevOk = false;
    this.eased = null;
    this.ref = null;
    this.hasRot = false;
    this.history.length = 0;
  }

  // forced: {p: Vector3} (anchor frame) from the PC control or the dev keeper, or null for the real hand.
  // head: {pos: Vector3, yaw: number} in the anchor frame, where the shoulders are hung from.
  update(anchor, dt, time, forced, head) {
    this.prevOk = this.ok;
    this.prevPalm.copy(this.palm);
    let isHand = false;
    this.hasRot = false;
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
      this.gripRot.copy(this.rot);
      this.hasRot = Number.isFinite(this.rot.x + this.rot.y + this.rot.z + this.rot.w);
    }
    // Tracked hands jitter a few millimetres at rest: ease toward them. Controllers and the PC control are taken exactly.
    if (!isHand || !this.eased) this.eased = this.grip.clone();
    else this.eased.lerp(this.grip, 1 - Math.exp(-HAND_FOLLOW * Math.max(dt, 1e-3)));
    this.eased.y = Math.max(this.eased.y, FLOOR_Y);

    const k = Math.min(1, Math.max(0, (this.eased.y - LOW_Y) / (HIGH_Y - LOW_Y)));
    this.q.slerpQuaternions(this.qDown, this.qUp, k);
    this.n.set(0, 0, 1).applyQuaternion(this.q); // the palm's normal
    this.palm.copy(this.eased).addScaledVector(this.n, GLOVE.palmOut);

    // What is DRAWN may differ from the steady pose the save test uses (this.q, this.palm): the glove also shows the real wrist
    // tipping and twisting, measured against the hand's own slow average so it needs no calibration, and a few millimetres of
    // life when the hand is a PC control. Fingers breathe, spread and close (see animate). None of it moves the palm centre.
    this.visQ.copy(this.q);
    if (this.hasRot) {
      if (!this.ref) this.ref = this.gripRot.clone();
      else this.ref.slerp(this.gripRot, 1 - Math.exp(-WRIST_FOLLOW * Math.max(dt, 1e-3)));
      this.dq.copy(this.gripRot).multiply(this.refInv.copy(this.ref).invert());
      const ang = 2 * Math.acos(Math.min(1, Math.abs(this.dq.w)));
      this.tilt.identity().slerp(this.dq, Math.min(WRIST_GAIN, WRIST_MAX / Math.max(ang, 1e-4)));
      this.visQ.premultiply(this.tilt);
    } else if (forced) {
      this.wobE.set(0.014 * Math.sin(time * 1.9 + this.phase), 0.01 * Math.sin(time * 1.3 + this.phase * 2), 0.014 * Math.sin(time * 1.5 + this.phase * 1.7));
      this.visQ.multiply(this.wob.setFromEuler(this.wobE));
    }
    this.group.position.copy(this.eased);
    this.group.quaternion.copy(this.visQ);
    this.group.visible = true;
    this.animate(dt, time);
    // the arm: from a shoulder under the head to the end of the glove's own sleeve
    this.joint.set(STUB_END[0], STUB_END[1], STUB_END[2]).multiplyScalar(GLOVE_SCALE).applyQuaternion(this.visQ).add(this.eased);
    this.xAxis.set(1, 0, 0).applyQuaternion(this.visQ);
    if (head) {
      shoulderFrom(head.pos, head.yaw, this.side, this.shoulder);
      this.arm.update(this.shoulder, this.joint, this.xAxis);
    } else {
      this.arm.hide();
    }
    if (!this.prevOk) this.prevPalm.copy(this.palm); // first tracked frame: no sweep from a stale spot
    this.ok = true;
    this.history.push({ t: time, p: this.palm.clone() });
    if (this.history.length > HISTORY) this.history.shift();
  }

  // The fingers. What drives them, strongest last: a relaxed, breathing hand; wide open while a shot is in flight; the player's
  // own fingers (a squeezed controller grip / trigger, or a tracked hand's real finger curl); cupped round a held ball; sprung
  // wide for a moment when the ball hits. Eased, closing faster than opening, like a hand.
  animate(dt, time) {
    const breathe = 0.5 + 0.5 * Math.sin(time * 1.7 + this.phase);
    let spread = 0.3 + 0.2 * breathe;
    const target = RELAXED.map((v, i) => v + (i === 0 ? 0.02 : 0.035) * breathe);
    if (this.alert) {
      spread = 1;
      for (let i = 0; i < 5; i++) target[i] *= 0.15;
    }
    const input = this.readInput();
    if (input) {
      for (let i = 0; i < 5; i++) target[i] = Math.max(target[i], input[i]);
      spread *= 1 - 0.7 * Math.max(...input);
    }
    if (this.hold) {
      const cup = [0.5, 0.55, 0.58, 0.55, 0.5];
      for (let i = 0; i < 5; i++) target[i] = cup[i];
      spread = 0.25;
    }
    const fl = Math.max(0, 1 - (time - this.flashAt) / FLASH);
    if (fl > 0) {
      spread = Math.max(spread, fl);
      for (let i = 0; i < 5; i++) target[i] *= 1 - 0.85 * fl;
    }
    const dtc = Math.max(dt, 1e-3);
    for (let i = 0; i < 5; i++) this.curl[i] += (target[i] - this.curl[i]) * (1 - Math.exp(-(target[i] > this.curl[i] ? 24 : 10) * dtc));
    this.spread += (spread - this.spread) * (1 - Math.exp(-14 * dtc));
    this.model.userData.setPose(this.curl, this.spread);
    this.model.position.z = -0.02 * fl; // the knock of the ball pushes the glove back toward the player
  }

  // The player's own fingers, [thumb, index, middle, ring, little] each 0 (open) ... 1 (closed), or null if nothing to read.
  readInput() {
    try {
      const src = this.inputSource();
      if (!src) return null;
      if (src.hand) return this.handCurl(src.hand);
      const b = src.gamepad?.buttons;
      if (!b) return null;
      const trig = b[0]?.value ?? 0;
      const grip = b[1]?.value ?? 0;
      return [Math.max(trig, grip) * 0.85, trig, grip, grip, grip];
    } catch (_) {
      return null; // the fingers are a nicety
    }
  }

  handCurl(hand) {
    const xr = this.world.renderer?.xr;
    const frame = xr?.getFrame?.();
    const space = xr?.getReferenceSpace?.();
    if (!frame?.getJointPose || !space) return null;
    const w = frame.getJointPose(hand.get('wrist'), space)?.transform?.position;
    if (!w) return null;
    const out = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
      const t = frame.getJointPose(hand.get(TIP_JOINTS[i]), space)?.transform?.position;
      if (!t) return null;
      const d = Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z);
      out[i] = Math.min(1, Math.max(0, (OPEN_REACH[i] - d) / (OPEN_REACH[i] * 0.46)));
    }
    return out;
  }

  // The ball has just hit this glove.
  react(time) {
    this.flashAt = time;
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
    this.group.add(this.left.group, this.right.group, this.left.arm.group, this.right.arm.group);
    this.head = { pos: new Vector3(), yaw: 0 }; // anchor frame: where the shoulders hang from
    this._hp = new Vector3();
    this._hq = new Quaternion();
    this._hd = new Vector3();
    this._hm = new Matrix4();
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
    this.updateHead(anchor);
    this.left.update(anchor, dt, time, forced?.left ?? null, this.head);
    this.right.update(anchor, dt, time, forced?.right ?? null, this.head);
  }

  // Where the player's head is, in the anchor frame (the same frame as the gloves), and which way it faces in the horizontal.
  // If it cannot be read the shoulders hang from the eye frame's origin: the seated player's eyes.
  updateHead(anchor) {
    const h = this.head;
    try {
      const cam = this.world.player?.head ?? this.world.camera;
      if (cam) {
        cam.updateWorldMatrix(true, false);
        anchor.updateWorldMatrix(true, false);
        this._hm.copy(anchor.matrixWorld).invert();
        cam.getWorldPosition(this._hp).applyMatrix4(this._hm);
        cam.getWorldQuaternion(this._hq);
        this._hd.set(0, 0, -1).applyQuaternion(this._hq).transformDirection(this._hm);
        const ok = Number.isFinite(this._hp.x + this._hp.y + this._hp.z) && this._hp.length() < 4;
        if (ok) {
          h.pos.copy(this._hp);
          if (Math.hypot(this._hd.x, this._hd.z) > 0.2) h.yaw = Math.atan2(-this._hd.x, -this._hd.z);
          return;
        }
      }
    } catch (_) {
      /* fall through to the eye frame */
    }
    h.pos.set(0, 0, 0);
    h.yaw = 0;
  }

  // A shot is in flight: the hands open wide.
  setAlert(on) {
    for (const g of this.sides) g.alert = !!on;
  }

  // A ball is held: the fingers cup round it.
  setHold(on) {
    for (const g of this.sides) g.hold = !!on;
  }

  // The ball hit a glove (or both).
  react(side, time) {
    if (side !== 'right') this.left.react(time);
    if (side !== 'left') this.right.react(time);
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
const PC_Z = -0.48; // m in front of the eyes: where a keeper's hands really are (elbows bent, under half a metre out)
const PC_X = 0.55;
const PC_Y_MIN = FIELD.ground + 0.12;
const PC_Y_MAX = 0.25;
const PC_STANCE_Y = -0.2; // hands up, a little below the eyes, ready
const PC_HALF_GAP = 0.155; // each palm this far from the middle: wide, and still together enough (<= GLOVE.together) to catch
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

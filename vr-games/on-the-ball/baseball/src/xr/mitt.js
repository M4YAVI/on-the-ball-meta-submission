// The catcher's mitt in the player's hand. It follows the hand's grip pose (a controller, or a tracked hand): nothing moves it but the
// player. It is worn on the left hand by default (a right-handed catcher) and goes to the other hand when only that one is tracked.
// The mitt keeps a short history of its own positions, so the game can ask how fast it is moving (a quiet mitt frames a pitch; a
// stabbing one does not), and it pulses the controller when the ball lands in it.
//
// It lives in the scene anchor (the eye frame), the same frame as the ball, so the catch test needs no conversions. The mitt model
// itself is baseball-xr's (xr/glove.js); local axes: +Y toward the fingertips, +Z out of the palm (the pocket opens this way).

import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { FIELD } from '../core/ball-path.js';
import { makeMitt } from './glove.js';
import { MouseBat } from '../../../src/xr/mouse-bat.js';

const POCKET_OUT = 0.05; // the pocket's centre sits this far in front of the grip (the palm)
const HAND_FOLLOW = 40; // 1/s: the pocket eases to the hand (about 25 ms: takes the jitter out of tracked hands, no lag)
const FLOOR_Y = FIELD.ground + 0.03; // the lowest the pocket can be: on the ground, not through it
const LOW_H = 0.12; // heights above the ground (m) between which the fingers turn from "down toward the plate" to "up at the zone"
const UP_H = 0.45;
const DOWN = [0, -0.7, 0.15]; // fingers down: mostly down, a little toward the catcher
const UP = [0, 0.97, 0.24]; // fingers up at the zone
const HISTORY = 8;
const SPEED_WINDOW = 0.05; // s over which the mitt's speed is measured
const LOST_HIDE = 0.35; // s without tracking before the mitt is hidden
const SWITCH_AFTER = 0.6; // s the mitt hand must be lost before the mitt moves to the other hand

export class PlayerMitt {
  constructor(world, side = 'left') {
    this.world = world;
    this.side = side;
    this.mitt = makeMitt('catcher');
    this.group = this.mitt.object;
    this.group.name = 'otb-mitt';
    this.group.visible = false;

    this.enabled = false;
    this.ok = false; // is the mitt tracked this frame?
    this.prevOk = false;
    this.lostFor = 0;
    this.pocket = new Vector3(); // the pocket's centre, anchor frame (eased: as drawn and as caught)
    this.prevPocket = new Vector3(); // last frame's
    this.target = new Vector3();
    this.normal = new Vector3(0, 0, -1); // which way the pocket opens
    this.rate = HAND_FOLLOW;
    this.override = null; // () => {p: Vector3} in the anchor frame, or null (the emulator's mouse)
    this.history = []; // [{t, p}]
    this.hold = 0; // 1 while a caught ball is held: the mitt is shut round it
    this.closed = 0;
    // Recoil: the ball knocks the mitt back, then it springs back (drawn only: a catch uses the hand's real position).
    this.kick = new Vector3();
    this.kickVel = new Vector3();
    this.tilt = 0;
    this.tiltVel = 0;

    this.m = new Matrix4();
    this.inv = new Matrix4();
    this.pos = new Vector3();
    this.rot = new Quaternion();
    this.scl = new Vector3();
    this.fwd = new Vector3();
    this.v = Array.from({ length: 6 }, () => new Vector3());
    this.baseQuat = new Quaternion();
    this.tiltQuat = new Quaternion();
    this.xAxis = new Vector3(1, 0, 0);
  }

  inputManager() {
    return this.world.input?.xr;
  }

  isTracked(side) {
    const im = this.inputManager();
    const src = im?.getPrimaryInputSource?.(side);
    if (!src) return false;
    return !im.untrackedPrimary?.[side];
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear() {
    this.group.visible = false;
    this.ok = this.prevOk = false;
    this.history.length = 0;
    this.hold = 0;
    this.closed = 0;
    this.kick.set(0, 0, 0);
    this.kickVel.set(0, 0, 0);
    this.tilt = this.tiltVel = 0;
  }

  // Fingers: up at the strike zone when the mitt is held high, down toward the plate when it is held low, as a catcher keeps it.
  fingers(h, out) {
    const t = Math.max(0, Math.min(1, (h - LOW_H) / (UP_H - LOW_H)));
    const k = t * t * (3 - 2 * t);
    return out.set(0, DOWN[1] + (UP[1] - DOWN[1]) * k, DOWN[2] + (UP[2] - DOWN[2]) * k).normalize();
  }

  // The pocket's pose from a position and a direction the pocket faces. thumb: +1 / -1, which side the thumb is on.
  setPose(p, normal) {
    const up = this.fingers(p.y - FIELD.ground, this.v[0]);
    const z = this.v[1].copy(normal);
    z.addScaledVector(up, -z.dot(up)).normalize();
    const x = this.v[2].crossVectors(up, z);
    this.m.makeBasis(x, up, z);
    this.group.quaternion.setFromRotationMatrix(this.m);
    this.baseQuat.copy(this.group.quaternion);
    this.group.scale.set(this.side === 'left' ? 1 : -1, 1, 1); // a left-hand mitt, mirrored for the right hand
    this.target.copy(p);
    this.normal.copy(z);
  }

  // Called once per frame, before the ball moves. anchor: the scene anchor (eye frame). Returns true while the mitt is in hand.
  update(anchor, dt, time) {
    this.prevPocket.copy(this.pocket);
    this.prevOk = this.ok;
    if (!this.enabled || !this.world.session) {
      this.clear();
      return false;
    }
    const forced = this.override?.();
    this.pcDriven = !!forced; // true only on the PC emulator's mouse (never on a headset)
    if (forced) {
      this.lostFor = 0;
      this.ok = true;
      this.setPose(forced.p, this.v[3].set(0, 0, -1));
      this.rate = Infinity;
    } else {
      this.ok = this.readGrip(anchor, dt);
      if (!this.ok) {
        // Hold the last pose for a moment (a short tracking drop), then hide. No catches while untracked.
        if (this.lostFor > LOST_HIDE) this.group.visible = false;
        this.history.length = 0;
        return false;
      }
      this.rate = HAND_FOLLOW;
    }
    // The pocket eases to the hand. It snaps when the mitt has just appeared (so it never slides in from where it was).
    if (!this.prevOk || this.rate === Infinity) this.pocket.copy(this.target);
    else this.pocket.lerp(this.target, 1 - Math.exp(-this.rate * Math.max(dt, 1e-3)));
    if (this.pocket.y < FLOOR_Y) this.pocket.y = FLOOR_Y;
    if (!Number.isFinite(this.pocket.x + this.pocket.y + this.pocket.z)) {
      this.ok = false;
      return false;
    }

    this.history.push({ t: time, p: [this.pocket.x, this.pocket.y, this.pocket.z] });
    if (this.history.length > HISTORY) this.history.shift();

    // Closing: shut while a ball is held, else a little open; the recoil spring (a little under-damped, so it settles with a give).
    const want = Math.max(0.1, this.hold);
    this.closed += (want - this.closed) * Math.min(1, (want > this.closed ? 16 : 6) * dt);
    this.mitt.setClose(this.closed);
    const k = 360;
    const c = 2 * Math.sqrt(k) * 0.6;
    this.kickVel.addScaledVector(this.kick, -k * dt).multiplyScalar(Math.max(0, 1 - c * dt));
    this.kick.addScaledVector(this.kickVel, dt);
    this.tiltVel += -k * this.tilt * dt;
    this.tiltVel *= Math.max(0, 1 - c * dt);
    this.tilt += this.tiltVel * dt;
    this.group.position.copy(this.pocket).add(this.kick);
    this.group.quaternion.copy(this.baseQuat).multiply(this.tiltQuat.setFromAxisAngle(this.xAxis, this.tilt));
    this.group.visible = true;
    return true;
  }

  // The hand's grip pose (anchor frame) -> the target pocket. Which hand wears it: the left, or the right when only that is tracked.
  readGrip(anchor, dt) {
    const other = this.side === 'left' ? 'right' : 'left';
    let tracked = this.isTracked(this.side);
    if (!tracked) {
      this.lostFor += dt;
      if (this.lostFor > SWITCH_AFTER && this.isTracked(other)) {
        this.side = other;
        this.lostFor = 0;
        this.history.length = 0;
        this.prevOk = false;
        tracked = true;
      }
    } else this.lostFor = 0;
    if (!tracked) return false;
    const grip = this.world.player?.gripSpaces?.[this.side];
    if (!grip) return false;
    grip.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.m.multiplyMatrices(this.inv, grip.matrixWorld);
    this.m.decompose(this.pos, this.rot, this.scl);
    if (!Number.isFinite(this.pos.x + this.pos.y + this.pos.z)) return false;
    // The pocket faces where the hand points, blended with "toward the pitcher" so a sloppy hold still catches.
    const normal = this.v[3].set(0, 0, -1);
    const ray = this.world.player?.raySpaces?.[this.side];
    if (ray) {
      ray.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(this.inv, ray.matrixWorld);
      this.fwd.set(0, 0, -1).transformDirection(this.m);
      if (this.fwd.z < -0.2) normal.multiplyScalar(0.4).addScaledVector(this.fwd, 0.6);
    }
    this.setPose(this.v[4].copy(this.pos).addScaledVector(this.v[5].copy(normal).normalize(), POCKET_OUT), normal);
    return true;
  }

  // How fast the mitt is moving (m/s), measured over the last ~50 ms.
  speed(time) {
    const h = this.history;
    if (h.length < 2) return 0;
    const now = h[h.length - 1];
    let then = h[0];
    for (let i = h.length - 2; i >= 0; i--) {
      then = h[i];
      if (now.t - h[i].t >= SPEED_WINDOW) break;
    }
    const dt = now.t - then.t;
    if (!(dt > 1e-4) || time - now.t > 0.1) return 0;
    return Math.hypot(now.p[0] - then.p[0], now.p[1] - then.p[1], now.p[2] - then.p[2]) / dt;
  }

  // The ball smacks into the pocket travelling along `dir` (unit) at `speed` m/s: the mitt is knocked back and snaps shut.
  impact(dir, speed) {
    this.kickVel.addScaledVector(dir, Math.min(1.6, 0.35 + speed * 0.045));
    this.tiltVel -= Math.min(2.2, 0.5 + speed * 0.06); // the fingers tip back toward the catcher
  }

  // A pulse in the hand that wears the mitt. Controllers only: tracked hands have nothing to vibrate.
  pulse(intensity, ms) {
    try {
      const gp = this.inputManager()?.getPrimaryInputSource?.(this.side)?.gamepad;
      if (!gp) return;
      const act = gp.hapticActuators?.[0];
      if (act?.pulse) act.pulse(intensity, ms);
      else gp.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity * 0.6 });
    } catch (_) {
      /* haptics are a nicety */
    }
  }
}

// Catching with the mouse, in the desktop emulator ONLY (IWER). A headset never runs this: there the mitt follows the real hand.
// The cursor is the hand: the pocket goes where the cursor's line crosses the plane MITT_Z in front of the eyes. The game treats it
// exactly like a hand: same pocket history, same swept catch test, same umpire. With a still mouse the mitt is still.
const MITT_Z = -0.62; // m in front of the eyes: within an arm's reach
const X_LIMIT = 0.8;
const Y_MIN = -0.95;
const Y_MAX = 0.1;

export class MouseMitt extends MouseBat {
  pose(anchor) {
    if (!this.active()) return null;
    const cam = this.camera();
    if (!cam) return null;
    this.ndc.set(this.nx, -(this.ny * 2 - 1));
    this.ray.setFromCamera(this.ndc, cam);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.o.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    this.d.copy(this.ray.ray.direction).transformDirection(this.inv);
    if (this.d.z > -1e-3) return null;
    const k = (MITT_Z - this.o.z) / this.d.z;
    this.p.set(
      Math.min(X_LIMIT, Math.max(-X_LIMIT, this.o.x + k * this.d.x)),
      Math.min(Y_MAX, Math.max(Y_MIN, this.o.y + k * this.d.y)),
      MITT_Z,
    );
    return { p: this.p };
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
    x.font = '700 50px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('Mouse = mitt.  Put it where the ball is going', 512, 66, 980);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(1.3, 0.1625), new MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 31;
    m.position.set(0, 1.12, -3.2);
    m.visible = false;
    return m;
  }
}

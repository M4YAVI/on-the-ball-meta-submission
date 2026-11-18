// The racket on the PC, in the desktop emulator ONLY (IWER). A headset never runs this: there the racket follows the real hand.
//
// On a PC the mouse is already taken: in the emulator the cursor is where the simulated EYES look (or, in Play mode, the mouse
// turns the HEAD), and the eyes are the score. So, like cricket's PC batting:
//   - where you look (the cursor, or the middle of the view in Play mode) is where the racket meets the ball,
//   - the scroll wheel is the swing: roll BACK to take the racket back, roll FORWARD to swing through (keep rolling forward to
//     come back to the ready position). A fast roll is a hard swing.
// Nothing here moves by itself: the racket goes where the wheel puts it and stays there. The game treats it exactly like a hand:
// same pose history, same swept hit test, same physics, same eye-tracking score. The pose maths is core/swing.js.

import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3 } from '@iwsdk/core';
import { TIMING } from '../core/racket-physics.js';
import { freeHandPose, PcSwing, racketPose, strokeFor, SWING } from '../core/swing.js';

const RAD_PER_PX = 0.0075; // swing per pixel of scroll (one notch is about 100 px: about 6 notches from the take-back to the finish)
const LOCK_FROM = -0.15; // swing value from which the contact point is committed (no steering the racket through the ball)
const SWITCH_RATE = 5; // 1/s: forehand <-> backhand change-over

export class MouseRacket {
  constructor(world) {
    this.world = world;
    this.nx = 0;
    this.ny = 0.55;
    this.drive = new PcSwing(); // the swing value, the wheel's target and the timing help (core/swing.js)
    this.aim = null; // [x, y]: where the live serve crosses the contact depth (set by the game), or null
    this.frameDt = null; // the game's frame step, so the racket and the ball move on the same clock
    this.lastT = 0;
    this.sgn = 1; // the stroke asked for by the look line
    this.mix = 0; // 0 forehand .. 1 backhand, as drawn
    this.lock = null;
    this.look = [0, -0.2];
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.o = new Vector3();
    this.d = new Vector3();
    this.inv = new Matrix4();
    this.p = new Vector3();
    this.q = new Quaternion();
    this.q2 = new Quaternion();
    this.fp = new Vector3();
    this.fq = new Quaternion();
    this.free = { p: this.fp, q: this.fq, shape: 'open' };
    this.hint = this.makeHint();
    this.onMove = (e) => {
      const el = this.world.renderer?.domElement;
      const r = el?.getBoundingClientRect?.();
      if (!r || !r.width || !r.height) return;
      this.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ny = (e.clientY - r.top) / r.height;
    };
    this.onWheel = (e) => {
      if (!this.world.session) return;
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
      // roll forward (deltaY < 0) = swing through, roll back = take back
      this.drive.roll(-e.deltaY * scale * RAD_PER_PX);
    };
    if (MouseRacket.available()) {
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
    return MouseRacket.available() && !!this.world.session && !this.disabled;
  }

  camera() {
    const xr = this.world.renderer?.xr;
    const cam = xr?.isPresenting ? xr.getCamera() : this.world.camera;
    const views = cam?.cameras ?? [];
    let best = null;
    for (const v of views) if (!best || (v.viewport?.z ?? 0) > (best.viewport?.z ?? 0)) best = v;
    return best ?? cam;
  }

  reset() {
    this.drive.reset();
    this.aim = null;
    this.lock = null;
    this.lastT = 0;
  }

  get th() {
    return this.drive.th;
  }

  get w() {
    return this.drive.w;
  }

  get armed() {
    return this.drive.armed;
  }

  // The live serve, from the game each frame: key (changes per serve), eta (s until it reaches the contact depth), aim ([x, y]
  // where it crosses it), speed (m/s there). setBall(null) when no serve is coming.
  //
  // Easy play: the racket goes to the ball (the look no longer has to be on the exact spot), and a forward roll a little early
  // is held and let go on time (core/swing.js PcSwing). The eyes are still the score; this is the hand play only.
  setBall(key, eta, aim, speed) {
    this.drive.setBall(key, eta, speed);
    if (key != null) this.aim = aim;
    else if (this.aim) {
      // keep the aim until the racket is at a pose that does not depend on it, so it never jumps mid-swing
      const th = this.drive.th;
      if ((th >= SWING.FINISH || th <= SWING.READY + 0.02) && Math.abs(this.drive.w) < 2) this.aim = null;
    }
  }

  swing() {
    const now = performance.now() / 1000;
    let dt = this.frameDt ?? (this.lastT ? now - this.lastT : 0);
    this.frameDt = null;
    this.lastT = now;
    if (dt <= 0) return 0;
    dt = Math.min(dt, 0.1);
    this.drive.step(dt);
    return dt;
  }

  // Where the look line crosses the contact depth (anchor frame). With a serve coming, the racket goes to the ball itself.
  readLook(anchor) {
    if (this.aim) {
      this.look = [this.aim[0], this.aim[1]];
      return;
    }
    const cam = this.camera();
    if (!cam) return;
    if (document.pointerLockElement) this.ndc.set(0, 0);
    else this.ndc.set(this.nx, -(this.ny * 2 - 1));
    this.ray.setFromCamera(this.ndc, cam);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.o.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    this.d.copy(this.ray.ray.direction).transformDirection(this.inv);
    if (this.d.z < -1e-3) {
      const k = (TIMING.idealZ - this.o.z) / this.d.z;
      this.look = [this.o.x + k * this.d.x, this.o.y + k * this.d.y];
    }
  }

  // The racket's pose in the anchor frame, or null when the PC control is not in use. Also works out the free hand's.
  pose(anchor) {
    if (!this.active()) return null;
    this.readLook(anchor);
    const dt = this.swing();
    // commit to the contact point as the racket comes into the ball; free again once it is through or back
    const inShot = this.th >= LOCK_FROM && this.th <= SWING.zone1 + 0.2;
    if (inShot) this.lock ??= this.look.slice();
    else this.lock = null;
    const look = this.lock ?? this.look;
    // forehand or backhand: chosen by the look line, changed only while the racket is not in a swing
    const still = !inShot && (this.th <= SWING.zone0 - 0.25 || this.th >= SWING.FINISH - 0.1) && Math.abs(this.w) < 2;
    if (still) this.sgn = strokeFor(look[0], this.sgn);
    const want = this.sgn < 0 ? 1 : 0;
    if (this.mix !== want) this.mix = want > this.mix ? Math.min(want, this.mix + SWITCH_RATE * dt) : Math.max(want, this.mix - SWITCH_RATE * dt);
    const m = this.mix * this.mix * (3 - 2 * this.mix);
    const fh = m < 1 ? racketPose(this.th, this.armed, look, 1) : null;
    const bh = m > 0 ? racketPose(this.th, this.armed, look, -1) : null;
    const set = (pose, p, q) => {
      p.set(pose.p[0], pose.p[1], pose.p[2]);
      q.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
    };
    if (!bh) set(fh, this.p, this.q);
    else if (!fh) set(bh, this.p, this.q);
    else {
      set(fh, this.p, this.q);
      set(bh, this.fp, this.q2);
      this.p.lerp(this.fp, m);
      this.q.slerp(this.q2, m);
    }
    const fr = freeHandPose(this.th, this.armed, look, m >= 0.5 ? -1 : 1);
    this.free.shape = fr.shape;
    set(fr, this.fp, this.fq);
    if (m >= 0.5 && m < 1) {
      // the left hand rides on the handle while the racket comes across
      this.fp.copy(this.p).add(this.o.set(0, 0, 0.095).applyQuaternion(this.q).negate());
      this.fq.copy(this.q);
    }
    return { p: this.p, q: this.q };
  }

  freePose() {
    return this.active() ? this.free : null;
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
    x.fillText('PC: watch the ball, roll the wheel FORWARD as it comes to swing', 512, 66, 980);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(1.3, 0.1625), new MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 31;
    m.position.set(0, 1.12, -3.2);
    m.visible = false;
    return m;
  }

  showHint(on) {
    this.hint.visible = !!on && MouseRacket.available() && !!this.world.session;
  }
}

// Batting on the PC, in the desktop emulator ONLY (IWER). A headset never runs this: there the bat follows the real hand.
//
// On a PC the mouse is already taken: in the emulator the cursor is where the simulated EYES look (or, in Play mode, the
// mouse turns the HEAD). Eye tracking is the score, so batting must not take the mouse away from it. So:
//   - the bat stands on the line you are looking along (the cursor, or the middle of the view in Play mode): look at the
//     ball and the bat is in line with it,
//   - the scroll wheel (or a two-finger swipe on a touchpad) is the swing: roll BACK to lift the bat (backlift), roll FORWARD
//     to swing it through. A fast roll is a hard shot, a slow one a push. The wheel never moves the cursor, so the eyes stay
//     on the ball while you swing.
// Nothing here moves by itself: the bat goes exactly where the player puts it and stays there until the player moves it. The
// game treats it exactly like a hand: same pose history, same swept hit test, same physics, same eye-tracking score.

import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3 } from '@iwsdk/core';
import { BAT } from '../core/bat-physics.js';

const PLANE_Z = -1.0; // m in front of the eyes: where the look line is read (about where the ball is played)
// What a batsman sees of his own bat (first person): his gloves low at the bottom of the view, the bat leaning forward and out
// to the side over the pitch, never standing up in the middle of the view. The hands are low and close to the body.
const HANDS_Y = -0.4;
const HANDS_Z = -0.68;
const X_MIN = -0.75;
const X_MAX = 0.85;
// The bat leans this far out to the side (degrees from straight down, toward the off side), so from the eyes it lies across
// the lower view like in a real batsman's view, gloves on the left, blade out to the right.
const LEAN = 35;
// Bat angle in degrees: 0 = blade hanging down (and out to the side, LEAN), + = swung forward, - = lifted back. The stance has
// the blade pointing forward and down over the pitch. The backlift takes the bat up behind, out of the batsman's view, as a
// real one does; the downswing brings it back into view through the ball and on into the follow-through.
const STANCE = 30;
const BACKLIFT_MAX = -100;
const FOLLOW_THROUGH = 200; // over the front shoulder, the blade up and behind the head
// The hands move with the swing, as a batsman's do (still only as the wheel moves the swing): back and down to the back hip in
// the backlift, and up and across to the front shoulder in the follow-through. So the bat leaves the view both ways, and only
// the part of the swing in front of the batsman (stance, downswing, the hit) is seen.
const LIFT_HANDS = { dx: 0.12, dy: -0.12, dz: 0.42 }; // at the top of the backlift
const FINISH_HANDS = { dx: -0.6, dy: 0.24, dz: 0.6 }; // at the end of the follow-through: beside the front shoulder
const FINISH_FROM = 65; // degrees: the hands start up toward the shoulder after the hit zone
const DEG_PER_PX = 0.4; // swing per pixel of scroll (one mouse-wheel notch is about 100 px, so ~3-4 notches = a full swing)
const SPRING = 70; // 1/s: how fast the bat follows the wheel (a hard flick gives a fast shot, a slow roll a gentle one)
const YAW_PER_M = 55; // degrees the swing turns toward the side the bat is on, per metre off centre (off / leg side shots)

export class MouseBat {
  constructor(world) {
    this.world = world;
    this.nx = 0;
    this.ny = 0.55;
    this.th = STANCE; // bat angle now (degrees)
    this.w = 0; // its rate (degrees/s)
    this.target = STANCE; // where the wheel has put it
    this.lastT = 0;
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.o = new Vector3();
    this.d = new Vector3();
    this.p = new Vector3();
    this.q = new Quaternion();
    this.m = new Matrix4();
    this.inv = new Matrix4();
    this.f = new Vector3();
    this.bd = new Vector3();
    this.r = new Vector3();
    this.bn = new Vector3();
    this.X = new Vector3();
    this.Y = new Vector3();
    this.Z = new Vector3();
    this.hint = this.makeHint();
    // The cursor is only read (never captured or stopped): the emulator's eyes and head controls get every event as before.
    this.onMove = (e) => {
      const el = this.world.renderer?.domElement;
      const r = el?.getBoundingClientRect?.();
      if (!r || !r.width || !r.height) return;
      this.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ny = (e.clientY - r.top) / r.height;
    };
    this.onWheel = (e) => {
      if (!this.world.session) return;
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1; // lines / pages to pixels
      // roll forward (deltaY < 0) = swing through, roll back = lift the bat
      this.target = Math.min(FOLLOW_THROUGH, Math.max(BACKLIFT_MAX, this.target - e.deltaY * scale * DEG_PER_PX));
    };
    if (MouseBat.available()) {
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

  // On the emulator the PC control always holds the bat during a session (the emulator's controller is not something a
  // person can swing, and a bat left on it floats in the view).
  active() {
    return MouseBat.available() && !!this.world.session;
  }

  // The camera that draws the emulator's view (the XR camera while in a session).
  camera() {
    const xr = this.world.renderer?.xr;
    const cam = xr?.isPresenting ? xr.getCamera() : this.world.camera;
    // The emulator draws one view across the canvas (the other has an empty viewport): use the widest.
    const views = cam?.cameras ?? [];
    let best = null;
    for (const v of views) if (!best || (v.viewport?.z ?? 0) > (best.viewport?.z ?? 0)) best = v;
    return best ?? cam;
  }

  // The bat follows the wheel's target like a quick spring (a hand has weight too). It never moves without the wheel.
  swing() {
    const now = performance.now() / 1000;
    let dt = this.lastT ? now - this.lastT : 0;
    this.lastT = now;
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    // critically damped spring, in small steps so it is steady at any frame rate
    const n = Math.ceil(dt / 0.004);
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = SPRING * SPRING * (this.target - this.th) - 2 * SPRING * this.w;
      this.w += a * h;
      this.th += this.w * h;
    }
  }

  // Back to the stance (menus, a new session).
  reset() {
    this.th = this.target = STANCE;
    this.w = 0;
    this.lastT = 0;
  }

  // The bat's pose in the anchor frame from the PC control, or null when it is not in use.
  pose(anchor) {
    if (!this.active()) return null;
    const cam = this.camera();
    if (!cam) return null;
    // Where the player is looking: the cursor, or the middle of the view when Play mode has locked the pointer.
    const locked = !!document.pointerLockElement;
    if (locked) this.ndc.set(0, 0);
    else this.ndc.set(this.nx, -(this.ny * 2 - 1));
    this.ray.setFromCamera(this.ndc, cam);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.o.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    this.d.copy(this.ray.ray.direction).transformDirection(this.inv);
    let x = 0;
    if (this.d.z < -1e-3) x = this.o.x + ((PLANE_Z - this.o.z) / this.d.z) * this.d.x;
    x = Math.min(X_MAX, Math.max(X_MIN, x));

    this.swing();
    const th = (this.th * Math.PI) / 180;
    const psi = (Math.max(-30, Math.min(30, x * YAW_PER_M)) * Math.PI) / 180;
    const lean = (LEAN * Math.PI) / 180;
    const cl = Math.cos(lean);
    this.f.set(Math.sin(psi), 0, -Math.cos(psi)); // forward, down the ball's line
    this.r.set(Math.cos(psi), 0, Math.sin(psi)); // across, to the off side
    // toward the toe: down-and-out (the lean) at th = 0, swung forward or back about the hands
    this.bd.set(0, -cl * Math.cos(th), 0).addScaledVector(this.r, Math.sin(lean) * Math.cos(th)).addScaledVector(this.f, Math.sin(th));
    // the face: square to the ball's line (no sideways tilt), perpendicular to the blade, leading the swing
    this.bn.set(0, Math.sin(th), 0).addScaledVector(this.f, cl * Math.cos(th)).normalize();
    this.Z.copy(this.bd).negate();
    this.X.copy(this.bn).negate();
    this.Y.crossVectors(this.Z, this.X);
    this.q.setFromRotationMatrix(this.m.makeBasis(this.X, this.Y, this.Z));
    // the sweet spot sits on the look line: shift the hands across so it does, whatever the swing angle (so the middle of the
    // bat travels straight down the ball's line and the face stays square: the lean is a look, it does not pull shots sideways)
    this.p.set(x - this.bd.x * -BAT.sweetZ, HANDS_Y, HANDS_Z);
    const ease = (u) => u * u * (3 - 2 * u);
    const lift = ease(Math.min(1, Math.max(0, -this.th / -BACKLIFT_MAX)));
    const fin = ease(Math.min(1, Math.max(0, (this.th - FINISH_FROM) / (FOLLOW_THROUGH - FINISH_FROM))));
    this.p.x += LIFT_HANDS.dx * lift + FINISH_HANDS.dx * fin;
    this.p.y += LIFT_HANDS.dy * lift + FINISH_HANDS.dy * fin;
    this.p.z += LIFT_HANDS.dz * lift + FINISH_HANDS.dz * fin;
    return { p: this.p, q: this.q };
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
    x.font = '700 42px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('PC: look at the ball. Wheel BACK = lift, FORWARD = swing', 512, 66, 980);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const m = new Mesh(new PlaneGeometry(1.3, 0.1625), new MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    m.renderOrder = 31;
    m.position.set(0, 1.12, -3.2); // above the menu panels and the call-outs
    m.visible = false;
    return m;
  }

  // Show the hint on the emulator until the player has hit a ball.
  showHint(on) {
    this.hint.visible = !!on && MouseBat.available() && !!this.world.session;
  }
}

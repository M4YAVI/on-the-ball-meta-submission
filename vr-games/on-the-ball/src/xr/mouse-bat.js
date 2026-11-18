// Batting on the PC, in the desktop emulator ONLY (IWER). A headset never runs this: there the bat follows the real hand.
//
// On a PC the mouse is already taken: in the emulator the cursor is where the simulated EYES look (or, in Play mode, the
// mouse turns the HEAD). Eye tracking is the score, so batting must not take the mouse away from it. So:
//   - the bat stands on the line you are looking along (the cursor, or the middle of the view in Play mode): look at the ball
//     and the bat is in line with it, at the height you look at as it comes through the hitting zone;
//   - the scroll wheel (or a two-finger swipe on a touchpad) is the swing: roll BACK to lift the bat (backlift), roll FORWARD
//     to swing it through. A fast roll is a hard shot, a slow one a push. The wheel never moves the cursor, so the eyes stay
//     on the ball while you swing.
// Nothing here moves by itself: the bat goes exactly where the player puts it and stays there until the player moves it. The
// game treats it exactly like a hand: same pose history, same swept hit test, same physics, same eye-tracking score.
// The pose itself (stance, backlift, the push through the ball, the follow-through) is pure maths in core/pc-swing.js.

import { CanvasTexture, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Raycaster, SRGBColorSpace, Vector2, Vector3 } from '@iwsdk/core';
import { PC_SWING, pcBatPoseFromLook, springStep } from '../core/pc-swing.js';

const { STANCE, BACKLIFT_MAX, FOLLOW_THROUGH, DEG_PER_PX } = PC_SWING;

export class MouseBat {
  constructor(world) {
    this.world = world;
    this.nx = 0;
    this.ny = 0.55;
    this.state = { th: STANCE, w: 0 }; // the bat angle now (degrees) and its rate (degrees/s)
    this.target = STANCE; // where the wheel has put it
    this.lastT = 0;
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.o = new Vector3();
    this.d = new Vector3();
    this.p = new Vector3();
    this.q = new Quaternion();
    this.inv = new Matrix4();
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

  // The swing angle now (degrees): below 0 the bat is lifted behind, STANCE at rest, past it the bat is going through.
  get th() {
    return this.state.th;
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
    const dt = this.lastT ? now - this.lastT : 0;
    this.lastT = now;
    springStep(this.state, this.target, dt);
  }

  // Back to the stance (menus, a new session).
  reset() {
    this.state.th = this.target = STANCE;
    this.state.w = 0;
    this.lastT = 0;
  }

  // The bat's pose in the anchor frame from the PC control, or null when it is not in use.
  pose(anchor) {
    if (!this.active()) return null;
    const cam = this.camera();
    if (!cam) return null;
    // Where the player is looking: the cursor (the simulated eyes), or the middle of the view when Play mode has locked the
    // pointer (the mouse turns the head).
    if (document.pointerLockElement) this.ndc.set(0, 0);
    else this.ndc.set(this.nx, -(this.ny * 2 - 1));
    this.ray.setFromCamera(this.ndc, cam);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.o.copy(this.ray.ray.origin).applyMatrix4(this.inv);
    this.d.copy(this.ray.ray.direction).transformDirection(this.inv);
    this.swing();
    const { p, q } = pcBatPoseFromLook([this.o.x, this.o.y, this.o.z], [this.d.x, this.d.y, this.d.z], this.state.th);
    this.p.set(p[0], p[1], p[2]);
    this.q.set(q[0], q[1], q[2], q[3]);
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

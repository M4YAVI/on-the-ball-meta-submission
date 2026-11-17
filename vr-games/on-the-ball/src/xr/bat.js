// The cricket bat in the player's hand. It follows the hand's grip pose exactly (controller or tracked hand): nothing moves it
// but the player. No buttons, no animation. The controller is the bat's handle (see gripToBat): the bat is at the same
// angle as the hand that holds it, the way a real bat is.
//
// It also keeps a short history of its own poses, so the game can ask how fast any point of the blade is moving (the bat's
// speed and direction are what send the ball away), and it pulses the controller when the ball hits it.
//
// The bat lives in the scene anchor (the eye frame), the same frame as the ball, so the hit test needs no conversions.

import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { BAT, batToWorld } from '../core/bat-physics.js';
import { makeGloves } from './gloves.js';

const HISTORY = 8; // frames of pose history kept for the swing speed
const VEL_WINDOW = 0.03; // s: swing speed is measured over about this long (smooths hand-tracking jitter, little lag)
const LOST_HIDE = 0.35; // s without tracking before the bat is hidden
const SWITCH_AFTER = 0.6; // s the holding hand must be lost before the bat moves to the other hand
// How the bat sits in the fist: exactly like a real bat. WebXR's grip space models a rod held in the fist along its Z axis,
// with -Z toward the thumb (MDN, XRInputSource.gripSpace). So the handle runs through the fist along that axis, the top of
// the handle is on the thumb side and the blade comes out below the little finger (+Z). The face of the bat looks where the
// palm looks (palm = -X of the right grip, +X of the left). Hold the controller like the bat's handle (ring up, palm to the
// bowler) and the bat is in the stance; the bat goes wherever the controller goes, at the same angle, nothing added.
// In bat-frame terms (blade toward the bat's -Z, face toward the bat's -X):
//   right hand: bat X = grip X, bat Z = -grip Z  -> 180 degrees about X
//   left hand:  bat X = -grip X, bat Z = -grip Z -> 180 degrees about Y
function gripToBat(side = 'right') {
  return side === 'left' ? new Quaternion(0, 1, 0, 0) : new Quaternion(1, 0, 0, 0);
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// English willow: pale straw with fine straight grain running down the blade.
function willowTex() {
  return canvasTex(256, 1024, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#d9bf86');
    g.addColorStop(0.5, '#ecd6a4');
    g.addColorStop(1, '#d9bf86');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const gx = (i + 0.5) * (w / 26) + (rnd() - 0.5) * 4;
      x.strokeStyle = `rgba(150,110,55,${0.18 + rnd() * 0.2})`;
      x.lineWidth = 1 + rnd() * 1.5;
      x.beginPath();
      x.moveTo(gx, 0);
      for (let y = 0; y <= h; y += 64) x.lineTo(gx + Math.sin(y * 0.01 + i) * 2, y);
      x.stroke();
    }
  });
}

// Rubber grip: dark, with a ribbed spiral.
function gripTex() {
  return canvasTex(128, 512, (x, w, h) => {
    x.fillStyle = '#1d2a22';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#2f4a38';
    x.lineWidth = 6;
    for (let y = -w; y < h + w; y += 22) {
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(w, y + w * 0.35);
      x.stroke();
    }
  });
}

function stickerTex() {
  return canvasTex(256, 512, (x, w, h) => {
    x.fillStyle = '#0c3b2a';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#f5c242';
    x.fillRect(10, 10, w - 20, 10);
    x.fillRect(10, h - 20, w - 20, 10);
    x.save();
    x.translate(w / 2, h / 2);
    x.rotate(-Math.PI / 2);
    x.fillStyle = '#ffffff';
    x.font = 'bold 92px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('ON THE BALL', 0, 0, h - 60);
    x.restore();
  });
}

// The blade: a flat face toward -X, a curved back with a raised spine, edges about 4 cm deep and the spine about 6.5 cm, the
// spine thickest in the lower middle (where the sweet spot is), shoulders that round in toward the handle.
function bladeGeometry() {
  const L = BAT.bladeTopZ - BAT.toeZ;
  const hw = BAT.halfWidth;
  const face = -0.026;
  const g = new BoxGeometry(1, hw * 2, L, 1, 14, 28);
  g.translate(0, 0, (BAT.bladeTopZ + BAT.toeZ) / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const along = (z - BAT.toeZ) / L; // 0 toe .. 1 shoulder
    // shoulders: the last 6 cm narrow and round toward the handle
    const sh = Math.max(0, (along - 0.89) / 0.11);
    const wScale = 1 - 0.62 * sh * sh;
    const yy = y * wScale;
    const u = Math.min(1, Math.abs(yy) / hw);
    const profile = 0.78 + 0.22 * Math.exp(-(((along - 0.33) / 0.38) ** 2)); // the "middle": thickest low on the blade
    const depth = (0.04 + 0.027 * Math.pow(1 - u * u, 0.7) * profile) * (1 - 0.35 * sh) * (0.93 + 0.07 * Math.min(1, along * 8));
    pos.setY(i, yy);
    pos.setX(i, pos.getX(i) > 0 ? face + depth : face);
  }
  g.computeVertexNormals();
  return g;
}

export class Bat {
  constructor(world) {
    this.world = world;
    this.group = new Group();
    this.group.name = 'otb-bat';
    this.group.visible = false;
    this.visual = new Group();
    this.group.add(this.visual);
    this.build();

    this.side = 'right';
    this.tracked = false;
    this.lostFor = 0;
    this.enabled = false;
    this.pose = null; // {p, q} in the anchor frame, this frame
    this.prevPose = null; // last frame
    this.history = []; // [{t, p, q}]
    this.gripOffset = gripToBat('right');
    this.gripOffsetLeft = gripToBat('left');
    this.override = null; // () => {p: Vector3, q: Quaternion} in the anchor frame, or null (the emulator's mouse batting)
    this.m = new Matrix4();
    this.inv = new Matrix4();
    this.v = new Vector3();
    this.q = new Quaternion();
    this.s = new Vector3();
    this.fp = null; // filtered position
    this.fq = null; // filtered rotation
  }

  build() {
    const willow = new MeshStandardMaterial({ map: willowTex(), roughness: 0.62, metalness: 0 });
    const blade = new Mesh(bladeGeometry(), willow);
    const handleLen = BAT.handleTopZ - BAT.bladeTopZ + 0.03;
    const handleGeo = new CylinderGeometry(BAT.handleRadius, BAT.handleRadius * 1.08, handleLen, 18, 1, false);
    handleGeo.rotateX(Math.PI / 2);
    handleGeo.translate(0, 0, (BAT.handleTopZ + BAT.bladeTopZ - 0.03) / 2);
    const handle = new Mesh(handleGeo, new MeshStandardMaterial({ map: gripTex(), roughness: 0.9, metalness: 0 }));
    const cap = new Mesh(new SphereGeometry(BAT.handleRadius * 1.05, 14, 8), new MeshStandardMaterial({ color: '#1d2a22', roughness: 0.9 }));
    cap.scale.set(1, 1, 0.55);
    cap.position.set(0, 0, BAT.handleTopZ);
    // the splice: the cane handle runs a little way into the blade's shoulders
    const spliceGeo = new CylinderGeometry(BAT.handleRadius * 1.08, BAT.handleRadius * 1.5, 0.05, 14);
    spliceGeo.rotateX(Math.PI / 2);
    spliceGeo.translate(0, 0, BAT.bladeTopZ - 0.005);
    const splice = new Mesh(spliceGeo, willow);
    // maker's sticker on the face, below the shoulders, like a real bat
    const sticker = new Mesh(
      new PlaneGeometry(0.075, 0.15),
      new MeshStandardMaterial({ map: stickerTex(), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    sticker.rotation.set(0, -Math.PI / 2, Math.PI / 2);
    sticker.position.set(-0.0265, 0, BAT.bladeTopZ - 0.13);
    this.visual.add(blade, handle, cap, splice, sticker);
    this.meshes = [blade, handle, cap, splice, sticker];
    // the batsman's gloves on the handle (look only: the hit test uses the blade)
    this.gloves = makeGloves();
    this.visual.add(this.gloves);
  }

  // Which hand holds it. Right by default; the left when only the left is tracked (and, once there, it stays there until the
  // left hand is lost, so it never flips mid-swing).
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
    if (!on) {
      this.group.visible = false;
      this.pose = this.prevPose = null;
      this.history.length = 0;
      this.fp = this.fq = null;
    }
  }

  // Called once per frame, before the ball moves. anchor: the scene anchor (eye frame). Returns true while the bat is in hand.
  update(anchor, dt, time) {
    if (!this.enabled || !this.world.session) {
      this.group.visible = false;
      this.pose = this.prevPose = null;
      this.history.length = 0;
      this.fp = this.fq = null;
      return false;
    }
    const forced = this.override?.();
    this.pcDriven = !!forced; // true only on the PC emulator's demo control (never on a headset)
    if (forced) {
      // Emulator only: the mouse is the player's hand. Same pose history, same hit test, same physics.
      this.tracked = true;
      this.lostFor = 0;
      this.fp = forced.p.clone();
      this.fq = forced.q.clone();
      return this.commit(time);
    }
    const other = this.side === 'right' ? 'left' : 'right';
    let tracked = this.isTracked(this.side);
    if (!tracked) {
      this.lostFor += dt;
      if (this.lostFor > SWITCH_AFTER && this.isTracked(other)) {
        this.side = other;
        this.lostFor = 0;
        this.fp = this.fq = null;
        this.history.length = 0;
        tracked = true;
      }
    } else this.lostFor = 0;
    // Prefer the right hand again when it comes back and the bat is idle in the left (not mid-swing).
    if (tracked && this.side === 'left' && this.isTracked('right') && this.tipSpeed(time) < 1) {
      this.side = 'right';
      this.fp = this.fq = null;
      this.history.length = 0;
    }
    this.tracked = tracked;

    if (!tracked) {
      // Hold the last pose for a moment (a short tracking drop mid-swing), then hide. No hits while untracked.
      this.prevPose = this.pose = null;
      if (this.lostFor > LOST_HIDE) this.group.visible = false;
      return false;
    }

    const grip = this.world.player?.gripSpaces?.[this.side];
    if (!grip) return false;
    grip.updateWorldMatrix(true, false);
    anchor.updateWorldMatrix(true, false);
    this.inv.copy(anchor.matrixWorld).invert();
    this.m.multiplyMatrices(this.inv, grip.matrixWorld);
    this.m.decompose(this.v, this.q, this.s);
    this.q.multiply(this.side === 'left' ? this.gripOffsetLeft : this.gripOffset);
    if (!Number.isFinite(this.v.x + this.v.y + this.v.z + this.q.w)) return false;

    // Tracked hands jitter a few millimetres at rest; controllers do not. Smooth only what is slow, so a swing keeps its full
    // speed and no lag (an adaptive "one euro" style filter: the faster the hand, the less smoothing).
    const isHand = !!this.inputManager()?.getPrimaryInputSource?.(this.side)?.hand;
    if (!this.fp || !isHand) {
      this.fp = this.v.clone();
      this.fq = this.q.clone();
    } else {
      const speed = this.fp.distanceTo(this.v) / Math.max(dt, 1e-3);
      const fc = 5 + 6 * speed; // Hz
      const a = 1 - Math.exp(-Math.max(dt, 1e-3) * 2 * Math.PI * fc);
      this.fp.lerp(this.v, a);
      this.fq.slerp(this.q, a);
    }
    return this.commit(time);
  }

  commit(time) {
    this.group.position.copy(this.fp);
    this.group.quaternion.copy(this.fq);
    this.group.visible = true;

    this.prevPose = this.pose;
    this.pose = { p: [this.fp.x, this.fp.y, this.fp.z], q: [this.fq.x, this.fq.y, this.fq.z, this.fq.w] };
    this.history.push({ t: time, p: this.pose.p, q: this.pose.q });
    if (this.history.length > HISTORY) this.history.shift();
    return true;
  }

  // Velocity (m/s, anchor frame) of a point fixed on the bat (bat-frame coordinates), measured over the last ~30 ms.
  velocityAt(local, time) {
    const h = this.history;
    if (h.length < 2) return [0, 0, 0];
    const now = h[h.length - 1];
    let then = h[0];
    for (let i = h.length - 2; i >= 0; i--) {
      then = h[i];
      if (now.t - h[i].t >= VEL_WINDOW) break;
    }
    const dtv = now.t - then.t;
    if (!(dtv > 1e-4) || time - now.t > 0.1) return [0, 0, 0];
    const a = batToWorld(then, local);
    const b = batToWorld(now, local);
    return [(b[0] - a[0]) / dtv, (b[1] - a[1]) / dtv, (b[2] - a[2]) / dtv];
  }

  tipSpeed(time) {
    const v = this.velocityAt([0, 0, BAT.sweetZ], time);
    return Math.hypot(v[0], v[1], v[2]);
  }

  // A pulse in the hand that holds the bat. Controllers only: tracked hands have nothing to vibrate.
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

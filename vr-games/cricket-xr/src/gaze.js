import { Quaternion, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';
// The verdict monitor and the calibration check are ON THE BALL's own code, not a copy: one source of truth.
import { CAL, CalibrationCheck, GazeVerdict, VERDICT } from '../../on-the-ball/src/core/gaze-verdict.js';

export { CAL, CalibrationCheck, VERDICT };

// "Eyes on the ball": where is the player looking while the delivery is in the air?
//
// What the headset can really provide decides what this reports:
//   * 'eyes'  - the runtime gave a gaze ray that moves independently of the head (real eye tracking,
//               e.g. Quest Pro). Only then is it called eye tracking.
//   * 'head'  - no usable eye data: the head's forward direction stands in, with a wider cone.
//               A "gaze" ray that never leaves the head's forward line is detected and treated as this.
//   * 'none'  - not in a headset (a PC): focus is not measured.
//   * `simulated` is true while the emulator's mouse stands in for the eyes. It is never real eye data.
//
// Eye movement is separated from head movement by working in HEAD space: the gaze direction is
// expressed relative to the head, filtered there, and only then rotated back into the world by the
// (unfiltered) head pose. So turning the head with the eyes locked on the ball keeps the gaze on the
// ball; moving only the eyes moves the gaze; and head motion is never smoothed or lagged.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Is the "gaze" ray really the eyes? (Reference: ON THE BALL src/core/gaze-verdict.js.)
// Evidence only counts while the head is nearly still. A head ray that the runtime samples a few ms apart from the
// head pose drifts off the head line while the head turns, which could otherwise pass as "eye movement".
const HEAD_STILL_DEG_S = 10;
// With the head still, an eye ray this far off the head's forward line is not a head ray...
const SEPARATION_DEG = 1.5; // same as ON THE BALL / the SDK (passAngleDeg)
// ...or the eye ray has moved this far inside the head (range of directions, not a running total, so sensor noise
// cannot add up to a false "eyes" over time).
const SPREAD_DEG = 2;
// Gaze filter: heavy smoothing while fixating (kills jitter), almost none during a saccade (no lag).
const FC_MIN = 3; // Hz while still
const FC_BETA = 0.12; // extra Hz per degree/second
// Eyes cannot rotate this fast: a bigger one-frame step is a sensor glitch, ignored for up to 2 frames.
const GLITCH_DEG_S = 1100;
const MAX_GLITCH_FRAMES = 2;
// Eye data may vanish for a blink; hold the last gaze this long, then treat the data as lost.
const HOLD_S = 0.15;
// Leaving the ball counts only after this long, so one noisy frame does not flip "watching".
const LOOK_AWAY_GRACE_S = 0.06;
// Looking away for this long in one go counts as having looked away from the delivery.
const LOOKED_AWAY_S = 0.25;
// Leaving the cone needs a slightly wider angle than entering it (hysteresis against flicker).
const CONE_EXIT = 1.3;
// Gaze speeds that separate fixation, smooth pursuit and saccades (degrees/second).
const PURSUIT_DEG_S = 8;
const SACCADE_DEG_S = 100;
// A head turn this fast (deg/s) is a deliberate head movement.
const HEAD_MOVE_DEG_S = 15;

// In the IWER desktop emulator there are no eyes. So the mouse stands in for them: wherever the mouse is
// over the view is where the "eyes" look (no gaze mode or pointer setup needed). Real eye tracking wins
// whenever the headset reports it.
const EMU_HALF_FOV_X = Math.tan((38 * Math.PI) / 180);
const EMU_HALF_FOV_Y = Math.tan((30 * Math.PI) / 180);

const finiteVec = (v) => !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, a.dot(b))));

// A usable rotation: finite and close to unit length (it is normalised in place when slightly off).
function validQuat(q) {
  if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) return false;
  const l2 = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (!(l2 > 0.8 && l2 < 1.2)) return false;
  q.normalize();
  return true;
}

export class FocusTracker {
  constructor() {
    this.mode = 'none'; // 'eyes' | 'head' | 'none'
    this.eyeSeen = false; // has the gaze ray ever moved independently of the head?
    this.origin = new Vector3();
    this.dir = new Vector3(0, 0, -1);
    this.watching = false;
    this.simulated = false; // true while the mouse is standing in for the eyes
    this.valid = true; // false while the gaze data is lost (after the blink hold) so it is not scored
    this.holding = false; // true while a short dropout is being bridged
    this.movement = 'none'; // 'fixation' | 'pursuit' | 'saccade' | 'head-turn' | 'none'
    this.eyeSpeed = 0; // deg/s, eye-in-head (the eyeball turning in the head)
    this.headSpeed = 0; // deg/s, head rotation
    this.gazeSpeed = 0; // deg/s, where the gaze points in the world
    this.prevDir = new Vector3(0, 0, -1);
    this.havePrevDir = false;

    this.v = new Vector3();
    this.headDir = new Vector3(0, 0, -1);
    this.q = new Quaternion();
    this.qInv = new Quaternion();
    this.rawLocal = new Vector3(0, 0, -1); // this frame's eye direction in head space
    this.prevRawLocal = new Vector3(0, 0, -1);
    this.filtLocal = new Vector3(0, 0, -1);
    this.prevHeadDir = new Vector3(0, 0, -1);
    this.haveRaw = false;
    this.haveFilt = false;
    this.havePrevHead = false;
    this.spread = null; // { yMin, yMax, pMin, pMax } of the eye-in-head direction while the head was still
    this.emulated = false; // the IWER desktop emulator is running: its "tracked" gaze is never real eyes
    this.resetVerdict();
    this.glitch = 0;
    this.gap = 0; // seconds since the last eye sample

    // Frame input, written by sample() or feed().
    this.inHeadPos = new Vector3();
    this.inHeadQuat = new Quaternion();
    this.inEyeKind = 'none'; // 'none' | 'tracked' | 'simulated'
    this.inEyePos = new Vector3();
    this.inEyeQuat = new Quaternion();
    this.inEyeLocal = new Vector3(0, 0, -1);
    this.toBall = new Vector3();

    this.emuX = 0; // emulator mouse, -1..1 across the view
    this.emuY = 0;
    this.emuMoved = false; // the mouse has been over the view at least once
    this.emuOver = false; // the mouse is over the view right now (not on the emulator's toolbar or panels)
    this.emuNdc = new Vector3();
    if (typeof window !== 'undefined' && window.addEventListener && typeof document !== 'undefined') {
      // The mouse is the eyes only while it is over the 3D view. On the emulator's toolbar, its hand panels or
      // outside the window it is not looking at anything in the scene: no gaze data then (not scored), instead of
      // a "gaze" stuck up on the toolbar that reads as looking away from the ball.
      const locked = () => !!document.pointerLockElement;
      const onMove = (e) => {
        if (locked()) {
          // Mouse-look: the mouse turns the head, the cursor is hidden, so the eyes look straight ahead.
          this.emuX = 0;
          this.emuY = 0;
          this.emuOver = true;
          this.emuMoved = true;
          return;
        }
        const t = e.target;
        if (!t || t.tagName !== 'CANVAS') {
          this.emuOver = false;
          return;
        }
        const r = t.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        this.emuX = ((e.clientX - r.left) / r.width) * 2 - 1;
        this.emuY = -(((e.clientY - r.top) / r.height) * 2 - 1);
        this.emuOver = true;
        this.emuMoved = true;
      };
      window.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerlockchange', () => {
        if (locked()) {
          this.emuX = 0;
          this.emuY = 0;
          this.emuOver = true;
        }
      });
      document.documentElement.addEventListener('pointerleave', () => (this.emuOver = false));
      window.addEventListener('blur', () => (this.emuOver = false));
    }
    this.resetPitch();
  }

  // True only for genuine eye tracking: never the head stand-in and never the emulator mouse.
  get realEyes() {
    return this.mode === 'eyes' && !this.simulated;
  }

  // What is actually measuring the gaze, for labels.
  get source() {
    if (this.mode === 'none') return 'none';
    if (this.mode === 'head') return 'head';
    if (this.simulated) return 'simulated-eyes';
    return this.valid ? 'eyes' : 'eyes-lost';
  }

  resetVerdict() {
    this.gazeVerdict = new GazeVerdict(); // ON THE BALL's monitor
    this.vClock = 0;
  }

  // The passive verdict: eye-independent once real eye movement was confirmed here, otherwise ON THE BALL's GazeVerdict
  // (no-gaze, head-locked, or unknown while there is not enough evidence yet).
  get verdict() {
    return this.eyeSeen ? VERDICT.EYE : this.gazeVerdict.verdict;
  }

  // eyeLocal: the gaze direction in head space, or null with no gaze pose. Fed to ON THE BALL's GazeVerdict
  // (the angle between two directions does not change when both are expressed in head space).
  updateVerdict(eyeLocal, dt) {
    if (this.eyeSeen) return;
    this.vClock += dt;
    const tracked = !!eyeLocal;
    this.gazeVerdict.update(this.vClock, tracked ? [eyeLocal.x, eyeLocal.y, eyeLocal.z] : null, [0, 0, -1], tracked);
  }

  // Head-still evidence that the eye ray moves on its own. local: eye direction in head space (unit).
  eyeEvidence(local, offDeg) {
    if (this.headSpeed > HEAD_STILL_DEG_S) return false;
    if (offDeg > SEPARATION_DEG) return true;
    const yawD = Math.atan2(local.x, -local.z) * RAD;
    const pitchD = Math.asin(Math.max(-1, Math.min(1, local.y))) * RAD;
    const s = this.spread;
    if (!s) {
      this.spread = { yMin: yawD, yMax: yawD, pMin: pitchD, pMax: pitchD };
      return false;
    }
    s.yMin = Math.min(s.yMin, yawD);
    s.yMax = Math.max(s.yMax, yawD);
    s.pMin = Math.min(s.pMin, pitchD);
    s.pMax = Math.max(s.pMax, pitchD);
    return s.yMax - s.yMin > SPREAD_DEG || s.pMax - s.pMin > SPREAD_DEG;
  }

  resetPitch() {
    this.watchTime = 0;
    this.flightTime = 0;
    this.invalidTime = 0;
    this.lostAt = null; // how far from the player the ball was when the eyes last left it
    this.wasWatching = false;
    this.offTime = 0;
    this.awayRun = 0;
    this.longestAway = 0;
    this.lookedAway = false;
    this.eyeTravel = 0; // degrees the eyes moved in the head during the delivery
    this.headTravel = 0; // degrees the head turned during the delivery
  }

  // Reads this frame's gaze from the player rig. inHeadset: an XR session is running.
  sample(player, camera, inHeadset, dt = 1 / 72) {
    this.simulated = false;
    if (!inHeadset) {
      this.mode = 'none';
      this.valid = true;
      this.holding = false;
      this.movement = 'none';
      camera.getWorldPosition(this.origin);
      camera.getWorldDirection(this.dir);
      this.havePrevHead = false;
      this.havePrevDir = false;
      return;
    }
    player.head.getWorldPosition(this.inHeadPos);
    player.head.getWorldQuaternion(this.inHeadQuat);
    this.emulated = typeof window !== 'undefined' && window.IWER_DEVICE !== undefined; // never set on Quest Browser
    this.inEyeKind = 'none';
    if (player.gazeOrigin === 'tracked' && player.eyeSpace) {
      player.eyeSpace.getWorldPosition(this.inEyePos);
      player.eyeSpace.getWorldQuaternion(this.inEyeQuat);
      this.inEyeKind = 'tracked';
    } else if (typeof window !== 'undefined' && window.IWER_DEVICE && this.emuMoved) {
      // Emulator: the gaze ray goes from the head through the pixel under the mouse. Unprojected with the camera
      // that drew the frame, so the ring sits exactly under the cursor at any window size or aspect.
      if (this.emuOver) {
        this.emuLocal(camera, this.inEyeLocal);
        this.inEyeKind = 'simulated';
      }
      // Cursor off the view: no eye data this frame (a blink-length gap is bridged, longer is not scored).
    }
    this.process(dt);
  }

  // The mouse's direction in head (camera) space, through the camera's own projection. Falls back to a fixed
  // field of view when the camera has no usable projection.
  emuLocal(camera, out) {
    const inv = camera && camera.projectionMatrixInverse;
    if (inv) {
      this.emuNdc.set(this.emuX, this.emuY, 0.5).applyMatrix4(inv);
      if (finiteVec(this.emuNdc) && this.emuNdc.z < 0) return out.copy(this.emuNdc).normalize();
    }
    return out.set(this.emuX * EMU_HALF_FOV_X, this.emuY * EMU_HALF_FOV_Y, -1).normalize();
  }

  // Test / tool entry: feed one frame of head (and optional eye) pose without a player rig.
  // eye: { pos, quat } for a tracked eye ray, { local } for a simulated direction in head space, or null.
  feed(dt, headPos, headQuat, eye = null) {
    this.inHeadPos.copy(headPos);
    this.inHeadQuat.copy(headQuat);
    this.inEyeKind = 'none';
    if (eye && eye.quat) {
      this.inEyePos.copy(eye.pos || headPos);
      this.inEyeQuat.copy(eye.quat);
      this.inEyeKind = 'tracked';
    } else if (eye && eye.local) {
      this.inEyeLocal.copy(eye.local);
      this.inEyeKind = 'simulated';
    }
    this.simulated = false;
    this.process(dt);
  }

  process(dt) {
    dt = Number.isFinite(dt) ? Math.min(0.25, Math.max(1e-3, dt)) : 1 / 72;

    // Head: required. Without a valid head pose nothing can be measured this frame.
    if (!finiteVec(this.inHeadPos) || !validQuat(this.inHeadQuat)) {
      this.valid = false;
      this.holding = false;
      return;
    }
    this.origin.copy(this.inHeadPos);
    this.headDir.set(0, 0, -1).applyQuaternion(this.inHeadQuat);
    if (this.havePrevHead) {
      const step = angleBetween(this.headDir, this.prevHeadDir) * RAD;
      this.headSpeed = step / dt;
      this.headTravel += step;
    } else {
      this.headSpeed = 0;
    }
    this.prevHeadDir.copy(this.headDir);
    this.havePrevHead = true;

    // Eye: the direction in head space, if the runtime gave a usable one.
    let haveEye = false;
    let originFromEye = false;
    if (this.inEyeKind === 'tracked') {
      if (validQuat(this.inEyeQuat)) {
        this.rawLocal.set(0, 0, -1).applyQuaternion(this.inEyeQuat); // world direction for now
        this.qInv.copy(this.inHeadQuat).invert();
        this.rawLocal.applyQuaternion(this.qInv).normalize();
        haveEye = finiteVec(this.rawLocal);
        originFromEye = haveEye && finiteVec(this.inEyePos);
      }
    } else if (this.inEyeKind === 'simulated') {
      this.rawLocal.copy(this.inEyeLocal);
      haveEye = finiteVec(this.rawLocal) && this.rawLocal.lengthSq() > 1e-6;
      if (haveEye) this.rawLocal.normalize();
    }

    const tracked = haveEye && this.inEyeKind === 'tracked';
    const offDeg = tracked ? Math.acos(Math.min(1, Math.max(-1, -this.rawLocal.z))) * RAD : NaN;

    if (haveEye) {
      this.gap = 0;
      this.holding = false;
      this.valid = true;
      // The emulator mouse, and any "tracked" gaze the emulator hands over, are labelled simulated: never real eyes.
      const simulated = this.inEyeKind === 'simulated' || this.emulated;
      this.simulated = simulated;
      this.lastEyeSimulated = simulated;
      // Is this independent eye data, or a head ray in disguise?
      if (!this.eyeSeen) {
        if (this.inEyeKind === 'simulated') this.eyeSeen = true;
        else if (this.eyeEvidence(this.rawLocal, offDeg)) this.eyeSeen = true;
      }
      if (tracked) this.updateVerdict(this.rawLocal, dt);
      if (this.eyeSeen) {
        this.filterEye(dt);
        this.mode = 'eyes';
        this.dir.copy(this.filtLocal).applyQuaternion(this.inHeadQuat).normalize();
        if (originFromEye) this.origin.copy(this.inEyePos);
        this.classify(dt);
        return;
      }
      this.prevRawLocal.copy(this.rawLocal);
      this.haveRaw = true;
    } else if (this.eyeSeen && this.haveFilt) {
      // Eye data went missing after real eye tracking was confirmed: bridge a blink, then call it lost.
      // It never silently becomes head tracking: the mode stays 'eyes' and lost time is not scored.
      this.simulated = !!this.lastEyeSimulated; // keeps its label while the data is missing
      this.gap += dt;
      if (this.gap <= HOLD_S) {
        this.holding = true;
        this.valid = true;
      } else {
        this.holding = false;
        this.valid = false;
      }
      this.mode = 'eyes';
      this.dir.copy(this.filtLocal).applyQuaternion(this.inHeadQuat).normalize(); // rides with the head
      this.eyeSpeed = 0;
      this.classify(dt);
      return;
    }

    // No eye data (and none ever confirmed): the head's direction stands in, labelled as head.
    if (!haveEye) this.updateVerdict(null, dt);
    this.mode = 'head';
    this.valid = true;
    this.holding = false;
    this.simulated = false;
    this.dir.copy(this.headDir);
    this.eyeSpeed = 0;
    this.classify(dt);
  }

  // Adaptive low-pass on the head-space eye direction, with glitch rejection.
  filterEye(dt) {
    if (!this.haveFilt) {
      this.filtLocal.copy(this.rawLocal);
      this.prevRawLocal.copy(this.rawLocal);
      this.haveFilt = true;
      this.haveRaw = true;
      this.glitch = 0;
      this.eyeSpeed = 0;
      return;
    }
    let speed = (angleBetween(this.rawLocal, this.prevRawLocal) * RAD) / dt;
    if (speed > GLITCH_DEG_S && this.glitch < MAX_GLITCH_FRAMES && this.inEyeKind !== 'simulated') {
      this.glitch++;
      this.rawLocal.copy(this.prevRawLocal); // ignore the impossible jump
      speed = 0;
    } else {
      this.glitch = 0;
    }
    this.eyeSpeed = speed;
    if (this.inEyeKind === 'simulated') {
      // The mouse has no sensor noise to filter: smoothing it only makes the ring lag behind the cursor.
      this.filtLocal.copy(this.rawLocal);
      this.prevRawLocal.copy(this.rawLocal);
      return;
    }
    const fc = FC_MIN + FC_BETA * speed;
    const alpha = 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.filtLocal.lerp(this.rawLocal, alpha).normalize();
    this.prevRawLocal.copy(this.rawLocal);
  }

  // Names what the gaze is doing, from where it points in the WORLD and what drives it:
  //   saccade   - the gaze jumped (eyes);
  //   pursuit   - the gaze is moving and the eyes are leading it (smooth following of the ball);
  //   head-turn - the gaze is moving because the head is turning;
  //   fixation  - the gaze is steady. That includes turning the head while the eyes hold the ball
  //               (the eyes counter-rotate: the gaze does not move, so it is not eye movement).
  classify(dt) {
    if (this.havePrevDir) this.gazeSpeed = (angleBetween(this.dir, this.prevDir) * RAD) / dt;
    else this.gazeSpeed = 0;
    this.prevDir.copy(this.dir);
    this.havePrevDir = true;
    if (this.mode === 'head') {
      this.movement = this.headSpeed > HEAD_MOVE_DEG_S ? 'head-turn' : 'fixation';
      return;
    }
    if (this.gazeSpeed > SACCADE_DEG_S) this.movement = 'saccade';
    else if (this.gazeSpeed > PURSUIT_DEG_S) this.movement = this.headSpeed > 0.6 * this.gazeSpeed ? 'head-turn' : 'pursuit';
    else this.movement = 'fixation';
    // Eye travel counts only when the eyes moved the gaze, not when the head carried it.
    if (this.movement === 'saccade' || this.movement === 'pursuit') this.eyeTravel += this.gazeSpeed * dt;
  }

  // Called every frame the ball is in flight. distance: ball to player, for the "looked away" note.
  // `radius`: the ball's radius, so a close ball (which is big in the view) is easier to keep on.
  track(ballPos, dt, distance, radius = 0.08) {
    if (this.mode === 'none') {
      this.watching = false;
      return;
    }
    if (!this.valid || !finiteVec(ballPos)) {
      // Lost or invalid gaze data is not the player's fault: it is not scored either way.
      this.invalidTime += dt;
      return;
    }
    const to = this.toBall.subVectors(ballPos, this.origin);
    const d2 = to.lengthSq();
    let inside = false;
    if (d2 > 1e-6) {
      const cone = (this.mode === 'eyes' ? CFG.focusConeEyes : CFG.focusConeHead) * DEG;
      const ballAngle = Math.atan(radius / Math.sqrt(d2));
      const limit = (this.wasWatching ? cone * CONE_EXIT : cone) + ballAngle;
      inside = this.dir.angleTo(to) < limit;
    }
    if (inside) {
      this.offTime = 0;
      this.watching = true;
      this.awayRun = 0;
    } else {
      this.offTime += dt;
      this.awayRun += dt;
      if (this.offTime >= LOOK_AWAY_GRACE_S) this.watching = false;
      if (this.awayRun > this.longestAway) this.longestAway = this.awayRun;
      if (this.awayRun >= LOOKED_AWAY_S) this.lookedAway = true;
    }
    this.flightTime += dt;
    if (this.watching) this.watchTime += dt;
    if (this.wasWatching && !this.watching) this.lostAt = distance;
    if (this.watching) this.lostAt = null;
    this.wasWatching = this.watching;
  }

  // 0..1 share of the (valid) flight the eyes were on the ball, or null when not measured.
  get focus() {
    if (this.mode === 'none' || this.flightTime <= 0) return null;
    const total = this.flightTime + this.invalidTime;
    if (this.flightTime / total < 0.5) return null; // mostly missing data: do not make up a score
    return Math.min(1, Math.max(0, this.watchTime / this.flightTime));
  }

  // Names the diagnostics panel reads.
  get focusFraction() {
    return this.focus;
  }
  get inCone() {
    return this.watching;
  }
  get gazeDir() {
    return this.dir;
  }
}

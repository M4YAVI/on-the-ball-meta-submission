import { Quaternion, Raycaster, Vector2, Vector3 } from '@iwsdk/core';
import { CFG } from './config.js';

// "Eyes on the ball": where is the player looking while the pitch is in the air?
//
// The game asks the headset for eye gaze (the `gaze-tracking` WebXR feature, see iwsdk.config.json).
// What the headset can really provide decides what this reports (reference: ON THE BALL src/core/gaze-verdict.js,
// and the Cricket Catch tracker this one shares its eye handling with):
//   * 'eyes'  - the runtime gave a gaze ray (`player.eyeSpace`, valid while `player.gazeOrigin === 'tracked'`) that
//               was seen moving independently of the head while the head was still. Only then is it eye tracking.
//   * 'head'  - no usable eye data: the head's forward direction stands in, with a wider cone. A "gaze" ray that
//               never leaves the head's forward line is detected and treated as this.
//   * 'none'  - not in a headset and no mouse yet: focus is not measured.
//   * `simulated` is true while the mouse, or the IWER emulator's gaze, stands in for the eyes. Never real eye data.
//
// Once real eyes are confirmed, missing eye data (a blink, a tracking dropout) is bridged for a moment and then marked
// lost and left unscored. It never silently turns into head tracking.
//
// Eye movement is separated from head movement by working in HEAD space: the gaze direction is expressed relative to
// the head, filtered there (jitter smoothing and glitch rejection), and only then rotated back into the world by the
// unfiltered head pose, so head motion is never smoothed or lagged.
//
// On desktop PC testing, moving the mouse aims the gaze ray across the view so tracking the ball
// can be tested and verified smoothly with instant visual lock-on.

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Is the "gaze" ray really the eyes? Evidence only counts while the head is nearly still: a head ray sampled a few ms
// apart from the head pose drifts off the head line while the head turns, which could otherwise pass as eye movement.
const HEAD_STILL_DEG_S = 10;
const SEPARATION_DEG = 2.5; // with the head still, a gaze ray this far off the head's forward line is real eye tracking
const SPREAD_DEG = 2; // ...or one that has moved this far inside the head (a range, so noise cannot add up)
// Gaze filter: heavy smoothing while fixating (kills jitter), almost none during a saccade (no lag).
const FC_MIN = 3; // Hz while still
const FC_BETA = 0.12; // extra Hz per degree/second
// Eyes cannot rotate this fast: a bigger one-frame step is a sensor glitch, ignored for up to 2 frames.
const GLITCH_DEG_S = 1100;
const MAX_GLITCH_FRAMES = 2;
// Eye data may vanish for a blink; hold the last gaze this long, then treat the data as lost.
const HOLD_S = 0.15;
// Real eye data is noisy: leaving the ball counts only after this long, and leaving the cone needs a slightly wider
// angle than entering it, so tracker noise does not flicker "watching". (Head and mouse input are not noisy and keep
// their instant response.)
const LOOK_AWAY_GRACE_S = 0.06;
const CONE_EXIT = 1.3;

// Passive head-locked monitor, same numbers as ON THE BALL / @iwsdk/xr-input GAZE_VERDICT.
export const VERDICT = Object.freeze({
  UNKNOWN: 'unknown', // not enough evidence yet
  NO_GAZE: 'no-gaze', // the runtime gave no gaze pose
  EYE: 'eye-independent', // the gaze ray moved independently of the head
  HEAD_LOCKED: 'head-locked', // the gaze ray matched the head ray the whole time
});
const LOCKED_IDENTICAL_DEG = 0.05;
const LOCKED_RATIO = 0.95;
const LOCKED_MAX_DEG = 0.1;
const LOCKED_MIN_S = 3;
const LOCKED_MIN_FRAMES = 90;

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

// The IWER desktop emulator. It is never installed on Quest Browser, so real headsets never take this path.
const inEmulator = () => typeof window !== 'undefined' && !!(window.IWER_DEVICE || window.__IWER__);

export class FocusTracker {
  constructor() {
    this.mode = 'none'; // 'eyes' | 'head' | 'none'
    this.eyeSeen = false; // has the gaze ray been seen moving independently of the head?
    this.origin = new Vector3();
    this.dir = new Vector3(0, 0, -1);
    this.watching = false;
    this.v = new Vector3();
    this.headDir = new Vector3();
    this.q = new Quaternion();
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.emuX = 0; // -1..1 across the view
    this.emuY = 0;
    this.emuMoved = false;
    this.simulated = false; // true while the mouse (or the emulator's gaze) is standing in for the eyes
    this.emulated = false; // the IWER emulator is running this frame
    this.mouseGaze = false; // the mouse is aiming the gaze this frame (desktop / emulator)
    this.valid = true; // false while confirmed eye data is lost (after the blink hold), so it is not scored
    this.holding = false; // true while a short dropout is being bridged
    this.cv = null;

    this.headQuat = new Quaternion();
    this.qInv = new Quaternion();
    this.eyeQuat = new Quaternion();
    this.eyePos = new Vector3();
    this.rawLocal = new Vector3(0, 0, -1); // this frame's eye direction in head space
    this.prevRawLocal = new Vector3(0, 0, -1);
    this.filtLocal = new Vector3(0, 0, -1);
    this.prevHeadDir = new Vector3(0, 0, -1);
    this.havePrevHead = false;
    this.haveFilt = false;
    this.headSpeed = 0; // deg/s
    this.glitch = 0;
    this.gap = 0; // seconds since the last confirmed eye sample
    this.spread = null; // range of the eye-in-head direction while the head was still
    this.lastEyeSimulated = false;
    this.resetVerdict();

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('pointermove', (e) => {
        const cv = this.canvas();
        const r = cv ? cv.getBoundingClientRect() : null;
        const w = (r && r.width > 0) ? r.width : (window.innerWidth || 1);
        const h = (r && r.height > 0) ? r.height : (window.innerHeight || 1);
        const left = r ? r.left : 0;
        const top = r ? r.top : 0;
        this.ndc.x = Math.max(-1, Math.min(1, ((e.clientX - left) / w) * 2 - 1));
        this.ndc.y = Math.max(-1, Math.min(1, -(((e.clientY - top) / h) * 2 - 1)));
        this.emuX = this.ndc.x;
        this.emuY = this.ndc.y;
        this.emuMoved = true;
      });
    }
    this.resetPitch();
  }

  canvas() {
    if (!this.cv || !this.cv.isConnected) {
      this.cv = (typeof document !== 'undefined')
        ? (document.querySelector('#scene-container canvas') || document.querySelector('canvas'))
        : null;
    }
    return this.cv;
  }

  // True only for genuine eye tracking: never the head stand-in and never simulated input.
  get realEyes() {
    return this.mode === 'eyes' && !this.simulated;
  }

  // What is actually measuring the gaze, for labels and diagnostics.
  get source() {
    if (this.mode === 'none') return 'none';
    if (this.mode === 'head') return 'head';
    if (this.simulated) return 'simulated-eyes';
    return this.valid ? 'eyes' : 'eyes-lost';
  }

  resetPitch() {
    this.watchTime = 0;
    this.flightTime = 0;
    this.invalidTime = 0; // time with lost eye data: not scored either way
    this.offTime = 0;
    this.lostAt = null; // how far from the player the ball was when the eyes last left it
    this.wasWatching = false;
  }

  resetVerdict() {
    this.verdict = VERDICT.UNKNOWN;
    this.vFrames = 0;
    this.vIdentical = 0;
    this.vMaxDeg = 0;
    this.vInvalid = 0;
    this.vSeconds = 0;
  }

  // Passive monitor (ON THE BALL GazeVerdict): does the gaze ray ever leave the head ray?
  // offDeg: angle between the gaze ray and the head's forward line this frame, or NaN with no gaze pose.
  updateVerdict(offDeg, dt) {
    if (this.eyeSeen) {
      this.verdict = VERDICT.EYE;
      return;
    }
    if (this.verdict === VERDICT.EYE) this.resetVerdict(); // eye confirmation was cleared: start the check again
    if (!Number.isFinite(offDeg)) {
      this.vInvalid++;
      if (this.verdict === VERDICT.UNKNOWN && this.vFrames === 0 && this.vInvalid >= LOCKED_MIN_FRAMES) this.verdict = VERDICT.NO_GAZE;
      return;
    }
    if (this.verdict === VERDICT.NO_GAZE) this.verdict = VERDICT.UNKNOWN;
    this.vFrames++;
    this.vSeconds += dt;
    if (offDeg < LOCKED_IDENTICAL_DEG) this.vIdentical++;
    if (offDeg > this.vMaxDeg) this.vMaxDeg = offDeg;
    if (
      this.vSeconds >= LOCKED_MIN_S &&
      this.vFrames >= LOCKED_MIN_FRAMES &&
      this.vIdentical / this.vFrames >= LOCKED_RATIO &&
      this.vMaxDeg < LOCKED_MAX_DEG
    ) {
      this.verdict = VERDICT.HEAD_LOCKED;
    }
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

  // Adaptive low-pass on the head-space eye direction, with glitch rejection.
  filterEye(dt) {
    if (!this.haveFilt) {
      this.filtLocal.copy(this.rawLocal);
      this.prevRawLocal.copy(this.rawLocal);
      this.haveFilt = true;
      this.glitch = 0;
      return;
    }
    let speed = (angleBetween(this.rawLocal, this.prevRawLocal) * RAD) / dt;
    if (speed > GLITCH_DEG_S && this.glitch < MAX_GLITCH_FRAMES) {
      this.glitch++;
      this.rawLocal.copy(this.prevRawLocal); // ignore the impossible jump
      speed = 0;
    } else {
      this.glitch = 0;
    }
    const fc = FC_MIN + FC_BETA * speed;
    const alpha = 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.filtLocal.lerp(this.rawLocal, alpha).normalize();
    this.prevRawLocal.copy(this.rawLocal);
  }

  // Desktop / emulator mouse stands in for the eyes (unchanged behaviour: direct, no smoothing).
  sampleMouse(camera) {
    if (camera.isCamera) {
      this.ndc.set(this.emuX, this.emuY);
      this.ray.setFromCamera(this.ndc, camera);
      this.origin.copy(this.ray.ray.origin);
      this.dir.copy(this.ray.ray.direction).normalize();
    } else {
      camera.getWorldPosition(this.origin);
      this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.q));
    }
    this.mode = 'eyes';
    this.simulated = true;
    this.mouseGaze = true;
    this.valid = true;
    this.holding = false;
  }

  // Reads this frame's gaze. inHeadset: an XR session is running. dt: frame time in seconds.
  sample(player, camera, inHeadset, dt = 1 / 72) {
    dt = Number.isFinite(dt) ? Math.min(0.25, Math.max(1e-3, dt)) : 1 / 72;
    this.simulated = false;
    this.mouseGaze = false;
    this.emulated = inEmulator();

    if (inHeadset && player && player.head) {
      player.head.getWorldPosition(this.origin);
      player.head.getWorldQuaternion(this.headQuat);
      if (!finiteVec(this.origin) || !validQuat(this.headQuat)) {
        // No usable head pose: nothing can be measured this frame (and nothing is scored).
        this.valid = false;
        this.holding = false;
        return;
      }
      this.headDir.set(0, 0, -1).applyQuaternion(this.headQuat);
      this.headSpeed = this.havePrevHead ? (angleBetween(this.headDir, this.prevHeadDir) * RAD) / dt : 0;
      this.prevHeadDir.copy(this.headDir);
      this.havePrevHead = true;

      // 1. Eye tracking from the runtime (Meta Quest Pro; or the emulator's gaze, labelled simulated).
      let haveEye = false;
      let offDeg = NaN;
      if (player.gazeOrigin === 'tracked' && player.eyeSpace) {
        player.eyeSpace.getWorldPosition(this.eyePos);
        player.eyeSpace.getWorldQuaternion(this.eyeQuat);
        if (validQuat(this.eyeQuat)) {
          this.qInv.copy(this.headQuat).invert();
          this.rawLocal.set(0, 0, -1).applyQuaternion(this.eyeQuat).applyQuaternion(this.qInv).normalize();
          haveEye = finiteVec(this.rawLocal);
          if (haveEye) offDeg = Math.acos(Math.min(1, Math.max(-1, -this.rawLocal.z))) * RAD;
        }
      }
      if (haveEye) {
        if (!this.eyeSeen && this.eyeEvidence(this.rawLocal, offDeg)) this.eyeSeen = true;
        this.updateVerdict(offDeg, dt);
        if (this.eyeSeen) {
          this.filterEye(dt);
          this.dir.copy(this.filtLocal).applyQuaternion(this.headQuat).normalize();
          if (finiteVec(this.eyePos)) this.origin.copy(this.eyePos);
          this.mode = 'eyes';
          this.simulated = this.emulated;
          this.lastEyeSimulated = this.simulated;
          this.valid = true;
          this.holding = false;
          this.gap = 0;
          return;
        }
      } else {
        this.updateVerdict(NaN, dt);
      }

      // 2. Emulator: the mouse aims the "eyes" (labelled simulated).
      if (this.emulated && this.emuMoved && camera) {
        this.sampleMouse(camera);
        return;
      }

      // 3. Eye data went missing after eye tracking was confirmed: bridge a blink, then call it lost.
      //    It never silently becomes head tracking: the mode stays 'eyes' and lost time is not scored.
      if (!haveEye && this.eyeSeen && this.haveFilt) {
        this.gap += dt;
        this.holding = this.gap <= HOLD_S;
        this.valid = this.holding;
        this.mode = 'eyes';
        this.simulated = this.lastEyeSimulated;
        if (finiteVec(this.eyePos)) this.origin.copy(this.eyePos);
        this.dir.copy(this.filtLocal).applyQuaternion(this.headQuat).normalize(); // rides with the head
        return;
      }

      // 4. Headset without (confirmed) eye tracking, e.g. Meta Quest 3: the head direction, labelled as head.
      this.dir.copy(this.headDir);
      this.mode = 'head';
      this.valid = true;
      this.holding = false;
      return;
    }

    this.havePrevHead = false;
    this.valid = true;
    this.holding = false;

    // Desktop simulated gaze outside XR, once the mouse has moved.
    if (this.emuMoved && camera) {
      this.sampleMouse(camera);
      return;
    }

    // Default outside headset before the mouse moves: not measured.
    if (camera) {
      camera.getWorldPosition(this.origin);
      this.dir.set(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(this.q));
    }
    this.mode = 'none';
  }

  // Called every frame the ball is in flight. distance: ball to player, for the "looked away" note.
  track(ballPos, dt, distance) {
    if (this.mode === 'none') {
      this.watching = false;
      return;
    }
    if (!this.valid || !finiteVec(ballPos) || !Number.isFinite(dt) || dt <= 0) {
      // Lost eye data (or a broken frame) is not the player's fault: it is not scored either way.
      if (Number.isFinite(dt) && dt > 0) this.invalidTime += dt;
      return;
    }
    // Generous tracking cone for desktop mouse simulation (18 deg) so players on 2D screens
    // can follow high-speed pitches naturally and lock on easily
    const baseCone = this.mode === 'eyes' ? CFG.focusConeEyes : CFG.focusConeHead;
    const cone = this.mouseGaze ? 18 : baseCone;
    // Only eye-tracker data (not the head, not the mouse) is noisy enough to need hysteresis and a look-away grace.
    const noisy = this.mode === 'eyes' && !this.mouseGaze;
    const limit = (noisy && this.wasWatching ? cone * CONE_EXIT : cone) * DEG;
    const to = this.v.subVectors(ballPos, this.origin);
    const inside = to.lengthSq() > 1e-6 && this.dir.angleTo(to) < limit;
    if (inside) {
      this.offTime = 0;
      this.watching = true;
    } else {
      this.offTime += dt;
      if (!noisy || this.offTime >= LOOK_AWAY_GRACE_S) this.watching = false;
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
    if (this.flightTime / total < 0.5) return null; // mostly missing eye data: do not make up a score
    return Math.min(1, Math.max(0, this.watchTime / this.flightTime));
  }
}

// ---------- calibration: "is this really your eyes?" ----------
// Same check as ON THE BALL (src/core/gaze-verdict.js CalibrationCheck), same numbers. The player keeps the head still
// and looks at each target in turn (e.g. a dot left, then a dot right). Only a gaze ray that moves independently of the
// head can pass. Pure logic: it is fed directions and times, so it is unit tested; it draws nothing itself.
// Passing it never proves the signal is hardware-real (the emulator can pass), so emulated input stays labelled simulated.
export const CAL = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PASSED: 'passed', FAILED: 'failed' });

const angleDegV = (a, b) => {
  if (!finiteVec(a) || !finiteVec(b)) return NaN;
  const la = a.length();
  const lb = b.length();
  if (!(la > 1e-9 && lb > 1e-9)) return NaN;
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b) / (la * lb)))) * RAD;
};

export class CalibrationCheck {
  // targets: [{ id, dir: Vector3 }] world-space directions, shown one after another.
  constructor({ targets, dwellMs = 400, timeoutMs = 15000, aimTolDeg = 6, headDriftDeg = 4, minSeparationDeg = 6 }) {
    if (!Array.isArray(targets) || targets.length === 0) throw new TypeError('CalibrationCheck needs targets');
    this.targets = targets;
    this.dwellMs = dwellMs;
    this.timeoutMs = timeoutMs;
    this.aimTolDeg = aimTolDeg;
    this.headDriftDeg = headDriftDeg;
    this.minSeparationDeg = minSeparationDeg;
    this.status = CAL.IDLE;
    this.targetIndex = 0;
    this.reason = null;
  }

  start(tMs, headDir) {
    this.status = CAL.RUNNING;
    this.reason = null;
    this.targetIndex = 0;
    this.headBase = headDir.clone();
    this._beginTarget(tMs);
  }

  _beginTarget(tMs) {
    this.targetStart = tMs;
    this.since = null;
    this.blockers = { 'no-gaze': 0, 'off-target': 0, 'head-moved': 0, 'gaze-follows-head': 0 };
  }

  snapshot(progress = 0) {
    return { status: this.status, targetIndex: this.targetIndex, progress, reason: this.reason };
  }

  // eyeDir / headDir: world-space directions. tracked: the runtime gave a gaze pose this frame.
  sample(tMs, eyeDir, headDir, tracked) {
    if (this.status !== CAL.RUNNING) return this.snapshot(this.status === CAL.PASSED ? 1 : 0);
    if (!Number.isFinite(tMs)) return this.snapshot();
    if (tMs - this.targetStart > this.timeoutMs) {
      this.status = CAL.FAILED;
      let worst = 'no-gaze';
      let most = -1;
      for (const [k, n] of Object.entries(this.blockers)) {
        if (n > most) {
          most = n;
          worst = k;
        }
      }
      this.reason = worst;
      return this.snapshot();
    }
    const target = this.targets[this.targetIndex];
    const aim = tracked ? angleDegV(eyeDir, target.dir) : NaN;
    const drift = angleDegV(headDir, this.headBase);
    const sep = tracked ? angleDegV(eyeDir, headDir) : NaN;
    let blocked = null;
    if (!tracked || !Number.isFinite(aim) || !Number.isFinite(sep)) blocked = 'no-gaze';
    else if (!(aim <= this.aimTolDeg)) blocked = 'off-target';
    else if (!(drift <= this.headDriftDeg)) blocked = 'head-moved';
    else if (!(sep >= this.minSeparationDeg)) blocked = 'gaze-follows-head';
    if (blocked) {
      this.blockers[blocked]++;
      this.since = null;
      return this.snapshot();
    }
    if (this.since === null) this.since = tMs;
    const progress = Math.min(1, (tMs - this.since) / this.dwellMs);
    if (progress >= 1) {
      this.targetIndex++;
      if (this.targetIndex >= this.targets.length) {
        this.status = CAL.PASSED;
        return this.snapshot(1);
      }
      this._beginTarget(tMs);
      return this.snapshot(0);
    }
    return this.snapshot(progress);
  }
}

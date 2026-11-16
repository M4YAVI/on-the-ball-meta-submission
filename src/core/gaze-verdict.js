// Is the "gaze" ray real eye movement, or just the head pointing forward?
//
// The Immersive Web SDK reads the runtime's gaze input and logs a verdict to the console, but it does not expose that
// verdict to the app. A runtime (or the Quest "gaze simulation = head" dev preview) can hand an app a gaze ray that is
// really the head direction, and scoring that as eye tracking would be wrong. So the app checks for itself, with the
// SDK's own thresholds, in two ways:
//   1. CalibrationCheck: before eye mode unlocks, the player keeps the head still and looks at a left dot, then a right
//      dot. Only a gaze ray that moves independently of the head can pass.
//   2. GazeVerdict: a passive monitor during play that notices a gaze ray that never leaves the head direction.
// Both are pure functions of directions and times, so they are unit tested in Node.
//
// Neither proves a signal is hardware-real: an emulator (or a forged client) can pass both. The app therefore also labels
// emulated input "Simulated" and never calls a calibration pass "hardware validated".

import { angle } from './engine.js';

export const VERDICT = Object.freeze({
  UNKNOWN: 'unknown', // not enough evidence yet
  NO_GAZE: 'no-gaze', // the runtime gave no gaze pose
  EYE: 'eye-independent', // the gaze ray separated from the head ray: independent of the head
  HEAD_LOCKED: 'head-locked', // the gaze ray matched the head ray the whole time
});

// Same numbers as @iwsdk/xr-input GAZE_VERDICT (gaze-pointer.js) so both agree on what "real eye movement" means.
export const THRESHOLDS = Object.freeze({
  passAngleDeg: 1.5, // gaze separating from the head by this much proves independent eye movement
  identicalAngleDeg: 0.05, // closer than this counts as "the same as the head"
  headLockedRatio: 0.95, // share of frames that must be identical to call it head-locked
  headLockedAngleDeg: 0.1, // and the gaze never separated by more than this
  minSeconds: 3, // minimum evidence before any negative verdict
  minFrames: 90,
});

export class GazeVerdict {
  constructor(thresholds = THRESHOLDS) {
    this.th = thresholds;
    this.reset();
  }

  reset() {
    this.verdict = VERDICT.UNKNOWN;
    this.firstValidAt = null;
    this.frames = 0;
    this.identical = 0;
    this.maxAngle = 0;
    this.invalid = 0;
  }

  // tSec: frame time in seconds. eyeDir / headDir: world-space unit-ish vectors. tracked: gaze pose valid this frame.
  update(tSec, eyeDir, headDir, tracked) {
    const a = tracked ? angle(eyeDir, headDir) : NaN;
    if (!Number.isFinite(a) || !Number.isFinite(tSec)) {
      this.invalid++;
      if (this.verdict === VERDICT.UNKNOWN && this.firstValidAt === null && this.invalid >= this.th.minFrames) {
        this.verdict = VERDICT.NO_GAZE;
      }
      return this.verdict;
    }
    if (this.firstValidAt === null) this.firstValidAt = tSec;
    this.frames++;
    if (a < this.th.identicalAngleDeg) this.identical++;
    if (a > this.maxAngle) this.maxAngle = a;

    if (this.maxAngle >= this.th.passAngleDeg) {
      this.verdict = VERDICT.EYE;
    } else if (
      tSec - this.firstValidAt >= this.th.minSeconds &&
      this.frames >= this.th.minFrames &&
      this.identical / this.frames >= this.th.headLockedRatio &&
      this.maxAngle < this.th.headLockedAngleDeg
    ) {
      this.verdict = VERDICT.HEAD_LOCKED;
    }
    return this.verdict;
  }
}

export const CAL = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PASSED: 'passed', FAILED: 'failed' });

export class CalibrationCheck {
  // targets: [{ id, dir:[x,y,z] }] in world space, shown to the player one after another.
  constructor({
    targets,
    dwellMs = 500, // how long the eyes must stay on a target
    timeoutMs = 15000, // per target
    aimTolDeg = 5, // eyes within this of the target count as looking at it
    headDriftDeg = 4, // the head may not turn more than this from where it started
    minSeparationDeg = 6, // and the eyes must be at least this far from the head direction
  }) {
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
    this.headBase = headDir;
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

  sample(tMs, eyeDir, headDir, tracked) {
    if (this.status !== CAL.RUNNING) return this.snapshot(this.status === CAL.PASSED ? 1 : 0);
    if (!Number.isFinite(tMs)) return this.snapshot();

    if (tMs - this.targetStart > this.timeoutMs) {
      this.status = CAL.FAILED;
      // Report whatever blocked the player most often, so the message can say what to change.
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
    const aim = tracked ? angle(eyeDir, target.dir) : NaN;
    const drift = angle(headDir, this.headBase);
    const sep = tracked ? angle(eyeDir, headDir) : NaN;

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

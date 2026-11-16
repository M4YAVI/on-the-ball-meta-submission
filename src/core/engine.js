// ON THE BALL scoring engine. Pure logic, no DOM, no XR: it runs the same in the headset and in Node tests.
//
// Ported from the VEGAH handoff baseline (handoff-baseline/engine.mjs, tag v0.1) with the scoring rules unchanged:
//   - a delivery needs at least 75% valid tracking time, otherwise it is UNSCORED (a sensor problem is never a miss)
//   - GREEN  : eyes on the ball for >= 80% of the valid time AND first on it within 30% of the flight
//              AND still on it as it arrives (deck slide 7: "Eyes stayed on the ball until it arrived")
//   - AMBER  : eyes on the ball for >= 50% of the valid time (partly tracked, acquired late, or left it before it arrived)
//   - RED    : anything else with enough valid tracking
//
// One deliberate fix (acceptance test T09). The baseline advanced its clock even for a rejected sample, so the
// interval that ENDED on the next good sample was credited although the sample before it was invalid. Now an interval is
// credited only when BOTH of its ends are good samples, closer together than `maxGapMs`.
//
// The arrival check looks only at the last `arrivalFraction` of the flight. If that window was not tracked well enough to
// judge (a blink right at the end), the check is skipped rather than failed: a sensor gap is never the player's miss.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const STATUS = Object.freeze({
  GREEN: 'green',
  AMBER: 'amber',
  RED: 'red',
  UNSCORED: 'unscored',
});

export const RULES = Object.freeze({
  maxGapMs: 100, // longest interval between two good samples that still counts as continuous tracking
  minQuality: 0.75, // share of the flight that must be validly tracked, else unscored
  greenCoverage: 0.8,
  greenAcquireFraction: 0.3,
  amberCoverage: 0.5,
  arrivalFraction: 0.15, // the last 15% of the flight is "as it arrives"
  arrivalMinValid: 0.5, // the window must be at least half tracked to be judged
  arrivalCoverage: 0.6, // and the eyes on the ball for at least 60% of it
  maxErrorDeg: 180,
});

const isVec3 = (v) =>
  v != null && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);

// Angle in degrees between two 3-vectors. NaN for malformed input or a zero-length vector (never a fake 0).
export function angle(a, b) {
  if (!isVec3(a) || !isVec3(b)) return NaN;
  const n = Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2]);
  if (!(n > 1e-9)) return NaN;
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (Math.acos(clamp(dot / n, -1, 1)) * 180) / Math.PI;
}

export const SAMPLE = Object.freeze({
  OK: 'ok', // interval credited
  BASELINE: 'baseline', // good sample, but no earlier good neighbour to form an interval with
  GAP: 'gap', // good sample, but the interval to the previous good sample was too long
  INVALID: 'invalid', // runtime reported no valid pose, wrong source, or an impossible error
  BAD_TIME: 'bad-time', // non-finite, negative or beyond the flight
  OUT_OF_ORDER: 'out-of-order', // duplicate, replayed or older timestamp
  CLOSED: 'closed',
});

export class Trial {
  // mode: which input source this trial accepts ('eye' | 'head' | 'simulated'). Samples from any other source are rejected,
  // so head data can never be scored as eye data.
  // duration: flight length in ms. tolerance: angle (deg) between gaze and ball that counts as "on the ball".
  constructor(mode, duration = 1200, tolerance = 7) {
    if (typeof mode !== 'string' || mode === '') throw new TypeError('Trial needs a source mode');
    if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Trial duration must be > 0 ms');
    if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 90) {
      throw new RangeError('Trial tolerance must be in (0, 90] degrees');
    }
    this.mode = mode;
    this.duration = duration;
    this.tolerance = tolerance;
    this.last = null; // time of the previous sample of any kind (for replay / ordering checks)
    this.prevGood = false; // was that previous sample good?
    this.valid = 0; // ms of validly tracked time
    this.hit = 0; // ms of that time spent on the ball
    this.first = null; // time the gaze first reached the ball
    this.arrivalStart = duration * (1 - RULES.arrivalFraction);
    this.endValid = 0; // validly tracked ms inside the arrival window
    this.endHit = 0; // of which on the ball
    this.bad = 0; // rejected samples and intervals (diagnostic only, never shown as a miss)
    this.samples = 0;
    this.closed = false;
    this.result = null;
  }

  // t: ms since release, on the clock of the caller (XR frame time; we never invent a sensor timestamp).
  // error: angle in degrees between the gaze ray and the direction to the ball.
  // source: where the ray came from. valid: false when the runtime had no usable pose this frame.
  sample(t, error, source, valid = true) {
    if (this.closed) return SAMPLE.CLOSED;
    if (!Number.isFinite(t) || t < 0 || t > this.duration) {
      this.bad++;
      return SAMPLE.BAD_TIME;
    }
    if (this.last !== null && t <= this.last) {
      this.bad++;
      return SAMPLE.OUT_OF_ORDER;
    }
    const prevT = this.last;
    const prevGood = this.prevGood;
    this.last = t;
    this.samples++;

    const good =
      valid === true &&
      source === this.mode &&
      Number.isFinite(error) &&
      error >= 0 &&
      error <= RULES.maxErrorDeg;
    this.prevGood = good;
    if (!good) {
      this.bad++;
      return SAMPLE.INVALID;
    }

    const onBall = error <= this.tolerance;
    if (onBall && this.first === null) this.first = t;

    if (prevT === null || !prevGood) return SAMPLE.BASELINE; // nothing before it to measure an interval from
    const dt = t - prevT;
    if (dt > RULES.maxGapMs) {
      this.bad++;
      return SAMPLE.GAP;
    }
    this.valid += dt;
    if (onBall) this.hit += dt;
    const inEnd = Math.max(0, t - Math.max(prevT, this.arrivalStart)); // part of this interval inside the arrival window
    if (inEnd > 0) {
      this.endValid += inEnd;
      if (onBall) this.endHit += inEnd;
    }
    return SAMPLE.OK;
  }

  finish() {
    if (this.result) return this.result;
    this.closed = true;
    const quality = this.valid / this.duration;
    const coverage = this.valid > 0 ? this.hit / this.valid : 0;
    const window = this.duration - this.arrivalStart;
    const arrivalJudged = this.endValid >= window * RULES.arrivalMinValid;
    const onAtArrival = !arrivalJudged || this.endHit / this.endValid >= RULES.arrivalCoverage;
    const early = this.first !== null && this.first <= this.duration * RULES.greenAcquireFraction;
    let status;
    let reason = null;
    if (quality < RULES.minQuality) {
      status = STATUS.UNSCORED;
      reason = 'insufficient-tracking';
    } else if (coverage >= RULES.greenCoverage && early && onAtArrival) {
      status = STATUS.GREEN;
    } else if (coverage >= RULES.amberCoverage) {
      status = STATUS.AMBER;
      reason = !early ? 'late' : !onAtArrival ? 'left-early' : 'partial';
    } else {
      status = STATUS.RED;
      reason = 'looked-away';
    }
    this.result = {
      mode: this.mode,
      status,
      reason,
      quality,
      coverage,
      acquireMs: this.first,
      arrival: arrivalJudged ? this.endHit / this.endValid : null,
      validMs: this.valid,
      samples: this.samples,
      bad: this.bad,
    };
    return this.result;
  }
}

// Tally a finished session. Unscored deliveries are counted separately, never as red.
export function tally(statuses) {
  const t = { total: 0, green: 0, amber: 0, red: 0, unscored: 0 };
  for (const s of statuses) {
    if (s in t && s !== 'total') {
      t[s]++;
      t.total++;
    }
  }
  return t;
}

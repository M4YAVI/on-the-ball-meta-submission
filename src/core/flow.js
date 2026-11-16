// The session state machine. Pure logic: the XR layer calls these methods and draws whatever `phase` says.
//
// Every method checks the current phase and returns false when it does not apply. That is what makes pinch spam, a
// double tap, or a late event harmless: the second call finds the phase has already moved on and does nothing (T14).
//
// Phases:  sport -> mode -> calibrating -> ready -> playing <-> between -> scorecard
//                                                      |
//                                                   paused  (an interrupted ball is thrown away, never scored as a miss)

import { makeDeliveries, cryptoRng } from './ball-path.js';
import { tally, STATUS } from './engine.js';

export const PHASE = Object.freeze({
  SPORT: 'sport',
  MODE: 'mode',
  CALIBRATING: 'calibrating',
  READY: 'ready',
  PLAYING: 'playing',
  BETWEEN: 'between',
  PAUSED: 'paused',
  SCORECARD: 'scorecard',
});

// Only cricket is playable in this build. The others are shown, honestly, as coming later.
export const SPORTS = Object.freeze([
  { id: 'cricket', label: 'Cricket', live: true },
  { id: 'baseball', label: 'Baseball', live: false },
  { id: 'tennis', label: 'Tennis', live: false },
  { id: 'football', label: 'Football', live: false },
]);

export const MODE = Object.freeze({ EYE: 'eye', HEAD: 'head', SIMULATED: 'simulated' });

export class GameFlow {
  constructor({ total = 20, rng = cryptoRng() } = {}) {
    this.total = total;
    this.rng = rng;
    this.reset();
  }

  reset() {
    this.phase = PHASE.SPORT;
    this.sport = null;
    this.mode = null;
    this.eyeCalibrated = false;
    this.deliveries = [];
    this.results = []; // finished, scored-or-unscored deliveries, in order
    this.index = 0; // the next scored delivery
    this.warmup = false;
    this.warmupDone = false;
    this.pausedFrom = null;
    this.interruptions = 0; // balls thrown away; reported, never counted as a miss
    this.startedAt = null;
    this.finishedAt = null;
  }

  selectSport(id) {
    if (this.phase !== PHASE.SPORT) return false;
    const s = SPORTS.find((x) => x.id === id);
    if (!s || !s.live) return false;
    this.sport = id;
    this.phase = PHASE.MODE;
    return true;
  }

  // Head mode is always allowed (it is labelled as head). Eye mode needs a passed calibration. Simulated is for emulator use.
  chooseMode(mode, { calibrated = false } = {}) {
    if (this.phase !== PHASE.MODE) return false;
    if (mode === MODE.EYE) {
      if (!calibrated) return false;
      this.eyeCalibrated = true;
    } else if (mode !== MODE.HEAD && mode !== MODE.SIMULATED) {
      return false;
    }
    this.mode = mode;
    this.phase = PHASE.READY;
    return true;
  }

  beginCalibration() {
    if (this.phase !== PHASE.MODE) return false;
    this.phase = PHASE.CALIBRATING;
    return true;
  }

  calibrationResult(passed) {
    if (this.phase !== PHASE.CALIBRATING) return false;
    this.phase = PHASE.MODE;
    this.eyeCalibrated = passed === true;
    return true;
  }

  // Starts (or restarts) the next delivery. Allowed from `ready` and `between`.
  beginBall(now = 0) {
    if (this.phase !== PHASE.READY && this.phase !== PHASE.BETWEEN) return null;
    if (this.deliveries.length === 0) this.deliveries = makeDeliveries(this.total, this.rng);
    this.warmup = !this.warmupDone;
    this.phase = PHASE.PLAYING;
    if (this.startedAt === null && !this.warmup) this.startedAt = now;
    const delivery = this.warmup ? { lane: 0, curve: 0 } : this.deliveries[this.index];
    return { index: this.index, warmup: this.warmup, delivery };
  }

  // Skip the warm-up ball (the player already knows the game).
  skipWarmup() {
    if (this.phase !== PHASE.READY) return false;
    this.warmupDone = true;
    return true;
  }

  // The finished delivery. `summary` is Trial.finish(). Returns the stored entry, or null if not playing.
  completeBall(summary, now = 0) {
    if (this.phase !== PHASE.PLAYING) return null;
    if (this.warmup) {
      this.warmup = false;
      this.warmupDone = true;
      this.phase = PHASE.BETWEEN;
      return { warmup: true, status: summary?.status ?? STATUS.UNSCORED };
    }
    const status = Object.values(STATUS).includes(summary?.status) ? summary.status : STATUS.UNSCORED;
    const entry = { index: this.index, status, quality: summary?.quality ?? 0, coverage: summary?.coverage ?? 0 };
    this.results.push(entry);
    this.index++;
    if (this.index >= this.total) {
      this.finishedAt = now;
      this.phase = PHASE.SCORECARD;
    } else {
      this.phase = PHASE.BETWEEN;
    }
    return entry;
  }

  // Pause, hidden page, headset removed, session end: the flight in progress is discarded and replayed later. It is NOT a miss.
  interrupt() {
    if (this.phase === PHASE.PLAYING) {
      this.interruptions++;
      this.pausedFrom = PHASE.BETWEEN; // resume replays the same delivery
      this.phase = PHASE.PAUSED;
      return true;
    }
    if (this.phase === PHASE.BETWEEN || this.phase === PHASE.READY) {
      this.pausedFrom = this.phase;
      this.phase = PHASE.PAUSED;
      return true;
    }
    return false;
  }

  pause() {
    return this.interrupt();
  }

  resume() {
    if (this.phase !== PHASE.PAUSED) return false;
    this.phase = this.pausedFrom ?? PHASE.BETWEEN;
    this.pausedFrom = null;
    return true;
  }

  // Start the 20 again with the same sport and mode. Fresh random deliveries.
  retry() {
    if (this.phase !== PHASE.SCORECARD && this.phase !== PHASE.PAUSED) return false;
    this.results = [];
    this.index = 0;
    this.deliveries = [];
    this.warmup = false;
    this.warmupDone = true; // already warmed up
    this.startedAt = null;
    this.finishedAt = null;
    this.pausedFrom = null;
    this.phase = PHASE.READY;
    return true;
  }

  // Back to the sport picker.
  exit() {
    const had = this.phase;
    this.reset();
    return had !== PHASE.SPORT;
  }

  get complete() {
    return this.phase === PHASE.SCORECARD && this.results.length === this.total;
  }

  counts() {
    return tally(this.results.map((r) => r.status));
  }

  minutes() {
    if (this.startedAt === null || this.finishedAt === null) return 0;
    return Math.max(0, Math.round((this.finishedAt - this.startedAt) / 60000));
  }
}

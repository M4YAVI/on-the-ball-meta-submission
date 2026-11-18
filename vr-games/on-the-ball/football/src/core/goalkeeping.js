// Goalkeeping for FOOTBALL: the gloves meet the shot, and the shot is saved, caught or a goal. Pure maths (no Three.js, no
// DOM), so it is unit-tested in Node (tests/goalkeeping.test.mjs).
//
// Hand play is a second score beside the eyes, never instead of them. The eye-tracking trial (src/core/engine.js) follows
// the ball from the strike to its arrival point 1.2 m in front of the eyes and ends there. The gloves only get the ball
// AFTER that (a seated keeper's hands reach about 0.4 - 0.8 m in front of the eyes anyway), so nothing a hand does can
// change the eye score.
//
// Frame: the scene anchor's eye frame, the same as the ball: x right, y up from the eyes, z negative toward the striker.
// The goal line is just behind the player (FIELD.goalLineZ), so a ball moving +z is going INTO the goal and a save sends it
// back out toward -z.

import { FIELD, PHYS } from './ball-path.js';

export const GLOVE = Object.freeze({
  // A keeper glove's palm and fingers are about 26 x 14 cm: as a target, a sphere of this radius round the palm centre.
  reach: 0.11,
  pcReach: 0.15, // the PC emulator's control is cruder than an arm: a slightly bigger target (never aim assist)
  palmOut: 0.04, // the palm centre sits this far in front of the grip point (toward the ball)
  together: 0.34, // m between the palm centres: closer than this, the two hands make one "W" and can hold the ball
  catchSpeed: 28, // m/s relative to the hands (~100 km/h): up to here two hands together hold it (a 110 km/h strike arrives at 25-27); faster, it is only parried
  punchSpeed: 3.0, // m/s: a glove driving toward the ball at least this fast punches it clear
  parryE: 0.45, // how much of the ball's speed into the glove comes back out (foam and a giving wrist)
  punchE: 0.75,
});

export const SAVE = Object.freeze({ CATCH: 'catch', PARRY: 'parry', PUNCH: 'punch', GOAL: 'goal' });

// A ball that comes back over the goal line inside the posts and under the bar is a goal, even after a touch.
export function crossedLine(p) {
  return p[2] - PHYS.ballRadius >= FIELD.goalLineZ && Math.abs(p[0]) <= FIELD.goalHalfWidth && p[1] <= FIELD.ground + FIELD.goalHeight;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Swept test between the ball and one glove over one frame, both moving (a fast dive must not pass through the ball between
// two frames). prevBall/ball and prevGlove/glove: positions at the last frame and this one. Returns null, or where they met:
// {t: 0..1 within the frame, ball, glove, normal (glove -> ball, unit)}.
export function sweepGlove(prevBall, ball, prevGlove, glove, reach = GLOVE.reach, ballR = PHYS.ballRadius) {
  if (!prevBall || !ball || !prevGlove || !glove) return null;
  const r0 = sub(prevBall, prevGlove);
  const d = sub(sub(ball, glove), r0);
  const dd = dot(d, d);
  const R = reach + ballR;
  // First time in [0, 1] the gap is R (solve |r0 + d t| = R), or the closest approach if it never gets that close.
  let t = 0;
  if (dot(r0, r0) > R * R) {
    if (dd < 1e-12) return null;
    const b = dot(r0, d);
    const c = dot(r0, r0) - R * R;
    const disc = b * b - dd * c;
    if (disc < 0) return null;
    t = (-b - Math.sqrt(disc)) / dd;
    if (!(t >= 0 && t <= 1)) return null;
  }
  const rel = [r0[0] + d[0] * t, r0[1] + d[1] * t, r0[2] + d[2] * t];
  const l = len(rel);
  const normal = l > 1e-6 ? [rel[0] / l, rel[1] / l, rel[2] / l] : [0, 0, -1];
  return { t, ball: lerp(prevBall, ball, t), glove: lerp(prevGlove, glove, t), normal };
}

// Two hands together meet the ball as ONE surface (the "W" behind it), not as two separate palms. The sweep finds whichever
// palm the ball touched first, and for a ball between the hands that touch is on the palm's edge: its normal points sideways and
// a hard shot would be steered on into the net. So with both hands together, the contact normal is taken from the middle of
// the two palms instead, and always faces back toward the field.
// ball: the ball's centre at contact; a, b: the two palm centres there. Returns a unit vector.
export function pairNormal(ball, a, b) {
  const n = [ball[0] - (a[0] + b[0]) / 2, ball[1] - (a[1] + b[1]) / 2, ball[2] - (a[2] + b[2]) / 2];
  if (!(len(n) > 1e-6)) return [0, 0, -1];
  const u = n.map((x) => x / len(n));
  if (u[2] > -0.5) u[2] = -0.5; // the W faces the field: a ball between the hands never leaves sideways or forward
  const l = len(u);
  return u.map((x) => x / l);
}

// The ball meets the glove(s). ballV, gloveV: velocities (m/s, eye frame). normal: from the glove to the ball at contact.
// together: both hands make one "W". Returns {kind, v}: v is the ball's velocity as it leaves the gloves ([0,0,0] if held).
//
// A ball coming square into the hands is pushed back out toward the field; a glancing touch only bends it, and it may still
// go in (the game then calls it a goal: "a touch, but in"). A glove driven at the ball punches it clear with more speed.
export function meetGlove(ballV, gloveV, normal, together = false) {
  const rel = sub(ballV, gloveV);
  const into = dot(rel, normal); // < 0: closing on the glove
  const relSpeed = len(rel);
  if (into >= 0) return { kind: SAVE.PARRY, v: [...ballV], glancing: true }; // moving apart already: just a brush
  const toBall = dot(gloveV, normal); // the glove's speed toward the ball (> 0: driving at it)
  if (together && relSpeed <= GLOVE.catchSpeed && toBall < GLOVE.punchSpeed) return { kind: SAVE.CATCH, v: [0, 0, 0] };
  const punch = toBall >= GLOVE.punchSpeed;
  const e = punch ? GLOVE.punchE : GLOVE.parryE;
  // Reflect the relative velocity off the contact normal, then carry the glove's own motion back in.
  const k = (1 + e) * into;
  const v = [rel[0] - k * normal[0] + gloveV[0], rel[1] - k * normal[1] + gloveV[1], rel[2] - k * normal[2] + gloveV[2]];
  return { kind: punch ? SAVE.PUNCH : SAVE.PARRY, v };
}

// The keeper's tally for one session (the eye score is kept elsewhere and never reads this). A shot is counted only when at
// least one glove was tracked while it came through: a shot with no hands in play is not a goal against the player, the same
// rule as a sensor failure never being a red ball. Warm-up shots are shown but not counted.
export class KeeperScore {
  constructor() {
    this.reset();
  }

  reset() {
    this.shots = 0;
    this.saves = 0;
    this.catches = 0;
    this.punches = 0;
    this.goals = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  // outcome: {kind: SAVE.*, touched?: boolean}. Returns what to show: {title, sub, saved}.
  record(outcome, { count = true, kmh = 0 } = {}) {
    const kind = outcome?.kind ?? SAVE.GOAL;
    const saved = kind !== SAVE.GOAL;
    if (count) {
      this.shots += 1;
      if (saved) {
        this.saves += 1;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        if (kind === SAVE.CATCH) this.catches += 1;
        if (kind === SAVE.PUNCH) this.punches += 1;
      } else {
        this.goals += 1;
        this.streak = 0;
      }
    }
    const title = kind === SAVE.CATCH ? 'CAUGHT!' : kind === SAVE.PUNCH ? 'PUNCHED CLEAR!' : kind === SAVE.PARRY ? 'SAVED!' : 'GOAL';
    let sub;
    if (!saved) sub = outcome?.touched ? 'A touch, but it went in' : 'It beat your gloves';
    else if (count && this.streak >= 2) sub = `${this.streak} saves in a row`;
    else if (kmh > 0) sub = `${Math.round(kmh)} km/h shot`;
    else sub = '';
    if (!count) sub = 'Warm-up';
    return { title, sub, saved, kind };
  }

  // One line for the scorecard, beside (never instead of) the eye-tracking counts.
  line() {
    const extra = [this.catches ? `${this.catches} caught` : '', this.punches ? `${this.punches} punched` : ''].filter(Boolean).join(', ');
    return `Gloves: ${this.saves} of ${this.shots} saved${extra ? ' · ' + extra : ''}`;
  }

  summary() {
    return {
      shots: this.shots,
      saves: this.saves,
      catches: this.catches,
      punches: this.punches,
      goals: this.goals,
      bestStreak: this.bestStreak,
      line: this.line(),
    };
  }
}

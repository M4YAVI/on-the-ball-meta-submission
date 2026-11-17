// Catching for BASEBALL: the player's mitt meets the pitch, the umpire calls it, and the catches are counted. Pure maths (no Three.js,
// no DOM), so it is unit-tested in Node. It is the "Glove Up" scoring (vr-games/baseball-xr) brought into ON THE BALL.
//
// Scoring is NOT eye tracking. The eye-tracking score (core/engine.js Trial) is unchanged and still ends at the pitch's arrival,
// 1.2 m in front of the eyes. The mitt only gets its turn after that: the ball carries on toward the catcher, and the mitt either
// meets it or it goes by. So nothing the hand does can move the eye score.
//
// Frame: the scene's eye frame (core/ball-path.js): x right, y up from the eyes, z negative toward the pitcher.

import { PATH } from './ball-path.js';

// The strike zone: the plate's width (17 in) plus a ball's radius either side, and 42 cm of height around the zone's centre.
export const STRIKE_ZONE = Object.freeze({ halfWidth: 0.216 + 0.037, halfHeight: 0.21 + 0.037 });

// Framing: a borderline ball caught quietly (the mitt barely moving) is sold as a strike; a borderline strike stabbed at (a fast
// mitt) is called a ball. margin: how far outside the zone still counts as borderline (m). quiet / stab: mitt speed (m/s).
export const FRAME = Object.freeze({ margin: 0.07, quiet: 1.2, stab: 2.6 });

export const CATCH = Object.freeze({
  radius: 0.22, // the ball's centre within this of the pocket's centre: inside the mitt's face (about 28 cm across)
  facing: 0.3, // the pocket must open toward the ball: its normal against the ball's direction of travel, at least this much
  missZ: 0.05, // a ball past this z (level with the eyes) has gone by: it is a miss
  holdS: 0.6, // s a caught ball stays in the mitt before the pitch is closed
});

const num = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

// Where the pitch crossed the plate, relative to the middle of the zone (what the umpire judges).
export function pitchOffset(plan) {
  const aim = plan?.aim ?? [0, PATH.zoneY, PATH.endZ];
  return { x: num(aim[0]), y: num(aim[1]) - PATH.zoneY };
}

// The umpire. `off` is where the pitch crossed, relative to the zone's centre.
export function umpire(off, caught, mittSpeed) {
  const ox = Math.abs(num(off?.x)) - STRIKE_ZONE.halfWidth;
  const oy = Math.abs(num(off?.y)) - STRIKE_ZONE.halfHeight;
  const outside = Math.max(ox, oy); // > 0: outside the zone by that much
  const speed = num(mittSpeed);
  if (!caught) return { strike: outside <= 0, framed: false, stabbed: false };
  if (outside > 0 && outside < FRAME.margin && speed < FRAME.quiet) return { strike: true, framed: true, stabbed: false };
  if (outside <= 0 && outside > -0.05 && speed > FRAME.stab) return { strike: false, framed: false, stabbed: true };
  return { strike: outside <= 0, framed: false, stabbed: false };
}

// The words for the umpire's call.
export function callLabel(call) {
  return call.framed ? 'Framed: STRIKE' : call.stabbed ? 'Stabbed it: Ball' : call.strike ? 'STRIKE' : 'Ball';
}

// Did the ball meet the pocket between the last frame and this one? The ball and the pocket both move, so the test is on the ball's
// path relative to the pocket: the closest it comes to the pocket's centre over the frame. Returns null, or where and when.
export function sweepCatch(prevBall, ball, prevPocket, pocket, radius = CATCH.radius) {
  if (!prevBall || !ball || !prevPocket || !pocket) return null;
  const r0 = [prevBall[0] - prevPocket[0], prevBall[1] - prevPocket[1], prevBall[2] - prevPocket[2]];
  const r1 = [ball[0] - pocket[0], ball[1] - pocket[1], ball[2] - pocket[2]];
  const d = [r1[0] - r0[0], r1[1] - r0[1], r1[2] - r0[2]];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  let t = dd > 1e-12 ? -(r0[0] * d[0] + r0[1] * d[1] + r0[2] * d[2]) / dd : 0;
  t = Math.min(1, Math.max(0, t));
  const c = [r0[0] + d[0] * t, r0[1] + d[1] * t, r0[2] + d[2] * t];
  const dist = Math.hypot(c[0], c[1], c[2]);
  if (!(dist <= radius)) return null;
  const at = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  return { t, dist, ball: at(prevBall, ball), pocket: at(prevPocket, pocket) };
}

// Is the mitt held so that its pocket opens toward the incoming ball? (A ball that hits the back of the mitt glances off.)
export function mittFacesBall(normal, vel) {
  const sp = Math.hypot(vel[0], vel[1], vel[2]);
  if (!(sp > 1e-6)) return true;
  return (normal[0] * vel[0] + normal[1] * vel[1] + normal[2] * vel[2]) / sp <= -CATCH.facing;
}

// The player's hand-play tally for one session: catches, what the umpire called, the run of catches in a row. Pitches that were
// thrown away (a pause, a lost session) never reach it. Warm-up pitches get their call-out but are not counted.
export class HandScore {
  constructor() {
    this.reset();
  }

  reset() {
    this.pitches = 0;
    this.catches = 0;
    this.misses = 0;
    this.strikes = 0;
    this.framed = 0;
    this.streak = 0;
    this.bestStreak = 0;
  }

  // result: { caught, off, mittSpeed, spot ('pocket'|'web'|'heel'|'edge'), why ('missed'|'back') }.
  // Returns the call-out to show: { title, sub, good }.
  record(result, { count = true } = {}) {
    const caught = !!result.caught;
    const call = umpire(result.off, caught, result.mittSpeed);
    let streak = this.streak;
    if (count) {
      this.pitches += 1;
      if (caught) {
        this.catches += 1;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
      } else {
        this.misses += 1;
        this.streak = 0;
      }
      if (call.strike) this.strikes += 1;
      if (call.framed) this.framed += 1;
      streak = this.streak;
    } else streak = caught ? streak + 1 : 0;
    const pocket = result.spot === 'pocket';
    let title;
    if (caught) title = streak >= 3 ? `${pocket ? 'POP!' : 'CAUGHT!'} ${streak} in a row` : pocket ? 'POP!' : 'CAUGHT!';
    else title = result.why === 'back' ? 'Off the back' : 'MISSED';
    return { title, sub: callLabel(call), good: caught, call };
  }

  summary() {
    return {
      pitches: this.pitches,
      catches: this.catches,
      misses: this.misses,
      strikes: this.strikes,
      framed: this.framed,
      streak: this.streak,
      bestStreak: this.bestStreak,
    };
  }
}

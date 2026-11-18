// Timing meter and the perfect shot (src/core/bat-physics.js). The eye-tracking score is not involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BAT, HIT, TIMING, batBounce, isPerfect, launch, perfectLaunch, stepBatted, sweepHit, timingOf } from '../src/core/bat-physics.js';
import { FIELD } from '../src/core/ball-path.js';

const sweetHit = { edge: false, sweet: true, e: 0.56 };

test('timing zones: the ideal point is PERFECT, further out is EARLY, nearer the body is LATE, and the meter position is signed', () => {
  assert.equal(timingOf(TIMING.idealZ).zone, 'perfect');
  assert.equal(timingOf(TIMING.idealZ - TIMING.perfectHalf + 0.005).zone, 'perfect');
  assert.equal(timingOf(TIMING.idealZ + TIMING.perfectHalf - 0.005).zone, 'perfect');
  assert.equal(timingOf(TIMING.idealZ - 0.3).zone, 'early');
  assert.equal(timingOf(TIMING.idealZ + 0.3).zone, 'late');
  assert.ok(timingOf(TIMING.idealZ - 0.3).off < 0 && timingOf(TIMING.idealZ + 0.3).off > 0);
  assert.equal(timingOf(-9).off, -1); // far out front pins to the early end of the meter
  assert.equal(timingOf(3).off, 1);
});

test('perfectLaunch: only a perfect touch, off the middle, with a real swing, qualifies', () => {
  const drive = [3, 1, -20]; // a drive, a little to the right
  const perfect = timingOf(TIMING.idealZ);
  assert.ok(perfectLaunch(drive, perfect, sweetHit, 15));
  assert.equal(perfectLaunch(drive, timingOf(TIMING.idealZ - TIMING.perfectHalf - 0.05), sweetHit, 15), null, 'early is not perfect');
  assert.equal(perfectLaunch(drive, timingOf(TIMING.idealZ + TIMING.perfectHalf + 0.05), sweetHit, 15), null, 'late is not perfect');
  assert.equal(perfectLaunch(drive, perfect, { edge: true, sweet: false, e: 0.4 }, 15), null, 'an edge never goes out');
  assert.equal(perfectLaunch(drive, perfect, { edge: false, sweet: false, e: 0.2 }, 15), null, 'off the toe or shoulder is not the middle');
  assert.ok(perfectLaunch(drive, perfect, { edge: false, sweet: false, e: 0.4 }, 15), 'a clean blade contact off the middle third still goes');
  assert.equal(perfectLaunch(drive, perfect, sweetHit, 3), null, 'a dab is not a swing');
  assert.equal(perfectLaunch(drive, null, sweetHit, 15), null);
  assert.equal(isPerfect(perfect, sweetHit, 15), true);
  assert.equal(isPerfect(perfect, sweetHit, 2), false);
});

test('a perfect touch always goes out in front: square or backward rebounds follow the swing, and are brought into the field', () => {
  const perfect = timingOf(TIMING.idealZ);
  const yawOf = (v) => (Math.atan2(v[0], -v[2]) * 180) / Math.PI;
  // the ball rode up an open face and came off going back over the batsman: it goes the way the bat was swinging
  const back = perfectLaunch([2, 9, 6], perfect, sweetHit, 15, [-3, 4, -14]);
  assert.ok(back[2] < 0, 'toward the bowler');
  assert.ok(Math.abs(yawOf(back) - yawOf([-3, 0, -14])) < 1e-9, 'along the swing');
  // no swing direction to go by: straight back past the bowler
  const straight = perfectLaunch([0, 9, 6], perfect, sweetHit, 15);
  assert.ok(Math.abs(yawOf(straight)) < 1e-9);
  // a glance square of the wicket is brought round into the field in front, on the same side
  const square = perfectLaunch([20, 1, -3], perfect, sweetHit, 15);
  assert.ok(Math.abs(yawOf(square) - TIMING.perfectMaxYawDeg) < 1e-9);
  const squareLeg = perfectLaunch([-20, 1, -3], perfect, sweetHit, 15);
  assert.ok(Math.abs(yawOf(squareLeg) + TIMING.perfectMaxYawDeg) < 1e-9);
});

test('perfectLaunch keeps the direction the player played and sends it fast and high', () => {
  const v = perfectLaunch([4, 0.5, -16], timingOf(TIMING.idealZ), sweetHit, 14);
  const hs = Math.hypot(v[0], v[2]);
  assert.ok(Math.abs(v[0] / hs - 4 / Math.hypot(4, 16)) < 1e-9, 'same heading, left or right');
  assert.ok(Math.abs(Math.hypot(...v) - TIMING.perfectExit) < 1e-9);
  assert.ok(Math.abs((Math.atan2(v[1], hs) * 180) / Math.PI - TIMING.perfectLoftDeg) < 1e-9);
  // a ball that already leaves faster keeps its speed, up to a quarter more than the perfect speed
  const fast = perfectLaunch([0, 0, -42], timingOf(TIMING.idealZ), sweetHit, 14);
  assert.ok(Math.abs(Math.hypot(...fast) - 42) < 1e-9);
  const wild = perfectLaunch([0, 0, -90], timingOf(TIMING.idealZ), sweetHit, 14);
  assert.ok(Math.abs(Math.hypot(...wild) - TIMING.perfectExit * 1.25) < 1e-9);
});

test('a perfect shot is a SIX on the full: every direction it can go clears the rope', () => {
  for (let yaw = -90; yaw <= 90; yaw += 4) {
    const a = (yaw * Math.PI) / 180;
    // whatever speed the bat gave the ball, from a soft 20 m/s up to the cap
    for (const sp of [20, 28, 36]) {
      const out = perfectLaunch([Math.sin(a) * sp, 2, -Math.cos(a) * sp], timingOf(TIMING.idealZ), sweetHit, 14);
      assert.ok(out, `qualifies at ${yaw} degrees`);
      const st = launch([0, FIELD.ground + 1.1, TIMING.idealZ], out);
      for (let i = 0; i < 600 && !st.rest && !st.crossed; i++) stepBatted(st, 1 / 60);
      assert.equal(st.crossed, 'six', `yaw ${yaw}, ${sp} m/s: ${st.crossed}, carried ${st.carry}`);
      assert.equal(st.bounced, false);
    }
  }
});

test('forgiving contact size: a ball that just grazes past is a hit, one clear of the larger size is still a miss', () => {
  const pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
  // the ball passes across the blade face, offset 6.5 cm sideways beyond the half width (5.4 cm): close but clear
  const path = (off) => [[off, 0.3, BAT.sweetZ], [off, -0.3, BAT.sweetZ]]; // y is the across-the-blade axis of a bat held upright
  const ballFrom = (offX) => [[offX, 0.3, BAT.sweetZ], [offX, -0.3, BAT.sweetZ]];
  void path;
  const miss = sweepHit(pose, pose, ...ballFrom(0.085));
  const hit = sweepHit(pose, pose, ...ballFrom(0.085), 0.036 + 0.05);
  assert.equal(miss, null, 'normal size: 8.5 cm off the face centre is past the blade');
  assert.ok(hit, 'forgiving size: it touches');
  assert.ok(hit.pad > 0.049 && hit.pad < 0.051);
  assert.equal(sweepHit(pose, pose, ...ballFrom(0.2), 0.036 + 0.05), null, 'still a miss well clear');
});

test('with the forgiving width a ball that just grazes the side is a face hit, not an edge; the plain bat calls it an edge', () => {
  const pose = { p: [0, 0, 0], q: [0, 0, 0, 1] };
  // a ball arriving along -x onto the face, 6.8 cm across from the middle (1.4 cm beyond the 5.4 cm half width)
  const b0 = [0.3, 0.068, BAT.sweetZ];
  const b1 = [-0.3, 0.068, BAT.sweetZ];
  const plain = sweepHit(pose, pose, b0, b1);
  const big = sweepHit(pose, pose, b0, b1, 0.036 + 0.05);
  assert.ok(plain && big);
  assert.equal(batBounce([-25, 0, 0], [-15, 0, 0], plain).edge, true);
  assert.equal(batBounce([-25, 0, 0], [-15, 0, 0], big).edge, false);
  assert.ok(HIT.restitution > 0);
});

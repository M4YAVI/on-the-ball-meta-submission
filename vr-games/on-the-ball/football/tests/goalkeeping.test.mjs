// Goalkeeping (core/goalkeeping.js): the save test, what the ball does off the gloves, the goal line, the keeper's tally, and
// whole shots run the way the game runs them (ball path -> carry-on after arrival -> swept glove test -> goal line).

import test from 'node:test';
import assert from 'node:assert/strict';

import { crossedLine, GLOVE, KeeperScore, meetGlove, pairNormal, SAVE, sweepGlove } from '../src/core/goalkeeping.js';
import { ballPosition, FIELD, flightMs, PHYS, SPEED_OPTIONS } from '../src/core/ball-path.js';
import { startRoll, stepRoll } from '../../src/core/ball-path.js';

// ------------------------------------------------------------------ sweepGlove
test('sweepGlove: a ball coming straight at the palm is met; one well wide is not', () => {
  const g = [0, -0.3, -0.8];
  assert.ok(sweepGlove([0, -0.3, -1.2], [0, -0.3, -0.6], g, g));
  assert.equal(sweepGlove([0.6, -0.3, -1.2], [0.6, -0.3, -0.6], g, g), null);
});

test('sweepGlove: a 110 km/h shot cannot pass through the glove between two frames, even at 30 fps', () => {
  const g = [0.1, -0.2, -0.8];
  const v = 30; // m/s
  const step = v / 30; // 1 m in one frame: the ball is never near the glove at either end of the frame
  const hit = sweepGlove([0.1, -0.2, -0.8 - step / 2], [0.1, -0.2, -0.8 + step / 2], g, g);
  assert.ok(hit, 'met inside the frame');
  assert.ok(hit.t > 0 && hit.t < 0.5, 'met on the way in, before the middle of the frame');
  assert.ok(hit.normal[2] < -0.9, 'the contact normal points back toward the striker');
});

test('sweepGlove: a dive across the ball meets it although the glove started and ended clear of it', () => {
  const ball = [0, -0.3, -0.8];
  const hit = sweepGlove(ball, ball, [-0.6, -0.3, -0.8], [0.6, -0.3, -0.8]);
  assert.ok(hit);
  assert.ok(hit.t > 0.2 && hit.t < 0.5);
  // the same dive tested as if the glove stood still at either end misses: the old bug
  assert.equal(sweepGlove(ball, ball, [-0.6, -0.3, -0.8], [-0.6, -0.3, -0.8]), null);
  assert.equal(sweepGlove(ball, ball, [0.6, -0.3, -0.8], [0.6, -0.3, -0.8]), null);
});

test('sweepGlove: the touch distance is the glove reach plus the ball radius', () => {
  const R = GLOVE.reach + PHYS.ballRadius;
  const g = [0, 0, -0.8];
  assert.ok(sweepGlove([R - 0.005, 0, -1.2], [R - 0.005, 0, -0.4], g, g));
  assert.equal(sweepGlove([R + 0.005, 0, -1.2], [R + 0.005, 0, -0.4], g, g), null);
  assert.ok(sweepGlove([R + 0.005, 0, -1.2], [R + 0.005, 0, -0.4], g, g, GLOVE.pcReach), 'the PC control has a slightly bigger target');
});

// ------------------------------------------------------------------ meetGlove
test('meetGlove: a square block with one hand pushes the ball back out toward the field, never into the net', () => {
  const res = meetGlove([0, -1, 20], [0, 0, 0], [0, 0, -1], false);
  assert.equal(res.kind, SAVE.PARRY);
  assert.ok(res.v[2] < -5, `out toward the striker, got vz=${res.v[2]}`);
  assert.ok(Math.hypot(...res.v) < 20, 'slower than it came in');
});

test('meetGlove: two hands together hold a shot they can hold, and only parry a rocket', () => {
  assert.equal(meetGlove([0, 0, 15], [0, 0, 0], [0, 0, -1], true).kind, SAVE.CATCH);
  assert.deepEqual(meetGlove([0, 0, 15], [0, 0, 0], [0, 0, -1], true).v, [0, 0, 0]);
  const rocket = meetGlove([0, 0, GLOVE.catchSpeed + 4], [0, 0, 0], [0, 0, -1], true);
  assert.equal(rocket.kind, SAVE.PARRY);
  assert.ok(rocket.v[2] < 0);
});

test('meetGlove: a glove driven at the ball punches it clear, harder than a parry', () => {
  const parry = meetGlove([0, 0, 20], [0, 0, 0], [0, 0, -1], false);
  const punch = meetGlove([0, 0, 20], [0, 0, -4], [0, 0, -1], true); // driving at it: no catch, a punch
  assert.equal(punch.kind, SAVE.PUNCH);
  assert.ok(punch.v[2] < parry.v[2], 'punched out faster');
});

test('meetGlove: a fingertip on the side of the ball only bends it, and it carries on toward goal', () => {
  // The ball brushes past the inside of the glove: the contact normal points almost straight across its flight.
  const l = Math.hypot(1, 0.15);
  const res = meetGlove([0, 0, 20], [0, 0, 0], [-1 / l, 0, -0.15 / l], false);
  assert.ok(res.v[2] > 10, `a glancing touch keeps most of its speed toward the goal, vz=${res.v[2]}`);
  assert.ok(res.v[0] < -1, 'and is bent away from the glove');
});

// ------------------------------------------------------------------ the goal line
test('crossedLine: only over the line, between the posts and under the bar', () => {
  const z = FIELD.goalLineZ + PHYS.ballRadius + 0.01;
  assert.equal(crossedLine([0, -0.5, z]), true);
  assert.equal(crossedLine([0, -0.5, FIELD.goalLineZ - 0.2]), false, 'still in front of the line');
  assert.equal(crossedLine([FIELD.goalHalfWidth + 0.3, -0.5, z]), false, 'wide of the post');
  assert.equal(crossedLine([0, FIELD.ground + FIELD.goalHeight + 0.2, z]), false, 'over the bar');
});

// ------------------------------------------------------------------ the keeper's tally
test('KeeperScore: saves, catches, punches, goals and the run of saves; warm-up is shown but not counted', () => {
  const k = new KeeperScore();
  assert.equal(k.record({ kind: SAVE.CATCH }, { count: false }).sub, 'Warm-up');
  assert.equal(k.shots, 0);
  k.record({ kind: SAVE.CATCH });
  k.record({ kind: SAVE.PARRY });
  const third = k.record({ kind: SAVE.PUNCH });
  assert.equal(third.title, 'PUNCHED CLEAR!');
  assert.equal(third.sub, '3 saves in a row');
  const goal = k.record({ kind: SAVE.GOAL, touched: true });
  assert.equal(goal.saved, false);
  assert.equal(goal.title, 'GOAL');
  assert.equal(goal.sub, 'A touch, but it went in');
  assert.deepEqual(
    { shots: k.shots, saves: k.saves, catches: k.catches, punches: k.punches, goals: k.goals, streak: k.streak, best: k.bestStreak },
    { shots: 4, saves: 3, catches: 1, punches: 1, goals: 1, streak: 0, best: 3 },
  );
  assert.equal(k.line(), 'Gloves: 3 of 4 saved · 1 caught, 1 punched');
  k.reset();
  assert.equal(k.summary().shots, 0);
});

// ------------------------------------------------------------------ whole shots, the way the game runs them
// After its arrival point the ball carries on (startRoll, clearIn3d) and each frame the gloves are swept against it; on contact
// meetGlove decides; the shot is a goal if the ball crosses the line. This is the same order as football/src/game.js.
function playShot(d, kmh, gloves, fps = 72) {
  const dur = flightMs(d.height, kmh);
  const pos = (u) => ballPosition(u, d.lane, d.curve, d.height, kmh, d.dip);
  const roll = startRoll(pos, dur, 0.5, true);
  let prev = roll.p.slice();
  const dt = 1 / fps;
  let touched = null;
  for (let i = 0; i < fps * 4; i++) {
    stepRoll(roll, dt);
    if (!touched && gloves) {
      let best = null;
      for (const g of gloves.palms) {
        const hit = sweepGlove(prev, roll.p, g, g);
        if (hit && (!best || hit.t < best.t)) best = hit;
      }
      if (best) {
        const together = gloves.palms.length === 2;
        const n = together ? pairNormal(best.ball, gloves.palms[0], gloves.palms[1]) : best.normal;
        const res = meetGlove(roll.v, [0, 0, 0], n, together);
        touched = res.kind;
        if (res.kind === SAVE.CATCH) return SAVE.CATCH;
        roll.p = best.ball.map((x, j) => x + n[j] * 0.01);
        roll.v = res.v;
      }
    }
    prev = roll.p.slice();
    if (crossedLine(roll.p)) return SAVE.GOAL;
    if (touched && (roll.v[2] <= 0 || roll.rest)) return touched;
    if (roll.rest) break;
  }
  return touched ?? 'stopped';
}

// Where the shot passes the keeper's hands (z = -0.8 by default): where a keeper who read it would put the gloves.
function passPoint(d, kmh, z = -0.8) {
  const r = startRoll((u) => ballPosition(u, d.lane, d.curve, d.height, kmh, d.dip), flightMs(d.height, kmh), 0.5, true);
  while (r.p[2] < z && !r.rest) stepRoll(r, 0.002);
  return r.p.slice();
}

const SHOTS = [];
for (const lane of [-1, 0, 1]) for (const height of [-1, 0, 1]) for (const curve of [-0.5, 0, 0.5]) SHOTS.push({ lane, height, curve, dip: 0.1 });

test('every shot, at every speed, with no hands in the way is a goal', () => {
  for (const { kmh } of SPEED_OPTIONS) for (const d of SHOTS) assert.equal(playShot(d, kmh, null), SAVE.GOAL, JSON.stringify({ kmh, d }));
});

test('two hands put where the shot passes save every shot: caught when it can be held, parried out when it is too fast', () => {
  for (const { kmh } of SPEED_OPTIONS) {
    for (const d of SHOTS) {
      const p = passPoint(d, kmh);
      const res = playShot(d, kmh, { palms: [[p[0] - 0.12, p[1], -0.8], [p[0] + 0.12, p[1], -0.8]] });
      assert.ok(res === SAVE.CATCH || res === SAVE.PARRY, `${res} for ${JSON.stringify({ kmh, d })}`);
      if (kmh <= 110) assert.equal(res, SAVE.CATCH, `a ${kmh} km/h shot into two hands is held`);
      if (kmh >= 130) assert.equal(res, SAVE.PARRY, `a ${kmh} km/h shot is too hot to hold`);
    }
  }
});

test('hands close in, under half a metre from the eyes (where the PC control and a real keeper hold them), save every shot too', () => {
  const z = -0.48;
  for (const { kmh } of SPEED_OPTIONS) {
    for (const d of SHOTS) {
      const p = passPoint(d, kmh, z);
      const res = playShot(d, kmh, { palms: [[p[0] - 0.155, p[1], z], [p[0] + 0.155, p[1], z]] });
      assert.ok(res === SAVE.CATCH || res === SAVE.PARRY, `${res} for ${JSON.stringify({ kmh, d })}`);
      if (kmh <= 110) assert.equal(res, SAVE.CATCH, `a ${kmh} km/h shot into two hands is held`);
    }
  }
});

test('one hand square behind the shot parries it out; hands well wide of it let it in', () => {
  for (const d of SHOTS) {
    const p = passPoint(d, 90);
    assert.equal(playShot(d, 90, { palms: [[p[0], p[1], -0.8]] }), SAVE.PARRY, JSON.stringify(d));
    assert.equal(playShot(d, 90, { palms: [[p[0] + 0.9, p[1], -0.8]] }), SAVE.GOAL, JSON.stringify(d));
  }
});

test('the gloves never get the ball before its arrival point, so the eye score (which ends there) cannot depend on them', () => {
  // The carry-on starts exactly at the arrival point, and that is the first position the game ever sweeps the gloves against.
  for (const d of SHOTS) {
    const r = startRoll((u) => ballPosition(u, d.lane, d.curve, d.height, 90, d.dip), flightMs(d.height, 90), 0.5, true);
    assert.deepEqual(r.p, ballPosition(1, d.lane, d.curve, d.height, 90, d.dip));
  }
});

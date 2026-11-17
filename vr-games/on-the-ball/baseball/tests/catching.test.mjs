// Tests for hand play in baseball: the mitt meets the pitch, the umpire calls it, the catches are counted. Run with: npm run test:baseball
// None of this touches the eye-tracking score (core/engine.js): the mitt only gets the ball after the pitch has arrived.
import test from 'node:test';
import assert from 'node:assert/strict';

import { startRoll, stepRoll } from '../../src/core/ball-path.js';
import { Trial, STATUS } from '../../src/core/engine.js';
import { ballPosition, flightPlan, LEVELS, PATH, PITCHES } from '../src/core/ball-path.js';
import { CATCH, FRAME, HandScore, mittFacesBall, pitchOffset, STRIKE_ZONE, sweepCatch, umpire } from '../src/core/catching.js';

const FRAME_DT = 1 / 72; // a Quest frame
const MITT_Z = -0.62; // where the emulator's mouse holds the mitt (xr/mitt.js)
const FACING = [0, 0, -1]; // pocket open toward the pitcher

// Fly a pitch past the plate and on toward the catcher, frame by frame, with the mitt held still at `pocket`: the first frame the
// mitt catches it on, or null. Exactly the loop game.js runs after the pitch's arrival.
function catchWith(plan, pocket) {
  const roll = startRoll((u) => ballPosition(u, plan), plan.ms, 0.5, true);
  let prev = roll.p.slice();
  for (let i = 0; i < 400 && roll.p[2] < CATCH.missZ && !roll.rest; i++) {
    stepRoll(roll, FRAME_DT);
    const hit = sweepCatch(prev, roll.p, pocket, pocket);
    if (hit) return { hit, v: roll.v.slice() };
    prev = roll.p.slice();
  }
  return null;
}
// Where a pitch passes the plane the mitt is held in.
function passPoint(plan, z = MITT_Z) {
  const roll = startRoll((u) => ballPosition(u, plan), plan.ms, 0.5, true);
  for (let i = 0; i < 2000 && roll.p[2] < z && !roll.rest; i++) stepRoll(roll, 0.002);
  return roll.p.slice();
}
function eachPitch(fn) {
  for (const level of LEVELS)
    for (let pitch = 0; pitch < PITCHES.length; pitch++)
      for (const lane of [-1, 0, 1])
        for (const row of [-1, 0, 1])
          for (const j of [-1, 0, 1]) {
            const delivery = { lane, row, pitch, dx: j * PATH.jitterM, dy: -j * PATH.jitterM, dv: j, flutter: null };
            fn({ level, pitch, lane, row, plan: flightPlan(delivery, level) });
          }
}

// ---------------------------------------------------------------- the umpire
test('the strike zone is the plate (17 in) plus a ball either side, 42 cm high plus a ball', () => {
  assert.ok(Math.abs(STRIKE_ZONE.halfWidth - (0.216 + 0.037)) < 1e-9);
  assert.ok(Math.abs(STRIKE_ZONE.halfHeight - (0.21 + 0.037)) < 1e-9);
});

test('umpire: down the middle is a strike, well off the plate is a ball, caught or not', () => {
  assert.equal(umpire({ x: 0, y: 0 }, true, 0).strike, true);
  assert.equal(umpire({ x: 0, y: 0 }, false, 0).strike, true);
  assert.equal(umpire({ x: 0.4, y: 0 }, true, 0).strike, false);
  assert.equal(umpire({ x: 0, y: -0.4 }, false, 0).strike, false);
});

test('umpire: a borderline ball caught quietly is framed into a strike; a loud, fast mitt does not frame it', () => {
  const off = { x: STRIKE_ZONE.halfWidth + FRAME.margin / 2, y: 0 };
  const quiet = umpire(off, true, FRAME.quiet / 2);
  assert.deepEqual([quiet.strike, quiet.framed], [true, true]);
  assert.equal(umpire(off, true, FRAME.quiet * 2).strike, false);
  assert.equal(umpire(off, false, 0).strike, false, 'a miss is never framed');
  assert.equal(umpire({ x: STRIKE_ZONE.halfWidth + FRAME.margin * 2, y: 0 }, true, 0).strike, false, 'too far off to frame');
});

test('umpire: a borderline strike stabbed at (a fast mitt) is called a ball', () => {
  const off = { x: STRIKE_ZONE.halfWidth - 0.02, y: 0 };
  const stab = umpire(off, true, FRAME.stab * 2);
  assert.deepEqual([stab.strike, stab.stabbed], [false, true]);
  assert.equal(umpire(off, true, 0.3).strike, true);
});

test('umpire: bad numbers never throw and give a plain call', () => {
  for (const off of [null, undefined, {}, { x: NaN, y: Infinity }]) {
    const c = umpire(off, true, NaN);
    assert.equal(typeof c.strike, 'boolean');
  }
});

test('pitchOffset: the middle of the zone is where the Middle / Level pitch crosses', () => {
  const o = pitchOffset(flightPlan({ lane: 0, row: 0, pitch: 0, dx: 0, dy: 0, dv: 0 }));
  assert.ok(Math.abs(o.x) < 1e-9 && Math.abs(o.y) < 1e-9);
  const left = pitchOffset(flightPlan({ lane: -1, row: 1, pitch: 0, dx: 0, dy: 0, dv: 0 }));
  assert.ok(left.x < -0.3 && Math.abs(left.y - PATH.rowStepM) < 1e-9);
});

// ---------------------------------------------------------------- the catch test
test('sweepCatch: a ball that comes through the pocket is caught; one that passes well to the side is not', () => {
  const pocket = [0, -0.4, MITT_Z];
  assert.ok(sweepCatch([0, -0.4, -0.7], [0, -0.4, -0.55], pocket, pocket));
  assert.equal(sweepCatch([0.5, -0.4, -0.7], [0.5, -0.4, -0.55], pocket, pocket), null);
  assert.equal(sweepCatch([0, -0.4 - CATCH.radius * 1.5, -0.7], [0, -0.4 - CATCH.radius * 1.5, -0.55], pocket, pocket), null);
});

test('sweepCatch: a fast ball that jumps right over the mitt between two frames is still caught (no tunnelling)', () => {
  const pocket = [0.05, -0.4, MITT_Z];
  // 40 m/s at 72 fps is 0.55 m a frame: from 0.3 m in front of the pocket to 0.25 m behind it
  const hit = sweepCatch([0.05, -0.4, MITT_Z - 0.3], [0.05, -0.4, MITT_Z + 0.25], pocket, pocket);
  assert.ok(hit);
  assert.ok(Math.abs(hit.ball[2] - MITT_Z) < 0.01, 'the contact is where it crossed the pocket');
  assert.ok(hit.t > 0 && hit.t < 1);
});

test('sweepCatch: a moving mitt reaching out to a ball counts, and either point missing gives null', () => {
  assert.ok(sweepCatch([0, -0.4, -0.7], [0, -0.4, -0.7], [0.3, -0.4, -0.7], [0, -0.4, -0.7]), 'the mitt closes on a ball that is nearly still');
  assert.equal(sweepCatch(null, [0, 0, 0], [0, 0, 0], [0, 0, 0]), null);
  assert.equal(sweepCatch([0, 0, 0], [0, 0, 0], [0, 0, 0], null), null);
  assert.equal(sweepCatch([NaN, 0, 0], [NaN, 0, 0], [0, 0, 0], [0, 0, 0]), null, 'a NaN ball is never a catch');
});

test('mittFacesBall: the pocket must open toward the ball; the back of the mitt does not catch', () => {
  assert.equal(mittFacesBall(FACING, [0, 0, 26]), true);
  assert.equal(mittFacesBall([0, 0, 1], [0, 0, 26]), false, 'turned round');
  assert.equal(mittFacesBall([1, 0, 0], [0, 0, 26]), false, 'on its side');
  assert.equal(mittFacesBall([0, 0, 1], [0, 0, 0]), true, 'a ball at rest');
});

// ---------------------------------------------------------------- the geometry: every pitch can be caught
test('every pitch type, speed, lane and row passes where an arm can reach, and a mitt held there catches it', () => {
  let n = 0;
  eachPitch(({ level, pitch, lane, row, plan }) => {
    const p = passPoint(plan);
    const where = `${level.id} ${PITCHES[pitch].short} lane ${lane} row ${row}`;
    assert.ok(Math.abs(p[0]) < 0.8, `${where}: x ${p[0].toFixed(2)} is within an arm's reach sideways`);
    assert.ok(p[1] > -0.95 && p[1] < 0.1, `${where}: y ${p[1].toFixed(2)} is between the knees and the chin`);
    const res = catchWith(plan, [p[0], p[1], MITT_Z]);
    assert.ok(res, `${where}: the mitt at the pass point catches it`);
    assert.ok(mittFacesBall(FACING, res.v), `${where}: it comes in at the front of the mitt`);
    n++;
  });
  assert.equal(n, LEVELS.length * PITCHES.length * 27);
});

test('a mitt held well off to the side or low misses every pitch', () => {
  eachPitch(({ plan }) => {
    const p = passPoint(plan);
    assert.equal(catchWith(plan, [p[0] + 0.6, p[1], MITT_Z]), null);
    assert.equal(catchWith(plan, [p[0], p[1] - 0.5, MITT_Z]), null);
  });
});

test('the mitt only gets the ball after the pitch has arrived: no catch is possible from the flight itself', () => {
  eachPitch(({ plan }) => {
    // the flight ends at the aim point, 1.2 m in front of the eyes; a mitt can only be held about 0.7 m out
    assert.ok(plan.aim[2] <= -1.2 + 1e-9);
    assert.ok(MITT_Z > plan.aim[2]);
  });
});

test('the eye-tracking score is the same whether the ball is caught or missed: the trial ends at the arrival, before the mitt', () => {
  const plan = flightPlan({ lane: 0, row: 0, pitch: 0, dx: 0, dy: 0, dv: 0 });
  const eyes = () => {
    const t = new Trial('eye', plan.ms, 7);
    for (let ms = 0; ms <= plan.ms; ms += 8) t.sample(ms, 1.5, 'eye', true, 7); // eyes right on the ball the whole way
    return t.finish();
  };
  const a = eyes();
  catchWith(plan, [...passPoint(plan).slice(0, 2), MITT_Z]); // the mitt then catches, or not: nothing above can see it
  const b = eyes();
  assert.equal(a.status, STATUS.GREEN);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- the tally
test('HandScore: catches, misses, strikes and the run of catches in a row', () => {
  const h = new HandScore();
  const mid = { x: 0, y: 0 };
  const wide = { x: 0.4, y: 0 };
  h.record({ caught: true, off: mid, mittSpeed: 0, spot: 'pocket' });
  h.record({ caught: true, off: wide, mittSpeed: 5, spot: 'web' });
  const third = h.record({ caught: true, off: mid, mittSpeed: 0, spot: 'pocket' });
  assert.match(third.title, /3 in a row/);
  const miss = h.record({ caught: false, off: mid, mittSpeed: 0 });
  assert.equal(miss.title, 'MISSED');
  assert.equal(miss.good, false);
  assert.equal(miss.sub, 'STRIKE', 'a strike is a strike whether or not the catcher held it');
  assert.deepEqual(h.summary(), { pitches: 4, catches: 3, misses: 1, strikes: 3, framed: 0, streak: 0, bestStreak: 3 });
});

test('HandScore: a quiet catch on the edge is framed and counted, and the call-out says so', () => {
  const h = new HandScore();
  const r = h.record({ caught: true, off: { x: STRIKE_ZONE.halfWidth + 0.03, y: 0 }, mittSpeed: 0.2, spot: 'pocket' });
  assert.equal(r.sub, 'Framed: STRIKE');
  assert.equal(h.framed, 1);
  assert.equal(h.strikes, 1);
});

test('HandScore: a warm-up pitch gets its call-out but is not counted', () => {
  const h = new HandScore();
  const r = h.record({ caught: true, off: { x: 0, y: 0 }, mittSpeed: 0, spot: 'pocket' }, { count: false });
  assert.equal(r.title, 'POP!');
  assert.deepEqual(h.summary(), new HandScore().summary());
});

test('HandScore: off the back of the mitt is a miss with its own words; reset clears the session', () => {
  const h = new HandScore();
  assert.equal(h.record({ caught: false, off: { x: 0, y: 0 }, why: 'back' }).title, 'Off the back');
  assert.equal(h.misses, 1);
  h.reset();
  assert.equal(h.pitches, 0);
  assert.equal(h.misses, 0);
});

test('HandScore: it keeps its own counts; it has no green / amber / red to mix with the eye-tracking scorecard', () => {
  const h = new HandScore();
  h.record({ caught: true, off: { x: 0, y: 0 }, spot: 'pocket' });
  assert.deepEqual(Object.keys(h.summary()).sort(), ['bestStreak', 'catches', 'framed', 'misses', 'pitches', 'streak', 'strikes']);
});

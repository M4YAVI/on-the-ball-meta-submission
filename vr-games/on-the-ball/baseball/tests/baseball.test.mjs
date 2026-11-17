// Tests for the baseball pitch physics and how baseball plugs into the shared scoring engine. Run with: npm run test:baseball
import test from 'node:test';
import assert from 'node:assert/strict';

import { Trial, angle, STATUS, TOLERANCE, RULES, toleranceFor } from '../../src/core/engine.js';
import { CalibrationCheck, GazeVerdict, VERDICT } from '../../src/core/gaze-verdict.js';
import { GameFlow, PHASE, MODE, SPORTS } from '../../src/core/flow.js';
import { HistoryStore } from '../../src/core/history.js';
import {
  aimPoint,
  ballPosition,
  cleanDelivery,
  drawnRadius,
  FIELD,
  flightMs,
  flightPlan,
  makeDeliveries,
  MOUND_Z,
  BALL_MIN_DEG,
  PATH,
  PHYS,
  pathFitsView,
  PITCHES,
  PLATE_Z,
  SPEED_OPTIONS,
  viewAngles,
  FOV,
  LEVELS,
  MPH,
} from '../src/core/ball-path.js';
import { breakAccel, choosePitch, DEFAULT_LEVEL, drawnRps, flutterAt, flutterParams, INCH, levelById, levelLabel, pitchSpeed, spinAxis } from '../src/core/pitches.js';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const LANES = [-1, 0, 1];
const ROWS = [-1, 0, 1];
const JIT = [-PATH.jitterM, 0, PATH.jitterM];
const FLUTTER = { ax: 0.12, ay: 0.08, wx: 7.5, wy: 8.4, px: 1.1, py: 2.3 };
// Every pitch type x every level x every lane and row, at the extreme command misses and speed jitter.
function eachPitch(fn) {
  for (const level of LEVELS)
    for (let pitch = 0; pitch < PITCHES.length; pitch++)
      for (const lane of LANES)
        for (const row of ROWS)
          for (const j of JIT) {
            const delivery = { lane, row, pitch, dx: j, dy: -j, dv: j / PATH.jitterM, flutter: PITCHES[pitch].flutter ? FLUTTER : null };
            fn({ level, pitch, lane, row, delivery, plan: flightPlan(delivery, level) });
          }
}
const slow = LEVELS[0];
const pro = levelById('pro');
const majors = levelById('fast');

// ---------------------------------------------------------------- the park
test('the park has the real measurements: the rubber is 60 ft 6 in (18.44 m) from the plate, 10 in high; a baseball is 7.4 cm', () => {
  assert.equal(PLATE_Z - MOUND_Z, 18.44);
  assert.ok(Math.abs(FIELD.moundTopY - FIELD.ground - 0.254) < 1e-9);
  assert.equal(PHYS.ballRadius * 2, 0.074);
  assert.ok(Math.abs(FIELD.plateZ - FIELD.plateFrontZ - 0.432) < 1e-9, 'the plate is 17 in deep');
  assert.ok(Math.abs(FIELD.plateHalfWidth * 2 - 0.432) < 0.001, 'and 17 in wide');
});
test('the player is the catcher: behind the plate, facing the mound. The plate is in front of the eyes and the pitcher about 18 m past it', () => {
  assert.ok(FIELD.plateZ < 0 && FIELD.plateZ > -1.5, 'home plate is just in front of the seated catcher');
  assert.ok(FIELD.moundZ < -18 && FIELD.moundZ > -20);
  assert.ok(PATH.endZ < FIELD.plateZ && PATH.endZ >= FIELD.plateFrontZ - 0.05, 'the pitch is judged as it crosses the front of the plate');
  assert.ok(PATH.release[2] > FIELD.moundZ && PATH.release[2] < FIELD.moundZ + 2.5, 'he lets go a stride in front of the rubber');
});
test('the batsman view stays cricket-only: baseball has no stumps and no bat, and every pitch moves toward the player', () => {
  eachPitch(({ plan }) => {
    let prev = ballPosition(0, plan)[2];
    for (let i = 1; i <= 100; i++) {
      const z = ballPosition(i / 100, plan)[2];
      assert.ok(z > prev, 'z only increases: the ball only ever comes closer');
      prev = z;
    }
  });
});

// ---------------------------------------------------------------- the pitches
test('there are twelve pitch types with the real big-league speeds and movement, and three speed levels', () => {
  assert.equal(PITCHES.length, 12);
  const by = Object.fromEntries(PITCHES.map((p) => [p.id, p]));
  assert.equal(by['four-seam'].mph, 95);
  assert.equal(by.curveball.mph, 80);
  assert.equal(by.eephus.mph, 52);
  assert.ok(by['four-seam'].ivb > 0 && by.curveball.ivb < 0, 'the fastball rides, the curveball drops');
  assert.ok(by.knuckleball.rpm < 600 && by.knuckleball.flutter > 0, 'the knuckleball flutters');
  assert.deepEqual(SPEED_OPTIONS.map((s) => s.id), ['easy', 'pro', 'fast']);
  assert.deepEqual(SPEED_OPTIONS.map((s) => s.label), ['Rookie 59 mph', 'Pro 78 mph', 'Majors 95 mph']);
  assert.equal(levelLabel(pro), 'Pro 78 mph');
  assert.equal(levelById('nonsense').id, DEFAULT_LEVEL, 'an unknown level falls back to the default');
  assert.equal(DEFAULT_LEVEL, 'easy', 'the default is the gentlest level: a trust-first first session');
});
test('flight times: a half-second-class ball, slower levels take longer, faster pitches arrive sooner, all finite', () => {
  const four = (level) => flightMs({ pitch: 0 }, level);
  assert.ok(four(majors) < four(pro) && four(pro) < four(slow));
  assert.ok(four(pro) > 400 && four(pro) < 560, `pro four-seamer = ${four(pro)} ms`);
  assert.ok(four(majors) > 330 && four(majors) < 460, `majors four-seamer = ${four(majors)} ms`);
  assert.ok(four(slow) > 550 && four(slow) < 750, `rookie four-seamer = ${four(slow)} ms`);
  eachPitch(({ plan }) => assert.ok(Number.isFinite(plan.ms) && plan.ms > 300 && plan.ms < 1500, `${plan.ms}`));
  const eephus = PITCHES.findIndex((p) => p.id === 'eephus');
  assert.ok(flightMs({ pitch: eephus }, pro) > flightMs({ pitch: 0 }, pro) + 250, 'the eephus hangs');
});
test('the ball leaves the pitcher\'s hand and arrives exactly at the aim point, 1.2 m in front of the eyes', () => {
  eachPitch(({ plan, delivery }) => {
    const a = ballPosition(0, plan);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - plan.from[i]) < 1e-9, 'starts at the hand');
    const e = ballPosition(1, plan);
    const aim = aimPoint(delivery);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(e[i] - aim[i]) < 1e-9, 'ends at the aim point');
    assert.equal(e[2], PATH.endZ);
    // a hair before the end it is still essentially there (no jump at the last frame)
    const near = ballPosition(0.999, plan);
    assert.ok(Math.hypot(near[0] - e[0], near[1] - e[1], near[2] - e[2]) < 0.06);
  });
});
test('real flight: gravity and the pitch\'s own movement are in the path, and the average speed is the pitch\'s speed', () => {
  eachPitch(({ plan, pitch, level }) => {
    assert.ok(Math.abs(plan.speed - pitchSpeed(PITCHES[pitch], level, plan.delivery.dv)) < 1e-12);
    const chord = Math.hypot(plan.aim[0] - plan.from[0], plan.aim[1] - plan.from[1], plan.aim[2] - plan.from[2]);
    assert.ok(Math.abs(chord / plan.T - plan.speed) < 1e-9, 'T = distance / speed');
    assert.equal(plan.acc[2], 0);
    // vertical: gravity pulls down, so the ball is thrown up above the straight line and falls onto the aim point
    const mid = ballPosition(0.5, plan);
    const lineY = (plan.from[1] + plan.aim[1]) / 2;
    assert.ok(mid[1] > lineY - 0.5, 'it arcs, it does not sink below the line');
  });
  // the movement is the real number of inches: the spin's acceleration over the flight displaces the ball by ivb / hb inches
  for (const p of PITCHES) {
    const T = 0.5;
    const a = breakAccel(p, T);
    assert.ok(Math.abs(0.5 * a.y * T * T - p.ivb * INCH) < 1e-9, `${p.id} ivb`);
    assert.ok(Math.abs(0.5 * a.x * T * T + p.hb * INCH) < 1e-9, `${p.id} hb (arm side is the catcher's left)`);
  }
  assert.ok(Math.abs(pitchSpeed(PITCHES[0], { velo: 1 }, 0) * MPH - 95) < 1e-9);
});
test('a curveball drops and a four-seamer rides, relative to the same pitch with no spin', () => {
  const curve = flightPlan({ pitch: PITCHES.findIndex((p) => p.id === 'curveball') }, pro);
  const four = flightPlan({ pitch: 0 }, pro);
  assert.ok(curve.acc[1] < -PHYS.g, 'extra downward pull');
  assert.ok(four.acc[1] > -PHYS.g, 'less drop than gravity alone');
  assert.ok(curve.acc[0] > 0 && four.acc[0] < 0, 'sweeps to glove side vs runs to the arm side (the catcher\'s left)');
});
test('spin: a drawn spin axis is a unit vector, a knuckleball hardly turns, and the drawn spin is slow enough not to strobe', () => {
  for (const p of PITCHES) {
    const a = spinAxis(p);
    assert.ok(Math.abs(Math.hypot(a.x, a.y, a.z) - 1) < 1e-9, p.id);
    assert.ok(drawnRps(p) < 20, `${p.id} is drawn at ${drawnRps(p)} turns a second`);
  }
  assert.ok(drawnRps(PITCHES.find((p) => p.id === 'knuckleball')) <= 2.5);
});
test('the knuckleball flutters late, is exactly back on the aim point at the end, and stays small', () => {
  const k = PITCHES.findIndex((p) => p.id === 'knuckleball');
  const plan = flightPlan({ pitch: k, flutter: FLUTTER }, pro);
  const plain = flightPlan({ pitch: k, flutter: null }, pro);
  let wobble = 0;
  for (let i = 0; i <= 100; i++) {
    const a = ballPosition(i / 100, plan);
    const b = ballPosition(i / 100, plain);
    wobble = Math.max(wobble, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  assert.ok(wobble > 0.01, 'it does flutter');
  assert.ok(wobble < 0.2, 'but only a little');
  assert.deepEqual(ballPosition(1, plan), ballPosition(1, plain), 'and it still crosses where it was aimed');
  assert.deepEqual(flutterAt(FLUTTER, 0, 0.5), { x: 0, y: 0 }, 'nothing at the release');
  const end = flutterAt(FLUTTER, 0.5, 0.5);
  assert.ok(Math.abs(end.x) < 1e-12 && Math.abs(end.y) < 1e-12);
  assert.deepEqual(flutterAt(null, 0.2, 0.5), { x: 0, y: 0 });
  const f = flutterParams(PITCHES[k], seeded(4));
  assert.ok(f && Math.abs(f.ax) <= PITCHES[k].flutter && Math.abs(f.ay) <= PITCHES[k].flutter);
  assert.equal(flutterParams(PITCHES[0], seeded(4)), null, 'only the knuckleball flutters');
});

// ---------------------------------------------------------------- lanes and rows
test('Left ends to the left, Middle straight at the player, Right to the right; the side ones about 16 degrees off', () => {
  for (const level of LEVELS) {
    const at = (lane) => viewAngles(ballPosition(1, flightPlan({ lane, row: 0, pitch: 0 }, level)));
    assert.ok(Math.abs(at(0).horizontal) < 0.01);
    assert.ok(at(1).horizontal > 15.9 && at(1).horizontal < 16.1, `${at(1).horizontal}`);
    assert.ok(at(-1).horizontal < -15.9 && at(-1).horizontal > -16.1, `${at(-1).horizontal}`);
  }
});
test('a Left or Right pitch ends far enough aside that a straight head misses it but the eyes can follow (the eye-tracking case)', () => {
  for (const lane of [-1, 1]) {
    const a = viewAngles(aimPoint({ lane, row: 0, pitch: 0 }));
    assert.ok(Math.abs(a.horizontal) > TOLERANCE.max + 3, `${a.horizontal} deg is outside even the widest cone`);
  }
});
test('Low, Level and High rows are 13 cm apart around the zone and every one is on the plate\'s height range', () => {
  const y = (row) => aimPoint({ row, lane: 0, pitch: 0 })[1];
  assert.ok(Math.abs(y(1) - y(0) - PATH.rowStepM) < 1e-12 && Math.abs(y(0) - y(-1) - PATH.rowStepM) < 1e-12);
  for (const row of ROWS) {
    const above = y(row) - FIELD.ground; // metres above the floor
    assert.ok(above > 0.55 && above < 1.15, `${above} m above the floor`);
  }
});

// ---------------------------------------------------------------- comfort
test('every pitch stays inside the Meta VR Glasses view with margin', () => {
  eachPitch(({ plan }) => assert.ok(pathFitsView(plan, 5, 80)));
  assert.equal(FOV.down, 43);
});
test('no pitch drops more than 25 degrees below eye level (comfortable eye angle, clear of the heads-up strip)', () => {
  eachPitch(({ plan }) => {
    for (let i = 0; i <= 120; i++) assert.ok(viewAngles(ballPosition(i / 120, plan)).vertical >= -PATH.arrivalFloorDeg, `${viewAngles(ballPosition(i / 120, plan)).vertical}`);
  });
});
test('no pitch rises more than 20 degrees above eye level (the glasses see 25 up, so 5 degrees to spare)', () => {
  eachPitch(({ plan }) => {
    for (let i = 0; i <= 120; i++) assert.ok(viewAngles(ballPosition(i / 120, plan)).vertical <= 20);
  });
});
test('the ball never goes through the ground and never gets closer than 1.1 m to the eyes', () => {
  eachPitch(({ plan }) => {
    for (let i = 0; i <= 120; i++) {
      const p = ballPosition(i / 120, plan);
      assert.ok(p[1] >= FIELD.ground + PHYS.ballRadius - 1e-9);
      assert.ok(Math.hypot(p[0], p[1], p[2]) >= 1.1);
    }
  });
});
test('the drawn ball stays close to real size: never under a 0.35 degree radius, about 11 cm across on the mound, real size up close', () => {
  for (const d of [1.2, 5, 12, 17.85, 19]) {
    const deg = (Math.atan(drawnRadius(d) / d) * 180) / Math.PI;
    assert.ok(deg >= 0.349, `${d} m: ${deg}`);
  }
  assert.ok(drawnRadius(17.85) * 2 < 0.23, `${drawnRadius(17.85) * 2} m across at the mound`);
  assert.ok(drawnRadius(17.85, BALL_MIN_DEG.hand) * 2 < 0.1, 'about the size of a ball held in his fingers');
  assert.equal(drawnRadius(1.2), PHYS.ballRadius, 'up close it is the real 7.4 cm ball');
});
test('the arrival point is where the ball would meet the plate, not the face: well below eye level', () => {
  eachPitch(({ plan }) => assert.ok(plan.aim[1] < -0.15 && plan.aim[1] > -0.6));
});

// ---------------------------------------------------------------- malformed input
test('malformed deliveries and parameters give a finite, comfortable ball', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x', {}, [], 1e9, -1e9, -1, 99]) {
    const d = cleanDelivery({ lane: bad, row: bad, pitch: bad, dx: bad, dy: bad, dv: bad, flutter: bad });
    assert.ok(LANES.includes(d.lane) && ROWS.includes(d.row) && Number.isInteger(d.pitch) && d.pitch >= 0 && d.pitch < PITCHES.length);
    assert.ok(Math.abs(d.dx) <= PATH.jitterM && Math.abs(d.dy) <= PATH.jitterM && Math.abs(d.dv) <= 1);
    const plan = flightPlan({ lane: bad, row: bad, pitch: bad, dx: bad, dy: bad, dv: bad }, bad, [bad, bad, bad]);
    assert.ok(Number.isFinite(plan.ms) && plan.ms > 0);
    for (const t of [0, 0.3, 1, bad, -5, 5]) assert.ok(ballPosition(t, plan).every(Number.isFinite), `${bad} ${t}`);
    assert.ok(pathFitsView(plan, 5, 60));
  }
  for (const bad of [undefined, null, 5, 'x', {}]) assert.ok(cleanDelivery(bad).lane === 0 && cleanDelivery(bad).pitch === 0);
  assert.ok(Number.isFinite(flightMs(undefined)));
});
test('a bad release point cannot throw the ball somewhere uncomfortable: it falls back to the measured hand, and is bounded', () => {
  const ok = flightPlan({ pitch: 0 }, pro, [NaN, undefined, 'x']);
  assert.deepEqual(ok.from, [...PATH.release]);
  const far = flightPlan({ pitch: 0 }, pro, [100, 100, -100]);
  assert.ok(far.from[2] >= -19.5 && far.from[2] <= -15 && Math.abs(far.from[0]) <= 1.5 && far.ms < 2500 && Number.isFinite(far.ms));
  assert.ok(pathFitsView(far, 5, 60), 'and the flight from the clamped hand is still comfortable');
  const real = flightPlan({ pitch: 0 }, pro, [-0.3, 0.6, -17.8]);
  assert.deepEqual(ballPosition(1, real), aimPoint({ pitch: 0 }), 'a different real hand position still arrives at the aim point');
});
test('a forged flutter or out-of-range value is clamped, and a flutter on a pitch that does not flutter is dropped', () => {
  const k = PITCHES.findIndex((p) => p.id === 'knuckleball');
  const d = cleanDelivery({ pitch: k, flutter: { ax: 99, ay: -99, wx: 1e6, wy: -3, px: 0, py: 0 } });
  assert.ok(Math.abs(d.flutter.ax) <= 0.2 && Math.abs(d.flutter.ay) <= 0.2 && d.flutter.wx <= 20 && d.flutter.wy >= 0);
  assert.equal(cleanDelivery({ pitch: 0, flutter: FLUTTER }).flutter, null);
  assert.equal(cleanDelivery({ pitch: k, flutter: { ax: NaN } }).flutter, null);
});

// ---------------------------------------------------------------- the 20 pitches
test('20 pitches: Left / Middle / Right and Low / Level / High balanced, shuffled, a spread of pitch types, repeatable from a seed', () => {
  const d = makeDeliveries(20, seeded(3));
  assert.equal(d.length, 20);
  for (const lane of LANES) assert.ok(d.filter((x) => x.lane === lane).length >= 6, `lane ${lane}`);
  for (const row of ROWS) assert.ok(d.filter((x) => x.row === row).length >= 6, `row ${row}`);
  for (const x of d) {
    assert.ok(LANES.includes(x.lane) && ROWS.includes(x.row) && Number.isInteger(x.pitch) && x.pitch >= 0 && x.pitch < PITCHES.length);
    assert.ok(Math.abs(x.dx) <= PATH.jitterM && Math.abs(x.dy) <= PATH.jitterM && Math.abs(x.dv) <= 1);
    assert.equal(!!x.flutter, !!PITCHES[x.pitch].flutter, 'only the knuckleball carries a flutter');
  }
  for (let i = 1; i < d.length; i++) assert.notEqual(d[i].pitch, d[i - 1].pitch, 'never the same pitch twice running');
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) assert.ok(new Set(makeDeliveries(20, seeded(seed)).map((x) => x.pitch)).size >= 5, 'a real spread of the arsenal');
  assert.deepEqual(makeDeliveries(20, seeded(3)), d);
  assert.notDeepEqual(makeDeliveries(20, seeded(4)), d);
  const order = (seed) => makeDeliveries(20, seeded(seed)).map((x) => x.lane).join();
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(order)).size > 1, 'the order is randomised');
});
test('the fastball is the most common pitch over many sessions, the eephus the rarest', () => {
  const counts = new Map();
  for (let seed = 1; seed <= 120; seed++) for (const x of makeDeliveries(20, seeded(seed))) counts.set(x.pitch, (counts.get(x.pitch) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  assert.equal(top[0][0], 0, 'four-seam is the top');
  assert.ok((counts.get(PITCHES.findIndex((p) => p.id === 'eephus')) ?? 0) < counts.get(0) / 5);
  assert.equal(choosePitch(() => 0.99, 'four-seam').id !== 'four-seam', true);
});
test('every pitch the game can ever throw is comfortable (the whole session space, many seeds)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    for (const x of makeDeliveries(20, seeded(seed))) {
      for (const level of LEVELS) assert.ok(pathFitsView(flightPlan(x, level), 5, 40));
    }
  }
});
test('the warm-up pitch (a lane only, as the shared flow gives it) is a normal, comfortable four-seamer down the middle', () => {
  const plan = flightPlan({ lane: 0, curve: 0 }, pro);
  assert.equal(plan.pitch.id, 'four-seam');
  assert.ok(Math.abs(viewAngles(ballPosition(1, plan)).horizontal) < 0.01);
  assert.ok(Number.isFinite(plan.ms) && pathFitsView(plan));
});

// ---------------------------------------------------------------- scoring on baseball paths (shared engine, unchanged)
// A simulated person: gaze(p, u) is the direction they look in when the ball is at p, u of the way through the flight.
function playPitch({ delivery, level = pro, gaze, mode = 'eye', ok = () => true }) {
  const plan = flightPlan(delivery, level);
  const trial = new Trial(mode, plan.ms, TOLERANCE.base);
  for (let t = 0; t <= plan.ms; t += 16) {
    const p = ballPosition(t / plan.ms, plan);
    trial.sample(t, angle(gaze(p, t / plan.ms), p), mode, ok(t / plan.ms));
  }
  return trial.finish();
}
const onBall = (p) => p;
test('the scoring rules and tolerances are the unchanged shared ones', () => {
  assert.equal(TOLERANCE.base, 7);
  assert.equal(TOLERANCE.max, 11);
  assert.equal(RULES.minQuality, 0.75);
  assert.equal(RULES.greenCoverage, 0.8);
  assert.equal(RULES.amberCoverage, 0.5);
  assert.equal(toleranceFor(0, 'head'), 7);
  assert.equal(toleranceFor(60, 'head'), 7);
});
test('eyes that follow the ball are green on every pitch type, level, lane and row', () => {
  eachPitch(({ delivery, level, pitch }) => {
    // every 4th combination keeps this fast while still covering all pitch types and levels
    if ((delivery.dx > 0) !== (delivery.dy < 0)) return;
    assert.equal(playPitch({ delivery, level, gaze: onBall }).status, STATUS.GREEN, `${PITCHES[pitch].id} ${level.id} ${JSON.stringify(delivery)}`);
  });
});
test('the core case: the head stays straight, the pitch goes Left or Right, the eyes follow it. Eyes score green; a head-only device does not', () => {
  for (const lane of [-1, 1]) for (const level of LEVELS) {
    const delivery = { lane, row: 0, pitch: 0 };
    const eyesFollow = playPitch({ delivery, level, gaze: onBall, mode: 'eye' });
    const headStraight = playPitch({ delivery, level, gaze: () => [0, 0, -1], mode: 'head' });
    assert.equal(eyesFollow.status, STATUS.GREEN);
    assert.notEqual(headStraight.status, STATUS.GREEN);
  }
});
test('eyes that find the ball late are amber, not green', () => {
  const late = (p, u) => (u < 0.45 ? [-0.5, 0, -0.6] : p);
  assert.equal(playPitch({ delivery: { lane: 1, row: 0, pitch: 0 }, gaze: late }).status, STATUS.AMBER);
});
test('eyes that look away are red', () => {
  assert.equal(playPitch({ delivery: { lane: 1, row: 0, pitch: 0 }, gaze: () => [-0.7, 0.5, -0.5] }).status, STATUS.RED);
});
test('a tracker that fails is UNSCORED, never red (the player is not blamed for the sensor)', () => {
  assert.equal(playPitch({ delivery: { lane: 1, row: 0, pitch: 0 }, gaze: onBall, ok: () => false }).status, STATUS.UNSCORED);
});
test('a blink does not cost the green, but a long dropout is unscored', () => {
  const d = { lane: 0, row: 0, pitch: 0 };
  assert.equal(playPitch({ delivery: d, gaze: onBall, ok: (u) => !(u > 0.4 && u < 0.5) }).status, STATUS.GREEN);
  assert.equal(playPitch({ delivery: d, gaze: onBall, ok: (u) => !(u > 0.2 && u < 0.7) }).status, STATUS.UNSCORED);
});
test('head samples cannot pass as eye samples on a pitch, and neither can simulated ones', () => {
  const ms = flightMs({ pitch: 0 }, pro);
  const t = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) t.sample(x, 0, 'head', true);
  assert.equal(t.finish().status, STATUS.UNSCORED);
  const sim = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) sim.sample(x, 0, 'simulated', true);
  assert.equal(sim.finish().status, STATUS.UNSCORED, 'simulated samples cannot pass as eye samples either');
});
test('forged and malformed samples do nothing: replayed, out-of-order, NaN, Infinity, negative', () => {
  const ms = flightMs({ pitch: 0 }, pro);
  const t = new Trial('eye', ms, TOLERANCE.base);
  for (let i = 0; i < 40; i++) t.sample(100, 0, 'eye', true);
  assert.equal(t.finish().status, STATUS.UNSCORED);
  const u = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) {
    u.sample(x, NaN, 'eye', true);
    u.sample(x + 1, Infinity, 'eye', true);
    u.sample(x + 2, -5, 'eye', true);
    u.sample(-x, 0, 'eye', true);
  }
  assert.equal(u.finish().status, STATUS.UNSCORED);
});
test('a pitch with a flight time of any real length is scored by the same rules (the slow eephus, the fast Majors fastball)', () => {
  const eephus = { lane: 1, row: 1, pitch: PITCHES.findIndex((p) => p.id === 'eephus') };
  assert.equal(playPitch({ delivery: eephus, level: slow, gaze: onBall }).status, STATUS.GREEN);
  assert.equal(playPitch({ delivery: { lane: -1, row: -1, pitch: 0 }, level: majors, gaze: onBall }).status, STATUS.GREEN);
  assert.equal(playPitch({ delivery: eephus, level: slow, gaze: () => [0, 0, -1], mode: 'head' }).status !== STATUS.GREEN, true);
});
test('a perfect scripted gaze still scores green: practice scores are not tamper-proof and are never presented as verified', () => {
  assert.equal(playPitch({ delivery: { lane: 1, row: 0, pitch: 0 }, gaze: onBall, mode: 'simulated' }).status, STATUS.GREEN);
  const store = new HistoryStore(null);
  const saved = store.add({ sport: 'baseball', source: 'simulated', speed: 'fast', results: Array(20).fill('green'), minutes: 1.4, ts: 7 });
  assert.equal(saved.source, 'simulated', 'the saved session keeps the SIMULATED label');
});

// ---------------------------------------------------------------- eye vs head: the shared checks work on baseball geometry
test('the eye check refuses a gaze that follows the head, and accepts eyes that move with the head still', () => {
  const targets = [
    { id: 'a', dir: [-0.24, 0, -0.97] },
    { id: 'b', dir: [0.24, 0, -0.97] },
  ];
  const head = [0, 0, -1];
  const follows = new CalibrationCheck({ targets });
  follows.start(0, head);
  for (let t = 0; t <= 20000; t += 16) follows.sample(t, head, head, true);
  assert.notEqual(follows.status, 'passed');
  const real = new CalibrationCheck({ targets });
  real.start(0, head);
  let t = 0;
  for (const tg of targets) for (let i = 0; i < 40; i++) real.sample((t += 16), tg.dir, head, true);
  assert.equal(real.status, 'passed');
  const v = new GazeVerdict();
  let r;
  for (let i = 0; i < 400; i++) r = v.update(i / 60, head, head, true);
  assert.equal(r, VERDICT.HEAD_LOCKED, 'a gaze ray glued to the head is flagged during play');
});

// ---------------------------------------------------------------- the session
test('baseball is a live sport and a warm-up plus 20 pitches reaches the scorecard', () => {
  assert.ok(SPORTS.find((s) => s.id === 'baseball').live);
  const f = new GameFlow({ rng: seeded(9), deliveries: makeDeliveries });
  assert.ok(f.selectSport('baseball'));
  assert.ok(f.chooseMode(MODE.HEAD));
  const lanes = [];
  for (let i = 0; i < 21; i++) {
    const b = f.beginBall(1000 + i);
    assert.ok(b);
    if (i === 0) assert.equal(b.warmup, true, 'one warm-up first');
    if (i > 0) {
      assert.equal(b.warmup, false);
      assert.ok(['lane', 'row', 'pitch', 'dx', 'dy', 'dv'].every((k) => Number.isFinite(b.delivery[k])), 'baseball pitches carry lane, row, pitch type and command');
      lanes.push(b.delivery.lane);
    }
    f.completeBall({ status: STATUS.GREEN, quality: 1, coverage: 1 }, 2000 + i);
  }
  assert.equal(lanes.length, 20);
  assert.equal(f.phase, PHASE.SCORECARD);
  assert.equal(f.counts().green, 20);
  assert.equal(f.results.length, 20);
});
test('all four sports are live, and cricket still gets its own deliveries (baseball did not change the shared flow)', () => {
  assert.deepEqual(SPORTS.map((s) => s.id).sort(), ['baseball', 'cricket', 'football', 'tennis']);
  assert.ok(SPORTS.every((s) => s.live));
  const f = new GameFlow({ rng: seeded(9) });
  f.selectSport('cricket');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  assert.ok('length' in f.beginBall(0).delivery);
  assert.equal(new GameFlow().selectSport('nonsense'), false);
});
test('eye mode needs a passed calibration; head mode stays separate and labelled', () => {
  const f = new GameFlow({ deliveries: makeDeliveries });
  f.selectSport('baseball');
  assert.equal(f.chooseMode(MODE.EYE, { calibrated: false }), false);
  assert.equal(f.phase, PHASE.MODE);
  assert.ok(f.chooseMode(MODE.HEAD));
  assert.equal(f.mode, MODE.HEAD);
});
test('an interrupted pitch is thrown away, never scored as a miss, and is replayed', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('baseball');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  const first = f.beginBall(0);
  assert.ok(f.interrupt());
  assert.equal(f.results.length, 0);
  assert.ok(f.resume());
  const again = f.beginBall(5);
  assert.deepEqual(again.delivery, first.delivery, 'the same pitch is replayed');
});
test('rapid presses do nothing twice: one action per state (pinch spam)', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('baseball');
  assert.equal(f.selectSport('baseball'), false);
  f.chooseMode(MODE.HEAD);
  assert.equal(f.chooseMode(MODE.HEAD), false);
  f.skipWarmup();
  assert.ok(f.beginBall(0));
  assert.equal(f.beginBall(0), null);
  assert.equal(f.pause(), true);
  assert.equal(f.pause(), false);
});
test('pause, retry and exit all work from the scorecard', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('baseball');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  for (let i = 0; i < 20; i++) {
    f.beginBall(i);
    f.completeBall({ status: STATUS.AMBER, quality: 1, coverage: 0.6 }, i + 1);
  }
  assert.equal(f.phase, PHASE.SCORECARD);
  assert.ok(f.retry());
  assert.equal(f.phase, PHASE.READY);
  assert.equal(f.results.length, 0);
  assert.ok(f.beginBall(99).delivery);
  assert.ok(f.interrupt());
  assert.ok(f.exit());
  assert.equal(f.phase, PHASE.SPORT);
});
test('saved baseball sessions keep their own level id and only totals', () => {
  const store = new HistoryStore(null);
  for (const s of SPEED_OPTIONS) {
    const saved = store.add({ sport: 'baseball', source: 'head', speed: s.id, results: Array(20).fill('green'), minutes: 1.1, ts: 5 });
    assert.ok(saved, `${s.id} is accepted`);
    assert.equal(saved.speed, s.id);
    assert.ok(!JSON.stringify(saved).includes('gaze'));
  }
  assert.equal(store.recent('baseball', 5).length, 3);
  assert.equal(store.recent('cricket', 3).length, 0);
});

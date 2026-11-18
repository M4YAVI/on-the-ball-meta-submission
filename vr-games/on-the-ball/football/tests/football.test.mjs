// Tests for the football shot physics and how football plugs into the shared scoring engine. Run with: npm run test:football
import test from 'node:test';
import assert from 'node:assert/strict';

import { Trial, angle, STATUS, TOLERANCE } from '../../src/core/engine.js';
import { GameFlow, PHASE, MODE, SPORTS } from '../../src/core/flow.js';
import { HistoryStore } from '../../src/core/history.js';
import {
  ballPosition,
  flight,
  flightMs,
  pathFitsView,
  viewAngles,
  makeDeliveries,
  drawnRadius,
  arrivalY,
  FIELD,
  PATH,
  PHYS,
  SPEED_OPTIONS,
  DEFAULT_KMH,
} from '../src/core/ball-path.js';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const LANES = [-1, 0, 1];
const CURVES = [-PATH.maxCurveM, 0, PATH.maxCurveM];
const HEIGHTS = [-1, -0.5, 0, 0.5, 1];
const DIPS = [-PATH.maxDipM, 0, PATH.maxDipM];
function eachShot(fn) {
  for (const s of SPEED_OPTIONS) for (const lane of LANES) for (const c of CURVES) for (const h of HEIGHTS) for (const d of DIPS) fn({ s, lane, c, h, d });
}

// ---------------------------------------------------------------- the field
test('distances are the real ones: 22 cm ball, penalty area edge 16.5 m from the goal line, 7.32 m goal', () => {
  assert.equal(PHYS.ballRadius, 0.11);
  assert.ok(Math.abs(FIELD.goalLineZ - FIELD.boxZ - 16.5) < 1e-9);
  assert.ok(Math.abs(FIELD.goalLineZ - FIELD.spotZ - 11) < 1e-9);
  assert.equal(FIELD.goalHalfWidth * 2, 7.32);
  assert.equal(FIELD.goalHeight, 2.44);
});
test('the goal is behind the chair, the striker outside the area, the ball in front of the striker', () => {
  assert.ok(FIELD.goalLineZ > 0, 'the goal is behind the chair, out of view');
  assert.ok(FIELD.strikerZ < FIELD.boxZ);
  assert.ok(PATH.releaseZ > FIELD.strikerZ);
});

// ---------------------------------------------------------------- flight
test('flight times: a hard default, a rocket at the top, slower ones take longer, all finite', () => {
  const ms = SPEED_OPTIONS.map((s) => flightMs(0, s.kmh));
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i] < ms[i - 1], 'faster shots arrive sooner');
  assert.ok(ms.at(-1) > 330 && ms.at(-1) < 450, `pro = ${ms.at(-1)}`);
  const hard = flightMs(0, DEFAULT_KMH);
  assert.ok(hard > 450 && hard < 620, `default = ${hard}`);
  assert.ok(ms[0] > 650 && ms[0] < 900, `gentle = ${ms[0]}`);
  assert.ok(ms.every(Number.isFinite));
});
test('the default speed is one of the options', () => assert.ok(SPEED_OPTIONS.some((s) => s.kmh === DEFAULT_KMH)));
test('the ball starts on the grass at the striker and ends 1.2 m in front of the eyes', () => {
  eachShot(({ s, lane, c, h }) => {
    const a = ballPosition(0, lane, c, h, s.kmh, 0);
    assert.ok(Math.abs(a[2] - PATH.releaseZ) < 1e-6);
    assert.ok(Math.abs(a[1] - PATH.releaseY) < 1e-6);
    const b = ballPosition(1, lane, c, h, s.kmh, 0);
    assert.equal(b[2], PATH.endZ);
    assert.ok(Math.abs(b[1] - arrivalY(h)) < 1e-9);
  });
});
test('the ball only ever moves toward the keeper', () => {
  eachShot(({ s, lane, c, h, d }) => {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const z = ballPosition(i / 100, lane, c, h, s.kmh, d)[2];
      assert.ok(z >= prev - 1e-9);
      prev = z;
    }
  });
});
test('the ball never goes through the grass and never reaches the face (stays 1.1 m away)', () => {
  eachShot(({ s, lane, c, h, d }) => {
    for (let i = 0; i <= 200; i++) {
      const p = ballPosition(i / 200, lane, c, h, s.kmh, d);
      assert.ok(p[1] >= FIELD.ground + PHYS.ballRadius - 1e-9, 'above the grass');
      assert.ok(Math.hypot(...p) >= 1.1, 'never closer than 1.1 m');
    }
  });
});
test('drag: the ball slows on the way, but not below 60% of its strike speed', () => {
  for (const s of SPEED_OPTIONS) {
    const f = flight(0, s.kmh);
    assert.ok(f.vEnd < f.v0 && f.vEnd > 0.6 * f.v0);
  }
});

// ---------------------------------------------------------------- comfort and the glasses' view
test('every shot stays inside the Meta VR Glasses view with margin', () => {
  eachShot(({ s, lane, c, h, d }) => assert.ok(pathFitsView(lane, c, 5, 120, h, s.kmh, d), `${s.id} lane ${lane} curve ${c} height ${h} dip ${d}`));
});
test('no shot drops more than 25 degrees below eye level (comfortable eye angle, clear of the heads-up strip)', () => {
  eachShot(({ s, lane, c, h, d }) => {
    for (let i = 0; i <= 200; i++) assert.ok(viewAngles(ballPosition(i / 200, lane, c, h, s.kmh, d)).vertical >= -25 - 1e-6);
  });
});
test('no shot rises more than 20 degrees above eye level (the glasses see 25 up, so 5 degrees to spare)', () => {
  eachShot(({ s, lane, c, h, d }) => {
    for (let i = 0; i <= 200; i++) assert.ok(viewAngles(ballPosition(i / 200, lane, c, h, s.kmh, d)).vertical <= 20);
  });
});
test('side shots keep their full 16 degree angle at every speed and height', () => {
  for (const s of SPEED_OPTIONS) {
    for (const h of HEIGHTS) {
      for (const lane of [-1, 1]) {
        const a = viewAngles(ballPosition(1, lane, 0.3, h, s.kmh, 0.2));
        assert.ok(Math.abs(Math.abs(a.horizontal) - PATH.maxLateralDeg) < 0.01, `${a.horizontal}`);
        assert.equal(Math.sign(a.horizontal), lane);
      }
    }
  }
});
test('a side shot ends far enough aside that a straight head misses it but the eyes can follow (the eye-tracking case)', () => {
  const p = ballPosition(1, 1, 0, 0, DEFAULT_KMH, 0);
  assert.ok(angle([0, 0, -1], p) > TOLERANCE.base * 2);
});
test('the drawn ball is never smaller than 1 degree across', () => {
  for (const d of [1.2, 5, 10, 16]) assert.ok(2 * Math.atan(drawnRadius(d) / d) >= (0.99 * Math.PI) / 180);
});

// ---------------------------------------------------------------- hostile input
test('malformed shot parameters give a finite ball', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x', 1e9, -1e9]) {
    assert.ok(ballPosition(0.5, bad, bad, bad, bad, bad).every(Number.isFinite), `${bad}`);
    assert.ok(Number.isFinite(flightMs(bad, bad)));
    for (const t of [bad, -5, 5]) assert.ok(ballPosition(t, 1, 0, 0, 70, 0).every(Number.isFinite));
  }
});
test('speed is clamped: nobody can ask for an impossible shot', () => {
  assert.equal(flightMs(0, 1), flightMs(0, 30));
  assert.equal(flightMs(0, 9999), flightMs(0, 150));
});

// ---------------------------------------------------------------- deliveries
test('20 shots: balanced lanes, shuffled, within the limits, repeatable from a seed', () => {
  const d = makeDeliveries(20, seeded(3));
  assert.equal(d.length, 20);
  for (const lane of LANES) assert.ok(d.filter((x) => x.lane === lane).length >= 6);
  for (const x of d) assert.ok(Math.abs(x.curve) <= PATH.maxCurveM && Math.abs(x.dip) <= PATH.maxDipM && Math.abs(x.height) <= 1);
  assert.deepEqual(makeDeliveries(20, seeded(3)), d);
  assert.notDeepEqual(makeDeliveries(20, seeded(4)), d);
});
test('the warm-up shot (lane 0, no height given) is a normal centre shot', () => {
  const p = ballPosition(1, 0, 0, undefined, DEFAULT_KMH, undefined);
  assert.ok(p.every(Number.isFinite) && Math.abs(p[0]) < 1e-9);
});

// ---------------------------------------------------------------- scoring on football paths (shared engine)
// A simulated person: gaze(p, u) is the unit direction they look in when the ball is at p, u of the way through the flight.
function playShot({ lane, c, h, d, kmh = DEFAULT_KMH, gaze, mode = 'eye', ok = () => true }) {
  const ms = flightMs(h, kmh);
  const trial = new Trial(mode, ms, TOLERANCE.base);
  for (let t = 0; t <= ms; t += 16) {
    const p = ballPosition(t / ms, lane, c, h, kmh, d);
    trial.sample(t, angle(gaze(p, t / ms), p), mode, ok(t / ms));
  }
  return trial.finish();
}
const onBall = (p) => p;
test('eyes that follow the ball are green on every lane and height', () => {
  for (const lane of LANES) for (const h of HEIGHTS) assert.equal(playShot({ lane, c: 0.2, h, d: 0.1, gaze: onBall }).status, STATUS.GREEN, `${lane} ${h}`);
});
test('a head held straight never earns green on a side shot: the ball leaves the centre, so only the eyes keep up', () => {
  const straight = () => [0, 0, -1];
  for (const lane of [-1, 1]) assert.notEqual(playShot({ lane, c: 0, h: 0, d: 0, gaze: straight, mode: 'head' }).status, STATUS.GREEN);
});
test('eyes that find the ball late are amber, not green', () => {
  const late = (p, u) => (u < 0.45 ? [-0.5, 0, -0.6] : p); // looking at the wrong place until nearly halfway
  assert.equal(playShot({ lane: 1, c: 0, h: 0, d: 0, gaze: late }).status, STATUS.AMBER);
});
test('a tracker that fails is UNSCORED, never red (the player is not blamed for the sensor)', () => {
  assert.equal(playShot({ lane: 1, c: 0, h: 0, d: 0, gaze: onBall, ok: () => false }).status, STATUS.UNSCORED);
});
test('a blink in the middle of the flight does not cost the green', () => {
  assert.equal(playShot({ lane: 0, c: 0, h: 0, d: 0, gaze: onBall, ok: (u) => !(u > 0.4 && u < 0.5) }).status, STATUS.GREEN);
});
test('head samples cannot pass as eye samples on a football shot', () => {
  const ms = flightMs(0, DEFAULT_KMH);
  const t = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) t.sample(x, 0, 'head', true);
  assert.equal(t.finish().status, STATUS.UNSCORED);
});
test('replayed timestamps on a football shot are unscored', () => {
  const t = new Trial('eye', flightMs(0, DEFAULT_KMH), TOLERANCE.base);
  for (let i = 0; i < 40; i++) t.sample(100, 0, 'eye', true);
  assert.equal(t.finish().status, STATUS.UNSCORED);
});
test('every speed option scores a perfect follower green (the fast ball is still fair)', () => {
  for (const s of SPEED_OPTIONS) assert.equal(playShot({ lane: 1, c: 0.4, h: 1, d: 0.2, kmh: s.kmh, gaze: onBall }).status, STATUS.GREEN, s.id);
});

// ---------------------------------------------------------------- the session
test('football is a live sport and a 20-shot session reaches the scorecard', () => {
  assert.ok(SPORTS.find((s) => s.id === 'football').live);
  const f = new GameFlow({ rng: seeded(9), deliveries: makeDeliveries });
  assert.ok(f.selectSport('football'));
  assert.ok(f.chooseMode(MODE.HEAD));
  for (let i = 0; i < 21; i++) {
    const b = f.beginBall(1000 + i);
    assert.ok(b);
    if (i > 0) assert.ok(['height', 'dip', 'curve', 'lane'].every((k) => Number.isFinite(b.delivery[k])), 'football shots carry height and dip');
    f.completeBall({ status: STATUS.GREEN, quality: 1, coverage: 1 }, 2000 + i);
  }
  assert.equal(f.phase, PHASE.SCORECARD);
  assert.equal(f.counts().green, 20);
});
test('cricket still gets cricket deliveries from a default flow', () => {
  const f = new GameFlow({ rng: seeded(9) });
  f.selectSport('cricket');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  assert.ok('length' in f.beginBall(0).delivery);
});
test('an interrupted shot is thrown away, never scored as a miss', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('football');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  f.beginBall(0);
  assert.ok(f.interrupt());
  assert.equal(f.results.length, 0);
  assert.ok(f.resume());
});
test('saved football sessions keep their own speed id and only totals', () => {
  const store = new HistoryStore(null);
  const saved = store.add({ sport: 'football', source: 'head', speed: 'easy', results: Array(20).fill('green'), minutes: 1.1, ts: 5 });
  assert.equal(saved.speed, 'easy');
  assert.equal(store.recent('football', 3).length, 1);
  assert.equal(store.recent('cricket', 3).length, 0);
  assert.ok(!JSON.stringify(saved).includes('gaze'));
});

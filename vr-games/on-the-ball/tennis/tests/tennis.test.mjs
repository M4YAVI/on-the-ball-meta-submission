// Tests for the tennis serve physics and how tennis plugs into the shared scoring engine. Run with: npm run test:tennis
import test from 'node:test';
import assert from 'node:assert/strict';

import { Trial, angle, STATUS, TOLERANCE, RULES, toleranceFor } from '../../src/core/engine.js';
import { CalibrationCheck, GazeVerdict, VERDICT } from '../../src/core/gaze-verdict.js';
import { GameFlow, PHASE, MODE, SPORTS } from '../../src/core/flow.js';
import { HistoryStore } from '../../src/core/history.js';
import {
  ballPosition,
  bounceT,
  bounceZ,
  flight,
  flightMs,
  pathFitsView,
  viewAngles,
  makeDeliveries,
  drawnRadius,
  ringRadius,
  RING_DEG,
  SIDE,
  cleanSide,
  otherSide,
  serverXFor,
  releaseXFor,
  courtShiftX,
  centreLineXFor,
  tossPosition,
  COURT,
  DIRECTIONS,
  FIELD,
  PATH,
  PHYS,
  SPEED_OPTIONS,
  TOSS,
  DEFAULT_KMH,
} from '../src/core/ball-path.js';

const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const LANES = [-1, 0, 1];
const CURVES = [-PATH.maxCurveM, 0, PATH.maxCurveM];
const DEPTHS = [-1, -0.5, 0, 0.5, 1];
function eachServe(fn) {
  for (const s of SPEED_OPTIONS) for (const lane of LANES) for (const c of CURVES) for (const d of DEPTHS) fn({ s, lane, c, d });
}

// ---------------------------------------------------------------- the court
test('the court has the real measurements: 23.77 m long, 8.23 m singles, 6.40 m service boxes, 0.914 m net, 6.7 cm ball', () => {
  assert.equal(COURT.length, 23.77);
  assert.equal(COURT.singlesWidth, 8.23);
  assert.equal(COURT.serviceDepth, 6.4);
  assert.equal(COURT.netHeight, 0.914);
  assert.equal(PHYS.ballRadius, 0.0335);
  assert.ok(Math.abs(FIELD.baselineNearZ - FIELD.baselineFarZ - 23.77) < 1e-9);
  assert.ok(Math.abs(FIELD.netZ - (FIELD.baselineNearZ + FIELD.baselineFarZ) / 2) < 1e-9, 'the net is half way');
  assert.ok(Math.abs(FIELD.serviceLineZ - FIELD.netZ - 6.4) < 1e-9);
});
test('the server stands on the far baseline about 23 m away, behind the line, and the ball is struck in front of him', () => {
  const dist = FIELD.baselineNearZ - FIELD.serverZ;
  assert.ok(dist > 23 && dist < 24.5, `server ${dist} m away`);
  assert.ok(FIELD.serverZ < FIELD.baselineFarZ, 'feet behind the baseline');
  assert.ok(PATH.releaseZ > FIELD.serverZ, 'contact in front of his feet');
  assert.ok(-PATH.releaseZ > 22 && -PATH.releaseZ < 24);
  assert.ok(FIELD.serverX < COURT.centreLineX, "on his deuce side: the receiver's left of the centre line");
});
test('the receiver sits on the baseline in the deuce half: the centre line (the T) is on his left, the sideline on his right', () => {
  assert.ok(COURT.centreLineX < 0);
  assert.ok(COURT.centreLineX + COURT.singlesWidth / 2 > 0);
});

// ---------------------------------------------------------------- the serve flight
test('flight times: a half-second-class fast serve, slower ones take longer, all finite', () => {
  const ms = SPEED_OPTIONS.map((s) => flightMs(0, s.kmh));
  for (let i = 1; i < ms.length; i++) assert.ok(ms[i] < ms[i - 1], 'faster serves arrive sooner');
  assert.ok(ms.at(-1) > 500 && ms.at(-1) < 720, `fast = ${ms.at(-1)}`);
  assert.ok(ms[0] > 900 && ms[0] < 1300, `slow = ${ms[0]}`);
  assert.ok(ms.every(Number.isFinite));
});
test('there are exactly three speeds (Slow, Medium, Fast) and three directions (Wide, Body, T)', () => {
  assert.deepEqual(SPEED_OPTIONS.map((s) => s.id), ['slow', 'medium', 'fast']);
  assert.deepEqual(DIRECTIONS.map((d) => d.label), ['Wide', 'Body', 'T']);
  assert.ok(SPEED_OPTIONS.some((s) => s.kmh === DEFAULT_KMH));
});
test('the ball starts at the server\'s contact point and ends 1.2 m in front of the eyes', () => {
  eachServe(({ s, lane, c, d }) => {
    const a = ballPosition(0, lane, c, d, s.kmh);
    assert.ok(Math.abs(a[2] - PATH.releaseZ) < 1e-6 && Math.abs(a[1] - PATH.releaseY) < 1e-6 && Math.abs(a[0] - PATH.releaseX) < 1e-6);
    const b = ballPosition(1, lane, c, d, s.kmh);
    assert.equal(b[2], PATH.endZ);
    assert.ok(Math.abs(b[1] - flight(d, s.kmh).yEnd) < 1e-9);
    assert.ok(Math.hypot(...b) > 1.1 && Math.hypot(...b) < 1.4, 'about 1.2 m from the eyes');
  });
});
test('the ball only ever moves toward the receiver', () => {
  eachServe(({ s, lane, c, d }) => {
    let prev = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const z = ballPosition(i / 200, lane, c, d, s.kmh)[2];
      assert.ok(z >= prev - 1e-9);
      prev = z;
    }
  });
});
test('it bounces EXACTLY once: one touch of the court, then it rises and does not touch again', () => {
  eachServe(({ s, lane, c, d }) => {
    const floor = FIELD.ground + PHYS.ballRadius;
    const n = 2000;
    let touches = 0;
    let inside = false;
    let firstTouchU = null;
    for (let i = 0; i <= n; i++) {
      const y = ballPosition(i / n, lane, c, d, s.kmh)[1];
      const on = y <= floor + 0.004;
      if (on && !inside) {
        touches++;
        if (firstTouchU === null) firstTouchU = i / n;
      }
      inside = on;
    }
    assert.equal(touches, 1, `${s.id} lane ${lane} depth ${d}`);
    assert.ok(Math.abs(firstTouchU - bounceT(d, s.kmh)) < 0.01, 'the touch is at the computed bounce time');
    // it came down before the bounce and goes up after it
    const u = bounceT(d, s.kmh);
    const before = ballPosition(u - 0.02, lane, c, d, s.kmh)[1];
    const after = ballPosition(u + 0.03, lane, c, d, s.kmh)[1];
    assert.ok(before > floor && after > floor, 'in the air on both sides of the bounce');
    assert.ok(ballPosition(1, lane, c, d, s.kmh)[1] > floor + 0.7, 'it has risen well clear of the court by the end');
  });
});
test('it lands inside the receiver\'s service box (past the net, short of the service line, on the deuce side)', () => {
  eachServe(({ s, lane, c, d }) => {
    const f = flight(d, s.kmh);
    const p = ballPosition(bounceT(d, s.kmh), lane, c, d, s.kmh);
    assert.ok(f.zb > FIELD.netZ && f.zb < FIELD.serviceLineZ, `bounce z ${f.zb}`);
    assert.ok(p[0] > COURT.centreLineX && p[0] < COURT.centreLineX + COURT.singlesWidth / 2, `bounce x ${p[0]}`);
    assert.equal(bounceZ(-1), PATH.bounceNearZ);
    assert.equal(bounceZ(1), PATH.bounceFarZ);
  });
});
test('every serve clears the net, with room to spare', () => {
  eachServe(({ s, lane, c, d }) => {
    let y = null;
    let prev = ballPosition(0, lane, c, d, s.kmh);
    for (let i = 1; i <= 4000 && y === null; i++) {
      const p = ballPosition(i / 4000, lane, c, d, s.kmh);
      if (p[2] >= FIELD.netZ && prev[2] < FIELD.netZ) y = p[1];
      prev = p;
    }
    assert.ok(y !== null);
    assert.ok(y > FIELD.ground + COURT.netHeight + PHYS.ballRadius + 0.05, `${s.id} depth ${d}: ${y}`);
  });
});
test('real physics: it slows on the way and at the bounce, but keeps a sensible share of its speed', () => {
  for (const s of SPEED_OPTIONS) {
    for (const d of DEPTHS) {
      const f = flight(d, s.kmh);
      assert.ok(f.hB < f.v0 && f.hB > 0.6 * f.v0, 'drag before the bounce');
      assert.ok(f.vEnd < f.h2 && f.vEnd > 0.8 * f.h2, 'drag after it');
      assert.ok(f.vy2 > 0 && f.vy2 < -f.vyB, 'the bounce turns the fall upward and loses some of it');
      assert.ok(Math.abs(f.vy2 / -f.vyB - PHYS.restitution) < 1e-9);
    }
  }
});
test('the toss: the ball rises from the hand, peaks, and is at the strike point exactly at the strike', () => {
  const start = tossPosition(TOSS.start);
  const strike = tossPosition(0);
  assert.ok(Math.abs(strike[1] - PATH.releaseY) < 1e-9 && strike[0] === PATH.releaseX && strike[2] === PATH.releaseZ);
  assert.ok(start[1] < strike[1] && Math.abs(start[1] - TOSS.handY) < 1e-9);
  const apex = tossPosition(TOSS.apexT)[1];
  assert.ok(apex > strike[1] && apex > start[1]);
  assert.ok(apex - PATH.releaseY < 1, 'struck on the way down, less than a metre under the top');
  let prev = start[1];
  for (let t = TOSS.start; t <= TOSS.apexT; t += 0.01) {
    const y = tossPosition(t)[1];
    assert.ok(y >= prev - 1e-9, 'rises up to the apex');
    prev = y;
  }
  assert.deepEqual(tossPosition(NaN).every(Number.isFinite), true);
  assert.deepEqual(tossPosition(-99), tossPosition(TOSS.start));
});

// ---------------------------------------------------------------- directions: Wide, Body, T
test('Wide ends to the right, Body straight at the receiver, T to the left; the side ones at the full 16 degrees', () => {
  for (const s of SPEED_OPTIONS) {
    for (const d of DEPTHS) {
      const wide = viewAngles(ballPosition(1, 1, 0.1, d, s.kmh));
      const body = viewAngles(ballPosition(1, 0, 0.1, d, s.kmh));
      const t = viewAngles(ballPosition(1, -1, 0.1, d, s.kmh));
      assert.ok(Math.abs(wide.horizontal - PATH.maxLateralDeg) < 0.01, `wide ${wide.horizontal}`);
      assert.ok(Math.abs(t.horizontal + PATH.maxLateralDeg) < 0.01, `t ${t.horizontal}`);
      assert.ok(Math.abs(body.horizontal) < 0.01, `body ${body.horizontal}`);
    }
  }
  assert.deepEqual(DIRECTIONS.map((x) => x.lane), [1, 0, -1]);
});
test('a Wide or T serve ends far enough aside that a straight head misses it but the eyes can follow (the eye-tracking case)', () => {
  for (const lane of [-1, 1]) {
    const p = ballPosition(1, lane, 0, 0, DEFAULT_KMH);
    assert.ok(angle([0, 0, -1], p) > TOLERANCE.base * 2);
  }
});

// ---------------------------------------------------------------- comfort and the glasses' view
test('every serve stays inside the Meta VR Glasses view with margin', () => {
  eachServe(({ s, lane, c, d }) => assert.ok(pathFitsView(lane, c, 5, 200, d, s.kmh), `${s.id} lane ${lane} curve ${c} depth ${d}`));
});
test('no serve drops more than 25 degrees below eye level (comfortable eye angle, clear of the heads-up strip)', () => {
  eachServe(({ s, lane, c, d }) => {
    for (let i = 0; i <= 300; i++) assert.ok(viewAngles(ballPosition(i / 300, lane, c, d, s.kmh)).vertical >= -25 - 1e-6);
  });
});
test('no serve rises more than 20 degrees above eye level (the glasses see 25 up, so 5 degrees to spare)', () => {
  eachServe(({ s, lane, c, d }) => {
    for (let i = 0; i <= 300; i++) assert.ok(viewAngles(ballPosition(i / 300, lane, c, d, s.kmh)).vertical <= 20);
  });
});
test('the ball never goes through the court and never gets closer than 1.1 m to the eyes', () => {
  eachServe(({ s, lane, c, d }) => {
    for (let i = 0; i <= 300; i++) {
      const p = ballPosition(i / 300, lane, c, d, s.kmh);
      assert.ok(p[1] >= FIELD.ground + PHYS.ballRadius - 1e-9);
      assert.ok(Math.hypot(...p) >= 1.1);
    }
  });
});
test('the drawn ball is real size up close, never more than about 3x real even at the server, and never a speck', () => {
  for (const d of [1.2, 3, 5, 7]) assert.equal(drawnRadius(d), PHYS.ballRadius, `${d} m: real size`);
  assert.ok(drawnRadius(23.4) <= 3.2 * PHYS.ballRadius, `at the server: ${drawnRadius(23.4)}`);
  for (const d of [8, 12, 18, 23.4]) {
    assert.ok(drawnRadius(d) >= PHYS.ballRadius);
    assert.ok(2 * Math.atan(drawnRadius(d) / d) >= (0.49 * Math.PI) / 180, `${d} m: at least half a degree across`);
  }
  let prev = Infinity;
  for (let d = 23.4; d >= 1.2; d -= 0.3) {
    const r = drawnRadius(d);
    assert.ok(r <= prev + 1e-12, 'it only ever shrinks as it comes');
    prev = r;
  }
});
test('the guide ring is a fixed 1.5 degrees where the ball is small, and always clear of the ball when it is close', () => {
  assert.equal(RING_DEG, 1.5);
  for (const d of [5, 8, 12, 23.4]) assert.ok(Math.abs((Math.atan(ringRadius(d) / d) * 180) / Math.PI - RING_DEG) < 1e-9, `${d} m`);
  for (const d of [1.2, 2, 3, 5, 12, 23.4]) assert.ok(ringRadius(d) >= 1.6 * drawnRadius(d) - 1e-12, `${d} m: the ring surrounds the ball`);
  assert.ok(ringRadius(23.4) < 0.5 * (23.4 * Math.tan((3.4 * Math.PI) / 180)), 'well under half the cricket ring at the server');
});

// ---------------------------------------------------------------- hostile input
test('malformed serve parameters give a finite ball', () => {
  for (const bad of [NaN, Infinity, -Infinity, undefined, null, 'x', 1e9, -1e9]) {
    assert.ok(ballPosition(0.5, bad, bad, bad, bad).every(Number.isFinite), `${bad}`);
    assert.ok(Number.isFinite(flightMs(bad, bad)));
    for (const t of [bad, -5, 5]) assert.ok(ballPosition(t, 1, 0, 0, 130).every(Number.isFinite));
  }
});
test('speed is clamped: nobody can ask for an impossible serve', () => {
  assert.equal(flightMs(0, 1), flightMs(0, 60));
  assert.equal(flightMs(0, 9999), flightMs(0, 200));
});

// ---------------------------------------------------------------- the 20 serves
test('20 serves: Wide / Body / T balanced, shuffled, within the limits, repeatable from a seed', () => {
  const d = makeDeliveries(20, seeded(3));
  assert.equal(d.length, 20);
  for (const lane of LANES) assert.ok(d.filter((x) => x.lane === lane).length >= 6, `lane ${lane}`);
  for (const x of d) assert.ok(Math.abs(x.curve) <= PATH.maxCurveM && Math.abs(x.depth) <= 1 && LANES.includes(x.lane));
  assert.deepEqual(makeDeliveries(20, seeded(3)), d);
  assert.notDeepEqual(makeDeliveries(20, seeded(4)), d);
  const order = (seed) => makeDeliveries(20, seeded(seed)).map((x) => x.lane).join();
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(order)).size > 1, 'the order is randomised');
});
test('the warm-up serve (Body, no depth given) is a normal, comfortable serve', () => {
  const p = ballPosition(1, 0, 0, undefined, DEFAULT_KMH);
  assert.ok(p.every(Number.isFinite) && Math.abs(viewAngles(p).horizontal) < 0.01);
  assert.ok(Number.isFinite(flightMs(undefined, DEFAULT_KMH)));
});

// ---------------------------------------------------------------- scoring on tennis paths (shared engine, unchanged)
// A simulated person: gaze(p, u) is the direction they look in when the ball is at p, u of the way through the flight.
function playServe({ lane, c, d, kmh = DEFAULT_KMH, gaze, mode = 'eye', ok = () => true }) {
  const ms = flightMs(d, kmh);
  const trial = new Trial(mode, ms, TOLERANCE.base);
  for (let t = 0; t <= ms; t += 16) {
    const p = ballPosition(t / ms, lane, c, d, kmh);
    trial.sample(t, angle(gaze(p, t / ms), p), mode, ok(t / ms));
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
test('eyes that follow the ball through the bounce are green on every direction, speed and depth', () => {
  for (const s of SPEED_OPTIONS) for (const lane of LANES) for (const d of DEPTHS) assert.equal(playServe({ lane, c: 0.1, d, kmh: s.kmh, gaze: onBall }).status, STATUS.GREEN, `${s.id} ${lane} ${d}`);
});
test('the core case: the head stays straight, the ball goes Wide, the eyes follow it. Eyes score green; a head-only device does not', () => {
  for (const lane of [-1, 1]) {
    const eyesFollow = playServe({ lane, c: 0, d: 0, gaze: onBall, mode: 'eye' });
    const headStraight = playServe({ lane, c: 0, d: 0, gaze: () => [0, 0, -1], mode: 'head' });
    assert.equal(eyesFollow.status, STATUS.GREEN);
    assert.notEqual(headStraight.status, STATUS.GREEN);
  }
});
test('eyes that find the ball late are amber, not green', () => {
  const late = (p, u) => (u < 0.45 ? [-0.5, 0, -0.6] : p);
  assert.equal(playServe({ lane: 1, c: 0, d: 0, gaze: late }).status, STATUS.AMBER);
});
test('eyes that look away are red', () => {
  assert.equal(playServe({ lane: 1, c: 0, d: 0, gaze: () => [-0.7, 0.5, -0.5] }).status, STATUS.RED);
});
test('a tracker that fails is UNSCORED, never red (the player is not blamed for the sensor)', () => {
  assert.equal(playServe({ lane: 1, c: 0, d: 0, gaze: onBall, ok: () => false }).status, STATUS.UNSCORED);
});
test('a blink does not cost the green, but a long dropout is unscored', () => {
  assert.equal(playServe({ lane: 0, c: 0, d: 0, gaze: onBall, ok: (u) => !(u > 0.4 && u < 0.5) }).status, STATUS.GREEN);
  assert.equal(playServe({ lane: 0, c: 0, d: 0, gaze: onBall, ok: (u) => !(u > 0.2 && u < 0.7) }).status, STATUS.UNSCORED);
});
test('head samples cannot pass as eye samples on a tennis serve', () => {
  const ms = flightMs(0, DEFAULT_KMH);
  const t = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) t.sample(x, 0, 'head', true);
  assert.equal(t.finish().status, STATUS.UNSCORED);
  const sim = new Trial('eye', ms, TOLERANCE.base);
  for (let x = 0; x <= ms; x += 16) sim.sample(x, 0, 'simulated', true);
  assert.equal(sim.finish().status, STATUS.UNSCORED, 'simulated samples cannot pass as eye samples either');
});
test('forged and malformed samples do nothing: replayed, out-of-order, NaN, Infinity, negative', () => {
  const ms = flightMs(0, DEFAULT_KMH);
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
test('a perfect scripted gaze still scores green: practice scores are not tamper-proof and are never presented as verified', () => {
  assert.equal(playServe({ lane: 1, c: 0, d: 0, gaze: onBall, mode: 'simulated' }).status, STATUS.GREEN);
  const store = new HistoryStore(null);
  const saved = store.add({ sport: 'tennis', source: 'simulated', speed: 'fast', results: Array(20).fill('green'), minutes: 1.4, ts: 7 });
  assert.equal(saved.source, 'simulated', 'the saved session keeps the SIMULATED label');
});
test('every speed scores a perfect follower green (the fast serve is still fair)', () => {
  for (const s of SPEED_OPTIONS) assert.equal(playServe({ lane: 1, c: 0.18, d: 1, kmh: s.kmh, gaze: onBall }).status, STATUS.GREEN, s.id);
});

// ---------------------------------------------------------------- eye vs head: the shared checks work on tennis geometry
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
test('tennis is a live sport and a warm-up plus 20 serves reaches the scorecard', () => {
  assert.ok(SPORTS.find((s) => s.id === 'tennis').live);
  const f = new GameFlow({ rng: seeded(9), deliveries: makeDeliveries });
  assert.ok(f.selectSport('tennis'));
  assert.ok(f.chooseMode(MODE.HEAD));
  const lanes = [];
  for (let i = 0; i < 21; i++) {
    const b = f.beginBall(1000 + i);
    assert.ok(b);
    if (i === 0) assert.equal(b.warmup, true, 'one warm-up first');
    if (i > 0) {
      assert.equal(b.warmup, false);
      assert.ok(['lane', 'curve', 'depth'].every((k) => Number.isFinite(b.delivery[k])), 'tennis serves carry lane, curve and depth');
      lanes.push(b.delivery.lane);
    }
    f.completeBall({ status: STATUS.GREEN, quality: 1, coverage: 1 }, 2000 + i);
  }
  assert.equal(lanes.length, 20);
  assert.equal(f.phase, PHASE.SCORECARD);
  assert.equal(f.counts().green, 20);
  assert.equal(f.results.length, 20);
});
test('cricket and football still get their own deliveries (tennis did not change the shared flow)', () => {
  const f = new GameFlow({ rng: seeded(9) });
  f.selectSport('cricket');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  assert.ok('length' in f.beginBall(0).delivery);
  assert.equal(new GameFlow().selectSport('nonsense'), false, 'an unknown sport is still refused');
});
test('eye mode needs a passed calibration; head mode stays separate and labelled', () => {
  const f = new GameFlow({ deliveries: makeDeliveries });
  f.selectSport('tennis');
  assert.equal(f.chooseMode(MODE.EYE, { calibrated: false }), false);
  assert.equal(f.phase, PHASE.MODE);
  assert.ok(f.chooseMode(MODE.HEAD));
  assert.equal(f.mode, MODE.HEAD);
});
test('an interrupted serve is thrown away, never scored as a miss, and is replayed', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('tennis');
  f.chooseMode(MODE.HEAD);
  f.skipWarmup();
  const first = f.beginBall(0);
  assert.ok(f.interrupt());
  assert.equal(f.results.length, 0);
  assert.ok(f.resume());
  const again = f.beginBall(5);
  assert.deepEqual(again.delivery, first.delivery, 'the same serve is replayed');
});
test('rapid presses do nothing twice: one action per state (pinch spam)', () => {
  const f = new GameFlow({ rng: seeded(2), deliveries: makeDeliveries });
  f.selectSport('tennis');
  assert.equal(f.selectSport('tennis'), false);
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
  f.selectSport('tennis');
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
test('saved tennis sessions keep their own speed id and only totals', () => {
  const store = new HistoryStore(null);
  for (const s of SPEED_OPTIONS) {
    const saved = store.add({ sport: 'tennis', source: 'head', speed: s.id, results: Array(20).fill('green'), minutes: 1.1, ts: 5 });
    assert.ok(saved, `${s.id} is accepted`);
    assert.equal(saved.speed, s.id);
    assert.ok(!JSON.stringify(saved).includes('gaze'));
  }
  assert.equal(store.recent('tennis', 5).length, 3);
  assert.equal(store.recent('cricket', 3).length, 0);
});

// ---------------------------------------------------------------- the two sides (deuce and ad): a try never changes side, the next one does
function eachServeBothSides(fn) {
  for (const side of [SIDE.DEUCE, SIDE.AD]) for (const s of SPEED_OPTIONS) for (const lane of LANES) for (const c of CURVES) for (const d of DEPTHS) fn({ side, s, lane, c, d });
}
test('the default side is deuce and changes nothing for the original serves', () => {
  assert.equal(SIDE.DEUCE, 1);
  assert.equal(SIDE.AD, -1);
  for (const lane of LANES) for (const u of [0, 0.3, 0.68, 1]) assert.deepEqual(ballPosition(u, lane, 0.1, 0.2, 130), ballPosition(u, lane, 0.1, 0.2, 130, SIDE.DEUCE));
  assert.equal(courtShiftX(SIDE.DEUCE), 0);
  assert.equal(serverXFor(SIDE.DEUCE), FIELD.serverX);
  assert.equal(releaseXFor(SIDE.DEUCE), PATH.releaseX);
});
test('side values are cleaned: anything odd means deuce, and the other side is always the opposite', () => {
  for (const bad of [undefined, null, NaN, Infinity, 'ad', 0, 1, 7]) assert.equal(cleanSide(bad), SIDE.DEUCE, `${bad}`);
  for (const ad of [-1, -0.2, -5, -Infinity]) assert.equal(cleanSide(ad), ad === -Infinity ? SIDE.DEUCE : SIDE.AD, `${ad}`);
  assert.equal(otherSide(SIDE.DEUCE), SIDE.AD);
  assert.equal(otherSide(SIDE.AD), SIDE.DEUCE);
  assert.equal(otherSide(otherSide(SIDE.AD)), SIDE.AD);
  assert.equal(otherSide(NaN), SIDE.AD);
  for (const side of [SIDE.DEUCE, SIDE.AD, NaN, 'x']) assert.ok(ballPosition(0.5, 1, 0.1, 0, 130, side).every(Number.isFinite));
});
test('ad side: the server is on the other side of his baseline, the court slides 4 m, and the receiver stays mid-half', () => {
  assert.equal(serverXFor(SIDE.AD), -FIELD.serverX);
  assert.ok(serverXFor(SIDE.DEUCE) < centreLineXFor(SIDE.DEUCE), 'deuce: server left of the centre line');
  assert.ok(serverXFor(SIDE.AD) > centreLineXFor(SIDE.AD), 'ad: server right of the centre line');
  assert.equal(courtShiftX(SIDE.AD), -2 * COURT.centreLineX);
  assert.equal(centreLineXFor(SIDE.AD), -COURT.centreLineX);
  for (const side of [SIDE.DEUCE, SIDE.AD]) {
    const toCentre = Math.abs(centreLineXFor(side));
    const toSideline = COURT.singlesWidth / 2 - toCentre;
    assert.ok(Math.abs(toCentre - toSideline) < 0.2, 'the receiver sits in the middle of the half');
    assert.ok(Math.abs(serverXFor(side) - centreLineXFor(side)) < 1.2, 'a metre from the centre mark');
  }
  // his strike is always on his hitting side, at the same offset from his body
  assert.ok(Math.abs(releaseXFor(SIDE.AD) - serverXFor(SIDE.AD) - (PATH.releaseX - FIELD.serverX)) < 1e-12);
});
test("ad side: Wide ends to the receiver's LEFT, T to his right, Body straight at him, all at the full 16 degrees", () => {
  for (const s of SPEED_OPTIONS) for (const d of DEPTHS) {
    const wide = viewAngles(ballPosition(1, 1, 0.1, d, s.kmh, SIDE.AD));
    const body = viewAngles(ballPosition(1, 0, 0.1, d, s.kmh, SIDE.AD));
    const t = viewAngles(ballPosition(1, -1, 0.1, d, s.kmh, SIDE.AD));
    assert.ok(Math.abs(wide.horizontal + PATH.maxLateralDeg) < 0.01, `wide ${wide.horizontal}`);
    assert.ok(Math.abs(t.horizontal - PATH.maxLateralDeg) < 0.01, `t ${t.horizontal}`);
    assert.ok(Math.abs(body.horizontal) < 0.01, `body ${body.horizontal}`);
  }
});
test('ad side: the flight has the same height, distance and timing as deuce, with the sideways direction reversed', () => {
  for (const s of SPEED_OPTIONS) for (const lane of LANES) for (const d of DEPTHS) {
    for (let i = 0; i <= 50; i++) {
      const a = ballPosition(i / 50, lane, 0.1, d, s.kmh, SIDE.DEUCE);
      const b = ballPosition(i / 50, lane, 0.1, d, s.kmh, SIDE.AD);
      assert.ok(Math.abs(a[1] - b[1]) < 1e-12 && Math.abs(a[2] - b[2]) < 1e-12, 'height and distance are identical');
    }
  }
  const a = ballPosition(1, 1, 0.1, 0, 130, SIDE.DEUCE);
  const b = ballPosition(1, 1, 0.1, 0, 130, SIDE.AD);
  assert.ok(Math.abs(a[0] + b[0]) < 1e-9, 'the arrival point is an exact mirror');
});
test('ad side: every serve is as comfortable as on deuce (view, angles, distance, one bounce, net clearance)', () => {
  eachServeBothSides(({ side, s, lane, c, d }) => {
    assert.ok(pathFitsView(lane, c, 5, 200, d, s.kmh, side), `side ${side} ${s.id} lane ${lane} curve ${c} depth ${d}`);
    const floor = FIELD.ground + PHYS.ballRadius;
    let touches = 0;
    let inside = false;
    let netY = null;
    let prev = ballPosition(0, lane, c, d, s.kmh, side);
    for (let i = 0; i <= 2000; i++) {
      const p = ballPosition(i / 2000, lane, c, d, s.kmh, side);
      const v = viewAngles(p).vertical;
      assert.ok(v >= -25 - 1e-6 && v <= 20, `vertical ${v}`);
      assert.ok(Math.hypot(...p) >= 1.1 && p[1] >= floor - 1e-9);
      const on = p[1] <= floor + 0.004;
      if (on && !inside) touches++;
      inside = on;
      if (netY === null && p[2] >= FIELD.netZ && prev[2] < FIELD.netZ) {
        netY = p[1];
        assert.ok(Math.abs(p[0] - centreLineXFor(side)) < COURT.doublesWidth / 2 + 0.914, 'it crosses the net between the posts');
      }
      prev = p;
    }
    assert.equal(touches, 1, 'exactly one bounce');
    assert.ok(netY > FIELD.ground + COURT.netHeight + PHYS.ballRadius + 0.05, 'clears the net');
  });
});
test("every serve lands in the receiver's service box on both sides (the right-hand box on deuce, the left-hand box on ad)", () => {
  eachServeBothSides(({ side, s, lane, c, d }) => {
    const p = ballPosition(bounceT(d, s.kmh), lane, c, d, s.kmh, side);
    const centre = centreLineXFor(side);
    const lo = side === SIDE.DEUCE ? centre : centre - COURT.singlesWidth / 2;
    const hi = side === SIDE.DEUCE ? centre + COURT.singlesWidth / 2 : centre;
    assert.ok(p[0] > lo && p[0] < hi, `side ${side}: bounce x ${p[0]} not in ${lo}..${hi}`);
    assert.ok(p[2] > FIELD.netZ && p[2] < FIELD.serviceLineZ, `bounce z ${p[2]}`);
  });
});
test('the toss follows the server to the ad side and still meets the strike point exactly', () => {
  for (const side of [SIDE.DEUCE, SIDE.AD]) {
    const strike = tossPosition(0, side);
    assert.ok(Math.abs(strike[0] - releaseXFor(side)) < 1e-12 && strike[1] === PATH.releaseY && strike[2] === PATH.releaseZ);
    const start = tossPosition(TOSS.start, side);
    assert.ok(Math.abs(start[0] - (serverXFor(side) + (TOSS.hand[0] - FIELD.serverX))) < 1e-12, 'leaves his free hand');
    assert.ok(Math.abs(start[0] - serverXFor(side)) < 1, 'close to his body');
    assert.equal(tossPosition(-0.4, side)[1], tossPosition(-0.4)[1], 'same height on both sides');
  }
  assert.deepEqual(tossPosition(-0.4), tossPosition(-0.4, SIDE.DEUCE));
});
test('a delivery has no side of its own: the side belongs to the whole try, so it can never change half way', () => {
  const d = makeDeliveries(20, seeded(5));
  assert.ok(d.every((x) => !('side' in x)));
  for (const lane of LANES) assert.ok(d.filter((x) => x.lane === lane).length >= 6);
});
test('ad side scoring: eyes that follow the ball are green; a head held straight is not, on a Wide or T serve', () => {
  const play = (side, lane, gaze, mode) => {
    const ms = flightMs(0, DEFAULT_KMH);
    const trial = new Trial(mode, ms, TOLERANCE.base);
    for (let t = 0; t <= ms; t += 16) {
      const p = ballPosition(t / ms, lane, 0.1, 0, DEFAULT_KMH, side);
      trial.sample(t, angle(gaze(p), p), mode, true);
    }
    return trial.finish();
  };
  for (const side of [SIDE.DEUCE, SIDE.AD]) {
    for (const lane of LANES) assert.equal(play(side, lane, (p) => p, 'eye').status, STATUS.GREEN, `side ${side} lane ${lane}`);
    for (const lane of [-1, 1]) assert.notEqual(play(side, lane, () => [0, 0, -1], 'head').status, STATUS.GREEN, `side ${side} lane ${lane} head straight`);
  }
});

// Unit and adversarial tests for the pure game logic. Run with: npm test
// Test ids (T01..T24) refer to docs/TEST-AND-ACCEPTANCE.md.
import test from 'node:test';
import assert from 'node:assert/strict';

import { Trial, angle, tally, STATUS, SAMPLE, TOLERANCE, toleranceFor } from '../src/core/engine.js';
import { GazeVerdict, VERDICT, CalibrationCheck, CAL } from '../src/core/gaze-verdict.js';
import { ballPosition, bounceT, viewAngles, pathFitsView, makeDeliveries, drawnRadius, ringRadius, flight, flightMs, FIELD, FOV, PATH, PHYS, SPEED_OPTIONS } from '../src/core/ball-path.js';
import { GameFlow, PHASE, MODE } from '../src/core/flow.js';
import { HistoryStore, HISTORY_KEY } from '../src/core/history.js';

// A flight of `ms` with a sample every 20 ms; fn(trial, t) decides each sample.
function run(fn, mode = 'eye', ms = 1000) {
  const x = new Trial(mode, ms);
  for (let t = 0; t <= ms; t += 20) fn(x, t);
  return x.finish();
}
const seeded = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

// ---------------------------------------------------------------- baseline behaviour, kept (T01)
test('aligned gaze is green', () => assert.equal(run((x, t) => x.sample(t, 0, 'eye')).status, STATUS.GREEN));
test('late acquisition is amber', () =>
  assert.equal(run((x, t) => x.sample(t, t < 400 ? 20 : 0, 'eye')).status, STATUS.AMBER));
test('deck rule "eyes stayed on the ball until it arrived": leaving it just before arrival is amber, not green', () => {
  const r = run((x, t) => x.sample(t, t < 860 ? 0 : 30, 'eye'));
  assert.ok(r.coverage >= 0.8, 'coverage alone would have been green');
  assert.equal(r.status, STATUS.AMBER);
  assert.equal(r.reason, 'left-early');
});
test('a blink right at arrival does not cost the green (sensor gap is not a miss)', () => {
  const r = run((x, t) => x.sample(t, 0, 'eye', !(t > 900 && t < 1000)));
  assert.equal(r.status, STATUS.GREEN);
  assert.equal(r.arrival, null);
});
test('late acquisition says late, looking away says looked-away', () => {
  assert.equal(run((x, t) => x.sample(t, t < 400 ? 30 : 0, 'eye')).reason, 'late');
  assert.equal(run((x, t) => x.sample(t, 30, 'eye')).reason, 'looked-away');
});
test('looking away is red', () => assert.equal(run((x, t) => x.sample(t, 30, 'eye')).status, STATUS.RED));
test('missing gaze is unscored, not red (T07)', () => {
  const r = run((x, t) => x.sample(t, 0, 'eye', false));
  assert.equal(r.status, STATUS.UNSCORED);
  assert.equal(r.reason, 'insufficient-tracking');
});
test('head data in an eye trial is rejected (no silent head-as-eye)', () =>
  assert.equal(run((x, t) => x.sample(t, 0, 'head')).status, STATUS.UNSCORED));
test('NaN injection is unscored (T10)', () => assert.equal(run((x, t) => x.sample(t, NaN, 'eye')).status, STATUS.UNSCORED));
test('replayed timestamps are unscored (T11)', () => assert.equal(run((x) => x.sample(0, 0, 'eye')).status, STATUS.UNSCORED));
test('large gaps are unscored', () => {
  const x = new Trial('eye', 1000);
  for (let t = 0; t <= 1000; t += 200) x.sample(t, 0, 'eye');
  assert.equal(x.finish().status, STATUS.UNSCORED);
});
test('a short dropout (blink) is tolerated (T07)', () =>
  assert.equal(run((x, t) => x.sample(t, 0, 'eye', t < 400 || t > 500)).status, STATUS.GREEN));
test('angle: zero vector and malformed input give NaN', () => {
  assert.ok(Number.isNaN(angle([0, 0, 0], [1, 0, 0])));
  assert.ok(Number.isNaN(angle([1, 0], [1, 0, 0])));
  assert.ok(Number.isNaN(angle(null, [1, 0, 0])));
  assert.ok(Number.isNaN(angle([Infinity, 0, 0], [1, 0, 0])));
});
test('angle: orthogonal vectors are 90 degrees', () => assert.equal(angle([1, 0, 0], [0, 1, 0]), 90));
test('a finished trial is immutable', () => {
  const x = new Trial('eye');
  const a = x.finish();
  assert.equal(x.sample(10, 0, 'eye'), SAMPLE.CLOSED);
  assert.equal(x.samples, 0);
  assert.equal(x.finish(), a);
});

// ---------------------------------------------------------------- T09: the interval-accounting fix
test('T09: an interval that touches an invalid sample is not credited', () => {
  const x = new Trial('eye', 1000);
  x.sample(0, 0, 'eye'); // good (baseline)
  x.sample(20, 0, 'eye', false); // invalid
  x.sample(40, 0, 'eye'); // good, but the sample before it was invalid: no interval
  x.sample(60, 0, 'eye'); // good: 40 -> 60 is the only credited interval
  assert.equal(x.valid, 20);
});
test('T09: alternating valid/invalid samples earn no credit', () => {
  const r = run((x, t) => x.sample(t, 0, 'eye', (t / 20) % 2 === 0));
  assert.equal(r.validMs, 0);
  assert.equal(r.status, STATUS.UNSCORED);
});
test('T09: an interval longer than the gap limit is not credited, the next one is', () => {
  const x = new Trial('eye', 1000);
  assert.equal(x.sample(0, 0, 'eye'), SAMPLE.BASELINE);
  assert.equal(x.sample(500, 0, 'eye'), SAMPLE.GAP);
  assert.equal(x.sample(520, 0, 'eye'), SAMPLE.OK);
  assert.equal(x.valid, 20);
});
test('T09: the baseline bug is gone: a blink costs exactly its own time plus one interval', () => {
  const r = run((x, t) => x.sample(t, 0, 'eye', t < 400 || t > 500));
  // good samples 0..380 (380 ms) and 520..1000 (480 ms), nothing across the 400..500 hole or its two edges
  assert.equal(r.validMs, 860);
});

// ---------------------------------------------------------------- T10, T11 malformed input
test('T10: bad values are rejected and counted, never scored', () => {
  const x = new Trial('eye', 1000);
  assert.equal(x.sample(0, Infinity, 'eye'), SAMPLE.INVALID);
  assert.equal(x.sample(20, -1, 'eye'), SAMPLE.INVALID);
  assert.equal(x.sample(40, 181, 'eye'), SAMPLE.INVALID);
  assert.equal(x.sample(60, 0, 'simulated'), SAMPLE.INVALID);
  assert.equal(x.sample(80, 0, 'eye', 'yes'), SAMPLE.INVALID); // only literal true is accepted
  assert.equal(x.valid, 0);
});
test('T11: duplicate, out-of-order, negative, future and non-finite times are rejected', () => {
  const x = new Trial('eye', 1000);
  assert.equal(x.sample(100, 0, 'eye'), SAMPLE.BASELINE);
  assert.equal(x.sample(100, 0, 'eye'), SAMPLE.OUT_OF_ORDER);
  assert.equal(x.sample(50, 0, 'eye'), SAMPLE.OUT_OF_ORDER);
  assert.equal(x.sample(-5, 0, 'eye'), SAMPLE.BAD_TIME);
  assert.equal(x.sample(1001, 0, 'eye'), SAMPLE.BAD_TIME);
  assert.equal(x.sample(NaN, 0, 'eye'), SAMPLE.BAD_TIME);
  assert.equal(x.sample(Infinity, 0, 'eye'), SAMPLE.BAD_TIME);
  assert.equal(x.sample('50', 0, 'eye'), SAMPLE.BAD_TIME);
  assert.equal(x.valid, 0);
});
test('edge gaze: eye mode cone is 7 deg near the centre, widens toward the edge, capped at 11; head mode stays 7', () => {
  assert.equal(toleranceFor(0, 'eye'), 7);
  assert.equal(toleranceFor(10, 'eye'), 7);
  assert.ok(Math.abs(toleranceFor(20, 'eye') - 9) < 1e-9);
  assert.equal(toleranceFor(60, 'eye'), TOLERANCE.max);
  assert.equal(toleranceFor(25, 'simulated'), toleranceFor(25, 'eye'));
  for (const e of [0, 16, 30, 60]) assert.equal(toleranceFor(e, 'head'), 7);
  assert.equal(toleranceFor(NaN, 'eye'), 7);
  // the cone never swallows the ball's offset: a head held straight (eyes centred) is never "on" a side ball
  for (let e = 12; e <= 40; e++) assert.ok(toleranceFor(e, 'eye') < e);
});
test('edge gaze: a per-sample cone scores an 9 deg error as on the ball at the edge but not at the centre', () => {
  const run = (tol) => {
    const tr = new Trial('eye', 1000, 7);
    for (let t = 0; t <= 1000; t += 10) tr.sample(t, 9, 'eye', true, tol);
    return tr.finish();
  };
  assert.equal(run(toleranceFor(25, 'eye')).status, STATUS.GREEN);
  assert.equal(run(toleranceFor(0, 'eye')).status, STATUS.RED);
  assert.equal(run(NaN).status, STATUS.RED, 'a bad cone falls back to the trial tolerance');
  assert.equal(run(500).status, STATUS.RED, 'an out-of-range cone falls back too');
});
test('trial constructor validates duration, tolerance and mode', () => {
  assert.throws(() => new Trial('eye', 0));
  assert.throws(() => new Trial('eye', NaN));
  assert.throws(() => new Trial('eye', 1000, 0));
  assert.throws(() => new Trial('eye', 1000, 200));
  assert.throws(() => new Trial(''));
  assert.throws(() => new Trial(undefined));
});
test('quality threshold: 75% tracked is scored, less is unscored', () => {
  const at = (cutoff) => {
    const x = new Trial('eye', 1000);
    for (let t = 0; t <= 1000; t += 10) x.sample(t, 0, 'eye', t <= cutoff);
    return x.finish().status;
  };
  assert.equal(at(750), STATUS.GREEN);
  assert.equal(at(740), STATUS.UNSCORED);
});
test('tally counts unscored separately from red', () => {
  assert.deepEqual(tally(['green', 'green', 'amber', 'red', 'unscored', 'bogus']), {
    total: 5,
    green: 2,
    amber: 1,
    red: 1,
    unscored: 1,
  });
});
test('T15: a perfect scripted ray scores green, and nothing marks a score as verified', () => {
  // Practice scores are forgeable client-side. The engine must not claim otherwise.
  const r = run((x, t) => x.sample(t, 0, 'eye'));
  assert.equal(r.status, STATUS.GREEN);
  assert.ok(!('verified' in r));
});

// ---------------------------------------------------------------- real eye versus head-locked gaze
const dirYaw = (deg) => [Math.sin((deg * Math.PI) / 180), 0, -Math.cos((deg * Math.PI) / 180)];
const HEAD = [0, 0, -1];

test('GazeVerdict: gaze that separates from the head is independent', () => {
  const g = new GazeVerdict();
  for (let i = 0; i < 100; i++) g.update(i / 30, dirYaw(i % 2 ? 4 : 0), HEAD, true);
  assert.equal(g.verdict, VERDICT.EYE);
});
test('GazeVerdict: gaze identical to the head for 3 s is head-locked', () => {
  const g = new GazeVerdict();
  for (let i = 0; i < 130; i++) g.update(i / 30, HEAD, HEAD, true);
  assert.equal(g.verdict, VERDICT.HEAD_LOCKED);
});
test('GazeVerdict: not enough evidence stays unknown, and a missing gaze pose is no-gaze', () => {
  const g = new GazeVerdict();
  for (let i = 0; i < 30; i++) g.update(i / 30, HEAD, HEAD, true);
  assert.equal(g.verdict, VERDICT.UNKNOWN);
  const n = new GazeVerdict();
  for (let i = 0; i < 100; i++) n.update(i / 30, null, HEAD, false);
  assert.equal(n.verdict, VERDICT.NO_GAZE);
});

function calibrate({ eye, head, tracked = () => true, ms = 40000, step = 16 }) {
  const c = new CalibrationCheck({ targets: [{ id: 'left', dir: dirYaw(-14) }, { id: 'right', dir: dirYaw(14) }] });
  c.start(0, HEAD);
  let last;
  for (let t = 0; t < ms && c.status === CAL.RUNNING; t += step) last = c.sample(t, eye(t, c), head(t), tracked(t));
  return { c, last };
}
const lookAtTarget = (t, c) => c.targets[c.targetIndex]?.dir ?? HEAD;

test('calibration: head still, eyes move to the left then right dot: passes', () => {
  const { c } = calibrate({ eye: lookAtTarget, head: () => HEAD });
  assert.equal(c.status, CAL.PASSED);
});
test('calibration: a gaze ray that follows the head fails (head-locked runtime)', () => {
  // Gaze = head. The player holds still, so the gaze never leaves the centre.
  const { c } = calibrate({ eye: () => HEAD, head: () => HEAD });
  assert.equal(c.status, CAL.FAILED);
  assert.equal(c.reason, 'off-target');
});
test('calibration: turning the head instead of the eyes fails', () => {
  // The player turns the whole head toward the dot and gaze rides along with it.
  const { c } = calibrate({
    eye: (t, cc) => cc.targets[cc.targetIndex].dir,
    head: (t) => dirYaw(-14),
  });
  assert.equal(c.status, CAL.FAILED);
  assert.equal(c.reason, 'head-moved');
});
test('calibration: no gaze pose fails with a clear reason', () => {
  const { c } = calibrate({ eye: () => null, head: () => HEAD, tracked: () => false });
  assert.equal(c.status, CAL.FAILED);
  assert.equal(c.reason, 'no-gaze');
});
test('calibration: looking at the dot only briefly does not pass', () => {
  const { c } = calibrate({ eye: (t) => (t % 400 < 200 ? dirYaw(-14) : HEAD), head: () => HEAD });
  assert.notEqual(c.status, CAL.PASSED);
});

// ---------------------------------------------------------------- the ball path fits the glasses' view
test('every delivery stays inside the Meta VR Glasses view with margin', () => {
  const rng = seeded(7);
  for (let n = 0; n < 200; n++) {
    const lane = [-1, 0, 1][Math.floor(rng() * 3)];
    const curve = (rng() * 2 - 1) * PATH.maxCurveM;
    assert.ok(pathFitsView(lane, curve, 5), `lane ${lane} curve ${curve} leaves the view`);
  }
});
test('the baseline end point (x = 1.7 m at 2 m) would have left the view', () => {
  const a = viewAngles([1.7, 0, -2]);
  assert.ok(a.horizontal > FOV.right, `expected > ${FOV.right}, got ${a.horizontal}`);
});
test('batsman view: the player stands at the crease with their own stumps behind them, not in front (keeper view)', () => {
  assert.ok(FIELD.batsmanStumpsZ > 0, "the batsman's stumps must be behind the eyes");
  assert.ok(FIELD.battingCreaseZ < 0 && FIELD.battingCreaseZ > -1, 'the crease is just in front of the feet');
  assert.ok(Math.abs(FIELD.batsmanStumpsZ - FIELD.bowlerStumpsZ - 20.12) < 0.05, '22 yards between the stumps');
  assert.ok(FIELD.bowlerZ > FIELD.bowlerStumpsZ && FIELD.bowlerZ < PATH.releaseZ + 1, 'the bowler releases near the far crease');
});
test('path starts at the bowler, comes all the way to the batsman, never touches the face', () => {
  assert.ok(Math.abs(ballPosition(0, 0, 0)[2] - PATH.releaseZ) < 1e-9);
  assert.ok(Math.abs(ballPosition(1, 0, 0)[2] - flight(0).endZ) < 1e-9);
  assert.ok(-PATH.endZ <= 1.5, 'the ball arrives at the bat, not 2.6 m away');
  for (const s of SPEED_OPTIONS) {
    for (const len of [-1, 0, 1]) {
      const z = flight(len, s.kmh).endZ;
      assert.ok(z <= PATH.endZ && z > -2.4, `${s.id} length ${len} ends at ${z}: in the batsman's hitting zone`);
    }
  }
  assert.ok(PATH.endZ < FIELD.battingCreaseZ, 'it arrives in front of the crease');
  for (let i = 0; i <= 100; i++) assert.ok(-ballPosition(i / 100, 1, 0.2)[2] >= 1.15);
  assert.ok(ballPosition(1, 0, 0)[1] < -0.3, 'it arrives below the eyes, around waist height');
});
test('no delivery ever drops more than 25 degrees below eye level (comfortable eye angle, clear of the heads-up strip)', () => {
  for (const s of SPEED_OPTIONS) {
    for (const len of [-1, 0, 1]) {
      for (const lane of [-1, 0, 1]) {
        for (const curve of [-PATH.maxCurveM, 0, PATH.maxCurveM]) {
          for (let i = 0; i <= 200; i++) {
            const v = viewAngles(ballPosition(i / 200, lane, curve, len, s.kmh)).vertical;
            assert.ok(v >= -PATH.arrivalFloorDeg - 0.05, `${s.id} len ${len} lane ${lane} reaches ${v.toFixed(1)} deg down`);
          }
        }
      }
    }
  }
  // the fast full ball, the old worst case (37 deg down), is still a real delivery that ends near the bat
  const f = flight(1, 140);
  assert.ok(f.t2 > 0.02 && f.endZ > -2.4 && f.endZ > f.zb, 'it still pitches and comes on toward the bat');
});
test('side deliveries keep their full 16 degree angle at every speed and length, even when they end early', () => {
  for (const s of SPEED_OPTIONS) {
    for (const len of [-1, 0, 1]) {
      const h = viewAngles(ballPosition(1, 1, 0, len, s.kmh)).horizontal;
      assert.ok(Math.abs(h - PATH.maxLateralDeg) < 0.01, `${s.id} len ${len} ends at ${h} deg`);
    }
  }
});
test('a side delivery ends far enough to the side that a straight head misses it but eyes can follow (the eye-tracking case)', () => {
  for (const lane of [-1, 1]) {
    const a = viewAngles(ballPosition(1, lane, 0));
    assert.ok(Math.abs(a.horizontal) > 7 * 2, `lane ${lane} ends at ${a.horizontal} deg`);
  }
});
test('the ball pitches on a length in front of the batsman; full balls pitch closer than short ones', () => {
  const zAt = (len) => ballPosition(bounceT(len), 0, 0, len)[2];
  assert.ok(zAt(0) > -7 && zAt(0) < -3.5, `good length pitches at ${zAt(0)}`);
  assert.ok(zAt(1) > zAt(-1));
  for (const len of [-1, 0, 1]) assert.ok(pathFitsView(1, PATH.maxCurveM, 5, 120, len) && pathFitsView(-1, -PATH.maxCurveM, 5, 120, len));
});
test('left and right lanes end on opposite sides; bad inputs are clamped, not NaN', () => {
  assert.ok(ballPosition(1, -1, 0)[0] < 0);
  assert.ok(ballPosition(1, 1, 0)[0] > 0);
  assert.equal(ballPosition(1, 0, 0)[0], 0);
  const p = ballPosition(NaN, 99, Infinity);
  assert.ok(p.every(Number.isFinite));
});
test('the ball bounces: lowest point is on the pitch side, then it rises', () => {
  assert.ok(ballPosition(bounceT(0), 0, 0)[1] < ballPosition(0, 0, 0)[1]);
  assert.ok(ballPosition(1, 0, 0)[1] > ballPosition(bounceT(0), 0, 0)[1]);
});
test('the ball bounces off the pitch for every length', () => {
  for (const len of [-1, 0, 1]) {
    const b = bounceT(len);
    assert.ok(ballPosition(b, 0, 0, len)[1] <= ballPosition(b - 0.05, 0, 0, len)[1]);
    assert.ok(ballPosition(b + 0.05, 0, 0, len)[1] > ballPosition(b, 0, 0, len)[1]);
  }
});
test('real ball flight: 140 km/h is the half-second ball, slower balls take longer, every speed and length stays in view', () => {
  const fast = flightMs(0, 140);
  assert.ok(fast > 430 && fast < 530, `140 km/h takes ${fast} ms`);
  let prev = 0;
  for (const s of [...SPEED_OPTIONS].sort((a, b) => b.kmh - a.kmh)) {
    const ms = flightMs(0, s.kmh);
    assert.ok(ms > prev, `${s.id} must take longer than a faster ball`);
    prev = ms;
    for (const len of [-1, 0, 1]) {
      for (const lane of [-1, 0, 1]) {
        assert.ok(pathFitsView(lane, lane * PATH.maxCurveM, 5, 120, len, s.kmh), `${s.id} lane ${lane} length ${len} leaves the view`);
        assert.ok(pathFitsView(lane, -lane * PATH.maxCurveM, 5, 120, len, s.kmh));
      }
      const end = ballPosition(1, 0, 0, len, s.kmh);
      assert.ok(end[1] < -0.3 && end[1] > FIELD.ground, `${s.id} length ${len} arrives at ${end[1]}`);
    }
  }
});
test('real ball flight: the ball slows in the air and on the bounce, and comes off the pitch slower than it went in', () => {
  const f = flight(0, 140);
  assert.ok(f.vb < f.v0, 'air drag slows it before it pitches');
  assert.ok(f.v1 < f.vb, 'it loses pace on the pitch');
  assert.ok(f.vEnd > 0.7 * f.v0 && f.vEnd < f.v0, 'but it still arrives quick');
  assert.ok(f.vy1 > 0 && f.vy1 < -(f.vy0 - PHYS.g * f.t1), 'it bounces up, with less vertical speed than it came down with');
  const atBounce = ballPosition(bounceT(0, 140), 0, 0, 0, 140);
  assert.ok(Math.abs(atBounce[1] - (FIELD.ground + PHYS.ballRadius)) < 1e-6, 'it touches the pitch surface');
  assert.ok(Math.abs(atBounce[2] - f.zb) < 1e-6);
});
test('the drawn ball never shrinks below a followable size', () => {
  const far = drawnRadius(18);
  assert.ok((Math.atan(far / 18) * 180) / Math.PI >= 0.89);
  assert.equal(drawnRadius(0.2), 0.036); // near the player it is the real size
  assert.ok(ringRadius(10) > drawnRadius(10));
});
test('deliveries: 20 balanced, shuffled, within the swing limit, repeatable from a seed', () => {
  const d = makeDeliveries(20, seeded(3));
  assert.equal(d.length, 20);
  const n = (l) => d.filter((x) => x.lane === l).length;
  assert.ok(n(-1) >= 6 && n(0) >= 6 && n(1) >= 6);
  assert.ok(d.every((x) => Math.abs(x.curve) <= PATH.maxCurveM));
  assert.ok(d.every((x) => x.length >= -1 && x.length <= 1));
  assert.deepEqual(makeDeliveries(20, seeded(3)), d);
  assert.notDeepEqual(makeDeliveries(20, seeded(4)), d);
});

// ---------------------------------------------------------------- the session state machine
function ready(mode = MODE.HEAD) {
  const f = new GameFlow({ total: 20, rng: seeded(11) });
  assert.ok(f.selectSport('cricket'));
  assert.ok(f.chooseMode(mode, { calibrated: mode === MODE.EYE }));
  return f;
}
const green = { status: STATUS.GREEN, quality: 1, coverage: 1 };

test('only cricket can be selected in this build', () => {
  const f = new GameFlow();
  assert.equal(f.selectSport('tennis'), false);
  assert.equal(f.selectSport('nonsense'), false);
  assert.equal(f.phase, PHASE.SPORT);
  assert.equal(f.selectSport('cricket'), true);
});
test('eye mode cannot be chosen without a passed calibration; head mode is explicit', () => {
  const f = new GameFlow();
  f.selectSport('cricket');
  assert.equal(f.chooseMode(MODE.EYE, { calibrated: false }), false);
  assert.equal(f.phase, PHASE.MODE);
  assert.equal(f.chooseMode('mystery'), false);
  assert.equal(f.chooseMode(MODE.HEAD), true);
  assert.equal(f.mode, MODE.HEAD);
});
test('a warm-up ball is not scored, then exactly 20 balls end on the scorecard', () => {
  const f = ready();
  let b = f.beginBall(1000);
  assert.equal(b.warmup, true);
  assert.equal(f.completeBall(green).warmup, true);
  assert.equal(f.results.length, 0);
  for (let i = 0; i < 20; i++) {
    b = f.beginBall(1000 + i);
    assert.equal(b.warmup, false);
    assert.equal(b.index, i);
    assert.ok(f.completeBall(green, 70000));
  }
  assert.equal(f.phase, PHASE.SCORECARD);
  assert.ok(f.complete);
  assert.equal(f.results.length, 20);
  assert.equal(f.beginBall(), null); // nothing more to play
  assert.equal(f.completeBall(green), null); // a late event cannot add a 21st ball
});
test('T13: an interrupted ball is discarded and replayed, never scored as a miss', () => {
  const f = ready();
  f.skipWarmup();
  f.beginBall(0);
  f.completeBall(green);
  const second = f.beginBall(1); // ball index 1 in flight
  assert.equal(f.interrupt(), true); // headset taken off, page hidden, session ended...
  assert.equal(f.phase, PHASE.PAUSED);
  assert.equal(f.results.length, 1);
  assert.equal(f.interruptions, 1);
  assert.equal(f.resume(), true);
  const again = f.beginBall(2);
  assert.equal(again.index, second.index);
  assert.deepEqual(again.delivery, second.delivery); // the same delivery
  assert.equal(f.results.length, 1);
});
test('T14: pinch spam does nothing the second time', () => {
  const f = ready();
  f.skipWarmup();
  assert.ok(f.beginBall(0));
  assert.equal(f.beginBall(0), null); // already playing
  assert.ok(f.completeBall(green));
  assert.equal(f.completeBall(green), null); // not playing any more: no double count
  assert.equal(f.results.length, 1);
  assert.equal(f.pause(), true);
  assert.equal(f.pause(), false);
  assert.equal(f.resume(), true);
  assert.equal(f.resume(), false);
  const s = new GameFlow();
  assert.equal(s.selectSport('cricket'), true);
  assert.equal(s.selectSport('cricket'), false);
});
test('unknown or hostile results are stored as unscored, not trusted', () => {
  const f = ready();
  f.skipWarmup();
  f.beginBall(0);
  assert.equal(f.completeBall({ status: 'perfect!!' }).status, STATUS.UNSCORED);
  f.beginBall(1);
  assert.equal(f.completeBall(null).status, STATUS.UNSCORED);
});
test('change mode goes back from ready to the mode choice', () => {
  const f = ready(MODE.HEAD);
  assert.equal(f.changeMode(), true);
  assert.equal(f.phase, PHASE.MODE);
  assert.equal(f.mode, null);
  assert.equal(f.changeMode(), false);
});
test('retry restarts the 20 with the same mode; exit returns to the picker and forgets the run', () => {
  const f = ready(MODE.EYE);
  f.skipWarmup();
  for (let i = 0; i < 20; i++) {
    f.beginBall(i);
    f.completeBall(green, 1000);
  }
  assert.equal(f.retry(), true);
  assert.equal(f.phase, PHASE.READY);
  assert.equal(f.results.length, 0);
  assert.equal(f.mode, MODE.EYE);
  assert.equal(f.exit(), true);
  assert.equal(f.phase, PHASE.SPORT);
  assert.equal(f.mode, null);
});
test('counts and minutes come from the recorded balls', () => {
  const f = ready();
  f.skipWarmup();
  const seq = ['green', 'green', 'amber', 'red', 'unscored'];
  for (let i = 0; i < 20; i++) {
    f.beginBall(60000);
    f.completeBall({ status: seq[i % 5] }, 60000 + 9 * 60000);
  }
  assert.deepEqual(f.counts(), { total: 20, green: 8, amber: 4, red: 4, unscored: 4 });
  assert.equal(f.minutes(), 9);
  const short = ready();
  short.skipWarmup();
  short.beginBall(0);
  short.completeBall({ status: 'green' }, 70000);
  short.startedAt = 0;
  short.finishedAt = 72000;
  assert.equal(short.minutes(), 1.2); // a 72-second session is 1.2 minutes, not a rounded-up 9
});

// ---------------------------------------------------------------- local history (T16, T21)
function fakeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => m,
  };
}
const session = (over = {}) => ({
  sport: 'cricket',
  source: 'head',
  results: Array(20).fill('green'),
  minutes: 9,
  ts: 1000,
  ...over,
});

test('history saves totals only: no gaze data can reach storage (T21)', () => {
  const st = fakeStorage();
  const h = new HistoryStore(st);
  const withExtras = { ...session(), gaze: [[0, 0, -1]], samples: [1, 2, 3], eyeImage: 'x' };
  const saved = h.add(withExtras);
  assert.deepEqual(Object.keys(saved).sort(), ['minutes', 'practice', 'results', 'source', 'speed', 'sport', 'ts']);
  assert.ok(!st.getItem(HISTORY_KEY).includes('gaze'));
  assert.equal(saved.practice, true);
});
test('T16: corrupt, wrong-shaped or hostile storage is discarded without a crash', () => {
  for (const bad of ['{not json', '{"a":1}', '"str"', 'null', JSON.stringify([{ sport: 1 }]), 'x'.repeat(300000)]) {
    const h = new HistoryStore(fakeStorage({ [HISTORY_KEY]: bad }));
    assert.deepEqual(h.load(), []);
    assert.ok(h.add(session())); // and it still works afterwards
  }
});
test('T16: edited entries with impossible values are dropped, valid ones kept', () => {
  const good = { ...session(), practice: true };
  const edited = { ...good, results: Array(20).fill('green').fill('legend', 3, 4) };
  const h = new HistoryStore(fakeStorage({ [HISTORY_KEY]: JSON.stringify([good, edited]) }));
  assert.equal(h.load().length, 1);
});
test('T16: blocked or full storage keeps the session in memory and reports it', () => {
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const h = new HistoryStore(full);
  assert.ok(h.add(session()));
  assert.equal(h.lastError, 'storage-write-failed');
  assert.equal(h.load().length, 1);
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
  assert.doesNotThrow(() => new HistoryStore(blocked).load());
  assert.doesNotThrow(() => new HistoryStore(null).add(session()));
});
test('history rejects invalid sessions, caps its size, lists newest first, and can be deleted', () => {
  const h = new HistoryStore(fakeStorage());
  assert.equal(h.add(session({ results: ['green'] })), null);
  assert.equal(h.add(session({ source: 'telepathy' })), null);
  assert.equal(h.add(session({ minutes: -4 })), null);
  assert.equal(h.add(session({ speed: 'warp' })).speed, 'spin'); // unknown speed falls back, never stored raw
  for (let i = 0; i < 60; i++) h.add(session({ ts: i, results: Array(20).fill(i % 2 ? 'red' : 'green') }));
  assert.equal(h.load().length, 50);
  const r = h.recent('cricket', 2);
  assert.equal(r.length, 2);
  assert.ok(r[0].ts > r[1].ts);
  assert.ok(JSON.parse(h.exportJson()).length === 50);
  h.clear();
  assert.deepEqual(h.load(), []);
});

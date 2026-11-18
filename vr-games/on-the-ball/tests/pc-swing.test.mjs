// The PC bat swing (src/core/pc-swing.js) played against real deliveries with the game's own hit test and physics. These are
// the "can it be hit, and does a good shot fly" guarantees: no delivery is untouchable, a well-timed swing middles it, and a
// perfect one goes out of the ground. The eye-tracking score is not involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PC_SWING, pcBatPose, pcBatPoseFromLook, springStep, sweetDepth } from '../src/core/pc-swing.js';
import { BAT, HIT, TIMING, batBounce, batToWorld, launch, perfectLaunch, shotKind, stepBatted, sweepHit, timingOf } from '../src/core/bat-physics.js';
import { PHYS, SPEED_OPTIONS, ballPosition, flightMs, startRoll, stepRoll } from '../src/core/ball-path.js';

const PC_PAD = 0.09; // game.js PC_HIT_PAD
const sweetAt = (pose) => batToWorld(pose, [0, 0, BAT.sweetZ]);
const faceOf = (pose) => batToWorld({ p: [0, 0, 0], q: pose.q }, [-1, 0, 0]);

test('the stance is unchanged: gloves at the bottom edge of the view, the blade forward and out over the pitch', () => {
  const { p } = pcBatPose(0, PC_SWING.STANCE);
  assert.ok(Math.abs(p[1] - PC_SWING.HANDS_Y) < 1e-9 && Math.abs(p[2] - PC_SWING.HANDS_Z) < 1e-9);
  const toe = batToWorld(pcBatPose(0, PC_SWING.STANCE), [0, 0, BAT.toeZ]);
  assert.ok(toe[0] > 0.05, 'the blade leans out to the off side');
  assert.ok(toe[2] < p[2], 'and forward over the pitch');
});

test('through the hit zone the middle of the bat stays on the look line and travels toward the bowler, face square and only a little open', () => {
  for (const x of [-0.3, 0, 0.3]) {
    let lastZ = Infinity;
    for (let th = PC_SWING.STANCE; th <= PC_SWING.FINISH_FROM; th += 5) {
      const pose = pcBatPose(x, th);
      const s = sweetAt(pose);
      assert.ok(Math.abs(s[0] - x) < 1e-9, `x ${x} th ${th}: middle at ${s[0].toFixed(3)}`);
      assert.ok(s[2] < lastZ, 'moving down the pitch');
      lastZ = s[2];
      const f = faceOf(pose);
      assert.ok(f[2] < -0.75, `x ${x} th ${th}: the face looks at the bowler (${f.map((v) => v.toFixed(2))})`);
    }
    assert.ok(lastZ < TIMING.idealZ - TIMING.perfectHalf, 'the push reaches past the perfect band');
  }
});

test('the look line is read at the bat\'s depth, and through the hit zone the middle of the bat reaches the looked-at height', () => {
  for (const ball of [[0.3, -0.75, -1.25], [-0.2, -0.95, -1.45], [0, -0.62, -1.0]]) {
    for (const th of [55, 65, 80]) {
      const pose = pcBatPoseFromLook([0, 0, 0], ball, th);
      const z = sweetDepth(th);
      const s = sweetAt(pose);
      assert.ok(Math.abs(s[0] - ((ball[0] / ball[2]) * z * PC_SWING.AIM_GAIN + PC_SWING.AIM_OFFSET)) < 1e-6, 'on the line');
      const want = (ball[1] / ball[2]) * z;
      const plain = sweetAt(pcBatPose(s[0], th))[1]; // the same pose without reaching for the height
      if (th === PC_SWING.FINISH_FROM) assert.ok(Math.abs(s[1] - want) < 0.02, `middle at ${s[1].toFixed(3)} for a look at ${want.toFixed(3)}`);
      else assert.ok(Math.abs(s[1] - want) <= Math.abs(plain - want) + 1e-9, `th ${th}: reaches toward the height`);
    }
  }
  // the stance does not follow the look's height
  const still = pcBatPoseFromLook([0, 0, 0], [0, -0.95, -1.1], PC_SWING.STANCE);
  assert.ok(Math.abs(still.p[1] - PC_SWING.HANDS_Y) < 1e-9);
});

test('the wheel spring follows the wheel and nothing else', () => {
  const st = { th: PC_SWING.STANCE, w: 0 };
  for (let i = 0; i < 60; i++) springStep(st, PC_SWING.STANCE, 1 / 72);
  assert.equal(st.th, PC_SWING.STANCE, 'still wheel, still bat');
  for (let i = 0; i < 30; i++) springStep(st, 100, 1 / 72);
  assert.ok(Math.abs(st.th - 100) < 1, 'it gets where the wheel put it');
});

// One delivery, one swing: the bat lifted, then the wheel rolled forward a notch every 35 ms from tSwing (s after release),
// the eyes on the ball. The same frame loop as the game (bat first, then the ball, the swept test between the two frames).
function play(lane, length, kmh, tSwing, fps = 72) {
  const dur = flightMs(length, kmh);
  const dt = 1 / fps;
  const st = { th: -70, w: 0 };
  let target = -70;
  let notch = tSwing;
  let prev = null;
  let prevPose = null;
  let roll = null;
  let look = [0, 0, -1];
  const hist = [];
  for (let t = dt; t < 3; t += dt) {
    while (t >= notch && target < PC_SWING.FOLLOW_THROUGH) {
      target = Math.min(PC_SWING.FOLLOW_THROUGH, target + 100 * PC_SWING.DEG_PER_PX);
      notch += 0.035;
    }
    springStep(st, target, dt);
    const pose = pcBatPoseFromLook([0, 0, 0], look, st.th);
    hist.push({ t, ...pose });
    if (hist.length > 8) hist.shift();
    let p;
    let v;
    if (t * 1000 < dur) {
      p = ballPosition((t * 1000) / dur, lane, 0, length, kmh);
      v = prev ? [(p[0] - prev[0]) / dt, (p[1] - prev[1]) / dt, (p[2] - prev[2]) / dt] : [0, 0, 0];
    } else {
      roll ??= startRoll((u) => ballPosition(u, lane, 0, length, kmh), dur, 0.5, true);
      stepRoll(roll, dt);
      p = roll.p.slice();
      v = roll.v.slice();
      if (p[2] > 0.05) return null; // past the batsman (game.js PAST_BATSMAN_Z)
    }
    look = p;
    const lifted = st.th < 0 && p[2] > -0.6;
    const c = prev && prevPose && !lifted ? sweepHit(prevPose, pose, prev, p, PHYS.ballRadius + PC_PAD) : null;
    if (c) {
      const now = hist[hist.length - 1];
      let then = hist[0];
      for (let j = hist.length - 2; j >= 0; j--) {
        then = hist[j];
        if (now.t - hist[j].t >= 0.03) break;
      }
      const lp = [0, c.local[1], c.local[2]];
      const a = batToWorld(then, lp);
      const b = batToWorld(now, lp);
      const batV = [0, 1, 2].map((i) => (b[i] - a[i]) / (now.t - then.t));
      let res = batBounce(v, batV, c);
      const timing = timingOf(c.ball[2]);
      const big = perfectLaunch(res.v, timing, res, Math.min(Math.hypot(...batV), HIT.maxBatSpeed), batV);
      if (big) res = { ...res, v: big };
      const fly = launch(c.ball, res.v);
      for (let i = 0; i < 900 && !fly.rest && !fly.crossed; i++) stepBatted(fly, 1 / 60);
      return { perfect: !!big, kind: shotKind(fly, res) ?? 'shot', zone: timing.zone };
    }
    prev = p;
    prevPose = pose;
  }
  return null;
}

test('no delivery is untouchable with the PC bat: every lane, length and speed can be hit, most with a wide window', () => {
  for (const { kmh } of SPEED_OPTIONS) {
    for (const lane of [-1, 0, 1]) {
      for (const length of [-1, 0, 1]) {
        const dur = flightMs(length, kmh) / 1000;
        let hits = 0;
        for (let ts = dur * 0.5; ts < dur + 0.1; ts += 0.01) if (play(lane, length, kmh, ts)) hits++;
        assert.ok(hits * 10 >= (kmh >= 140 ? 30 : 60), `${kmh} km/h lane ${lane} length ${length}: ${hits * 10} ms window`);
      }
    }
  }
});

test('at the default speed every lane has a perfect swing, and every perfect shot is a six', () => {
  const kmh = 85;
  for (const lane of [-1, 0, 1]) {
    for (const length of [-1, 0, 1]) {
      const dur = flightMs(length, kmh) / 1000;
      let perfect = 0;
      for (let ts = dur * 0.5; ts < dur + 0.1; ts += 0.005) {
        const h = play(lane, length, kmh, ts);
        if (h?.perfect) {
          perfect++;
          assert.equal(h.kind, 'six', `lane ${lane} length ${length}`);
        }
      }
      assert.ok(perfect >= 3, `lane ${lane} length ${length}: ${perfect * 5} ms perfect window`);
    }
  }
});

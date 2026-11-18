// ON THE BALL · Tennis hand play: the racket, the return and the PC swing. Pure maths, run in Node.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ballPosition, COURT, FIELD, flightMs, PHYS, SIDE, SPEED_OPTIONS } from '../src/core/ball-path.js';
import {
  CARRY,
  courtPlan,
  headContact,
  landsIn,
  launchReturn,
  netTopY,
  perfectReturn,
  ASSIST,
  assistContact,
  contactPoint,
  easyReturn,
  predictReturn,
  RACKET,
  RACKET_LENGTH,
  racketBounce,
  racketToWorld,
  returnKind,
  serveVelocity,
  startCarry,
  stepCarry,
  stepReturn,
  sweepRacket,
  TIMING,
  timingOf,
} from '../src/core/racket-physics.js';
import { BODY, solveArm } from '../src/core/arm.js';
import { DRIVE, freeHandPose, PcSwing, racketPose, rotateQ, strokeFor, sweetSpot, SWING, timeToContact } from '../src/core/swing.js';

const ID = [0, 0, 0, 1];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// A racket held still with its face square to the net: 90 degrees about Y turns the racket's X (the face normal) to -z, so the
// strings stand in the x-y plane and the head points to the left of the hand.
const faceNet = (p) => ({ p, q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] });

test('the racket is a legal, ordinary one: 68.5 cm long, a 34 x 26 cm head, strung area inside the ITF limits', () => {
  assert.ok(RACKET_LENGTH > 0.66 && RACKET_LENGTH <= 0.737, `length ${RACKET_LENGTH}`);
  assert.ok(RACKET.headA * 2 <= 0.394 && RACKET.headB * 2 <= 0.292);
  assert.ok(RACKET.stringA * 2 <= 0.394 && RACKET.stringB * 2 <= 0.292);
  assert.ok(RACKET.sweetZ > RACKET.headZ && RACKET.sweetZ < RACKET.headZ + RACKET.stringA, 'sweet spot just below the middle of the head');
});

test('contact: the strings, the frame, and a clean miss', () => {
  const mid = headContact([0.02, 0, RACKET.sweetZ]);
  assert.ok(mid && mid.onStrings && mid.u < 0.1);
  assert.deepEqual(mid.normalLocal.map((x) => Math.round(x)), [1, 0, 0]);
  const rim = headContact([0, RACKET.headB + 0.02, RACKET.headZ]);
  assert.ok(rim && !rim.onStrings, 'just outside the frame touches the frame');
  assert.equal(headContact([0.06, 0, RACKET.headZ]), null, '6 cm off the face is a miss');
  assert.equal(headContact([0, 0, RACKET.gripTopZ - 0.04]), null, 'the throat is not a hitting surface');
});

test('a 170 km/h ball cannot pass through a still racket between two frames (swept test)', () => {
  const pose = faceNet([0, 0, -1]);
  const sweet = racketToWorld(pose, [0, 0, RACKET.sweetZ]);
  const v = 47; // m/s
  const dt = 1 / 72;
  const b0 = [sweet[0], sweet[1], sweet[2] - (v * dt) / 2];
  const b1 = [sweet[0], sweet[1], sweet[2] + (v * dt) / 2];
  const hit = sweepRacket(pose, pose, b0, b1);
  assert.ok(hit, 'the ball is caught by the strings');
  assert.ok(hit.onStrings);
});

test('off the strings: a still racket sends a ball back at about 0.3-0.5 of its speed at the sweet spot, less off the tip, little off the frame', () => {
  const pose = faceNet([0, 0, -1]);
  const at = (local) => {
    const w = racketToWorld(pose, local);
    const c = sweepRacket(pose, pose, [w[0], w[1], w[2] - 0.2], [w[0], w[1], w[2] + 0.2]);
    return racketBounce([0, 0, 20], [0, 0, 0], c);
  };
  const sweet = at([0, 0, RACKET.sweetZ]);
  const tip = at([0, 0, RACKET.headZ - RACKET.stringA + 0.02]);
  const frame = at([0, RACKET.headB - 0.004, RACKET.headZ]);
  const ks = len(sweet.v) / 20;
  assert.ok(ks > 0.3 && ks < 0.55, `apparent COR at the sweet spot ${ks}`);
  assert.ok(sweet.v[2] < 0, 'it goes back toward the server');
  assert.ok(len(tip.v) < len(sweet.v), 'weaker off the tip');
  assert.ok(frame.frame && len(frame.v) < len(sweet.v), 'a frame hit dies');
});

test('the swing sends the ball: faster racket, faster return; brushing up the ball gives topspin, and topspin brings it down sooner', () => {
  const pose = faceNet([0, 0, -1]);
  const w = racketToWorld(pose, [0, 0, RACKET.sweetZ]);
  const c = sweepRacket(pose, pose, [w[0], w[1], w[2] - 0.2], [w[0], w[1], w[2] + 0.2]);
  const slow = racketBounce([0, 0, 18], [0, 0, -8], c);
  const fast = racketBounce([0, 0, 18], [0, 0, -18], c);
  assert.ok(len(fast.v) > len(slow.v) + 5);
  const brush = racketBounce([0, 0, 18], [0, 6, -16], c);
  assert.ok(brush.w[0] < -40, `topspin (spin about -x for a ball going -z): ${brush.w}`);
  // the same launch, with and without the spin
  const p = [0, -0.2, -1];
  const flat = predictReturn(launchReturn(p, brush.v, [0, 0, 0]), SIDE.DEUCE);
  const top = predictReturn(launchReturn(p, brush.v, brush.w), SIDE.DEUCE);
  assert.ok(top.landing && flat.landing && top.landing[1] > flat.landing[1], 'topspin lands shorter');
});

test('the line calls: in, long, wide, the net; and the lines move with the court on the ad side', () => {
  const pl = courtPlan(SIDE.DEUCE);
  assert.ok(landsIn(pl.cx, pl.farZ + 1, SIDE.DEUCE));
  assert.ok(!landsIn(pl.cx, pl.farZ - 0.5, SIDE.DEUCE), 'long');
  assert.ok(!landsIn(pl.cx + COURT.singlesWidth / 2 + 0.3, -18, SIDE.DEUCE), 'wide');
  assert.ok(landsIn(pl.cx + COURT.singlesWidth / 2, -18, SIDE.DEUCE), 'on the line is in');
  const ad = courtPlan(SIDE.AD);
  assert.ok(Math.abs(ad.cx - pl.cx - 4) < 1e-9, 'the court slides 4 m for the ad side');
  assert.ok(Math.abs(netTopY(pl.cx, 1) - (FIELD.ground + COURT.netHeight)) < 1e-9, '0.914 m in the middle');
  // a low hard ball into the net, a good one over it
  const into = predictReturn(launchReturn([0, -0.3, -1], [0, 0.5, -25]), SIDE.DEUCE);
  assert.equal(into.result, 'net');
  const good = predictReturn(launchReturn([0, -0.2, -1], [-1.5, 4.5, -24], [-120, 0, 0]), SIDE.DEUCE);
  assert.equal(good.result, 'in');
  const long = predictReturn(launchReturn([0, -0.2, -1], [0, 9, -30]), SIDE.DEUCE);
  assert.equal(long.result, 'out');
  // a stepped return and the flown-ahead prediction agree
  const st = launchReturn([0, -0.2, -1], [-1.5, 4.5, -24], [-120, 0, 0]);
  while (!st.result && !st.rest) stepReturn(st, 1 / 72, SIDE.DEUCE);
  assert.equal(st.result, 'in');
});

test('timing: early out in front, perfect at the contact point, late when cramped', () => {
  assert.equal(timingOf(TIMING.idealZ).zone, 'perfect');
  assert.equal(timingOf(TIMING.idealZ - 0.3).zone, 'early');
  assert.equal(timingOf(TIMING.idealZ + 0.3).zone, 'late');
  assert.equal(timingOf(-5).off, -1);
});

test('a perfect return goes back deep, inside the lines, over the net, the way the player sent it; not off the frame or a block', () => {
  const hit = { frame: false, u: 0.2 };
  const perfect = timingOf(TIMING.idealZ);
  for (const side of [SIDE.DEUCE, SIDE.AD]) {
    for (const vx of [-6, 0, 6]) {
      const from = [0.2, -0.2, TIMING.idealZ];
      const r = perfectReturn([vx, 3, -22], perfect, hit, 15, from, side);
      assert.ok(r, 'qualifies');
      const p = predictReturn(launchReturn(from, r.v, r.w), side);
      assert.equal(p.result, 'in', `side ${side} vx ${vx}`);
      assert.ok(p.landing[1] < courtPlan(side).farZ + 3.5, 'deep');
      assert.ok(Math.hypot(...r.v) * 3.6 >= 110, 'fast');
    }
  }
  assert.ok(perfectReturn([6, 3, -22], perfect, hit, 15, [0, -0.2, -1], SIDE.DEUCE).v[0] > perfectReturn([-6, 3, -22], perfect, hit, 15, [0, -0.2, -1], SIDE.DEUCE).v[0], 'direction kept');
  assert.equal(perfectReturn([0, 3, -22], perfect, { frame: true, u: 0.2 }, 15, [0, 0, -1], 1), null, 'not off the frame');
  assert.equal(perfectReturn([0, 3, -22], perfect, hit, 3, [0, 0, -1], 1), null, 'not a block');
  assert.equal(perfectReturn([0, 3, -22], timingOf(TIMING.idealZ - 0.4), hit, 15, [0, 0, -1], 1), null, 'not early');
});

test('the call-out kind: winner, in, out, net, framed', () => {
  assert.equal(returnKind({ result: 'in' }, { perfect: true, v0: [0, 0, -20] }), 'winner');
  assert.equal(returnKind({ result: 'in' }, { perfect: false, v0: [0, 0, -20] }), 'in');
  assert.equal(returnKind({ result: 'in' }, { perfect: false, v0: [0, 0, -35] }), 'winner');
  assert.equal(returnKind({ result: 'out' }, { v0: [0, 0, -20] }), 'out');
  assert.equal(returnKind({ result: 'net' }, { frame: true, v0: [0, 0, -9] }), 'framed');
  assert.equal(returnKind({ result: null, rest: false }, {}), null);
});

test('after its arrival point the serve flies on its own path through the hitting zone, and never comes closer than about 40 cm to the eyes', () => {
  for (const s of SPEED_OPTIONS) {
    for (const lane of [-1, 0, 1]) {
      for (const side of [SIDE.DEUCE, SIDE.AD]) {
        const d = { lane, curve: 0.1, depth: 0, kmh: s.kmh, side };
        const dur = flightMs(0, s.kmh);
        const p1 = ballPosition(1, lane, 0.1, 0, s.kmh, side);
        const v1 = serveVelocity(1, d, dur);
        assert.ok(v1[2] > 10, 'still coming in fast');
        const st = startCarry(p1, v1);
        let minEye = Infinity;
        while (!st.rest) {
          const before = st.v.slice();
          stepCarry(st, 1 / 90);
          if (st.p[2] < CARRY.clearFromZ - 0.05) assert.ok(Math.abs(st.v[0] - before[0]) < 0.05, 'not turned in the hitting zone');
          if (st.p[2] > -0.4 && st.p[2] < 0.4) minEye = Math.min(minEye, Math.hypot(st.p[0], st.p[1], st.p[2]));
        }
        assert.ok(minEye >= 0.38, `passes ${minEye.toFixed(2)} m from the eyes`);
      }
    }
  }
});

// ------------------------------------------------------------------ the PC swing
test('PC swing: at contact the sweet spot is on the look line at the contact depth, the face square to the net', () => {
  for (const look of [[0, -0.2], [0.34, -0.1], [-0.34, -0.3]]) {
    const sgn = strokeFor(look[0]);
    const pose = racketPose(0, true, look, sgn);
    const s = sweetSpot(pose);
    assert.ok(Math.abs(s[0] - look[0]) < 1e-6 && Math.abs(s[1] - look[1]) < 1e-6 && Math.abs(s[2] - TIMING.idealZ) < 1e-6);
    const n = rotateQ(pose.q, [sgn > 0 ? -1 : 1, 0, 0]); // the face toward the net
    assert.ok(n[2] < -0.98, `face normal ${n}`);
  }
  assert.equal(strokeFor(0), 1, 'forehand down the middle');
  assert.equal(strokeFor(-0.34), -1, 'backhand on the left');
});

test('PC swing: the racket never jumps, on the take-back path, the ready path, either stroke, and between the two paths', () => {
  const look = [0.2, -0.2];
  for (const sgn of [1, -1]) {
    for (const armed of [true, false]) {
      let prev = null;
      let prevF = null;
      for (let th = SWING.BACK - 0.1; th <= SWING.RECOVER + 0.1; th += 0.005) {
        const p = racketPose(th, armed, look, sgn);
        const f = freeHandPose(th, armed, look, sgn);
        if (prev) {
          assert.ok(len(sub(sweetSpot(p), sweetSpot(prev))) < 0.03, `racket jump at th ${th.toFixed(3)} (${sgn}, ${armed})`);
          assert.ok(len(sub(f.p, prevF.p)) < 0.03, `free hand jump at th ${th.toFixed(3)}`);
        }
        prev = p;
        prevF = f;
      }
    }
    // where the paths switch (a full take-back arms it, the hitting zone disarms it) they are the same pose
    for (const th of [SWING.armBelow, SWING.zone0]) {
      const a = racketPose(th, true, look, sgn);
      const b = racketPose(th, false, look, sgn);
      assert.ok(len(sub(sweetSpot(a), sweetSpot(b))) < 0.03, `paths meet at ${th}`);
    }
  }
  // READY is the same pose before and after the recovery wrap
  assert.ok(len(sub(racketPose(SWING.READY, false, look, 1).p, racketPose(SWING.RECOVER, false, look, 1).p)) < 1e-9);
});

test('what the player sees: ready racket in the lower right, take-back and finish out of view, never in front of the face', () => {
  const look = [0.2, -0.2];
  const ready = sweetSpot(racketPose(SWING.READY, false, look, 1));
  assert.ok(ready[0] > 0.05 && ready[1] < 0 && ready[2] < -0.3, `ready ${ready}`);
  const back = sweetSpot(racketPose(SWING.BACK, true, look, 1));
  assert.ok(back[2] > -0.1, 'the take-back is beside / behind the player');
  for (let th = SWING.BACK; th <= SWING.RECOVER; th += 0.02) {
    for (const sgn of [1, -1]) {
      const p = racketPose(th, true, look, sgn);
      // the hand never comes within 30 cm of the eyes (the arm runs from it to the shoulder, so the arm stays clear too), and
      // the head never passes within 15 cm
      assert.ok(len(p.p) > 0.3, `hand at th ${th.toFixed(2)} is ${len(p.p).toFixed(2)} m from the eyes`);
      for (let z = RACKET.gripTopZ; z >= RACKET.headZ - RACKET.headA; z -= 0.02) assert.ok(len(racketToWorld(p, [0, 0, z])) > 0.15, `th ${th}`);
    }
  }
});

test('the arm: real bone lengths (ANSUR II means), never stretched, the elbow hanging down, the body under the head', () => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2000; i++) {
    const w = [rnd() * 1.6 - 0.8, rnd() * 1.4 - 0.9, rnd() * 1.4 - 1.2];
    for (const side of ['right', 'left']) {
      const s = solveArm(w, side);
      assert.ok(Math.abs(dist(w, s.elbow) - BODY.forearm) < 1e-6, 'forearm length');
      const up = dist(s.elbow, s.shoulder);
      if (s.outOfReach) assert.ok(up >= BODY.upper - 1e-3, 'out of reach: the shoulder is beyond the upper arm, which keeps its length');
      else assert.ok(Math.abs(up - BODY.upper) < 1e-6, 'upper arm length');
      const base = [(side === 'left' ? -1 : 1) * BODY.shoulderX, BODY.shoulderY, BODY.shoulderZ];
      if (dist(w, base) > BODY.upper - BODY.forearm + 0.01) assert.ok(dist(s.shoulder, base) <= BODY.lean + 1e-9, 'the shoulder leans at most 20 cm');
    }
  }
  // a hand held out at chest height in front: the elbow hangs below it, the arm bent
  const s = solveArm([0.25, -0.3, -0.4], 'right');
  assert.ok(s.elbow[1] < -0.35 && !s.outOfReach, `elbow ${s.elbow}`);
  // a hand out of anyone's reach: drawn straight at its real length, not pulled out into a pole
  const far = solveArm([0.2, -0.1, -1.4], 'right');
  assert.ok(far.outOfReach && Math.abs(dist([0.2, -0.1, -1.4], far.elbow) - BODY.forearm) < 1e-6);
  // the body stands under the head: crouch 20 cm and the shoulders come down 20 cm
  const crouch = solveArm([0.25, -0.5, -0.4], 'right', [0, -0.2, 0]);
  assert.ok(Math.abs(crouch.shoulder[1] - (BODY.shoulderY - 0.2)) < 0.02);
});

test('PC swing: the arm reaches every pose of the swing for balls out to either side, and the forearm never comes across the eyes', () => {
  const segDist = (a, b) => {
    // closest distance from the eyes (origin) to the segment a-b
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, -(a[0] * ab[0] + a[1] * ab[1] + a[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    return len([a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
  };
  for (let lx = -0.55; lx <= 0.8; lx += 0.05)
    for (const ly of [-0.2, 0, 0.1])
      for (const [look, sgn] of [1, -1].map((cur) => [[lx, ly], strokeFor(lx, cur)]))
      for (const armed of [true, false])
        for (let th = SWING.BACK; th <= SWING.RECOVER; th += 0.02) {
          const p = racketPose(th, armed, look, sgn);
          const s = solveArm(p.p, 'right');
          const at = `look ${look.map((v) => v.toFixed(2))} th ${th.toFixed(2)} (${sgn > 0 ? 'forehand' : 'backhand'})`;
          // a ball near the middle is out of a seated player's reach with this stroke: the arm is then drawn straight at its real\n          // length (never stretched); a ball out to the side is within reach\n          if (lx <= -0.3 || lx >= 0.4) assert.ok(!s.outOfReach, `in reach: ${at}`);
          assert.ok(segDist(p.p, s.elbow) > 0.2, `forearm clear of the eyes: ${at}`);
        }
});

// Full PC swings against real serves, as the game plays them (xr/mouse-racket.js, game.js tryRacket): the swing value is the
// game's PcSwing, the racket goes to where the serve crosses the contact depth, the hit test is the strings first and then the
// reach of a swing, and the return is the easy one.
function playServe(d, rollAt, dt = 1 / 72) {
  const dur = flightMs(d.depth, d.kmh);
  const T = dur / 1000;
  const meet = contactPoint(d, dur);
  const carry = startCarry(ballPosition(1, d.lane, d.curve, d.depth, d.kmh, d.side), serveVelocity(1, d, dur));
  const sw = new PcSwing();
  const key = {};
  let prev = null;
  let prevB = null;
  let rolled = false;
  let lock = null;
  for (let t = dt; t < T + 0.6; t += dt) {
    sw.setBall(key, meet.t - t, meet.speed);
    if (!rolled && t >= meet.t + rollAt) {
      rolled = true;
      sw.roll(2.25); // three notches forward
    }
    sw.step(dt);
    let b;
    let v;
    if (t <= T) {
      b = ballPosition(t / T, d.lane, d.curve, d.depth, d.kmh, d.side);
      v = serveVelocity(t / T, d, dur);
    } else {
      stepCarry(carry, dt);
      b = carry.p.slice();
      v = carry.v.slice();
    }
    const look = [meet.p[0], meet.p[1]];
    if (sw.th >= -0.15) lock ??= look;
    const lk = lock ?? look;
    const pose = racketPose(sw.th, sw.armed, lk, strokeFor(lk[0]));
    if (prev) {
      let c = sweepRacket(prev, pose, prevB, b, PHYS.ballRadius + 0.04);
      const sv = sub(racketToWorld(pose, [0, 0, RACKET.sweetZ]), racketToWorld(prev, [0, 0, RACKET.sweetZ])).map((x) => x / dt);
      if (!c) c = assistContact(prev, pose, prevB, b, ASSIST.reachPc, sv);
      if (c) {
        const loc = [0, c.local[1], c.local[2]];
        const rv = sub(racketToWorld(pose, loc), racketToWorld(prev, loc)).map((x) => x / dt);
        const res = racketBounce(v, rv, c);
        const timing = timingOf(c.ball[2]);
        const e = easyReturn(res.v, timing, c.ball, d.side);
        const outcome = predictReturn(launchReturn(c.ball, e.v, e.w), d.side).result;
        return { timing, perfect: e.perfect, outcome, kind: returnKind({ result: outcome }, { perfect: e.perfect, v0: e.v }) };
      }
    }
    prev = pose;
    prevB = b;
  }
  return null;
}

test('PC swing against every serve: any forward roll up to a second early meets the ball, it always lands in, on time is PERFECT', () => {
  for (const fps of [60, 72, 90]) {
    for (const side of [SIDE.DEUCE, SIDE.AD]) {
      for (const s of SPEED_OPTIONS) {
        for (const lane of [-1, 0, 1]) {
          for (const depth of [-1, 1]) {
            const d = { lane, curve: 0.08, depth, kmh: s.kmh, side };
            let onTime = 0;
            let perfect = 0;
            for (let off = -1.0; off <= -0.02; off += 0.07) {
              const r = playServe(d, off, 1 / fps);
              const at = `${s.id} lane ${lane} depth ${depth} side ${side} roll ${off.toFixed(2)} s @${fps}`;
              assert.ok(r, `meets the ball: ${at}`);
              assert.equal(r.outcome, 'in', `lands in: ${at}`);
              if (off > -DRIVE.perfectBuffer) {
                onTime += 1;
                if (r.perfect) perfect += 1;
              }
              if (r.perfect) assert.equal(r.kind, 'winner');
            }
            assert.ok(perfect / onTime >= 0.6, `on-time rolls are mostly PERFECT (${perfect}/${onTime}, ${s.id} ${lane} ${depth} ${side} @${fps})`);
          }
        }
      }
    }
  }
  // a roll long before the serve (during the toss) is a practice swing, not held for the ball; a roll in time is held
  const sw = new PcSwing();
  sw.setBall('a', 1.6, 25);
  sw.roll(2.25);
  assert.equal(sw.hold, null);
  assert.ok(sw.target > SWING.READY, 'it swings at once');
  const sw2 = new PcSwing();
  sw2.setBall('a', 0.4, 25);
  sw2.roll(2.25);
  assert.ok(sw2.hold && sw2.target === SWING.BACK, 'held in the take-back');
  sw2.setBall('b', 0.4, 25);
  assert.equal(sw2.hold, null, 'a new serve drops the hold');
});

test('the reach of a swing: a swinging racket meets a ball its sweet spot passes close to; a still racket, a take-back, or a far ball does not', () => {
  const pose = faceNet([0.3, -0.2, -0.55]);
  const sweet = racketToWorld(pose, [0, 0, RACKET.sweetZ]);
  const b0 = [sweet[0], sweet[1] + 0.24, sweet[2] - 0.2];
  const b1 = [sweet[0], sweet[1] + 0.24, sweet[2] + 0.2]; // 24 cm above the sweet spot: over the frame, the strings miss it
  assert.equal(sweepRacket(pose, pose, b0, b1, PHYS.ballRadius + 0.04), null);
  const c = assistContact(pose, pose, b0, b1, ASSIST.reach, [-6, 0, -6]);
  assert.ok(c && c.assisted && c.onStrings && c.u <= 0.5, 'a swing reaches it');
  assert.equal(assistContact(pose, pose, b0, b1, ASSIST.reach, [0, 0, -0.5]), null, 'a racket held still does not');
  assert.equal(assistContact(pose, pose, b0, b1, ASSIST.reach, [0, 0, 6]), null, 'a take-back does not');
  const far = [b0[0], b0[1] + 0.45, b0[2]];
  assert.equal(assistContact(pose, pose, far, [far[0], far[1], far[2] + 0.4], ASSIST.reach, [-6, 0, -6]), null, '70 cm away is out of reach');
  // the ball comes back off the face toward the server
  const res = racketBounce([0, 1, 25], [-6, 0, -6], c);
  assert.ok(res.v[2] < 0);
});

test('easy returns: whatever the racket did, a hit goes over the net and lands in; perfect is deep and fast, early and late go to the sides', () => {
  for (const side of [SIDE.DEUCE, SIDE.AD]) {
    for (const dz of [-0.9, -0.4, 0, 0.3, 0.8]) {
      const timing = timingOf(TIMING.idealZ + dz);
      for (const fx of [-0.6, 0, 0.7]) {
        for (const fy of [-0.7, -0.2, 0.2]) {
          for (const pv of [[0, 0, 0], [8, 2, 10], [-12, 6, -20], [10, -8, -30], [0, 20, -5]]) {
            const from = [fx, fy, TIMING.idealZ + dz];
            const r = easyReturn(pv, timing, from, side);
            const p = predictReturn(launchReturn(from, r.v, r.w), side);
            assert.equal(p.result, 'in', `side ${side} dz ${dz} from ${from} v ${pv}`);
            assert.equal(r.perfect, timing.zone === 'perfect');
            if (r.perfect) assert.ok(p.landing[1] < courtPlan(side).farZ + 3.5, 'perfect is deep');
          }
        }
      }
    }
  }
  const from = [0, -0.2, TIMING.idealZ];
  const early = easyReturn([0, 0, 0], timingOf(TIMING.idealZ - 0.45), from, SIDE.DEUCE);
  const late = easyReturn([0, 0, 0], timingOf(TIMING.idealZ + 0.45), from, SIDE.DEUCE);
  assert.ok(early.v[0] < 0 && late.v[0] > 0, 'early is pulled left, late pushed right');
  assert.ok(Math.hypot(...easyReturn([0, 0, -20], timingOf(TIMING.idealZ), from, SIDE.DEUCE).v) >= TIMING.winnerSpeed - 2, 'perfect is fast');
});

test('the serve reaches the contact point after its arrival point, where the PC racket goes', () => {
  for (const s of SPEED_OPTIONS) {
    const d = { lane: 1, curve: 0.08, depth: 0, kmh: s.kmh, side: SIDE.DEUCE };
    const dur = flightMs(0, s.kmh);
    const m = contactPoint(d, dur);
    assert.ok(Math.abs(m.p[2] - TIMING.idealZ) < 1e-3);
    assert.ok(m.t > dur / 1000 && m.t < dur / 1000 + 0.1, `${s.id} t ${m.t}`);
    assert.ok(m.speed > 10);
  }
  assert.ok(timeToContact(SWING.BACK) > timeToContact(SWING.READY) && timeToContact(SWING.BACK) < 0.1);
});


test('the eye score is untouched: the serve still arrives 1.2 m out, at the same moment', () => {
  const p = ballPosition(1, 0, 0, 0, 130, SIDE.DEUCE);
  assert.ok(Math.abs(p[2] - -1.2) < 1e-9);
  assert.ok(Math.abs(flightMs(0, 130) - 822) < 5);
});

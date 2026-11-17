// Batting physics: the bat meets the ball without letting it pass through, sends it away by the bat's own speed and direction,
// and the batted ball flies, bounces, rolls and reaches the rope like a real one. The eye-tracking score is not part of this.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BAT, GROUND_PLAN, HIT, batBounce, batToWorld, bladeContact, hapticFor, launch, restitutionAt, shotKind, stepBatted, sweepHit, worldToBat } from '../src/core/bat-physics.js';
import { FIELD, PHYS, ballPosition, flightMs, startRoll, stepRoll } from '../src/core/ball-path.js';

const len = (v) => Math.hypot(v[0], v[1], v[2]);
// A bat held out in front of the batsman, blade hanging straight down, face toward the bowler (-z). In the bat frame the blade
// runs along -Z and the face looks along -X, so: bat -Z -> scene -Y (down), bat -X -> scene -Z (toward the bowler).
// That is a rotation of +90 deg about Y (bat -X -> -Z... ) followed by tipping the blade down; built from a matrix below.
function quatFromBasis(xAxis, yAxis, zAxis) {
  const [m00, m10, m20] = xAxis;
  const [m01, m11, m21] = yAxis;
  const [m02, m12, m22] = zAxis;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return [x, y, z, w];
}
// bat X -> scene +Z (so the face, -X, looks at the bowler), bat Z -> scene +Y (so the blade, -Z, hangs down), bat Y -> scene X
const DOWN_FACING_BOWLER = quatFromBasis([0, 0, 1], [1, 0, 0], [0, 1, 0]);
const at = (p) => ({ p, q: DOWN_FACING_BOWLER });

// Hands at the arrival point's height, so the sweet spot is where the ball arrives.
function batAtArrival(lane = 0, length = 0, kmh = 85) {
  const end = ballPosition(1, lane, 0, length, kmh);
  return [end[0], end[1] - BAT.sweetZ, end[2]]; // blade hangs down: sweet spot 0.56 m below the hands
}

test('bat frame round-trips and the test pose hangs the blade down with the face to the bowler', () => {
  const pose = at([0.1, -0.2, -1]);
  const toe = batToWorld(pose, [0, 0, BAT.toeZ]);
  assert.ok(Math.abs(toe[1] - (-0.2 + BAT.toeZ)) < 1e-9, 'toe straight below the hands');
  const faceDir = batToWorld({ p: [0, 0, 0], q: pose.q }, [-1, 0, 0]);
  assert.ok(faceDir[2] < -0.99, 'face looks toward the bowler');
  const back = worldToBat(pose, toe);
  assert.ok(Math.abs(back[2] - BAT.toeZ) < 1e-9);
});

test('contact: a ball touching the face is a hit, a ball a few cm clear is not, the handle is not the blade', () => {
  assert.ok(bladeContact([-(BAT.halfDepth + PHYS.ballRadius - 0.002), 0, BAT.sweetZ]));
  assert.equal(bladeContact([-(BAT.halfDepth + PHYS.ballRadius + 0.01), 0, BAT.sweetZ]), null);
  assert.equal(bladeContact([0, 0, BAT.bladeTopZ + 0.1]), null);
  assert.equal(bladeContact([0, BAT.halfWidth + PHYS.ballRadius + 0.01, BAT.sweetZ]), null);
});

test('no tunnelling: a 140 km/h ball crossing the blade in one long frame is still caught by the swept test', () => {
  const pose = at(batAtArrival(0, 0, 140));
  const end = ballPosition(1, 0, 0, 0, 140);
  // one 50 ms frame: the ball covers ~1.9 m, starting well in front of the bat and ending well behind it
  const b0 = [end[0], end[1], end[2] - 1.0];
  const b1 = [end[0], end[1], end[2] + 0.9];
  const hit = sweepHit(pose, pose, b0, b1);
  assert.ok(hit, 'hit found');
  assert.ok(hit.s > 0 && hit.s < 1);
  assert.ok(hit.ball[2] < end[2], 'caught on the bowler side of the face');
});

test('no tunnelling: a fast swing through a slow ball in one frame is caught too', () => {
  const ball = [0, -0.6, -1.0];
  const hands = [0, ball[1] - BAT.sweetZ, ball[2]];
  const p0 = at([hands[0] - 0.6, hands[1], hands[2]]); // the blade sweeps sideways 1.2 m in one frame
  const p1 = at([hands[0] + 0.6, hands[1], hands[2]]);
  // the face looks at the bowler, so sweeping along x hits with the edge: still a contact
  assert.ok(sweepHit(p0, p1, ball, ball));
});

test('a ball that passes wide of the bat is not a hit', () => {
  const pose = at([0.5, 0, -1]);
  assert.equal(sweepHit(pose, pose, [-0.4, -0.6, -2.5], [-0.4, -0.6, 0.2]), null);
});

test('a dead bat blocks: the ball drops away slowly, back toward the bowler', () => {
  const pose = at(batAtArrival());
  const end = ballPosition(1, 0, 0, 0, 85);
  const hit = sweepHit(pose, pose, [end[0], end[1], end[2] - 0.4], [end[0], end[1], end[2] + 0.2]);
  const res = batBounce([0, 1.5, 21], [0, 0, 0], hit);
  assert.ok(res.v[2] < 0, 'goes back down the pitch');
  assert.ok(len(res.v) < 9, `soft (${len(res.v).toFixed(1)} m/s)`);
  assert.equal(shotKind(launch(hit.ball, res.v), res), 'block');
  assert.ok(res.sweet);
});

test('the bat speed and direction send the ball: a straight drive goes straight and fast, harder swing goes faster', () => {
  const pose = at(batAtArrival());
  const end = ballPosition(1, 0, 0, 0, 85);
  const hit = sweepHit(pose, pose, [end[0], end[1], end[2] - 0.4], [end[0], end[1], end[2] + 0.2]);
  const slow = batBounce([0, 1.5, 21], [0, 1, -8], hit);
  const fast = batBounce([0, 1.5, 21], [0, 1, -16], hit);
  assert.ok(fast.v[2] < slow.v[2], 'faster toward the bowler');
  assert.ok(len(fast.v) > 25 && len(fast.v) < 45, `drive ${len(fast.v).toFixed(1)} m/s`);
  // Swinging across the line (bat moving to the off side, +x) pulls the ball that way.
  const across = batBounce([0, 1.5, 21], [8, 1, -12], hit);
  assert.ok(across.v[0] > 3, 'ball follows the bat across');
});

test('the sweet spot is liveliest; the toe and the shoulder are dead', () => {
  assert.equal(restitutionAt(BAT.sweetZ), HIT.restitution);
  assert.ok(restitutionAt(BAT.toeZ) < 0.25);
  assert.ok(restitutionAt(BAT.bladeTopZ) < 0.25);
  assert.ok(restitutionAt(BAT.sweetZ + 0.1) < HIT.restitution);
});

test('an edge flies off sideways and is called as an edge', () => {
  const end = [0, -0.6, -1.2];
  const pose = at([end[0] - BAT.halfWidth * 0.95, end[1] - BAT.sweetZ, end[2]]); // the ball meets the outer 5% of the face
  const hit = sweepHit(pose, pose, [end[0], end[1], end[2] - 0.4], [end[0], end[1], end[2] + 0.1]);
  assert.ok(hit);
  const res = batBounce([0, 1, 21], [0, 0, -6], hit);
  assert.ok(res.edge);
  assert.ok(Math.abs(res.v[0]) > 2, 'deflected sideways');
  assert.equal(shotKind(launch(hit.ball, res.v), res), 'edge');
});

test('a mistracked swing is capped at a real bat speed', () => {
  const pose = at(batAtArrival());
  const end = ballPosition(1, 0, 0, 0, 85);
  const hit = sweepHit(pose, pose, [end[0], end[1], end[2] - 0.4], [end[0], end[1], end[2] + 0.2]);
  const wild = batBounce([0, 1.5, 21], [0, 0, -400], hit);
  const capped = batBounce([0, 1.5, 21], [0, 0, -HIT.maxBatSpeed], hit);
  assert.ok(Math.abs(len(wild.v) - len(capped.v)) < 1e-6);
});

function fly(v, p = [0, -0.6, -1.2], secs = 12) {
  const st = launch(p, v);
  for (let i = 0; i < secs * 72 && !st.rest; i++) stepBatted(st, 1 / 72);
  return st;
}

test('lofted straight drive at 30 m/s clears the rope: SIX', () => {
  const a = (40 * Math.PI) / 180;
  const st = fly([0, 30 * Math.sin(a), -30 * Math.cos(a)]);
  assert.equal(st.crossed, 'six');
  assert.equal(shotKind(st, { edge: false, v: [0, 0, -30] }), 'six');
});

test('a hard drive along the ground runs to the rope: FOUR', () => {
  const st = fly([6, 0.5, -26]);
  assert.equal(st.crossed, 'four');
  assert.ok(st.bounced);
});

test('a gentle push stops in the field, on the grass, and is not a boundary', () => {
  const st = fly([2, 2, -10]);
  assert.ok(st.rest);
  assert.equal(st.crossed, null);
  assert.ok(Math.abs(st.p[1] - (FIELD.ground + PHYS.ballRadius)) < 1e-6, 'resting on the ground');
  const r = Math.hypot(st.p[0] - GROUND_PLAN.centerX, st.p[2] - GROUND_PLAN.centerZ);
  assert.ok(r < GROUND_PLAN.ropeR);
});

test('the batted ball loses speed in the air (drag) like the bowled one', () => {
  const st = launch([0, 5, -1], [0, 0, -30]);
  stepBatted(st, 0.2);
  assert.ok(Math.abs(st.v[2]) < 30 && Math.abs(st.v[2]) > 25);
});

test('stepping is frame-rate independent', () => {
  const a = launch([0, -0.6, -1.2], [3, 8, -20]);
  const b = launch([0, -0.6, -1.2], [3, 8, -20]);
  for (let i = 0; i < 72; i++) stepBatted(a, 1 / 72);
  for (let i = 0; i < 120; i++) stepBatted(b, 1 / 120);
  assert.ok(len([a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]]) < 0.05);
});

test('haptics: a sweet hit is short, a toe or shoulder hit stings longer, an edge is a light tick', () => {
  const sweet = hapticFor({ edge: false, sweet: true, impact: 30 });
  const sting = hapticFor({ edge: false, sweet: false, impact: 30 });
  const edge = hapticFor({ edge: true, sweet: false, impact: 30 });
  assert.ok(sting.ms > sweet.ms && sting.intensity >= sweet.intensity);
  assert.ok(edge.intensity < sweet.intensity);
  for (const h of [sweet, sting, edge]) assert.ok(h.intensity > 0 && h.intensity <= 1);
});

test('cricket: after its arrival point a straight ball carries on straight (playable), and never toward the face', () => {
  for (const length of [-1, 0, 1]) {
    for (const kmh of [60, 85, 140]) {
      const posAt = (u) => ballPosition(u, 0, 0, length, kmh);
      const dur = flightMs(length, kmh);
      const roll = startRoll(posAt, dur, 0.5, true);
      const x0 = roll.p[0];
      let minFace = Infinity;
      let maxDrift = 0;
      for (let i = 0; i < 400 && roll.p[2] < 0.3; i++) {
        stepRoll(roll, 1 / 240);
        if (roll.p[2] < -0.3) maxDrift = Math.max(maxDrift, Math.abs(roll.p[0] - x0));
        minFace = Math.min(minFace, Math.hypot(roll.p[0], roll.p[1], roll.p[2]));
      }
      assert.ok(maxDrift < 0.1, `drift ${maxDrift.toFixed(2)} m (length ${length}, ${kmh} km/h)`);
      assert.ok(minFace >= 0.45, `passes ${minFace.toFixed(2)} m from the eyes`);
    }
  }
  // the other sports keep the sideways clearance
  const old = startRoll((u) => ballPosition(u, 0, 0, 0, 85), flightMs(0, 85));
  assert.ok(Math.abs(old.v[0]) > 0.1);
});

test('every delivery passes through the hitting zone in front of the body', () => {
  // The scored flight ends at the arrival point (or earlier for a full ball at pace, at the 25 degree floor); after that the same
  // ball carries on toward the batsman (startRoll). Somewhere on that path it must cross the zone a bat swung from the hands
  // reaches: 0.3 to 1.3 m in front of the eyes, between the knees and the chest, within 0.8 m to either side.
  const inZone = (p) => p[2] >= -1.3 && p[2] <= -0.3 && p[1] <= -0.1 && p[1] >= -1.15 && Math.abs(p[0]) <= 0.8;
  for (const lane of [-1, 0, 1]) {
    for (const length of [-1, 0, 1]) {
      for (const kmh of [60, 85, 115, 140]) {
        const dur = flightMs(length, kmh);
        let seen = false;
        for (let i = 0; i <= 200 && !seen; i++) seen = inZone(ballPosition(i / 200, lane, 0, length, kmh));
        const roll = startRoll((u) => ballPosition(u, lane, 0, length, kmh), dur, 0.5, true);
        for (let i = 0; i < 300 && !seen; i++) seen = inZone(stepRoll(roll, 1 / 240).p);
        assert.ok(seen, `lane ${lane} length ${length} ${kmh} km/h`);
      }
    }
  }
});

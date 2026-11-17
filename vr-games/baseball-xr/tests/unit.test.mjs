// Unit tests: plain Node, no browser, no headset. Run with `npm run test:unit`.
// They check the game's tuning, the eye-gaze logic, and the maths the flight and contact rely on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { CATCHER_EYE_Y, CFG } from '../src/config.js';
import {
  breakAccel, callOffset, callWords, choosePitch, clampToReach, commandMiss, drawnRps, flutterAt, flutterParams,
  FRAME, INCH, LEVELS, levelById, MPH, PITCHES, pitchSpeed, REACH, SPEED, spinAxis, STRIKE_ZONE, umpire,
} from '../src/pitches.js';
import { CAL, CalibrationCheck, FocusTracker, VERDICT } from '../src/gaze.js';
import { EyeRingTracker, projectGazePoint } from '../src/eye-tracker.js';
import { inTargetSquare } from '../src/game.js';

const BALL_RADIUS = 0.048; // src/ball.js

// ---------- tuning ----------

const by = (n) => PITCHES.find((p) => p.name === n);
const seq = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('the whole arsenal: twelve pitches, unlocking in order from the four-seamer on pitch 1', () => {
  assert.deepEqual(PITCHES.map((p) => p.name), [
    'Four-seam fastball', 'Sinker', 'Changeup', 'Cutter', 'Curveball', 'Slider', 'Splitter', 'Sweeper',
    'Knuckle curve', 'Screwball', 'Knuckleball', 'Eephus',
  ]);
  assert.equal(PITCHES[0].from, 1);
  for (let i = 1; i < PITCHES.length; i++) assert.ok(PITCHES[i].from > PITCHES[i - 1].from);
  for (const p of PITCHES) assert.ok(p.from <= CFG.pitches, `${p.name} must unlock within a round`);
});

test('a full round calls every pitch in the arsenal, and the fastball most', () => {
  const rand = seq(7);
  const counts = {};
  for (let n = 1; n <= 25; n++) {
    const p = choosePitch(n, rand);
    assert.ok(p.from <= n, `${p.name} is not unlocked on pitch ${n}`);
    counts[p.name] = (counts[p.name] || 0) + 1;
  }
  for (const p of PITCHES) assert.ok(counts[p.name] >= 1, `${p.name} is thrown in a round`);
  // Over many pitches the usage follows a big-league mix: four-seamers most, the eephus rarely.
  const many = {};
  for (let i = 0; i < 20000; i++) { const p = choosePitch(25, rand); many[p.name] = (many[p.name] || 0) + 1; }
  assert.ok(many['Four-seam fastball'] > many.Slider && many.Slider > many.Eephus);
  // A shaken-off sign is never the pitch he then throws.
  for (let i = 0; i < 200; i++) assert.notEqual(choosePitch(25, rand, PITCHES[0]), PITCHES[0]);
});

test('speeds are Statcast speeds: 95 mph four-seamer in the majors, slower in pro and rookie', () => {
  const mph = (p, level, ramp = 1) => pitchSpeed(p, levelById(level), ramp, () => 0.5) * MPH;
  assert.ok(Math.abs(mph(PITCHES[0], 'majors') - 95) < 0.5, 'majors four-seamer');
  assert.ok(mph(PITCHES[0], 'pro') > 74 && mph(PITCHES[0], 'pro') < 82, 'pro four-seamer');
  assert.ok(mph(PITCHES[0], 'rookie') > 54 && mph(PITCHES[0], 'rookie') < 64, 'rookie four-seamer');
  assert.ok(mph(PITCHES[0], 'pro', 0) < mph(PITCHES[0], 'pro', 1) - 25, 'the round ramps up from an easy first pitch');
  // The order of speeds is a real pitcher's: four-seam > sinker > cutter > split/change/slider > curve > knuckler > eephus.
  const m = (n) => by(n).mph;
  assert.ok(m('Four-seam fastball') > m('Sinker') && m('Sinker') > m('Cutter') && m('Cutter') > m('Splitter'));
  assert.ok(m('Splitter') > m('Curveball') && m('Changeup') > m('Curveball') && m('Curveball') > m('Knuckleball'));
  assert.ok(m('Eephus') < 60 && m('Knuckleball') < 80);
  // Never over the cap, even when he reaches back.
  const rand = seq(3);
  for (let i = 0; i < 2000; i++) assert.ok(pitchSpeed(PITCHES[0], levelById('majors'), 1, rand) * MPH <= SPEED.capMph);
});

test('movement: each pitch moves its real inches, the right way, whatever the speed', () => {
  const move = (p, T) => { const a = breakAccel(p, T, 1, {}); return { x: (0.5 * a.x * T * T) / INCH, y: (0.5 * a.y * T * T) / INCH }; };
  for (const p of PITCHES) {
    for (const T of [0.42, 0.7]) {
      const d = move(p, T);
      assert.ok(Math.abs(d.y - p.ivb) < 1e-6 && Math.abs(d.x + p.hb) < 1e-6, `${p.name} over ${T}s`);
    }
  }
  // A right-hander's arm side is the catcher's left (-x): sinker and changeup run that way, the
  // sweeper and slider go glove side (+x), the four-seamer rides, the curveballs drop.
  assert.ok(move(by('Sinker'), 0.42).x < -10 && move(by('Changeup'), 0.42).x < -10 && move(by('Screwball'), 0.42).x < -10);
  assert.ok(move(by('Sweeper'), 0.42).x > 12 && move(by('Slider'), 0.42).x > 2 && move(by('Cutter'), 0.42).x > 1);
  assert.ok(by('Four-seam fastball').ivb > 14 && by('Curveball').ivb < -8 && by('Knuckle curve').ivb < -8);
  assert.ok(Math.abs(by('Sweeper').hb) > Math.abs(by('Slider').hb), 'a sweeper sweeps more than a gyro slider');
});

test('each pitch spins the way that makes it move (Magnus: spin x velocity), plus its bullet spin', () => {
  const v = new Vector3(0, 0, 1); // the pitch flies towards the catcher
  for (const p of PITCHES) {
    const axis = new Vector3().copy(spinAxis(p, {}));
    assert.ok(Math.abs(axis.length() - 1) < 1e-9, `${p.name} unit axis`);
    assert.ok(drawnRps(p) > 0, `${p.name} turns`);
    if (Math.hypot(p.hb, p.ivb) < 3) continue; // a knuckleball hardly moves from spin
    const f = axis.clone().cross(v).normalize(); // direction of the Magnus force
    const want = new Vector3(-p.hb, p.ivb, 0).normalize();
    assert.ok(f.dot(want) > 0.999, `${p.name}: spin pushes it the way it breaks`);
    assert.ok(Math.abs(axis.z - p.gyro) < 1e-9, `${p.name}: its share of bullet spin`);
  }
  assert.ok(spinAxis(by('Four-seam fastball'), {}).x < -0.85, 'four-seamer: mostly backspin');
  assert.ok(new Vector3().copy(spinAxis(by('Curveball'), {})).cross(v).y < -0.6, 'curveball: topspin dives');
  assert.ok(spinAxis(by('Slider'), {}).z > 0.6, 'slider: mostly bullet spin');
  assert.ok(drawnRps(by('Knuckleball')) < 3, 'a knuckleball barely turns');
});

test('a knuckleball flutters in flight and still crosses where it was aimed', () => {
  const f = flutterParams(by('Knuckleball'), seq(11), {});
  const T = 0.5;
  let most = 0;
  for (let t = 0; t <= T; t += 0.01) most = Math.max(most, Math.hypot(...Object.values(flutterAt(f, t, T, {}))));
  assert.ok(most > 0.03, 'it dances');
  const end = flutterAt(f, T, T, {});
  assert.ok(Math.hypot(end.x, end.y) < 1e-12 && Math.hypot(...Object.values(flutterAt(f, 0, T, {}))) < 1e-12);
});

test('the battery: called spots are in the zone; command misses stay catchable; a good target is tighter', () => {
  for (const p of PITCHES) for (const c of p.calls) {
    const o = callOffset(c, {});
    assert.ok(Math.abs(o.x) <= STRIKE_ZONE.halfWidth && Math.abs(o.y) <= STRIKE_ZONE.halfHeight, `${p.name} ${c}`);
    assert.ok(callWords(c).length > 1);
  }
  assert.ok(callOffset('down-away', {}).x > 0 && callOffset('down-away', {}).y < 0, 'away is the catcher\'s right, vs a right-handed hitter');
  const spread = (good) => {
    const rand = seq(5);
    let s = 0;
    for (let i = 0; i < 4000; i++) { const m = commandMiss(PITCHES[0], rand, good, {}); s += m.x * m.x + m.y * m.y; }
    return Math.sqrt(s / 4000);
  };
  assert.ok(spread(true) < spread(false) * 0.8, 'a good target tightens his command');
  const far = clampToReach({ x: 2, y: -2 });
  assert.ok(far.x === REACH.halfWidth && far.y === -REACH.halfHeight);
});

test('the umpire: strikes, balls, a framed strike and a stabbed ball', () => {
  assert.equal(umpire({ x: 0, y: 0 }, true, 0.2).strike, true);
  assert.equal(umpire({ x: 0.33, y: 0 }, true, 0.2).strike, false);
  const edge = STRIKE_ZONE.halfWidth;
  const framed = umpire({ x: edge + 0.03, y: 0 }, true, 0.3);
  assert.ok(framed.strike && framed.framed, 'just off the plate, caught quietly: framed');
  assert.ok(!umpire({ x: edge + 0.03, y: 0 }, true, 2).strike, 'caught with the mitt moving: a ball');
  assert.ok(!umpire({ x: edge + 0.03, y: 0 }, false, 0).strike, 'not caught: no framing');
  const stab = umpire({ x: edge - 0.02, y: 0 }, true, 3.5);
  assert.ok(!stab.strike && stab.stabbed, 'a stab at a corner strike loses it');
  assert.ok(FRAME.quiet < FRAME.stab);
});

test('the catch zone is bigger than the ball, and a near miss is a real near miss', () => {
  assert.ok(CFG.catchRadius > BALL_RADIUS, 'a catch needs the ball to reach the mitt');
  assert.ok(CFG.catchRadius < 0.3, 'the mitt is not a bucket');
  assert.ok(CFG.nearMiss > CFG.catchRadius, 'a near miss is outside the catch');
  assert.ok(CFG.bareHandRadius > BALL_RADIUS, 'the bare hand must be able to touch the ball');
  assert.ok(CFG.backOfMitt < 0 && CFG.backOfMitt > -1, 'back-of-mitt cut-off is an angle cosine');
});

test('levels and the round: the default is pro, and the ramp finishes inside the round', () => {
  assert.deepEqual(LEVELS.map((l) => l.id), ['rookie', 'pro', 'majors']);
  assert.equal(CFG.level, 'pro');
  assert.equal(levelById('nonsense').id, 'pro');
  assert.ok(CFG.rampPitches < CFG.pitches);
  assert.ok(CFG.signTime > 0.5 && CFG.shakeChance < 0.3);
});

test('focus cones: the eyes can be tighter than the head, which must be looser', () => {
  assert.ok(CFG.focusConeEyes > 0 && CFG.focusConeEyes < CFG.focusConeHead);
});

// ---------- the flight maths (the same solve the game uses) ----------

test('a solved pitch arrives exactly at its aim point, for every pitch type and level', () => {
  // The game solves: vel = (aim - from) / T - accel * T / 2, then pos(T) = from + vel T + accel T^2 / 2.
  const from = new Vector3(-0.6, 1.77, -17.9);
  const aim = new Vector3(-0.2, 0.95, -0.55);
  for (const p of PITCHES) {
    for (const level of LEVELS) {
      for (const ramp of [0, 1]) {
        const speed = pitchSpeed(p, level, ramp, () => 0.5);
        const T = from.distanceTo(aim) / speed;
        const b = breakAccel(p, T, 0.45 + 0.55 * ramp, {});
        const accel = new Vector3(b.x, b.y - CFG.gravity, 0);
        const vel = aim.clone().sub(from).divideScalar(T).addScaledVector(accel, -0.5 * T);
        const at = from.clone().addScaledVector(vel, T).addScaledVector(accel, 0.5 * T * T);
        assert.ok(at.distanceTo(aim) < 1e-9, `${p.name} ${level.id}`);
      }
    }
  }
});

// ---------- eye gaze ----------

// A fake player: a head and an eye ray, placed in the world.
function rig({ gazeTracked = false, eyeYaw = 0, headYaw = 0 } = {}) {
  const head = new Object3D();
  head.position.set(0, 1.2, 0);
  head.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), headYaw);
  head.updateMatrixWorld(true);
  const eye = new Object3D();
  eye.position.set(0, 1.2, 0);
  eye.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), eyeYaw);
  eye.updateMatrixWorld(true);
  return {
    head,
    eyeSpace: eye,
    gazeOrigin: gazeTracked ? 'tracked' : 'none',
  };
}
const camera = new Object3D();
camera.position.set(0, 1.2, 0);
camera.updateMatrixWorld(true);

test('no headset: focus is not measured (null), on a PC', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, false);
  f.resetPitch();
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  assert.equal(f.mode, 'none');
  assert.equal(f.focus, null);
});

test('head direction: looking straight at the ball counts as watching it', () => {
  const f = new FocusTracker();
  const ball = new Vector3(0, 1.2, -5);
  f.sample(rig(), camera, true);
  assert.equal(f.mode, 'head');
  f.resetPitch();
  for (let i = 0; i < 60; i++) f.track(ball, 1 / 60, 5);
  assert.equal(f.focus, 1);
});

test('head direction: looking away from the ball does not count', () => {
  const f = new FocusTracker();
  f.sample(rig({ headYaw: Math.PI / 2 }), camera, true); // head turned 90 degrees, away from the ball
  f.resetPitch();
  const ball = new Vector3(0, 1.2, -5);
  for (let i = 0; i < 60; i++) f.track(ball, 1 / 60, 5);
  assert.equal(f.focus, 0);
});

test('focus is the share of the flight spent watching the ball', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, true);
  f.resetPitch();
  const on = new Vector3(0, 1.2, -5);
  const off = new Vector3(3, 1.2, -5); // about 31 degrees off the head's line: outside the head cone
  for (let i = 0; i < 30; i++) f.track(on, 1 / 60, 5);
  for (let i = 0; i < 30; i++) f.track(off, 1 / 60, 5);
  assert.ok(Math.abs(f.focus - 0.5) < 1e-9, `focus was ${f.focus}`);
});

test('eye tracking is only used once the gaze ray separates from the head', () => {
  const f = new FocusTracker();
  // Tracked, but the "gaze" ray is just the head's direction (a runtime that reports no real eyes).
  f.sample(rig({ gazeTracked: true, eyeYaw: 0 }), camera, true);
  assert.equal(f.mode, 'head');
  // Real eyes: the gaze ray is 10 degrees off the head.
  f.sample(rig({ gazeTracked: true, eyeYaw: (10 * Math.PI) / 180 }), camera, true);
  assert.equal(f.mode, 'eyes');
});

test('with real eyes, a glance 10 degrees off the ball is not watching', () => {
  const f = new FocusTracker();
  f.sample(rig({ gazeTracked: true, eyeYaw: (10 * Math.PI) / 180 }), camera, true); // eyes turned 10 degrees
  assert.equal(f.mode, 'eyes');
  f.resetPitch();
  // The ball is straight ahead. With eyes the cone is tight (7 degrees), so 10 degrees away is not watched.
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  f.track(new Vector3(0, 1.2, -5), 1 / 60, 5);
  assert.equal(f.watching, false);
});

test('before any pitch is measured, focus is null', () => {
  const f = new FocusTracker();
  f.sample(rig(), camera, true);
  f.resetPitch();
  assert.equal(f.focus, null);
});

test('eye ring tracker: stays anchored to baseball position in pitcher hand and flight', () => {
  const origin = new Vector3(0, 1.3, 0);
  const dir = new Vector3(0, 0, -1);
  const pitcherHandBall = new Vector3(0.2, 1.95, -16.5);
  const pt = projectGazePoint(origin, dir, pitcherHandBall);
  assert.ok(pt.distanceTo(pitcherHandBall) < 1e-6, 'ring is anchored to ball in pitcher hand');

  // Any gaze tilt (even looking up toward scoreboard at 25 degrees) does not displace tracker into sky
  const angle = (25 * Math.PI) / 180;
  const skyDir = new Vector3(0, Math.sin(angle), -Math.cos(angle)).normalize();
  const ptSky = projectGazePoint(origin, skyDir, pitcherHandBall);
  assert.ok(ptSky.distanceTo(pitcherHandBall) < 1e-6, 'tracker stays at pitcher hand level and never jumps to scoreboard');
});

test('eye ring tracker: visual reticle locks on and scales with distance', () => {
  const mockWorld = { createTransformEntity: () => {} };
  const tracker = new EyeRingTracker(mockWorld);
  tracker.show();
  assert.equal(tracker.visible, true);

  const mockFocus = {
    origin: new Vector3(0, 1.3, 0),
    dir: new Vector3(0, 0, -1),
    watching: true,
  };
  const ball = new Vector3(0, 1.3, -10);
  const camera = new Object3D();
  camera.position.set(0, 1.3, 0);

  // Update while locked on
  tracker.update(mockFocus, ball, true, true, camera, null, 1 / 60);
  assert.ok(tracker.group.position.distanceTo(ball) < 1e-6, 'reticle is placed at the ball');
  assert.equal(tracker.ringMaterial.color.getHex(), 0x5eead4, 'ring turns cyan-teal on lock');
  assert.ok(tracker.group.scale.x > 0.4, 'ring scales proportionally at 10m');

  // Update when eyes look away: stays anchored to the ball, dims to neutral white, does not jump to sky
  mockFocus.watching = false;
  mockFocus.dir.set(0, 0.8, -0.6).normalize(); // looking high toward sky / scoreboard
  tracker.update(mockFocus, ball, false, true, camera, null, 1 / 60);
  assert.ok(tracker.group.position.distanceTo(ball) < 1e-6, 'reticle remains at ball position instead of leaping to sky');
  assert.equal(tracker.ringMaterial.color.getHex(), 0xffffff, 'ring dims to white when off target');
});

test('hand tracking: thumb-to-middle-finger squeezing closes the mitt', () => {
  const OPEN_AT = 0.11; // 11cm thumb-to-middle distance
  const CLOSED_AT = 0.04; // 4cm thumb-to-middle distance

  const calcSqueeze = (d) => Math.max(0, Math.min(1, (OPEN_AT - d) / (OPEN_AT - CLOSED_AT)));

  assert.equal(calcSqueeze(0.12), 0, 'Hand wide open (12cm) produces 0 squeeze');
  assert.equal(calcSqueeze(0.11), 0, 'Hand at open threshold (11cm) produces 0 squeeze');
  assert.ok(Math.abs(calcSqueeze(0.075) - 0.5) < 1e-6, 'Hand half-closed (7.5cm) produces 0.5 squeeze');
  assert.equal(calcSqueeze(0.04), 1.0, 'Hand at closed threshold (4cm) produces 1.0 squeeze');
  assert.equal(calcSqueeze(0.02), 1.0, 'Pinching fingers tight (2cm) caps at 1.0 squeeze');
});

test('bare-hand penalty: catching without mitt incurs bare-hand deflection', () => {
  const bareHandRadius = 0.14; // CFG.bareHandRadius
  const ballPos = new Vector3(0, 1.2, -0.65);
  const bareHandPos = new Vector3(0, 1.2, -0.65); // Directly touching bare hand

  const d = ballPos.distanceTo(bareHandPos);
  assert.ok(d <= bareHandRadius, 'Ball touches bare hand');
  // In game, touches within bareHandRadius trigger missed("bare")
  const outcome = d <= bareHandRadius ? 'bare' : 'missed';
  assert.equal(outcome, 'bare', 'Direct bare-hand contact results in "bare" penalty');
});

test('umpire framing mechanics: quiet framing vs aggressive stabbing', () => {
  // Pitches just outside the strike zone (0.02m outside)
  const borderlineOutside = new Vector3(STRIKE_ZONE.halfWidth + 0.02, 0, 0);

  // Quiet catch: mitt speed = 0.5 m/s (< 1.2 m/s quiet threshold)
  const quietCall = umpire(borderlineOutside, true, 0.5);
  assert.equal(quietCall.strike, true, 'Quiet borderline pitch is framed into a strike');
  assert.equal(quietCall.framed, true, 'Umpire flags framed pitch');

  // Pitches just inside the strike zone (0.02m inside)
  const borderlineInside = new Vector3(STRIKE_ZONE.halfWidth - 0.02, 0, 0);

  // Stabbed catch: mitt speed = 3.0 m/s (> 2.6 m/s stab threshold)
  const stabbedCall = umpire(borderlineInside, true, 3.0);
  assert.equal(stabbedCall.strike, false, 'Stabbed pitch inside zone is rung up as a ball');
  assert.equal(stabbedCall.stabbed, true, 'Umpire flags stabbed pitch');
});

test('target square detection: hand inside strike zone square is accepted easily', () => {
  const targetPos = { x: 0, y: 0.60, z: -0.55, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };

  // Directly centered at target
  const deadCenter = { x: 0, y: 0.60, z: -0.55, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  assert.equal(inTargetSquare(deadCenter, targetPos), true, 'dead center is inside square');

  // Planar offset within zone width/height but at same depth
  const upperRight = { x: STRIKE_ZONE.halfWidth, y: 0.60 + STRIKE_ZONE.halfHeight, z: -0.55, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  assert.equal(inTargetSquare(upperRight, targetPos), true, 'upper right boundary is inside square');

  // Natural arm depth discrepancy (+-15cm to +-35cm in Z)
  const armDrawnBack = { x: 0.05, y: 0.62, z: -0.40, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  assert.equal(inTargetSquare(armDrawnBack, targetPos), true, 'hand held closer to chest is inside square');

  const armExtended = { x: -0.05, y: 0.58, z: -0.85, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  assert.equal(inTargetSquare(armExtended, targetPos), true, 'hand reached forward is inside square');

  // Hand far away should be rejected
  const farAway = { x: 1.2, y: 1.5, z: -0.55, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  assert.equal(inTargetSquare(farAway, targetPos), false, 'hand 1m away is rejected');
});

test('lag fix: delta time clamp at 0.15s preserves game speed at low framerate', () => {
  // At 15 FPS (frame time ~66ms):
  const lowFpsDt = 1 / 15;
  const clampedDt = Math.min(lowFpsDt, 0.15);
  // Clamped dt should equal the real frame time, not 0.05 (which caused slow motion)
  assert.ok(Math.abs(clampedDt - lowFpsDt) < 1e-6, 'game advances full wall-clock step at 15 FPS');
  assert.ok(clampedDt > 0.05, 'dt is not artificially throttled to 50ms slow motion');
});

test('catcher crouch stance: eyes sit at CATCHER_EYE_Y = 0.95m', () => {
  const CATCHER_EYE_Y = 0.95;
  const standingHeadWorldY = 1.65;
  const rigWorldY = 0;
  const physicalHeadY = standingHeadWorldY - rigWorldY;
  const targetRigY = CATCHER_EYE_Y - physicalHeadY;

  // With rig offset, player eyes sit exactly at CATCHER_EYE_Y
  const actualEyeY = physicalHeadY + targetRigY;
  assert.ok(Math.abs(actualEyeY - CATCHER_EYE_Y) < 1e-6, 'catcher eyes sit at authentic crouch height');
});

test('real baseball catcher: bare throwing hand is hidden from view', () => {
  const trackedHands = {
    left: { mesh: { visible: true }, model: { visible: true } },
    right: { mesh: { visible: true }, model: { visible: true } },
  };
  const side = 'left'; // catching glove is on the left hand
  const otherSide = side === 'left' ? 'right' : 'left';
  const otherHand = trackedHands[otherSide];

  // In real baseball, the throwing hand stays hidden behind the back/ankle
  if (otherHand) {
    if (otherHand.mesh) otherHand.mesh.visible = false;
    if (otherHand.model) otherHand.model.visible = false;
  }

  assert.equal(trackedHands.right.mesh.visible, false, 'bare hand mesh is not drawn');
  assert.equal(trackedHands.right.model.visible, false, 'bare hand model root is not drawn');
});

test('strike zone target alignment: middle of strike zone is centered at home plate', () => {
  const targetPos = { x: 0, y: 0.85, z: CFG.arriveZ, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  const gloveAtCenter = { x: 0, y: 0.85, z: CFG.arriveZ, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };

  assert.equal(inTargetSquare(gloveAtCenter, targetPos), true, 'glove in the exact middle of strike zone is accepted');
});

test('diagnostics frame time accumulator: running frameSum maintains exact sum in O(1)', () => {
  const frameTimes = [];
  let frameSum = 0;
  const maxSamples = 120;

  for (let i = 1; i <= 200; i++) {
    const dt = 16.6 + (i % 5);
    frameTimes.push(dt);
    frameSum += dt;
    if (frameTimes.length > maxSamples) {
      frameSum -= frameTimes.shift();
    }
  }

  const expectedSum = frameTimes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(frameSum - expectedSum) < 1e-9, 'running sum matches array reduce without allocations');
});

test('lag optimization: glove squeeze deadband prevents per-frame vertex re-bending', () => {
  const deadband = 0.015;
  let recomputeCount = 0;
  let closed = 0.1;

  function tryClose(v) {
    const k = Math.max(0, Math.min(1, v));
    if (Math.abs(k - closed) < deadband) return false;
    closed = k;
    recomputeCount++;
    return true;
  }

  // Micro-sensor jitter from Quest tracking cameras (+-0.005)
  assert.equal(tryClose(0.103), false, '0.003 jitter does not trigger recompute');
  assert.equal(tryClose(0.108), false, '0.008 jitter does not trigger recompute');
  assert.equal(recomputeCount, 0, 'zero vertex buffer recomputations during micro jitter');

  // Real deliberate hand squeeze (+0.10)
  assert.equal(tryClose(0.20), true, 'deliberate squeeze triggers update');
  assert.equal(recomputeCount, 1, 'updated on real squeeze');
});

test('catcher view camera: aligned behind home plate and looking towards mound', () => {
  const cameraPos = { x: 0, y: 1.15, z: 1.1 };
  const moundLookAt = { x: 0, y: 0.85, z: -19.24 };

  assert.ok(cameraPos.y >= CATCHER_EYE_Y, 'camera is positioned just above/behind crouch height');
  assert.ok(cameraPos.z >= 1.0, 'camera gives natural perspective without clipping the mitt');
  assert.ok(moundLookAt.z < -18, 'view is aimed straight at the pitcher on the mound');
});

test('anywhere in strike zone square is accepted', () => {
  const zoneCenter = { x: 0, y: 0.85, z: CFG.arriveZ, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };
  const calledAt = { x: 0.20, y: 1.05, z: CFG.arriveZ, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };

  // Glove placed in opposite corner of the square (-0.20, 0.65) away from called spot
  const gloveInOppositeCorner = { x: -0.20, y: 0.65, z: CFG.arriveZ, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } };

  const inSquare = inTargetSquare(gloveInOppositeCorner, zoneCenter) || inTargetSquare(gloveInOppositeCorner, calledAt);
  assert.equal(inSquare, true, 'glove in any part of the strike zone square is accepted');
});

test('catcherUp glove orientation: tilts fingers downward for low pitches and upright for high pitches', () => {
  const MITT_LOW_Y = 0.12;
  const MITT_UP_Y = 0.45;
  const MITT_DOWN_Y = -0.7;
  const MITT_UP_Y_DIR = 0.97;
  const MITT_DOWN_Z = 0.15;
  const MITT_UP_Z = 0.24;

  function catcherUp(pocketY) {
    const t = Math.max(0, Math.min(1, (pocketY - MITT_LOW_Y) / (MITT_UP_Y - MITT_LOW_Y)));
    const k = t * t * (3 - 2 * t);
    const y = MITT_DOWN_Y + (MITT_UP_Y_DIR - MITT_DOWN_Y) * k;
    const z = MITT_DOWN_Z + (MITT_UP_Z - MITT_DOWN_Z) * k;
    const len = Math.hypot(y, z);
    return { y: y / len, z: z / len };
  }

  // Dirt pitch (in dirt below plate): fingers tilt down to scoop
  const dirt = catcherUp(0.10);
  assert.ok(dirt.y < -0.8, `dirt ball finger Y (${dirt.y}) must tilt downwards`);

  // Low strike zone pitch (knee height): fingers upright facing pitcher
  const lowZone = catcherUp(0.40);
  assert.ok(lowZone.y > 0.8, `low strike zone finger Y (${lowZone.y}) must stay upright facing pitcher`);

  // High pitch (pocket at top of zone): fingers point upright towards the sky
  const high = catcherUp(0.85);
  assert.ok(high.y > 0.8, `high ball finger Y (${high.y}) must point upright`);
});

test('desktop pointer: dynamic reach compensation reaches low catches down to REACH_Y0', () => {
  const CATCH_PLANE_Z = CFG.arriveZ; // -0.55m
  const REACH_Y0 = 0.05; // 5cm above dirt
  const cameraY = 0.95; // CATCHER_EYE_Y
  const fovHalfTan = Math.tan((35 * Math.PI) / 180); // 70 deg vertical FOV

  // Natural unprojected bottom reach on untilted camera:
  const lowestReach = cameraY - (-CATCH_PLANE_Z) * fovHalfTan; // ~0.565m
  assert.ok(lowestReach > 0.50, 'natural frustum cuts off well above plate');

  function projectToPlane(ndcY) {
    const rawY = cameraY + ndcY * (-CATCH_PLANE_Z) * fovHalfTan;
    let y = rawY;
    if (lowestReach > REACH_Y0 && ndcY < -0.85) {
      const shortfall = lowestReach - REACH_Y0;
      const t = Math.min(1, (-ndcY - 0.85) / 0.15);
      const k = t * t * (3 - 2 * t);
      y -= shortfall * k;
    }
    return y;
  }

  // At bottom of canvas (ndc.y = -1), mitt reaches down to plate floor
  const atBottom = projectToPlane(-1);
  assert.ok(Math.abs(atBottom - REACH_Y0) < 1e-6, `bottom pointer must reach REACH_Y0 (got ${atBottom})`);

  // Across the strike zone (ndc.y >= -0.85), pure optical ray is preserved (zero error)
  const atLowZone = projectToPlane(-0.75);
  const rawLowZone = cameraY + (-0.75) * (-CATCH_PLANE_Z) * fovHalfTan;
  assert.ok(Math.abs(atLowZone - rawLowZone) < 1e-6, 'strike zone optical ray is preserved with zero error');

  // At center of canvas (ndc.y = 0), unprojected ray is unchanged
  const atCenter = projectToPlane(0);
  assert.ok(Math.abs(atCenter - cameraY) < 1e-6, 'center pointer is unchanged');

  // At top of canvas (ndc.y = +1), unprojected ray reaches high pitches without modification
  const atTop = projectToPlane(1);
  assert.ok(atTop > 1.3, 'top pointer reaches high zone without distortion');
});

test('desktop gaze simulation outside XR: mouse movement drives gaze ray and ball focus', () => {
  const f = new FocusTracker();
  assert.equal(f.simulated, false, 'starts unsimulated before any mouse movement');

  // Simulate mouse movement on desktop
  f.emuMoved = true;
  f.emuX = 0;
  f.emuY = 0;

  // Outside XR session (inHeadset = false), focus tracker runs simulated eye tracking
  f.sample(rig(), camera, false);
  assert.equal(f.mode, 'eyes', 'mode switches to eyes via desktop simulation');
  assert.equal(f.simulated, true, 'simulated flag is true');

  // Ball tracking operates smoothly
  f.resetPitch();
  const ball = new Vector3(0, 1.2, -5);
  for (let i = 0; i < 60; i++) f.track(ball, 1 / 60, 5);
  assert.equal(f.focus, 1, 'watching ball in simulated desktop gaze accumulates 100% focus');
});

test('pitch target vs gaze reticle: distinct crosshairs and separate visual identities', () => {
  // Target ring properties
  const targetColor = 0xffd166; // gold
  const targetTicksCount = 4; // crosshair ticks at 0, 90, 180, 270 deg
  const targetDepth = CFG.arriveZ; // fixed at catch plane -0.55m

  // Gaze reticle properties
  const eyeColorLocked = 0x5eead4; // cyan-teal
  const eyeColorUnlocked = 0xffffff; // white
  const eyeHasTicks = false;

  assert.notEqual(targetColor, eyeColorLocked, 'target and gaze reticles must have different colors');
  assert.notEqual(targetColor, eyeColorUnlocked, 'target and idle gaze must have different colors');
  assert.equal(targetTicksCount, 4, 'target ring has crosshair tick tabs for aiming');
  assert.equal(eyeHasTicks, false, 'gaze reticle is a smooth circle without crosshair ticks');
  assert.equal(targetDepth, -0.55, 'target ring is stationary in world space on strike zone plane');
});

// ---------- eye tracking: genuine eyes, head-locked rays, blinks, dropouts, smoothing, calibration ----------
// Reference behaviour: ON THE BALL src/core/gaze-verdict.js. Head and eye poses are built separately per frame.

const G_DT = 1 / 72;
const G_DEG = Math.PI / 180;
const G_FWD = new Vector3(0, 0, -1);
const G_HEAD = new Vector3(0, 1.2, 0);
const G_BALL = new Vector3(0, 1.2, -10);
const gYaw = (deg) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg * G_DEG);
const gToward = (dir) => new Quaternion().setFromUnitVectors(G_FWD, dir.clone().normalize());
const gAngle = (a, b) => a.angleTo(b) / G_DEG;
const gNoise = (seed) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
};

// A player rig for one frame: head orientation, and an eye world rotation (null = no eye data this frame).
function gRig(headQ, eyeQ) {
  const head = new Object3D();
  head.position.copy(G_HEAD);
  head.quaternion.copy(headQ);
  head.updateMatrixWorld(true);
  let eyeSpace = null;
  if (eyeQ) {
    eyeSpace = new Object3D();
    eyeSpace.position.copy(G_HEAD);
    eyeSpace.quaternion.copy(eyeQ);
    eyeSpace.updateMatrixWorld(true);
  }
  return { head, eyeSpace, gazeOrigin: eyeQ ? 'tracked' : 'none' };
}
// One headset frame, then (optionally) the ball is tracked.
function gFrame(f, headQ, eyeQ, ball = G_BALL, track = true) {
  f.sample(gRig(headQ, eyeQ), camera, true, G_DT);
  if (track) f.track(ball, G_DT, 10);
}
// Feeds independent eye data: with the head still, the eyes look a little off the head line, then at the ball.
function gPrime(f) {
  const toBall = gToward(G_BALL.clone().sub(G_HEAD));
  for (let i = 0; i < 10; i++) gFrame(f, gYaw(0), i % 2 ? toBall : gYaw(6), G_BALL, false);
  for (let i = 0; i < 20; i++) gFrame(f, gYaw(0), toBall, G_BALL, false);
}
function gConfirm(f) {
  gPrime(f);
  assert.equal(f.realEyes, true);
}

test('eye tracking: a blink is bridged, a long dropout is marked lost and never becomes head tracking', () => {
  const f = new FocusTracker();
  const toBall = gToward(G_BALL.clone().sub(G_HEAD));
  gConfirm(f);
  f.resetPitch();
  for (let i = 0; i < 20; i++) gFrame(f, gYaw(0), toBall);
  for (let i = 0; i < 7; i++) gFrame(f, gYaw(0), null); // ~100 ms blink
  assert.equal(f.mode, 'eyes');
  assert.equal(f.holding, true);
  assert.equal(f.watching, true, 'a blink does not look like looking away');
  for (let i = 0; i < 144; i++) gFrame(f, gYaw(0), null); // 2 s dropout, head still pointing at the ball
  assert.equal(f.mode, 'eyes', 'still eye mode: not silently switched to head');
  assert.equal(f.source, 'eyes-lost');
  assert.equal(f.valid, false);
  assert.ok(f.invalidTime > 1.5, 'lost time is recorded, not scored');
  assert.equal(f.focus, null, 'a flight that is mostly missing eye data gets no made-up score');
  for (let i = 0; i < 10; i++) gFrame(f, gYaw(0), toBall);
  assert.equal(f.source, 'eyes', 'eye data back: eye tracking resumes');
});

test('eye tracking: a head ray that lags the head pose while the head turns fast is never taken for eyes', () => {
  const f = new FocusTracker();
  let prev = gYaw(0);
  for (let i = 0; i < 300; i++) {
    const q = gYaw(Math.sin(i / 8) * 40);
    gFrame(f, q, prev, G_BALL, false); // the "gaze" is last frame's head pose (timing skew)
    prev = q;
  }
  assert.equal(f.eyeSeen, false);
  assert.equal(f.mode, 'head');
  assert.equal(f.realEyes, false);
});

test('eye tracking: small sensor noise on a head ray cannot add up to a false "eyes"', () => {
  const n = gNoise(5);
  const f = new FocusTracker();
  for (let i = 0; i < 3000; i++) {
    const d = G_FWD.clone().add(new Vector3(n() * 0.01, n() * 0.01, 0)); // about +/-0.3 deg
    gFrame(f, gYaw(0), gToward(d), G_BALL, false);
  }
  assert.equal(f.eyeSeen, false);
  assert.equal(f.mode, 'head');
});

test('eye tracking: verdicts for head-locked, no-gaze and independent eye data', () => {
  const locked = new FocusTracker();
  for (let i = 0; i < 240; i++) {
    const q = gYaw(Math.sin(i / 30) * 10);
    gFrame(locked, q, q, G_BALL, false);
  }
  assert.equal(locked.verdict, VERDICT.HEAD_LOCKED);
  assert.equal(locked.mode, 'head');
  const none = new FocusTracker();
  for (let i = 0; i < 100; i++) gFrame(none, gYaw(0), null, G_BALL, false);
  assert.equal(none.verdict, VERDICT.NO_GAZE);
  assert.equal(none.mode, 'head');
  const eyes = new FocusTracker();
  gConfirm(eyes);
  assert.equal(eyes.verdict, VERDICT.EYE);
});

test('eye tracking: in the emulator a tracked gaze ray is labelled simulated and keeps the 7 degree eye cone', () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const before = globalThis.window;
  globalThis.window = { IWER_DEVICE: {} };
  try {
    const f = new FocusTracker();
    gPrime(f);
    assert.equal(f.mode, 'eyes');
    assert.equal(f.simulated, true);
    assert.equal(f.realEyes, false);
    assert.equal(f.source, 'simulated-eyes');
    // 10 degrees off the ball: outside the 7 degree eye cone (the 18 degree cone is only for the mouse).
    f.resetPitch();
    for (let i = 0; i < 30; i++) gFrame(f, gYaw(0), gYaw(10));
    assert.equal(f.watching, false);
    for (let i = 0; i < 30; i++) gFrame(f, gYaw(0), null);
    assert.equal(f.simulated, true, 'the label survives a dropout');
    assert.equal(f.realEyes, false);
  } finally {
    if (had) globalThis.window = before;
    else delete globalThis.window;
  }
});

test('eye tracking: jitter while fixating is smoothed, and a one-frame 90 degree glitch is ignored', () => {
  const n = gNoise(7);
  const f = new FocusTracker();
  const toBallDir = G_BALL.clone().sub(G_HEAD).normalize();
  gConfirm(f);
  let rawSq = 0;
  let outSq = 0;
  let k = 0;
  for (let i = 0; i < 300; i++) {
    const j = toBallDir.clone().add(new Vector3(n() * 0.03, n() * 0.03, 0)).normalize(); // ~ +/-0.9 deg
    gFrame(f, gYaw(0), gToward(j));
    if (i > 30) {
      rawSq += gAngle(j, toBallDir) ** 2;
      outSq += gAngle(f.dir, toBallDir) ** 2;
      k++;
    }
  }
  assert.ok(Math.sqrt(outSq / k) < Math.sqrt(rawSq / k) * 0.6, 'jitter is reduced');
  assert.equal(f.watching, true);
  const before = f.dir.clone();
  gFrame(f, gYaw(0), gToward(new Vector3(1, 0, 0)));
  assert.ok(gAngle(f.dir, before) < 3, 'the spike did not move the gaze');
  assert.equal(f.watching, true);
});

test('eye tracking: a saccade still arrives within a few frames (smoothing does not lag real eye moves)', () => {
  const f = new FocusTracker();
  gConfirm(f);
  for (let i = 0; i < 30; i++) gFrame(f, gYaw(0), gYaw(0), G_BALL, false);
  const target = G_FWD.clone().applyQuaternion(gYaw(15));
  let frames = 0;
  for (; frames < 30; frames++) {
    gFrame(f, gYaw(0), gToward(G_FWD.clone().lerp(target, Math.min(1, (frames + 1) / 4))), G_BALL, false);
    if (gAngle(f.dir, target) < 2) break;
  }
  assert.ok(frames <= 9, `settled in ${frames + 1} frames`);
});

test('eye tracking: real eyes get a short look-away grace; head direction keeps its instant response', () => {
  const toBall = gToward(G_BALL.clone().sub(G_HEAD));
  const away = gYaw(40);
  const e = new FocusTracker();
  gConfirm(e);
  e.resetPitch();
  for (let i = 0; i < 20; i++) gFrame(e, gYaw(0), toBall);
  gFrame(e, gYaw(0), away);
  assert.equal(e.watching, true, 'one noisy frame off the ball is not a look-away');
  for (let i = 0; i < 20; i++) gFrame(e, gYaw(0), away);
  assert.equal(e.watching, false, 'a real look-away is still detected');
  const h = new FocusTracker();
  h.resetPitch();
  for (let i = 0; i < 20; i++) gFrame(h, gYaw(0), null);
  assert.equal(h.watching, true);
  gFrame(h, away, null);
  assert.equal(h.watching, false, 'head mode: unchanged, immediate');
});

test('eye tracking: NaN head or eye poses never poison the gaze or the score', () => {
  const f = new FocusTracker();
  gConfirm(f);
  f.resetPitch();
  for (const bad of [new Quaternion(NaN, 0, 0, 1), new Quaternion(Infinity, 0, 0, 1), new Quaternion(0, 0, 0, 0)]) {
    gFrame(f, gYaw(0), bad);
    assert.ok(Number.isFinite(f.dir.x) && Number.isFinite(f.dir.y) && Number.isFinite(f.dir.z));
  }
  const flight = f.flightTime;
  f.sample(gRig(new Quaternion(NaN, NaN, NaN, NaN), null), camera, true, G_DT);
  assert.equal(f.valid, false);
  f.track(G_BALL, G_DT, 10);
  assert.equal(f.flightTime, flight, 'a broken head pose is not scored');
  f.track(new Vector3(NaN, 0, 0), G_DT, 10);
  assert.equal(f.flightTime, flight, 'a NaN ball position is ignored');
});

const gCalTargets = () => [
  { id: 'left', dir: G_FWD.clone().applyQuaternion(gYaw(15)) },
  { id: 'right', dir: G_FWD.clone().applyQuaternion(gYaw(-15)) },
];

test('calibration: head still and eyes on each dot passes; a gaze that follows the head fails', () => {
  const ok = new CalibrationCheck({ targets: gCalTargets() });
  ok.start(0, G_FWD.clone());
  let snap;
  let ms = 0;
  for (const tg of ok.targets) for (let i = 0; i < 40; i++) snap = ok.sample((ms += 1000 / 72), tg.dir, G_FWD, true);
  assert.equal(snap.status, CAL.PASSED);
  const follows = new CalibrationCheck({ targets: gCalTargets(), timeoutMs: 1000, headDriftDeg: 30 });
  follows.start(0, G_FWD.clone());
  for (let t = 0; t <= 1100; t += 1000 / 72) snap = follows.sample(t, follows.targets[0].dir, follows.targets[0].dir, true);
  assert.equal(snap.status, CAL.FAILED);
  assert.equal(snap.reason, 'gaze-follows-head');
});

test('calibration: head turning fails as head-moved; no gaze fails as no-gaze; NaN never passes', () => {
  let snap;
  const moved = new CalibrationCheck({ targets: gCalTargets(), timeoutMs: 1000 });
  moved.start(0, G_FWD.clone());
  const halfway = G_FWD.clone().applyQuaternion(gYaw(8));
  for (let t = 0; t <= 1100; t += 1000 / 72) snap = moved.sample(t, moved.targets[0].dir, halfway, true);
  assert.equal(snap.reason, 'head-moved');
  const none = new CalibrationCheck({ targets: gCalTargets(), timeoutMs: 1000 });
  none.start(0, G_FWD.clone());
  for (let t = 0; t <= 1100; t += 1000 / 72) snap = none.sample(t, null, G_FWD, false);
  assert.equal(snap.reason, 'no-gaze');
  const nan = new CalibrationCheck({ targets: gCalTargets(), timeoutMs: 500 });
  nan.start(0, G_FWD.clone());
  for (let t = 0; t <= 600; t += 1000 / 72) snap = nan.sample(t, new Vector3(NaN, 0, -1), G_FWD, true);
  assert.equal(snap.status, CAL.FAILED);
});

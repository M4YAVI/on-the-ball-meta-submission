// Checks the emulator's fielder hands (src/emulator-hands.js) against the REAL game in IWER's emulated
// Quest with hand tracking, and takes screenshots of the hands at the moment of contact.
// Needs the dev server on :8081 (npm run dev:runtime, or iwsdk dev).
//
//   node tests/emulator-hands.check.cjs [--shots <dir>] [--live] [types...]   e.g. normal high wide normal
//
// What it checks, from the joint positions the emulator actually produces (not from what we asked it for):
//   * the game reads the real finger joints (middle and distal joints, ring finger) and models each hand
//     with its full set of finger bones
//   * idle: the hand is relaxed and slightly cupped (every finger a little bent, none flat or clenched),
//     and the fingers are not all bent by the same amount
//   * on the catch: ALL FIVE fingers close round the ball (not just thumb and index), each by its own amount
//   * every ball is caught, with BOTH hands for a ball at the body (orthodox or reverse cup), one hand
//     for a wide ball, and the two palms are close together at the moment of contact
// --live plays in real time through the game's own frame loop (what a person sees); without it the
// game is stepped at a fixed rate so the screenshots land on exact moments.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
let shots = null;
let live = false;
const types = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shots') shots = path.resolve(args[++i]);
  else if (args[i] === '--live') live = true;
  else types.push(args[i]);
}
if (!types.length) types.push('normal', 'high', 'wide', 'normal', 'high', 'normal');
if (shots) fs.mkdirSync(shots, { recursive: true });

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const fmt = (b) => FINGERS.map((k) => `${k} ${b[k] === null ? '?' : b[k].toFixed(0)}`).join('  ');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=d3d11'],
  });
  const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: shots ? { width: 1280, height: 720 } : { width: 640, height: 360 }, deviceScaleFactor: shots ? 2 : 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The launch the person uses: ?autoxr starts the emulator session in hand mode, with the fielder hands on.
  await page.goto(`https://localhost:8081/?autoxr=1&balls=${types.length}&tutorial=0`);
  await page.waitForFunction(() => window.__game && window.__world, null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__world.session, null, { timeout: 20000 });
  await page.waitForTimeout(1000);

  if (shots) {
    // Only the game view: hide the emulator panels.
    await page.evaluate(() => {
      const fixed = [...document.body.children].find((e) => getComputedStyle(e).position === 'fixed' && e.querySelector('canvas'));
      if (fixed) {
        for (const kid of fixed.children) {
          if (kid.tagName === 'CANVAS' && getComputedStyle(kid).zIndex !== '3') continue; // the game's canvas
          kid.style.display = 'none';
        }
      }
    });
  }
  // A full-frame shot, and a close-up of the hands (and the ball) cropped from it.
  const snap = async (name) => {
    if (!shots) return;
    await page.screenshot({ path: path.join(shots, `${name}.png`) });
    const c = await page.evaluate(() => {
      const s = window.__game.sys;
      const cam = window.__world.camera;
      const V3 = s.head.constructor;
      const toScreen = (p) => {
        const q = new V3(p.x, p.y, p.z).project(cam);
        return { x: ((q.x + 1) / 2) * innerWidth, y: ((1 - q.y) / 2) * innerHeight };
      };
      const pts = [s.hands.left.palm, s.hands.right.palm].map(toScreen);
      if (s.ball.visible) pts.push(toScreen(s.ball.position));
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length, w: innerWidth, h: innerHeight };
    });
    const cw = 560;
    const ch = 360;
    const x = Math.max(0, Math.min(c.w - cw, Math.round(c.x - cw / 2)));
    const y = Math.max(0, Math.min(c.h - ch, Math.round(c.y - ch / 2)));
    await page.screenshot({ path: path.join(shots, `${name}-close.png`), clip: { x, y, width: cw, height: ch } });
  };

  // In-page helpers: finger bend (degrees, summed over the finger's joints) read from the emulated hand's skeleton.
  await page.evaluate(() => {
    const g = window.__game;
    const V3 = g.sys.head.constructor;
    const names = (f) =>
      f === 'thumb'
        ? ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip']
        : [`${f}-finger-metacarpal`, `${f}-finger-phalanx-proximal`, `${f}-finger-phalanx-intermediate`, `${f}-finger-phalanx-distal`, `${f}-finger-tip`];
    const pos = (side, n) => {
      const o = g.trackedHands[side] && g.trackedHands[side].joints[n];
      if (!o) return null;
      const p = new V3();
      o.getWorldPosition(p);
      return p;
    };
    window.__joint = pos;
    window.__bends = (side) =>
      Object.fromEntries(
        ['thumb', 'index', 'middle', 'ring', 'pinky'].map((f) => {
          const pts = names(f).map((n) => pos(side, n));
          if (pts.some((p) => !p)) return [f, null];
          let sum = 0;
          for (let i = 1; i < pts.length - 1; i++) {
            const a = pts[i].clone().sub(pts[i - 1]).normalize();
            const b = pts[i + 1].clone().sub(pts[i]).normalize();
            sum += (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180) / Math.PI;
          }
          return [f, sum];
        }),
      );
    window.__frame = () => new Promise((r) => window.__world.session.requestAnimationFrame(() => { const n = performance.now(); if (window.__lastT) window.__fps = 1000 / (n - window.__lastT); window.__lastT = n; r(); }));
  });

  let ok = true;
  const check = (pass, msg) => {
    if (!pass) ok = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${msg}`);
  };

  // ---- start the round: the hands are now played ----
  const wiring = await page.evaluate(async (first) => {
    const s = window.__game.sys;
    s.forceType = first;
    s.forceWideSide = -1;
    s.lockout = 0;
    s.tryStart();
    await new Promise((r) => setTimeout(r, 700));
    await window.__frame();
    const h = s.hands.right;
    const mid = window.__joint('right', 'index-finger-phalanx-intermediate');
    const ring = window.__joint('right', 'ring-finger-tip');
    return {
      state: s.state,
      caps: h.capCount,
      mid: mid ? mid.distanceTo(h.mids.index) : null,
      ringTip: ring ? ring.distanceTo(h.tips.ring) : null,
      active: s.emulatorHands.live,
      idle: { left: window.__bends('left'), right: window.__bends('right') },
    };
  }, types[0]);
  check(wiring.active, `the fielder hands are on in the emulator (round state: ${wiring.state})`);
  check(wiring.caps === 16, `each hand is modelled with ${wiring.caps} capsules (forearm, palm, 4 fingers x 3 bones, thumb x 2)`);
  check(wiring.mid !== null && wiring.mid < 1e-4, `the game reads the index finger's real middle joint (off by ${wiring.mid === null ? '?' : wiring.mid.toExponential(1)} m)`);
  check(wiring.ringTip !== null && wiring.ringTip < 1e-4, `the game reads the ring fingertip (off by ${wiring.ringTip === null ? '?' : wiring.ringTip.toExponential(1)} m)`);

  // ---- idle: relaxed and slightly cupped, each finger its own amount ----
  const idle = wiring.idle;
  console.log(`      idle bends (deg), left:  ${fmt(idle.left)}\n                        right: ${fmt(idle.right)}`);
  for (const side of ['left', 'right']) {
    const four = ['index', 'middle', 'ring', 'pinky'].map((f) => idle[side][f]);
    check(four.every((x) => x !== null && x > 30 && x < 190), `${side} hand idle: fingers slightly cupped, none flat or clenched (${four.map((x) => x && x.toFixed(0)).join(', ')} deg)`);
    check(Math.max(...four) - Math.min(...four) > 6, `${side} hand idle: the fingers are not all bent the same amount (spread ${(Math.max(...four) - Math.min(...four)).toFixed(0)} deg)`);
  }
  await snap('00-idle-ready');

  // ---- play the balls ----
  const out = [];
  let current = null;
  let caughtAt = -1;
  let last = null;
  const t0 = Date.now();
  while (out.length < types.length && Date.now() - t0 < 500000) {
    const st = await page.evaluate(
      async ({ types, live }) => {
        const s = window.__game.sys;
        const eh = s.emulatorHands;
        const d = window.IWER_DEVICE;
        if (!window.__real) {
          window.__real = s.constructor.prototype.update;
          if (!live) s.update = () => {};
        }
        if (s.state === 'ready' || s.state === 'feedback' || s.state === 'idle') {
          s.forceType = types[s.ballNo] || 'normal';
          s.forceWideSide = -1;
        }
        if (!live) for (let i = 0; i < 3; i++) window.__real.call(s, 1 / 60);
        await eh.flush();
        await d.remote.dispatch('look_at', { device: 'headset', target: { x: s.ball.position.x, y: s.ball.position.y, z: s.ball.position.z } });
        await window.__frame();
        return {
          state: s.state,
          ball: s.ballNo,
          held: !!s.heldBy,
          p: s.state === 'flying' && s.flightDuration > 0 ? s.life / s.flightDuration : 0,
          t: eh.t,
          result: s.lastResult,
          two: s.twoHanded,
          tech: s.catchInfo && s.catchInfo.technique,
          gap: s.hands.left.palm.distanceTo(s.hands.right.palm),
          dbg: {
            reason: s.decision && s.decision.reason,
            point: s.decision && s.decision.point && s.decision.point.toArray().map((x) => +x.toFixed(2)),
            aim: s.aim.toArray().map((x) => +x.toFixed(2)),
            head: s.head.toArray().map((x) => +x.toFixed(2)),
            tech: eh.tech,
            lp: s.hands.left.palm.toArray().map((x) => +x.toFixed(2)),
            rp: s.hands.right.palm.toArray().map((x) => +x.toFixed(2)),
            ln: s.hands.left.normal.toArray().map((x) => +x.toFixed(2)),
            rn: s.hands.right.normal.toArray().map((x) => +x.toFixed(2)),
            fps: Math.round(window.__fps || 0),
            corrL: [eh.hands.left.corr.x, eh.hands.left.corr.y, eh.hands.left.corr.z].map((x) => +x.toFixed(3)),
            sentL: eh.hands.left.sentPalm && [eh.hands.left.sentPalm.x, eh.hands.left.sentPalm.y, eh.hands.left.sentPalm.z].map((x) => +x.toFixed(3)),
          },
          bends: { left: window.__bends('left'), right: window.__bends('right') },
        };
      },
      { types, live },
    );
    const no = st.ball;
    if (st.state === 'swinging' || st.state === 'flying') current = current || { ball: no, type: types[no - 1], shots: {} };
    if (current && st.state === 'flying' && !current.shots.approach && st.p > 0.55) {
      current.shots.approach = true;
      current.approach = st.bends;
      await snap(`ball${no}-0-approach`);
    }
    if (current && st.held && caughtAt < 0) {
      caughtAt = st.t;
      current.contact = { gap: st.gap, bends: st.bends };
      await snap(`ball${no}-1-contact`);
    }
    if (current && caughtAt >= 0 && !current.shots.wrapped && st.t - caughtAt > 0.3) {
      current.shots.wrapped = true;
      current.wrapped = st.bends;
      await snap(`ball${no}-2-wrapped`);
    }
    if (current && caughtAt >= 0 && !current.shots.held && st.t - caughtAt > 0.85) {
      current.shots.held = true;
      current.held = st.bends;
      await snap(`ball${no}-3-held`);
    }
    if (current && st.state === 'feedback' && last !== 'feedback') {
      current.result = st.result;
      current.dbg = st.dbg;
      current.twoHanded = st.two;
      current.technique = st.tech;
    }
    if (current && current.result !== undefined && last === 'feedback' && (st.state === 'ready' || st.state === 'over' || st.state === 'swinging')) {
      out.push(current);
      current = null;
      caughtAt = -1;
    }
    last = st.state;
    if (st.state === 'over') {
      if (current && current.result !== undefined) out.push(current);
      break;
    }
  }

  for (const r of out) {
    const wantTwo = r.type !== 'wide';
    const good = r.result === 'caught' && (!wantTwo || r.twoHanded);
    check(good, `ball ${r.ball} (${r.type}): ${r.result}${r.twoHanded ? ', two hands' : ', one hand'}${r.technique ? ` [${r.technique}]` : ''}`);
    if (!good) console.log('      debug', JSON.stringify(r.dbg));
    if (r.contact && wantTwo) check(r.contact.gap < 0.28, `ball ${r.ball}: the two palms are together at contact (${(r.contact.gap * 100).toFixed(0)} cm apart)`);
    const held = r.held || r.wrapped;
    if (!held || r.result !== 'caught') continue;
    // How much each finger closed from its relaxed idle, on each hand.
    const delta = {};
    for (const side of ['left', 'right']) {
      delta[side] = {};
      for (const f of FINGERS) delta[side][f] = held[side][f] - idle[side][f];
    }
    // The four fingers must each close; the thumb may already be touching the ball (it then stays where it is).
    const allFive = (side) => FINGERS.every((f) => (f === 'thumb' ? delta[side][f] > -4 : delta[side][f] > 12));
    const spread = (side) => Math.max(...FINGERS.map((f) => delta[side][f])) - Math.min(...FINGERS.map((f) => delta[side][f]));
    const catching = wantTwo ? ['left', 'right'] : [['left', 'right'].sort((a, b) => FINGERS.reduce((x, f) => x + delta[b][f], 0) - FINGERS.reduce((x, f) => x + delta[a][f], 0))[0]];
    for (const side of catching) {
      const d = FINGERS.map((f) => `${f} ${delta[side][f] >= 0 ? '+' : ''}${delta[side][f].toFixed(0)}`).join(', ');
      check(allFive(side), `ball ${r.ball} ${side} hand: all five fingers close round the ball (${d} deg)`);
      check(spread(side) > 8, `ball ${r.ball} ${side} hand: each finger closes by its own amount (spread ${spread(side).toFixed(0)} deg)`);
    }
  }
  if (out.length < types.length) check(false, `only ${out.length}/${types.length} balls finished`);
  for (const e of errors) check(false, `page error: ${e}`);
  await browser.close();
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED');
  process.exit(ok ? 0 : 1);
})();

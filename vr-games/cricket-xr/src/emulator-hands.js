// Fielder hands for the IWER emulator (never a headset).
//
// In the emulator a person has a mouse, so the "tracked" hands are only what the emulator can show:
// fixed whole-hand presets and a thumb-and-index pinch. Nothing moves the other fingers, and nobody
// can reach a 20 m/s ball with two gizmos. So here the hands are played like a fielder's:
//
//   * Relaxed and slightly cupped while waiting, every finger a little different (the outer fingers
//     curl most) and breathing a little.
//   * Up and ready while the coach strikes, then a smooth (minimum-jerk) reach timed to the flight,
//     palms turned to the ball, all five fingers opening into a cup as it nears.
//   * On contact the fingers wrap round the ball one after the other, index first and little finger
//     last, the thumb closing across, while the hands give back towards the body.
//   * A ball coming at the body is taken with BOTH hands together: an orthodox cup (fingers forward
//     and down, little fingers together) at chest height and below, a reverse cup (fingers up, thumbs
//     together) above the shoulders. Only a ball wide of the body is one-handed, and then the other
//     hand comes across to cover it.
//
// It only moves the emulated hands, through the emulator's own remote-control interface. Whether the
// ball is caught is still decided by catching.js from the finger joints the emulator produces, so a
// finger in the wrong place really does drop the ball. A headset has no IWER_DEVICE and never runs
// this: real hands are never touched.
//
// The PLAYER catches. By default the arrow keys move both hands (left/right/up/down; the mouse stays the eyes) and
// this module only does what a fielder's hands do by themselves: palms turn to the ball, the hands reach forward and
// the fingers open into a cup as it nears, and they close round it on contact. Where the hands ARE decides whether
// it is caught. ?assist=1 plays the hands completely (demos, tests); ?assist=0 or the M key gives the emulator's own
// gizmos (F and click) instead.

import { Vector3 } from '@iwsdk/core';
import { BALL_RADIUS } from './ball.js';
import { trackedHands } from './hands.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const _jp = new Vector3();
const ease = (x) => {
  x = clamp01(x);
  return x * x * x * (10 + x * (-15 + 6 * x)); // minimum jerk: how a human hand reaches
};
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, k = 1) => v(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};
const lerp = (a, b, k) => v(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
const perp = (f, n) => norm(add(f, n, -dot(f, n))); // f, made square to n
const UP = v(0, 1, 0);
const DOWN = v(0, -1, 0);
const SX = { left: -1, right: 1 };
const SIDES = ['left', 'right'];
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const HAND_SPEED = 2.2; // m/s the arrow keys move the hands
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Each finger's own character, so the five never move as one block.
//   IDLE:     how curled it is when relaxed (0 = the emulator's relaxed hand, 1 = the cup pose).
//   READY:    how curled when the hand is ready for the ball (fingers cupped, the thumb held back).
//   WRAP:     how far past the cup it closes round the ball (towards the claw, a spherical grasp).
//   DELAY:    when in the closing it starts (the little finger finishes last).
//   PHASE:    its own slow breathing.
const IDLE = { thumb: 0.3, index: 0.42, middle: 0.5, ring: 0.58, pinky: 0.66 };
const READY = { thumb: 0.5, index: 0.86, middle: 0.95, ring: 1, pinky: 1 };
// Half the distance between the hands in the ready position (m): about shoulder width apart.
const READY_GAP = 0.17;
const WRAP = { thumb: 1.05, index: 1.0, middle: 1.0, ring: 1.0, pinky: 1.0 };
const DELAY = { thumb: 0.015, index: 0, middle: 0.025, ring: 0.05, pinky: 0.075 }; // seconds after the catch
const PHASE = { thumb: 0.4, index: 1.1, middle: 2.3, ring: 3.1, pinky: 4.2 };
// The joints of each finger that can touch the ball (the thumb has two bones, the others three).
const TOUCH = {
  thumb: ['thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};
const SKIN = 0.008; // a finger counts as touching the ball when its bone is this close to the surface
const CLOSE_RATE = 4.5; // how fast a finger closes round the ball (whole range per second)

// One finger's place on the path relaxed -> cup -> claw: `stage` 0 is the relaxed hand, 1 the cup, 2 the
// claw. The whole hand is the cup pose and each finger is blended from it, so any finger can be anywhere.
function fingerBlend(stage) {
  const s = Math.max(0, Math.min(2, stage));
  return s < 1 ? { poseId: 'default', weight: 1 - s } : { poseId: 'claw', weight: s - 1 };
}

export class EmulatorHands {
  // game: the game system (state, ball, aim, the hands as catching.js reads them).
  constructor(game) {
    this.game = game;
    this.manual = false; // the M key: manual hands
    this.forced = null; // tests: true / false overrides the launch rules
    this.plan = null; // recordings: { catch: false } makes a late, dropped attempt
    this.t = 0;
    this.live = false;
    this.pending = [];
    this.tech = null; // the technique for the ball in flight
    this.ballKey = -1;
    this.caughtT = -1;
    this.inDir = v(0, 0, -1); // from the hands towards the incoming ball
    this.snap = {}; // each hand's pose at the moment of the catch
    this.hands = {};
    // close: how far each finger has closed round the ball (0 open .. 1 fully), driven by touch.
    for (const side of SIDES) this.hands[side] = { pose: null, corr: v(), sentPalm: null, stage: {}, close: Object.fromEntries(FINGERS.map((f) => [f, 0])) };

    const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    this.auto = params.get('assist') === '1'; // plays the hands completely (demos, tests)
    this.launchOn = params.get('assist') !== '0'; // otherwise: arrow keys aim, the fielder's technique is automatic
    this.off = v(); // where the player has moved the hands, from the ready position
    this.keys = { left: false, right: false, up: false, down: false };
    this.onKeyUp = (e) => {
      const k = ARROWS[e.code];
      if (k) this.keys[k] = false;
    };
    this.onArrow = (e) => {
      const k = ARROWS[e.code];
      if (!k) return;
      if (this.live && !this.autoPlay) e.preventDefault(); // the page must not scroll while playing
      this.keys[k] = true;
    };
    // No on-screen PC prompt: this is a VR game. In a headset the player's own hands catch; in the emulator the
    // arrow keys stay as a silent developer aid only.
    this.hint = null;
    this.onKey = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      this.manual = !this.manual;
      console.info(this.manual ? '[emulator hands] manual: the emulator gizmos, F and click control the hands' : '[emulator hands] auto: the hands field the ball');
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keydown', this.onArrow, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', () => Object.keys(this.keys).forEach((k) => (this.keys[k] = false)));
    }
  }

  // Full auto-play: only on request (?assist=1) or when a test/recording forces the hands on.
  get autoPlay() {
    return this.auto || this.forced === true;
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keydown', this.onArrow, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
    }
    if (this.hint && this.hint.parentNode) this.hint.parentNode.removeChild(this.hint);
    this.release();
  }

  get device() {
    return typeof window !== 'undefined' ? window.IWER_DEVICE : undefined;
  }

  // Should the hands be played right now?
  get wanted() {
    const d = this.device;
    if (!d || !d.remote || !this.game.world.session) return false;
    if (d.primaryInputMode !== 'hand' || !d.hands || !d.hands.left || !d.hands.right) return false;
    if (!d.hands.left.connected || !d.hands.right.connected) return false;
    if (this.forced !== null) return this.forced;
    return this.launchOn && !this.manual;
  }

  head() {
    const h = this.game.head;
    return v(h.x, h.y, h.z);
  }

  // The game bends the whole player rig when the head tips down (and for low balls), and everything
  // here is worked out in the game's world. The emulator places hands relative to its own origin, so
  // what is sent has to leave the rig's offset out.
  rigOffset() {
    const rig = this.game.player || (this.game.world && this.game.world.player);
    const p = rig && rig.position;
    return p ? v(p.x, p.y, p.z) : v();
  }

  pose(pos, palm, fingersHint, cup, grip) {
    const p = norm(palm);
    return { pos, palm: p, fingers: perp(fingersHint, p), cup, grip };
  }

  blend(a, b, k) {
    const palm = norm(lerp(a.palm, b.palm, k));
    return {
      pos: lerp(a.pos, b.pos, k),
      palm,
      fingers: perp(lerp(a.fingers, b.fingers, k), palm),
      cup: a.cup + (b.cup - a.cup) * k,
      grip: a.grip + (b.grip - a.grip) * k,
    };
  }

  // A fielder's ready position (cricket coaching): an athletic stance with the hands apart, about shoulder
  // width, out in front of the body, palms open and facing the ball, fingers relaxed and pointing down and
  // forward. The hands only come together into a cup once the ball is on its way (playerPose), so the wait
  // does not look like two hands held out palms-up. Held a little higher than a real fielder's waist so they
  // sit in the lower part of the view. `up` lifts them (the coach is striking: hands come up, ready).
  readyPose(side, h, up = 0) {
    const sx = SX[side];
    return this.pose(
      v(h.x + sx * READY_GAP, h.y - 0.3 + up, h.z - 0.42 - up * 0.6),
      v(-sx * 0.3, 0.3, -0.9), // palms to the ball, a little up and turned slightly in
      v(sx * 0.12, -0.9, -0.4), // fingers down and forward, relaxed
      0.25,
      0,
    );
  }

  // Ready stance while waiting, with a little breathing so the hands are not frozen.
  rest(side, h) {
    const s = this.game;
    const sx = SX[side];
    const striking = s.state === 'swinging';
    const breathe = 0.007 * Math.sin(this.t * 1.8 + (sx > 0 ? 0 : 1.3));
    const sway = 0.004 * Math.sin(this.t * 1.1 + sx);
    const P = this.readyPose(side, h, (striking ? 0.07 : 0) + breathe);
    P.pos = add(P.pos, v(sway, 0, 0));
    P.cup = striking ? 0.55 : 0.2;
    return P;
  }

  // Player-controlled hands (no assist): the emulator starts its hands up by the face, palms to the turf, which
  // is no way to field. So when the session starts, and again when a round starts, put each hand once into the
  // ready position, then let go: from there on the emulator's own controls move them.
  placeReady() {
    const d = this.device;
    if (!d || !d.remote || !d.hands) return;
    const h = this.head();
    const rig = this.rigOffset();
    const arr = (a) => [a.x, a.y, a.z];
    for (const side of SIDES) {
      const hand = d.hands[side];
      if (!hand || !hand.connected) continue;
      const P = this.readyPose(side, h);
      const fingers = {};
      for (const f of FINGERS) fingers[f] = fingerBlend(IDLE[f]); // relaxed, slightly cupped
      d.remote
        .dispatch('set_transform', {
          device: 'hand-' + side,
          position: add(P.pos, rig, -1),
          orientation: { fingers: arr(P.fingers), palm: arr(P.palm) },
          anchor: 'grip',
        })
        .then(() => d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'cup', fingers }))
        .then(() => {
          if (hand.pin) hand.setPin(null); // stays where it was put; the player moves it from here
        })
        .catch((e) => console.warn('[emulator hands] could not place the hands in the ready position:', e && e.message ? e.message : e));
    }
  }

  // Calls placeReady() on a new session (once both hands are connected) and on each new round.
  updatePlacement() {
    const s = this.game;
    const d = this.device;
    const session = s.world && s.world.session;
    const ready = !!(session && d && d.remote && d.primaryInputMode === 'hand' && d.hands && d.hands.left && d.hands.right && d.hands.left.connected && d.hands.right.connected);
    const roundStart = (this.prevState === 'idle' || this.prevState === 'over') && s.state === 'ready';
    this.prevState = s.state;
    if (!ready) return;
    if (this.placedFor !== session || roundStart) {
      this.placedFor = session;
      this.placeReady();
    }
  }

  chooseTechnique(h) {
    const s = this.game;
    const dx = s.aim.x - h.x;
    const shoulderY = h.y - 0.22;
    return {
      twoHand: Math.abs(dx) < 0.42, // coming at the body: both hands together
      catchSide: dx >= 0 ? 'right' : 'left',
      reverse: s.aim.y > shoulderY + 0.02, // above the shoulders: fingers up, thumbs together
    };
  }

  // Where each hand wants to be when the ball arrives.
  catchPose(side, h, tech) {
    const s = this.game;
    const sx = SX[side];
    const a = v(s.aim.x, s.aim.y, s.aim.z + 0.01);
    const inDir = this.inDir;
    if (tech.twoHand) {
      if (tech.reverse) {
        // Reverse cup: thumbs together, palms square to the ball and a hand's width apart so the ball
        // lands in the pocket between them, fingers softly curled (fully curled tips would meet the
        // ball first and make it a one-handed take).
        return this.pose(add(a, v(sx * 0.08, 0, 0.02)), add(add(inDir, UP, 0.1), v(-sx * 0.15, 0, 0)), UP, 0.8, 0);
      }
      // Orthodox cup: palms up and towards the ball, a touch below its line so it drops in. Little
      // fingers nearly touching, so a ball cannot reach one palm without being in the pocket.
      return this.pose(add(a, v(sx * 0.04, -0.04, 0)), add(add(inDir, UP, 0.95), v(-sx * 0.25, 0, 0)), DOWN, 1, 0);
    }
    if (side === tech.catchSide) {
      return this.pose(a, add(inDir, v(-sx * 0.2, 0.1, 0)), v(sx * 0.45, 1, 0), 1, 0);
    }
    // The other hand follows part of the way, for balance.
    const r = this.rest(side, h);
    return this.pose(lerp(r.pos, a, 0.3), r.palm, r.fingers, 0.4, 0);
  }

  // A late, dropped attempt: the hands react too late and too low.
  latePose(side) {
    const s = this.game;
    const sx = SX[side];
    const a = v(s.aim.x + 0.32 + sx * 0.05, s.aim.y - 0.3, s.aim.z + 0.06);
    return this.pose(a, add(this.inDir, UP, 0.9), DOWN, 0.6, 0);
  }

  // After the catch: the fingers wrap round the ball, the hands give back towards the body, then bring
  // the ball up in front of the chest with both hands round it.
  heldPose(side, h, tc) {
    const sx = SX[side];
    const tech = this.tech || { twoHand: true, catchSide: side };
    const start = this.snap[side];
    const catcher = tech.twoHand || side === tech.catchSide;
    const give = ease(tc / 0.3);
    const lift = ease((tc - 0.55) / 0.6);
    const hold = this.pose(v(h.x + sx * 0.05, h.y - 0.45, h.z - 0.34), v(-sx * 0.35, 0.9, -0.25), v(0, -0.25, -1), 1, 0.9);
    if (catcher) {
      const g = { ...start, pos: add(start.pos, v(0, -0.03, 0.15), give), cup: 1, grip: ease(tc / 0.22) };
      return this.blend(g, hold, lift);
    }
    // One-handed catch: the other hand comes across to cover the ball.
    const other = this.snap[tech.catchSide];
    const cover = this.pose(
      add(other.pos, v(-SX[tech.catchSide] * 0.09, 0.0, 0.15 * give)),
      v(SX[tech.catchSide] * 0.6, 0.3, -0.4),
      UP,
      1,
      0.7,
    );
    return this.blend(this.blend(start, cover, ease((tc - 0.05) / 0.35)), hold, lift);
  }

  // Moves the player's hands with the arrow keys; with no key held, between balls, they drift back to the middle.
  moveByKeys(dt) {
    const k = this.keys;
    const dx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const dy = (k.up ? 1 : 0) - (k.down ? 1 : 0);
    const s = this.game;
    if (dx || dy) {
      this.off.x += dx * HAND_SPEED * dt;
      this.off.y += dy * HAND_SPEED * dt;
    } else if (s.state === 'feedback' || s.state === 'ready') {
      const f = 1 - Math.exp(-dt / 0.35);
      this.off.x -= this.off.x * f;
      this.off.y -= this.off.y * f;
    }
    this.off.x = Math.max(-0.95, Math.min(0.95, this.off.x));
    this.off.y = Math.max(-0.55, Math.min(0.95, this.off.y));
  }

  // Where the player has put a hand, with a fielder's technique added on top: the palms turn to the ball, fingers
  // down for a low ball (orthodox cup) and up for a high one (reverse cup), the hands reach forward to meet it and the
  // fingers open into a cup as it nears. p: how far through the flight the ball is.
  playerPose(side, h, flying, p) {
    const s = this.game;
    const sx = SX[side];
    const striking = s.state === 'swinging';
    const y = h.y - 0.3 + this.off.y + (striking ? 0.05 : 0);
    const rev = smooth(h.y - 0.28, h.y - 0.08, y); // 0 orthodox cup .. 1 reverse cup
    const fb = flying ? ease((p - 0.06) / 0.5) : 0; // how far into catching mode
    const inDir = flying ? this.inDir : v(0, 0, -1);
    const palmLow = add(add(inDir, UP, 0.95), v(-sx * 0.25, 0, 0));
    const palmHigh = add(add(inDir, UP, 0.1), v(-sx * 0.15, 0, 0));
    const ready = this.readyPose(side, h);
    const palm = lerp(ready.palm, lerp(norm(palmLow), norm(palmHigh), rev), fb);
    const fingers = lerp(ready.fingers, lerp(DOWN, UP, rev), fb);
    const gap = READY_GAP + (0.045 + 0.035 * rev - READY_GAP) * fb; // from shoulder width the hands close up into a cup (a bit wider for the reverse cup)
    const reach = flying ? ease((p - 0.2) / 0.6) : 0;
    const zReady = h.z - 0.45 - (striking ? 0.03 : 0);
    let z = zReady + (s.aim.z + 0.01 - zReady) * reach;
    z += 0.05 * (flying ? ease((p - 0.8) / 0.2) : 0); // soft hands: they start to travel back as it arrives
    const c0 = striking ? 0.55 : 0.2;
    const cup = c0 + (1 - c0) * (flying ? ease((p - 0.25) / 0.55) : 0);
    const bob = 0.004 * Math.sin(this.t * 1.8 + (sx > 0 ? 0 : 1.3)) * (1 - fb);
    return this.pose(v(h.x + this.off.x + sx * gap, y - 0.04 * fb * (1 - rev) + bob, z), palm, fingers, cup, 0);
  }

  // The technique, read from where the player's hands are (nobody chose it for them).
  playerTech(h) {
    const s = this.game;
    const L = this.hands.left.pose;
    const R = this.hands.right.pose;
    const mid = L && R ? (L.pos.x + R.pos.x) / 2 : h.x;
    const y = L && R ? (L.pos.y + R.pos.y) / 2 : h.y - 0.3;
    return { twoHand: true, catchSide: s.aim.x >= mid ? 'right' : 'left', reverse: y > h.y - 0.2 };
  }

  // Works out where each hand is this frame (smoothed towards where it wants to be).
  step(dt) {
    const s = this.game;
    this.t += dt;
    const h = this.head();
    const flying = s.state === 'flying';
    if (flying && this.ballKey !== s.ballNo) {
      this.ballKey = s.ballNo;
      this.tech = this.autoPlay ? this.chooseTechnique(h) : this.playerTech(h);
      this.caughtT = -1;
    }
    if (!this.autoPlay) {
      this.moveByKeys(dt);
      if (flying && this.caughtT < 0) this.tech = this.playerTech(h);
    }
    if (flying) {
      const vl = len(s.vel);
      if (vl > 1e-3) this.inDir = v(-s.vel.x / vl, -s.vel.y / vl, -s.vel.z / vl);
    }
    if (s.heldBy && this.caughtT < 0) {
      this.caughtT = this.t;
      for (const side of SIDES) this.snap[side] = this.hands[side].pose || this.rest(side, h);
    }
    if (!s.heldBy && s.state !== 'feedback') this.caughtT = -1;

    const p = flying && s.flightDuration > 0 ? s.life / s.flightDuration : 0;
    const plan = this.plan;
    for (const side of SIDES) {
      const H = this.hands[side];
      let want;
      if (this.caughtT >= 0) {
        want = this.heldPose(side, h, this.t - this.caughtT);
      } else if (!this.autoPlay) {
        want = this.playerPose(side, h, flying, p);
      } else if (flying && plan && plan.catch === false) {
        const r = this.rest(side, h);
        want = this.blend(r, this.latePose(side), 0.55 * ease((p - 0.5) / 0.5));
      } else if (flying) {
        const r = this.rest(side, h);
        const c = this.catchPose(side, h, this.tech);
        want = this.blend(r, c, ease((p - 0.06) / 0.62));
        // Fingers open into the cup as the ball nears...
        want.cup = r.cup + (c.cup - r.cup) * ease((p - 0.25) / 0.55);
        // ...and soft hands: they start to travel back with the ball just as it arrives.
        want.pos = add(want.pos, v(0, 0, 0.05), ease((p - 0.8) / 0.2) * (c.cup >= 0.7 ? 1 : 0));
      } else {
        want = this.rest(side, h);
      }
      // Smooth everything, tighter while the ball is in the air.
      const tau = flying || this.caughtT >= 0 ? 0.04 : this.autoPlay ? 0.16 : 0.05;
      const k = 1 - Math.exp(-dt / tau);
      H.pose = H.pose ? this.blend(H.pose, want, k) : want;
      this.updateClosing(side, dt);

      // The emulator places its grip anchor, the game reads its own palm point, and the two are not the
      // same spot (they drift apart by a few cm to 30 cm with the hand's pose and the headset's turn):
      // close that gap, so the palm the game sees is where this module meant it to be.
      const gh = s.hands && s.hands[side];
      if (H.sentPalm && gh && gh.valid && gh.hasNormal) {
        H.corr = add(H.corr, v(H.sentPalm.x - gh.palm.x, H.sentPalm.y - gh.palm.y, H.sentPalm.z - gh.palm.z), 0.6);
        const cl = len(H.corr);
        const max = 0.35;
        if (cl > max) H.corr = v((H.corr.x / cl) * max, (H.corr.y / cl) * max, (H.corr.z / cl) * max);
      }
    }
  }

  // How far a finger's nearest bone is from the ball's surface (negative: pressing into it), from the
  // emulated hand's real joint positions. null when the joints are not available.
  fingerGap(side, f, ball, r) {
    const hand = trackedHands[side];
    if (!hand || !hand.joints) return null;
    let best = Infinity;
    for (const name of TOUCH[f]) {
      const o = hand.joints[name];
      if (!o) continue;
      o.getWorldPosition(_jp);
      best = Math.min(best, _jp.distanceTo(ball));
    }
    return best === Infinity ? null : best - r;
  }

  // Closes each finger round the ball until it touches it, then holds: a finger that already touches
  // stops, one that has not carries on. They start one after another (index first, little finger last).
  // Without a catch the fingers let go.
  updateClosing(side, dt) {
    const s = this.game;
    const H = this.hands[side];
    const holding = this.caughtT >= 0;
    const tc = holding ? this.t - this.caughtT : 0;
    const r = BALL_RADIUS * s.ball.scale.x;
    for (const f of FINGERS) {
      let c = H.close[f];
      if (!holding) {
        c -= 2.5 * dt;
      } else if (tc >= DELAY[f]) {
        const gap = this.fingerGap(side, f, s.ball.position, r);
        if (gap === null || gap > SKIN) c += CLOSE_RATE * dt; // not touching yet: keep closing
        else if (gap < -SKIN) c -= CLOSE_RATE * 0.5 * dt; // pressing into the ball: ease off
      }
      H.close[f] = clamp01(c);
    }
  }

  // Every finger's own stage for a pose: relaxed -> cup -> claw.
  fingerStages(P, side) {
    const H = this.hands[side];
    const stages = {};
    const idleOnly = 1 - clamp01(P.cup * 1.4); // the little breathing only while the hand is relaxed
    for (const f of FINGERS) {
      const base = IDLE[f] + (READY[f] - IDLE[f]) * P.cup;
      const breathe = 0.04 * idleOnly * Math.sin(this.t * 1.3 + PHASE[f] + (side === 'left' ? 0.9 : 0));
      stages[f] = base + WRAP[f] * H.close[f] + breathe;
    }
    return stages;
  }

  // Sends this frame's hand placement and finger shapes to the emulator.
  apply() {
    const d = this.device;
    if (!d || !d.remote) return this.flush();
    const rig = this.rigOffset();
    for (const side of SIDES) {
      const H = this.hands[side];
      if (!H.pose) H.pose = this.rest(side, this.head());
      const P = H.pose;
      H.sentPalm = P.pos;
      const arr = (a) => [a.x, a.y, a.z];
      this.pending.push(
        d.remote
          .dispatch('set_transform', {
            device: 'hand-' + side,
            position: add(add(P.pos, H.corr), rig, -1),
            orientation: { fingers: arr(P.fingers), palm: arr(P.palm) },
            anchor: 'grip',
          })
          .catch((e) => this.fail(e)),
      );
      H.stage = this.fingerStages(P, side);
      const fingers = {};
      for (const f of FINGERS) fingers[f] = fingerBlend(H.stage[f]);
      this.pending.push(d.remote.dispatch('set_hand_pose', { device: 'hand-' + side, poseId: 'cup', fingers }).catch((e) => this.fail(e)));
    }
    return this.flush();
  }

  fail(e) {
    if (this.failed) return;
    this.failed = true;
    console.warn('[emulator hands] the emulator refused a hand command; leaving the hands to manual control:', e && e.message ? e.message : e);
    this.manual = true;
  }

  // Resolves when every command sent so far has been applied (recordings wait on it before a frame).
  flush() {
    const all = this.pending;
    this.pending = [];
    return Promise.all(all);
  }

  // Lets go of the hands: the emulator's gizmos move them again.
  release() {
    const d = this.device;
    if (!d || !d.hands) return;
    for (const side of SIDES) {
      const hand = d.hands[side];
      if (hand && hand.pin) hand.setPin(null);
      if (hand && Object.keys(hand.fingerPoses || {}).length) hand.clearFingerPoses();
    }
  }

  // Called once a frame, after the game has read the hands.
  update(dt) {
    const on = this.wanted;
    const s = this.game;
    // Only while a round is on. Before it and after it the hands are the player's (to touch the
    // PLAY AGAIN / LOBBY orbs, or just to look at). A recording forces them on throughout.
    const inPlay = this.forced === true || s.state === 'ready' || s.state === 'swinging' || s.state === 'flying' || s.state === 'feedback';
    if (!on || !inPlay) this.updatePlacement();
    else this.prevState = s.state;
    if (!on || !inPlay) {
      if (this.hint) this.hint.style.display = 'none';
      if (this.live) {
        this.release();
        this.live = false;
        for (const side of SIDES) {
          this.hands[side].pose = null;
          this.hands[side].corr = v();
          this.hands[side].sentPalm = null;
          for (const f of FINGERS) this.hands[side].close[f] = 0;
        }
      }
      return;
    }
    this.live = true;
    if (this.hint) this.hint.style.display = this.autoPlay ? 'none' : 'block';
    this.step(Math.min(dt, 0.1));
    this.apply();
  }
}

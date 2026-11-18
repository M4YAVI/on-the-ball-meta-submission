// ON THE BALL · TENNIS: the game system (the player is the receiver, seated on the baseline). It connects the pure logic (src/core) to the headset: it reads where the player is looking,
// scores each delivery, and draws the panels for the current phase.
//
// Rules this file enforces, taken from the product direction:
//   - Eye mode only after a passed calibration. Head mode is a separate, always-labelled mode. Head data is never given an eye label.
//   - Emulator input is labelled SIMULATED and never presented as real eyes.
//   - A pause, a hidden page, or the end of the XR session throws away the ball in flight. It is never scored as a miss.
//   - A sensor failure gives UNSCORED, never red.
//   - Only totals are kept. No gaze or head poses are stored.

import { createSystem, Group, Mesh, MeshBasicMaterial, Pressed, Quaternion, RayInteractable, RingGeometry, SphereGeometry, Vector3, VisibilityState } from '@iwsdk/core';
// The scoring engine, gaze checks, session flow, history and panels are the same ones cricket uses (../../src); only the
// serve physics, the court, the ball and the words are tennis's.
import { angle, STATUS, TOLERANCE as BASE_TOLERANCE, toleranceFor, Trial } from '../../src/core/engine.js';
import { CAL, CalibrationCheck, GazeVerdict, VERDICT } from '../../src/core/gaze-verdict.js';
import { GameFlow, MODE, PHASE } from '../../src/core/flow.js';
import { HistoryStore } from '../../src/core/history.js';
import { Rays } from '../../src/xr/rays.js';
import { Sfx } from '../../src/xr/audio.js';
import { Ui } from '../../src/xr/ui.js';
import { COLORS } from '../../src/xr/theme.js';
import { ballPosition, bounceT, cleanSide, flightMs, makeDeliveries, otherSide, PATH, PHYS, SIDE, SPEED_OPTIONS } from './core/ball-path.js';
import { TennisScene } from './xr/tennis-scene.js';
import { BallRig } from './xr/ball.js';
import { TENNIS_SKIN } from './skin.js';
import { Racket } from './xr/racket.js';
import { MouseRacket } from './xr/mouse-racket.js';
import { ReturnCallout } from './xr/return-callout.js';
import { TimingMeter } from './xr/timing-meter.js';
import { ASSIST, assistContact, contactPoint, easyReturn, hapticFor, launchReturn, predictReturn, RACKET, racketBounce, returnKind, serveVelocity, startCarry, stepCarry, stepReturn, sweepRacket, timingOf } from './core/racket-physics.js';

const LEAD_IN = 1.5; // s: the server settles, lifts his free arm and tosses the ball before he strikes it
const MAX_FLIGHT_STEP = 0.05; // s: the most the ball's flight clock moves in one frame (a frame hitch holds the ball, never jumps it)
const HIT_LINGER = 0.45; // s after a return (and after the serve's arrival time) before the serve is closed
const SWISH_SPEED = 9; // m/s at the sweet spot: a swing this fast whooshes
// Forgiving contact size: metres added to the ball's radius in the strings test. On top of it a SWINGING racket meets any ball
// its sweet spot passes within reach of (core/racket-physics.js ASSIST), and every return lands in (easyReturn): hand play is
// for fun, the eyes are the score. The PC control gets a little more (a wheel is cruder than an arm).
const HIT_PAD = 0.03;
const PC_HIT_PAD = 0.04;
// The racket is in hand on these screens: practice swings before the first serve, every serve, and the pause.
const RACKET_PHASES = new Set([PHASE.READY, PHASE.PLAYING, PHASE.BETWEEN, PHASE.PAUSED]);
const GAP = 2.2; // s between deliveries
const TOLERANCE = BASE_TOLERANCE.base; // 7 deg near the centre; eye mode widens it toward the edge (core/engine.js toleranceFor)
const CAL_ANGLE = 14; // degrees to each side for the calibration dots
const CAL_DIST = 2.4;
const PREFS_KEY = 'otb.prefs.tennis.v1'; // tennis's speeds are not cricket's, so its choice is stored apart
const LOCK_ON_MS = 100; // guide ring: on the ball this long before it turns green
const LOCK_OFF_MS = 150; // and off the ball this long before it goes back to white (no flicker)

function safeStorage() {
  try {
    const s = window.localStorage;
    s.getItem('otb.probe');
    return s;
  } catch (_) {
    return null;
  }
}

const CAL_MESSAGES = {
  'no-gaze': 'No eye-tracking signal was received. Check that eye tracking is allowed on this device, or use Head mode.',
  'off-target': 'We could not see your eyes reach the dot. Try again, or use Head mode.',
  'head-moved': 'Your head moved. Keep it still and move only your eyes. If this keeps happening, this device follows your head, so use Head mode.',
  'gaze-follows-head': 'The gaze followed your head instead of your eyes, so eye mode stays locked. Use Head mode.',
  recentered: 'The view was recentred, so the eye check stopped. Keep your head still and try again.',
};

// Served inside the local hub (https://<pc>/ontheball/) there is a lobby one level up; served on its own there is not.
const IN_HUB = typeof window !== 'undefined' && window.location.pathname.split('/').filter(Boolean).length > 0;

export class GameSystem extends createSystem({ pressed: { required: [RayInteractable, Pressed] } }) {
  init() {
    this.rays = new Rays(this.world);
    this.sfx = new Sfx();
    this.storage = safeStorage();
    this.history = new HistoryStore(this.storage);
    this.flow = new GameFlow({ deliveries: makeDeliveries });
    this.verdict = new GazeVerdict();

    this.o = new Vector3();
    this.d = new Vector3();
    this.ho = new Vector3();
    this.hd = new Vector3();
    this.local = new Vector3();
    this.world3 = new Vector3();
    this.eyeArr = [0, 0, 0];
    this.headArr = [0, 0, 0];
    this.rayArr = [0, 0, 0];
    this.toBall = [0, 0, 0];
    this.headToBall = [0, 0, 0];

    // Everything lives in one anchor placed at the seated player's eyes, so the scene follows their height and facing.
    this.anchor = new Group();
    this.anchor.name = 'otb-anchor';
    this.anchorEntity = this.world.createTransformEntity(this.anchor);
    this.scene3d = new TennisScene();
    this.anchor.add(this.scene3d.root);
    this.ball = new BallRig();
    this.anchor.add(this.ball.group);
    this.calDots = this.makeCalibrationDots();
    this.anchor.add(this.calDots);
    this.headDot = this.makeHeadDot();
    this.anchor.add(this.headDot);
    this.readyDot = this.makeReadyDot();
    this.anchor.add(this.readyDot);
    // Hand play: the racket follows the player's hand and a return goes back by the racket's own speed and direction. The
    // eye-tracking score does not change: it still follows the ball (wherever it goes) and still ends at the serve's arrival.
    this.racket = new Racket(this.world);
    this.anchor.add(this.racket.group, this.racket.body);
    this.callout = new ReturnCallout();
    this.anchor.add(this.callout.mesh);
    this.meter = new TimingMeter(); // EARLY / PERFECT / LATE on the right: feedback for the return, never part of the score
    this.anchor.add(this.meter.mesh);
    this.returned = null; // the last return, still flying or rolling after its serve was scored
    this.swishAt = -Infinity;
    this.hitOnce = false;
    this.hand = { serves: 0, returns: 0, in: 0, winners: 0 }; // the racket's own tally for the scorecard line
    // Desktop emulator only: the mouse wheel swings the racket (a headset never uses this).
    this.mouseRacket = new MouseRacket(this.world);
    this.anchor.add(this.mouseRacket.hint);
    this.racket.override = () => this.mouseRacket.pose(this.anchor);
    this.racket.freeOverride = () => this.mouseRacket.freePose();
    this.cleanupFuncs.push(() => this.mouseRacket.dispose());

    this.eyeAvailable = false;
    this.eyeNote = '';
    this.notice = null;
    this.flash = null;
    this.cur = null;
    this.nextAt = null;
    this.cal = null;
    this.calSnap = null;
    this.calUiAt = 0;
    this.finishedTs = null;
    this.sessionRows = [];
    this.needAnchor = false;
    this.wasInXR = false;
    this.speed = this.loadSpeed();
    // Which half of the court this try is played from. A try never changes side half way: the next try uses the other one.
    this.nextSide = this.loadSide(); // the side the next try starts on (saved, so it carries on alternating after a restart)
    this.side = this.nextSide;
    this.sessionDone = false; // a try has been finished: the next one is played from the other side
    this.skin = { ...TENNIS_SKIN };
    this.updateSkin();
    this.scene3d.setSide(this.side);
    this.guide = this.loadGuide();
    this.streak = 0;
    this.bestStreak = 0;
    this.modeCheckAt = 0;
    this.time = 0;
    this.refSpace = null;
    this.recenterPending = false;
    this.warmFrames = 0;
    this.onRecenter = () => {
      this.recenterPending = true; // handled on the next frame, inside the normal update
    };
    this.cleanupFuncs.push(() => this.detachRecenter());

    this.ui = new Ui(this.world, this.anchorEntity, (id) => this.onPress(id), this.skin);
    this.anchor2D();
    this.toStart();
    this.sharpenXR();
    this.prewarm();

    this.queries.pressed.subscribe('qualify', (entity) => this.ui.press(entity));
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v === VisibilityState.Hidden || v === VisibilityState.VisibleBlurred) this.interruptPlay();
      }),
    );
    const onHidden = () => {
      if (document.hidden) this.interruptPlay();
    };
    document.addEventListener('visibilitychange', onHidden);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', onHidden));

    if (import.meta.env.DEV) {
      window.__otb = {
        flow: this.flow,
        state: () => this.buildState(),
        press: (id) => this.onPress(id, true),
        game: this,
        autopilot: null,
      };
      // dev keys for the simulated-gaze autopilot: 1 follows the ball, 2 late, 3 away, 4 blink, 5 long dropout, 0 off
      const keys = { 1: 'perfect', 2: 'late', 3: 'away', 4: 'blink', 5: 'dropout', 6: 'head', 0: null };
      const onKey = (e) => {
        if (e.key in keys) {
          window.__otb.autopilot = keys[e.key];
          console.info(`[otb] autopilot ${keys[e.key]}`);
        }
      };
      window.addEventListener('keydown', onKey);
      this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));
    }
  }

  // The SDK's own hand and controller models are never drawn: the player sees the racket and his own hands instead (xr/racket.js).
  // The SDK's thin pointer ray and cursor stay, and show only while pointing at a button.
  hideInputModels() {
    const v = this.world.input?.xr?.visualAdapters;
    if (!v) return;
    for (const kind of ['hand', 'controller']) {
      for (const side of ['left', 'right']) {
        const model = v[kind]?.[side]?.visual?.model;
        if (model && model.visible) model.visible = false;
      }
    }
  }

  // Sharper picture in the headset: a bigger render target than the default and no foveated (blurred) edges. Must be set
  // before the VR session starts, so it is done here at load. An optimisation only: the game works without it.
  sharpenXR() {
    try {
      const xr = this.world.renderer?.xr;
      xr?.setFramebufferScaleFactor?.(1.3);
      xr?.setFoveation?.(0);
    } catch (_) {
      /* keep the defaults */
    }
  }

  // The first time the ball, its glow and the ready dot are drawn, the GPU compiles their shaders and uploads their textures.
  // That one-off stall (well over 100 ms) landed inside the first flight, so the warm-up ball came out UNSCORED for "weak
  // tracking". Doing that work here, before anything is played, keeps every flight smooth from the first ball.
  prewarm() {
    const r = this.world.renderer;
    if (!r) return;
    const objs = [this.ball.group, this.readyDot, this.calDots, this.headDot, this.racket.group, this.racket.body, this.racket.free, this.racket.freeOpen, this.racket.freeFist, this.racket.armRacket.group, this.racket.armFree.group, this.callout.mesh, this.meter.mesh];
    const was = objs.map((o) => o.visible);
    try {
      objs.forEach((o) => (o.visible = true));
      this.ball.group.traverse((o) => {
        if (o.material?.map) r.initTexture?.(o.material.map);
      });
      r.compile?.(this.world.scene, this.world.camera);
    } catch (_) {
      /* an optimisation only: the game works without it */
    } finally {
      objs.forEach((o, i) => (o.visible = was[i]));
    }
  }

  // Inside a headset the renderer builds different (XR) shader variants, so the pre-warm above does not cover them. For the
  // first few frames of every XR session the ball is drawn far too small to see, straight ahead, which makes the GPU do that
  // work now instead of on the first release (measured: a 306 ms stall on the release frame without this).
  warmXR() {
    if (!(this.warmFrames > 0)) return;
    const g = this.ball.group;
    if (this.flow.phase === PHASE.PLAYING || this.cur) {
      this.warmFrames = 0; // never interfere with a real ball
      g.scale.setScalar(1);
      return;
    }
    this.warmFrames -= 1;
    if (this.warmFrames > 0) {
      g.visible = true;
      g.scale.setScalar(1e-4);
      g.position.set(0, 0, -3);
    } else {
      g.visible = false;
      g.scale.setScalar(1);
    }
  }

  // ------------------------------------------------------------------ small helpers
  loadSpeed() {
    try {
      const id = JSON.parse(this.storage?.getItem(PREFS_KEY) ?? '{}').speed;
      return SPEED_OPTIONS.find((s) => s.id === id) ?? SPEED_OPTIONS[1];
    } catch (_) {
      return SPEED_OPTIONS[1];
    }
  }
  loadGuide() {
    try {
      return JSON.parse(this.storage?.getItem(PREFS_KEY) ?? '{}').guide !== false; // on unless the player turned it off
    } catch (_) {
      return true;
    }
  }
  loadSide() {
    try {
      return cleanSide(JSON.parse(this.storage?.getItem(PREFS_KEY) ?? '{}').side);
    } catch (_) {
      return SIDE.DEUCE;
    }
  }
  saveSpeed() {
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify({ speed: this.speed.id, guide: this.guide, side: this.nextSide }));
    } catch (_) {
      /* preferences are optional */
    }
  }

  // The words on the ready panel say which side this try is played from.
  updateSkin() {
    const where = this.side === SIDE.AD ? 'the ad side (the server is on your right). ' : 'the deuce side (the server is on your left). ';
    this.skin.warmupIntro = `You are receiving on ${where}One warm-up serve, then 20 serves. `;
    this.skin.intro = `You are receiving on ${where}Twenty serves. `;
  }

  // Move to a side for a new try: the court slides under the seated player and the server walks across. Never done during a try.
  applySide(side) {
    this.side = cleanSide(side);
    this.nextSide = this.side;
    this.sessionDone = false;
    this.scene3d.setSide(this.side);
    this.updateSkin();
    this.saveSpeed();
    if (this.ui) this.refreshUi();
  }

  makeCalibrationDots() {
    const g = new Group();
    g.visible = false;
    this.calMeshes = [];
    for (const side of [1, -1]) {
      // side +1 is the dot to the left (positive yaw), shown first
      const a = (side * CAL_ANGLE * Math.PI) / 180;
      const dot = new Group();
      dot.position.set(-Math.sin(a) * CAL_DIST, -0.1, -Math.cos(a) * CAL_DIST);
      const core = new Mesh(new SphereGeometry(0.05, 20, 14), new MeshBasicMaterial({ color: COLORS.accent, toneMapped: false }));
      const halo = new Mesh(
        new RingGeometry(0.085, 0.1, 40),
        new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false, toneMapped: false }),
      );
      halo.renderOrder = 25;
      dot.add(core, halo);
      dot.userData = { core, halo };
      g.add(dot);
      this.calMeshes.push(dot);
    }
    return g;
  }

  // HEAD mode only: a small, faint ring where the head points, so the player can see what is being measured. Head scoring
  // without it feels broken (the ball "goes red" for no visible reason). Eye and simulated modes never show a cursor: the
  // glasses have no gaze cursor, and the eyes must not chase a dot.
  makeHeadDot() {
    const m = new Mesh(
      new RingGeometry(0.028, 0.04, 40),
      new MeshBasicMaterial({ color: '#F5A524', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    m.renderOrder = 28;
    m.visible = false;
    return m;
  }

  // A soft glow that follows the ball through the toss, so the eyes are already where the serve will start. It fades in over the
  // lead-in and is gone the moment the ball is struck.
  makeReadyDot() {
    const m = new Mesh(
      new SphereGeometry(0.2, 16, 12),
      new MeshBasicMaterial({ color: '#fffbe8', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    m.position.set(PATH.releaseX, PATH.releaseY + 0.02, PATH.releaseZ + 0.2);
    m.renderOrder = 27;
    m.visible = false;
    return m;
  }

  updateHeadDot() {
    const f = this.flow;
    const on = f.mode === MODE.HEAD && (f.phase === PHASE.PLAYING || f.phase === PHASE.BETWEEN) && this.rays.headRay(this.ho, this.hd);
    this.headDot.visible = !!on;
    if (!on) return;
    this.world3.copy(this.hd).multiplyScalar(3).add(this.ho);
    this.anchor.worldToLocal(this.world3);
    this.headDot.position.copy(this.world3);
    this.headDot.lookAt(this.ho);
  }

  buildState() {
    const f = this.flow;
    return {
      phase: f.phase,
      source: f.mode ?? 'head',
      results: f.results.map((r) => r.status),
      counts: f.counts(),
      minutes: f.minutes(),
      ts: this.finishedTs ?? Date.now(),
      eyeAvailable: this.eyeAvailable,
      eyeNote: this.eyeNote,
      emulated: Rays.emulated(),
      calib: this.calSnap,
      notice: this.notice,
      warmup: !!this.cur?.warmup,
      warmupPending: !f.warmupDone,
      flash: this.flash,
      history: this.sessionRows,
      speedLabel: this.speed.label,
      guide: this.guide,
      streak: this.streak,
      bestStreak: this.bestStreak,
      inHub: IN_HUB,
      hand: this.handLine(),
    };
  }

  // The racket's line on the scorecard, under the eye-tracking source (the eye counts stay the score). Only once the racket
  // has been used.
  handLine() {
    const h = this.hand;
    if (!h.returns) return null;
    return { line: `Racket: ${h.in} of ${h.serves} returns in · ${h.winners} winner${h.winners === 1 ? '' : 's'}` };
  }

  resetHand() {
    this.hand = { serves: 0, returns: 0, in: 0, winners: 0 };
  }

  showPhase() {
    if (import.meta.env.DEV && this.lastPhase !== this.flow.phase) {
      console.info(`[otb] phase ${this.flow.phase} mode=${this.flow.mode} ball=${this.flow.results.length}`);
    }
    this.lastPhase = this.flow.phase;
    this.ui.show(this.flow.phase, this.buildState());
  }
  refreshUi() {
    this.ui.refresh(this.buildState());
  }

  // Eye-frame anchor. On a flat screen (preview) it sits where the 2D camera is; in a headset, at the player's head.
  anchor2D() {
    const cam = this.world.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(this.o);
    this.anchor.position.set(this.o.x, 1.2, this.o.z);
    this.anchor.rotation.set(0, 0, 0);
  }

  tryAnchor() {
    if (!this.rays.headRay(this.ho, this.hd) || this.ho.y < 0.25) return; // wait for the first real head pose
    this.anchor.position.copy(this.ho);
    this.anchor.rotation.set(0, Math.atan2(-this.hd.x, -this.hd.z), 0);
    this.needAnchor = false;
    this.showPhase();
  }

  // Recenter (the player holds the system button, or the runtime resets the reference space). The scene is re-placed in
  // front of the player, a ball in flight is thrown away (never a miss), and a running eye check stops, because its
  // "head still" reference is no longer valid (T13).
  attachRecenter() {
    const ref = this.world.renderer?.xr?.getReferenceSpace?.();
    if (!ref || ref === this.refSpace || typeof ref.addEventListener !== 'function') return;
    this.detachRecenter();
    this.refSpace = ref;
    ref.addEventListener('reset', this.onRecenter);
  }

  detachRecenter() {
    try {
      this.refSpace?.removeEventListener('reset', this.onRecenter);
    } catch (_) {
      /* the session is already gone */
    }
    this.refSpace = null;
  }

  handleRecenter() {
    this.recenterPending = false;
    this.interruptPlay();
    if (this.flow.phase === PHASE.CALIBRATING) this.endCalibration(false, 'recentered');
    this.needAnchor = true;
  }

  onSessionChange(inXR) {
    this.wasInXR = inXR;
    if (inXR) {
      this.needAnchor = true;
      this.rays.gazeSeenAt = -Infinity;
      this.verdict.reset();
      this.warmFrames = 4; // see warmXR()
    } else {
      this.detachRecenter();
      this.recenterPending = false;
      this.interruptPlay();
      if (this.flow.phase === PHASE.CALIBRATING) this.endCalibration(false, 'no-gaze');
      this.anchor2D();
    }
    this.showPhase();
  }

  // ------------------------------------------------------------------ input
  onPress(id, force = false) {
    if (!force && !this.rays.inSession()) {
      // the flat-screen preview is look-only: say what to do instead of ignoring the click
      this.notice = 'Start VR with the headset button first. Look and pinch work inside VR.';
      this.refreshUi();
      return;
    }
    this.sfx.unlock();
    const f = this.flow;
    this.notice = null;
    switch (id) {
      case 'btn:eye':
        if (this.eyeAvailable && f.beginCalibration()) this.startCalibration();
        break;
      case 'btn:head':
        if (f.chooseMode(MODE.HEAD)) this.toReady();
        break;
      case 'btn:back':
        // the mode choice is the first screen, so back means the main lobby one level up
        if (IN_HUB && f.phase === PHASE.MODE) window.location.href = new URL('../../', window.location.href).href; // tennis sits one level below ON THE BALL, which sits below the lobby
        break;
      case 'btn:calcancel':
        this.endCalibration(false, null);
        break;
      case 'btn:start':
        this.beginBall();
        break;
      case 'btn:speed': {
        const i = SPEED_OPTIONS.indexOf(this.speed);
        this.speed = SPEED_OPTIONS[(i + 1) % SPEED_OPTIONS.length];
        this.saveSpeed();
        this.refreshUi();
        break;
      }
      case 'btn:guide':
        this.guide = !this.guide;
        this.saveSpeed();
        this.refreshUi();
        break;
      case 'btn:modeback':
        if (f.changeMode()) {
          this.updateEyeAvailability(true);
          this.showPhase();
        }
        break;
      case 'btn:pause':
        this.interruptPlay();
        break;
      case 'btn:resume':
        if (f.resume()) {
          if (f.phase === PHASE.BETWEEN) this.nextAt = this.time + 1.2;
          this.showPhase();
        }
        break;
      case 'btn:retry':
      case 'btn:retry2': {
        const finished = f.phase === PHASE.SCORECARD; // a finished try was already set to flip; an abandoned one flips now
        if (f.retry()) {
          this.flash = null;
          this.streak = 0;
          this.bestStreak = 0;
          this.finishedTs = null;
          this.nextAt = null;
          this.resetHand();
          if (!finished) this.nextSide = otherSide(this.side);
          this.applySide(this.nextSide);
          this.toReady();
        }
        break;
      }
      case 'btn:exit':
      case 'btn:exit2':
        this.cur = null;
        this.roll = null;
        this.returned = null;
        this.callout.hide();
        this.meter.clear();
        this.resetHand();
        this.ball.show(false);
        this.flash = null;
        this.finishedTs = null;
        this.nextAt = null;
        this.streak = 0;
        this.bestStreak = 0;
        this.toStart();
        if (this.sessionDone) this.applySide(this.nextSide); // a finished try: the next one starts on the other side
        break;
      default:
        break;
    }
  }

  // Tennis opens straight on the "how should we follow the ball" choice, like cricket does.
  toStart() {
    this.flow.exit();
    this.flow.selectSport('tennis');
    this.updateEyeAvailability(true);
    this.notice = null;
    this.showPhase();
  }

  toReady() {
    this.verdict.reset();
    this.showPhase();
  }

  // ------------------------------------------------------------------ eye availability and calibration
  updateEyeAvailability(force = false) {
    const inXR = this.rays.inSession();
    const granted = inXR && this.rays.gazeGranted();
    const seen = this.time - this.rays.gazeSeenAt < 5;
    const available = granted && seen;
    let note;
    if (!inXR) note = 'Start VR to play. Eye tracking is only available inside a headset.';
    else if (available) {
      note = Rays.emulated()
        ? 'Eye tracking here comes from the emulator, so scores are labelled SIMULATED. A quick eye check comes first.'
        : 'This device reports eye tracking. A quick eye check (two dots, a few seconds) confirms it follows your eyes, not your head.';
    } else if (granted) note = 'Waiting for the eye tracker to report a signal. Use Head mode if it does not appear.';
    else note = 'This device does not give web apps eye tracking. Head mode follows your head direction and is labelled HEAD.';
    if (force || available !== this.eyeAvailable || note !== this.eyeNote) {
      this.eyeAvailable = available;
      this.eyeNote = note;
      this.ui.setEnabled('btn:eye', available);
      if (this.flow.phase === PHASE.MODE) this.refreshUi();
    }
  }

  startCalibration() {
    this.rays.headRay(this.ho, this.hd);
    this.headArr[0] = this.hd.x;
    this.headArr[1] = this.hd.y;
    this.headArr[2] = this.hd.z;
    this.calDots.visible = true;
    this.calDots.updateWorldMatrix(true, true);
    const targets = this.calMeshes.map((dot, i) => {
      dot.getWorldPosition(this.world3);
      const v = this.world3.sub(this.ho).normalize();
      return { id: i === 0 ? 'left' : 'right', dir: [v.x, v.y, v.z] };
    });
    this.cal = new CalibrationCheck({ targets });
    this.cal.start(this.time * 1000, this.headArr.slice());
    this.calSnap = this.cal.snapshot(0);
    this.showPhase();
  }

  endCalibration(passed, reason) {
    this.calDots.visible = false;
    this.cal = null;
    this.calSnap = null;
    const f = this.flow;
    if (f.phase !== PHASE.CALIBRATING) return;
    f.calibrationResult(passed);
    if (passed) {
      f.chooseMode(Rays.emulated() ? MODE.SIMULATED : MODE.EYE, { calibrated: true });
      this.sfx.play('good');
      this.toReady();
    } else {
      this.notice = reason ? CAL_MESSAGES[reason] ?? CAL_MESSAGES['off-target'] : null;
      this.updateEyeAvailability(true);
      this.showPhase();
    }
  }

  stepCalibration(time) {
    if (import.meta.env.DEV && window.__otb?.autopilot === 'perfect') this.devGazeAt(this.calMeshes[this.cal.targetIndex]);
    const eyeOk = this.rays.eyeRay(this.o, this.d);
    const headOk = this.rays.headRay(this.ho, this.hd);
    this.eyeArr[0] = this.d.x;
    this.eyeArr[1] = this.d.y;
    this.eyeArr[2] = this.d.z;
    this.headArr[0] = this.hd.x;
    this.headArr[1] = this.hd.y;
    this.headArr[2] = this.hd.z;
    const before = this.cal.targetIndex;
    const snap = this.cal.sample(time * 1000, this.eyeArr, this.headArr, eyeOk && headOk);
    this.calSnap = snap;
    if (snap.status === CAL.RUNNING && snap.targetIndex !== before) this.sfx.play('ui', 0.4); // first dot caught: the eyes hear it
    this.calMeshes.forEach((dot, i) => {
      const active = i === snap.targetIndex;
      const pulse = 1 + 0.12 * Math.sin(time * 6);
      dot.userData.core.material.color.set(active ? COLORS.accent : '#3b4540');
      dot.userData.core.scale.setScalar(active ? pulse : 0.7);
      dot.userData.halo.visible = active;
      // the ring closes in on the dot while the eyes hold it, so progress shows where the player is looking
      dot.userData.halo.scale.setScalar(active ? 1.9 - 0.9 * (snap.progress ?? 0) : 1);
      dot.userData.halo.lookAt(this.ho);
    });
    if (snap.status === CAL.PASSED) this.endCalibration(true, null);
    else if (snap.status === CAL.FAILED) this.endCalibration(false, snap.reason);
    else if (time - this.calUiAt > 0.1) {
      this.calUiAt = time;
      this.refreshUi();
    }
  }

  // ------------------------------------------------------------------ playing
  beginBall() {
    const f = this.flow;
    const b = f.beginBall(Date.now());
    if (!b) return;
    // Real flight time for this serve: its strike speed and where it bounces.
    const dur = flightMs(b.delivery.depth, this.speed.kmh);
    this.cur = { ...b, dur, kmh: this.speed.kmh, t0: this.time + LEAD_IN, side: this.side, released: false, bounced: false, locked: false, onSince: null, offSince: null, trial: new Trial(f.mode, dur, TOLERANCE) };
    // when and where this serve reaches the contact point if nobody hits it: the PC racket goes there and times itself to it
    const d = b.delivery;
    this.cur.meet = contactPoint({ lane: d.lane, curve: d.curve, depth: d.depth, kmh: this.speed.kmh, side: this.side }, dur);
    this.nextAt = null;
    this.showPhase();
  }

  // Throw away the ball in flight (pause, hidden page, session end). It is not scored and will be replayed.
  interruptPlay() {
    const f = this.flow;
    if (f.phase !== PHASE.PLAYING && f.phase !== PHASE.BETWEEN) return;
    this.cur = null;
    this.nextAt = null;
    this.roll = null;
    this.returned = null;
    this.callout.hide();
    this.meter.clear();
    this.ball.show(false);
    this.readyDot.visible = false;
    this.scene3d.setDelivery(null);
    if (f.interrupt()) this.showPhase();
  }

  placeRoll(r, dt) {
    this.local.set(r.p[0], r.p[1], r.p[2]);
    this.world3.copy(this.local);
    this.anchor.localToWorld(this.world3);
    this.ball.coast(this.local, this.world3.distanceTo(this.o), r.rest ? 0 : dt);
  }

  // ------------------------------------------------------------------ the racket
  // Did the racket meet the ball between the last frame and this one? p: the ball's position now, v: its velocity (eye frame).
  // On a hit the ball goes back by the racket's own speed and direction (core/racket-physics.js), with a sound and a pulse.
  tryRacket(c, p, v, time) {
    const prev = c.prev;
    c.prev = [p[0], p[1], p[2]];
    const r = this.racket;
    if (c.racketSeen === undefined) c.racketSeen = false;
    if (r.pose) c.racketSeen = true;
    if (!prev || !r.pose || !r.prevPose) return false;
    const pad = PHYS.ballRadius + (r.pcDriven ? PC_HIT_PAD : HIT_PAD);
    let contact = sweepRacket(r.prevPose, r.pose, prev, p, pad);
    if (!contact) {
      // the reach of a swing: the sweet spot passed close to the ball while the racket was swinging through
      const sv = r.velocityAt([0, 0, RACKET.sweetZ], time);
      contact = assistContact(r.prevPose, r.pose, prev, p, r.pcDriven ? ASSIST.reachPc : ASSIST.reach, sv);
    }
    if (!contact) return false;
    const rv = r.velocityAt([0, contact.local[1], contact.local[2]], time);
    let res = racketBounce(v, rv, contact);
    const n = res.normal;
    const start = [contact.ball[0] + n[0] * 0.012, contact.ball[1] + n[1] * 0.012, contact.ball[2] + n[2] * 0.012];
    // Timing: where the racket met the ball. Every return goes back over and in (easy play); PERFECT goes deep and fast for a
    // winner, early is pulled cross-court, late pushed the other way. The player's swing still picks the side.
    const timing = timingOf(contact.ball[2]);
    const easy = easyReturn(res.v, timing, start, c.side);
    res = { ...res, v: easy.v, w: easy.w };
    const kmh = Math.hypot(res.v[0], res.v[1], res.v[2]) * 3.6;
    const st = launchReturn(start, res.v, res.w);
    const hit = { st, res, at: time, kmh, said: null, timing, perfect: easy.perfect, frame: res.frame, v0: res.v.slice() };
    const big = easy.perfect;
    // The outcome is known the moment it leaves the racket (the same physics flown ahead), so the scorecard is right even when
    // the last serve's return is still in the air.
    hit.outcome = returnKind({ ...predictReturn(st, c.side), rest: true }, hit);
    c.hit = hit;
    if (!c.warmup) {
      this.hand.returns += 1;
      if (hit.outcome === 'in' || hit.outcome === 'winner') this.hand.in += 1;
      if (hit.outcome === 'winner') this.hand.winners += 1;
    }
    this.meter.show(timing, !!big);
    this.hitOnce = true;
    this.world3.set(start[0], start[1], start[2]);
    this.anchor.localToWorld(this.world3);
    const loud = Math.min(1, res.impact / 40);
    this.sfx.play(res.frame ? 'edge' : 'racket', 0.35 + 0.5 * loud, { kmh: Math.max(70, kmh), pos: this.world3 });
    const hp = hapticFor(res);
    r.pulse(hp.intensity, hp.ms);
    if (import.meta.env.DEV) {
      console.info(`[otb] hit ${contact.assisted ? `reach ${contact.miss.toFixed(2)}m` : res.frame ? 'frame' : res.sweet ? 'middle' : 'strings'} exit=${kmh.toFixed(0)}km/h racket=${Math.hypot(...rv).toFixed(1)}m/s u=${res.u.toFixed(2)} spin=${Math.hypot(...res.w).toFixed(0)} timing=${timing.zone} z=${contact.ball[2].toFixed(2)} -> ${hit.outcome}${big ? ' PERFECT' : ''}`);
    }
    return true;
  }

  // Move a return on, and call it once it is decided (where it bounces, or the net).
  advanceReturn(h, dt) {
    const before = h.st.bounces;
    stepReturn(h.st, dt, this.side);
    if (h.st.bounces > before && h.st.bounces <= 2) {
      this.world3.set(h.st.p[0], h.st.p[1], h.st.p[2]);
      this.anchor.localToWorld(this.world3);
      this.sfx.play('bounce', h.st.bounces === 1 ? 0.3 : 0.18, { kmh: 90, pos: this.world3 });
    }
    if (h.said) return;
    const kind = returnKind(h.st, h);
    if (!kind) return;
    h.said = kind;
    if (import.meta.env.DEV) console.info(`[otb] return ${kind}${h.perfect ? ' (perfect timing)' : ''}`);
    this.callout.show(kind, h.kmh);
  }

  placeReturned(st, dt) {
    this.local.set(st.p[0], st.p[1], st.p[2]);
    this.world3.copy(this.local);
    this.anchor.localToWorld(this.world3);
    this.ball.coast(this.local, this.world3.distanceTo(this.o), st.rest ? 0 : dt);
  }

  updateRacket(dt, time) {
    const on = RACKET_PHASES.has(this.flow.phase);
    this.racket.setEnabled(on);
    this.meter.setEnabled(on && !!this.world.session);
    if (!on) this.mouseRacket.reset();
    this.mouseRacket.showHint(on && !this.hitOnce);
    // the PC racket moves on the ball's clock (a frame hitch holds both), and knows the serve that is coming
    this.mouseRacket.frameDt = Math.min(dt, MAX_FLIGHT_STEP);
    const c = this.cur;
    if (c?.meet && !c.hit && this.flow.phase === PHASE.PLAYING) {
      const since = c.released ? c.flight + Math.min(dt, MAX_FLIGHT_STEP) : time - c.t0; // the ball's clock at the end of this frame
      this.mouseRacket.setBall(c, c.meet.t - since, c.meet.p, c.meet.speed);
    } else this.mouseRacket.setBall(null);
    if (!this.racket.update(this.anchor, dt, time)) return;
    const sp = this.racket.tipSpeed(time);
    if (sp > SWISH_SPEED && time - this.swishAt > 0.5) {
      this.swishAt = time;
      this.racket.group.getWorldPosition(this.world3);
      this.sfx.play('swish', 0.1 + 0.28 * Math.min(1, (sp - SWISH_SPEED) / 14), { pos: this.world3 });
    }
  }

  stepPlay(dt, time) {
    const c = this.cur;
    if (!c) return;
    this.roll = null;
    const f = this.flow;
    // Once the ball is struck, its clock moves at most MAX_FLIGHT_STEP per frame: a frame hitch (a busy PC running the emulator)
    // holds the ball still for that frame instead of jumping it ahead. At a steady headset frame rate nothing changes.
    const lead = c.released ? (c.flight += Math.min(dt, MAX_FLIGHT_STEP)) : time - c.t0;
    if (lead < 0) {
      this.scene3d.setDelivery(lead); // seconds to the strike: the server lifts his arm and tosses
      // The real tennis ball is there from the start: in the server's hand, then up in the toss.
      this.readyDot.visible = false;
      this.local.set(this.scene3d.tossPos[0], this.scene3d.tossPos[1], this.scene3d.tossPos[2]);
      this.world3.copy(this.local);
      this.anchor.localToWorld(this.world3);
      this.ball.rest(this.local, this.world3.distanceTo(this.o), dt);
      return;
    }
    if (!c.released) {
      c.released = true;
      c.flight = Math.min(lead, MAX_FLIGHT_STEP);
      this.returned = null; // the last return is picked up: a new ball is served
      this.readyDot.visible = false;
      this.ball.show(true);
      const toss = this.scene3d.tossPos || ballPosition(0, c.delivery.lane, c.delivery.curve, c.delivery.depth, c.kmh, c.side);
      this.local.set(toss[0], toss[1], toss[2]);
      this.world3.copy(this.local);
      this.anchor.localToWorld(this.world3);
      this.sfx.play('racket', 0.55, { kmh: c.kmh, pos: this.world3 });
    }
    this.scene3d.setDelivery(lead); // seconds since the strike: the follow-through after the ball has gone
    const ms = lead * 1000;
    const sd = { lane: c.delivery.lane, curve: c.delivery.curve, depth: c.delivery.depth, kmh: c.kmh, side: c.side };
    if (ms >= c.dur) {
      // Past the arrival point the ball flies on along its own path (scoring ended at arrival). The racket can still meet it
      // here: the arrival point is 1.2 m out and a player hits it a little later, nearer the body. A ball nobody hits carries
      // on past the player and is turned aside only once it is past any racket (core/racket-physics.js startCarry).
      if (!c.hit) {
        c.roll ??= startCarry(ballPosition(1, sd.lane, sd.curve, sd.depth, sd.kmh, sd.side), serveVelocity(1, sd, c.dur));
        stepCarry(c.roll, Math.min(dt, MAX_FLIGHT_STEP));
        this.tryRacket(c, c.roll.p, c.roll.v, time);
      } else this.advanceReturn(c.hit, dt);
      if (c.hit) {
        this.placeReturned(c.hit.st, dt);
        if (time - c.hit.at >= HIT_LINGER) this.finishBall(time);
        return;
      }
      this.placeRoll(c.roll, dt);
      if (c.roll.rest) this.finishBall(time);
      return;
    }
    const t01 = ms / c.dur;
    let p;
    if (c.hit) {
      // Returned before its arrival point: the eyes are still scored, against where the ball really is now (off the racket).
      this.advanceReturn(c.hit, dt);
      p = c.hit.st.p;
    } else {
      p = ballPosition(t01, sd.lane, sd.curve, sd.depth, sd.kmh, sd.side);
      if (this.tryRacket(c, p, serveVelocity(t01, sd, c.dur), time)) p = c.hit.st.p;
    }
    if (!c.hit && !c.bounced && t01 >= bounceT(c.delivery.depth, c.kmh)) {
      c.bounced = true; // exactly once: the ball touches the court
      this.local.set(p[0], p[1], p[2]);
      this.world3.copy(this.local);
      this.anchor.localToWorld(this.world3);
      this.sfx.play('bounce', 0.35, { kmh: c.kmh, pos: this.world3 });
    }
    this.local.set(p[0], p[1], p[2]);
    this.world3.copy(this.local);
    this.anchor.localToWorld(this.world3);

    // Where is the player looking from, and which source is it? The source string is the one actually read: a head ray can
    // only ever carry the label 'head', so an eye trial rejects it.
    if (import.meta.env.DEV && window.__otb?.autopilot) this.devAutopilot(t01);
    let ok;
    let source;
    let headOk = false;
    if (f.mode === MODE.HEAD) {
      ok = this.rays.headRay(this.o, this.d);
      source = 'head';
    } else {
      ok = this.rays.eyeRay(this.o, this.d);
      source = f.mode;
      headOk = this.rays.headRay(this.ho, this.hd);
      this.eyeArr[0] = this.d.x;
      this.eyeArr[1] = this.d.y;
      this.eyeArr[2] = this.d.z;
      this.headArr[0] = this.hd.x;
      this.headArr[1] = this.hd.y;
      this.headArr[2] = this.hd.z;
      if (f.mode === MODE.EYE && this.verdict.update(time, this.eyeArr, this.headArr, ok) === VERDICT.HEAD_LOCKED) {
        this.notice = CAL_MESSAGES['gaze-follows-head'];
        this.interruptPlay();
        return;
      }
    }
    let err = NaN;
    if (ok) {
      this.toBall[0] = this.world3.x - this.o.x;
      this.toBall[1] = this.world3.y - this.o.y;
      this.toBall[2] = this.world3.z - this.o.z;
      this.rayArr[0] = this.d.x;
      this.rayArr[1] = this.d.y;
      this.rayArr[2] = this.d.z;
      err = angle(this.rayArr, this.toBall);
    }
    // How far the ball is from where the head points. Toward the edge the eyes (and the tracker) are less exact, so eye mode
    // gets a wider cone there; head mode keeps the fixed one. Without a head pose, the centre value applies.
    let tol = TOLERANCE;
    if (f.mode !== MODE.HEAD && headOk) {
      this.headToBall[0] = this.world3.x - this.ho.x;
      this.headToBall[1] = this.world3.y - this.ho.y;
      this.headToBall[2] = this.world3.z - this.ho.z;
      tol = toleranceFor(angle(this.headArr, this.headToBall), source);
    }
    c.trial.sample(ms, err, source, ok, tol);

    // Guide ring: green while the player is on the ball, white when not. Debounced so it does not flicker. Feedback only.
    // Same cone as the score, so the ring never disagrees with the result.
    if (ok && err <= tol) {
      c.onSince ??= ms;
      c.offSince = null;
    } else {
      c.offSince ??= ms;
      c.onSince = null;
    }
    if (!c.locked && c.onSince !== null && ms - c.onSince >= LOCK_ON_MS) c.locked = true;
    if (c.locked && c.offSince !== null && ms - c.offSince >= LOCK_OFF_MS) c.locked = false;
    this.ball.setLock(this.guide && c.locked, dt);

    this.ball.place(this.local, this.world3.distanceTo(this.o), this.o, dt);
  }

  // DEV ONLY: point the emulator's simulated eyes at an object while the head stays still (calibration demo).
  devGazeAt(obj) {
    const gaze = window.IWER_DEVICE?.gaze;
    if (!gaze || !obj) return;
    this._q = this._q ?? new Quaternion();
    this._v = this._v ?? new Vector3();
    this._f = this._f ?? new Vector3(0, 0, -1);
    this.rays.headRay(this.ho, this.hd);
    obj.getWorldPosition(this._v);
    this._v.sub(this.ho).normalize();
    this._q.setFromUnitVectors(this._f, this._v);
    gaze.connected = true;
    gaze.quaternion.set(this._q.x, this._q.y, this._q.z, this._q.w);
  }

  // DEV ONLY (compiled out of production builds): drive the emulator's simulated gaze so the whole scoring loop can be tested
  // without a person. This is SIMULATED input; it is labelled as such everywhere and is never evidence of real eyes.
  devAutopilot(t01) {
    const dev = window.IWER_DEVICE;
    const gaze = dev?.gaze;
    const mode = window.__otb.autopilot;
    if (mode === 'head' && dev) {
      // the whole head follows the ball (to test HEAD mode)
      this.rays.headRay(this.ho, this.hd);
      this._q = this._q ?? new Quaternion();
      this._v = this._v ?? new Vector3();
      this._f = this._f ?? new Vector3(0, 0, -1);
      this._v.copy(this.world3).sub(this.ho).normalize();
      this._q.setFromUnitVectors(this._f, this._v);
      dev.quaternion.set(this._q.x, this._q.y, this._q.z, this._q.w);
      return;
    }
    if (!gaze) return;
    this.rays.headRay(this.ho, this.hd);
    this._q = this._q ?? new Quaternion();
    this._v = this._v ?? new Vector3();
    this._f = this._f ?? new Vector3(0, 0, -1);
    const blink = mode === 'blink' && t01 > 0.4 && t01 < 0.52; // 12% of the flight (about 95 ms at the default speed)
    const longBlink = mode === 'dropout' && t01 > 0.25 && t01 < 0.8;
    gaze.connected = !(blink || longBlink);
    if (mode === 'away') this._v.set(-0.5, 0, -0.6);
    else if (mode === 'late' && t01 < 0.5) this._v.set(0, 0, -1);
    else this._v.copy(this.world3).sub(this.ho);
    this._v.normalize();
    this._q.setFromUnitVectors(this._f, this._v);
    gaze.quaternion.set(this._q.x, this._q.y, this._q.z, this._q.w);
  }

  finishBall(time) {
    const c = this.cur;
    const f = this.flow;
    const summary = c.trial.finish();
    this.cur = null;
    this.roll = c.hit ? null : c.roll ?? null; // the ball is not removed: it carries on behind the player
    this.returned = c.hit ?? null; // a return flies on (over the net and into the court) while the next serve is set up
    if (!c.warmup && c.racketSeen) this.hand.serves += 1; // a serve faced with the racket in hand counts for the racket line
    const entry = f.completeBall(summary, Date.now());
    if (!entry) return;
    if (import.meta.env.DEV) {
      const ri = this.world.renderer.info.render;
      console.info(`[otb] render calls=${ri.calls} triangles=${ri.triangles}`);
      console.info(`[otb] ball ${entry.warmup ? 'warmup' : entry.index + 1} ${summary.status} quality=${summary.quality.toFixed(2)} coverage=${summary.coverage.toFixed(2)} first=${summary.acquireMs} bad=${summary.bad}`);
    }
    // green streak: a run of greens in a row. Unscored balls (sensor trouble) neither add to it nor break it.
    if (!entry.warmup) {
      if (summary.status === STATUS.GREEN) this.streak += 1;
      else if (summary.status !== STATUS.UNSCORED) this.streak = 0;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
    }
    this.flash = { status: summary.status, reason: summary.reason, quality: summary.quality, coverage: summary.coverage, streak: entry.warmup ? 0 : this.streak, until: time + GAP - 0.3 };
    if (summary.status === STATUS.GREEN) this.sfx.play('good', this.streak >= 3 ? 0.55 : 0.4);
    if (f.phase === PHASE.SCORECARD) {
      this.finishSession();
    } else {
      this.nextAt = time + GAP;
      this.showPhase();
    }
  }

  finishSession() {
    const f = this.flow;
    this.finishedTs = Date.now();
    this.flash = null;
    this.sessionDone = true;
    this.nextSide = otherSide(this.side); // shown from the next try on, never under the scorecard
    this.saveSpeed();
    this.history.add({
      sport: f.sport,
      source: f.mode,
      speed: this.speed.id,
      results: f.results.map((r) => r.status),
      minutes: f.minutes(),
      ts: this.finishedTs,
    });
    this.sessionRows = this.history.recent(f.sport, 3).slice(1, 3); // the two sessions before this one
    try {
      // a lobby tile can show the best number of green balls
      const best = Math.max(Number(this.storage?.getItem('otb-tennis-best-green')) || 0, f.counts().green);
      this.storage?.setItem('otb-tennis-best-green', String(best));
    } catch (_) {
      /* optional */
    }
    this.sfx.play('done', 0.5);
    this.showPhase();
  }

  // ------------------------------------------------------------------ frame loop
  update(dt, time) {
    this.time = time;
    const inXR = this.rays.inSession();
    if (inXR !== this.wasInXR) this.onSessionChange(inXR);
    if (inXR) {
      this.attachRecenter();
      if (this.recenterPending) this.handleRecenter();
      this.warmXR();
    }
    if (this.needAnchor && inXR) this.tryAnchor();
    if (inXR) this.hideInputModels();
    this.rays.noteGaze(time);
    if (this.world?.camera) this.sfx.updateListener(this.world.camera);
    this.scene3d.update(dt);
    // the ball is in the server's hand and then tossed from the start of the build-up until it is struck, and is never left behind
    this.scene3d.setBallAtRest(this.flow.phase === PHASE.PLAYING && !!this.cur && !this.cur.released);
    this.ui.update();
    this.updateHeadDot();
    this.updateRacket(dt, time); // before the ball moves, so the hit test uses this frame's racket

    switch (this.flow.phase) {
      case PHASE.MODE:
        if (time - this.modeCheckAt > 0.25) {
          this.modeCheckAt = time;
          this.updateEyeAvailability();
        }
        break;
      case PHASE.CALIBRATING:
        if (this.cal) this.stepCalibration(time);
        break;
      case PHASE.PLAYING:
        this.stepPlay(dt, time);
        break;
      case PHASE.BETWEEN:
        if (this.roll) {
          stepCarry(this.roll, dt);
          this.placeRoll(this.roll, dt);
        }
        if (this.returned) {
          this.advanceReturn(this.returned, dt);
          this.placeReturned(this.returned.st, dt);
        }
        if (this.nextAt !== null && time >= this.nextAt) this.beginBall();
        break;
      default:
        break;
    }
    // (Once the next serve starts, the same ball is in the server's hand: the last return has long landed by then.)
    this.callout.update(dt);
    this.meter.update(dt);
    if (this.flash && this.flash.until < time && this.flow.phase !== PHASE.SCORECARD) {
      this.flash = null;
      this.refreshUi();
    }
  }
}

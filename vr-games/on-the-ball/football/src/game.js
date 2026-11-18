// ON THE BALL · FOOTBALL: the game system (the player is the goalkeeper). It connects the pure logic (src/core) to the headset: it reads where the player is looking,
// scores each delivery, and draws the panels for the current phase.
//
// Rules this file enforces, taken from the product direction:
//   - Eye mode only after a passed calibration. Head mode is a separate, always-labelled mode. Head data is never given an eye label.
//   - Emulator input is labelled SIMULATED and never presented as real eyes.
//   - A pause, a hidden page, or the end of the XR session throws away the ball in flight. It is never scored as a miss.
//   - A sensor failure gives UNSCORED, never red.
//   - Only totals are kept. No gaze or head poses are stored.

import { startRoll, stepRoll } from '../../src/core/ball-path.js';
import { createSystem, Group, Mesh, MeshBasicMaterial, Pressed, Quaternion, RayInteractable, RingGeometry, SphereGeometry, Vector3, VisibilityState } from '@iwsdk/core';
// The scoring engine, gaze checks, session flow, history and panels are the same ones cricket uses (../../src); only the
// shot physics, the ground, the ball and the words are football's.
import { angle, STATUS, TOLERANCE as BASE_TOLERANCE, toleranceFor, Trial } from '../../src/core/engine.js';
import { CAL, CalibrationCheck, GazeVerdict, VERDICT } from '../../src/core/gaze-verdict.js';
import { GameFlow, MODE, PHASE } from '../../src/core/flow.js';
import { HistoryStore } from '../../src/core/history.js';
import { Rays } from '../../src/xr/rays.js';
import { Sfx } from '../../src/xr/audio.js';
import { Ui } from '../../src/xr/ui.js';
import { COLORS } from '../../src/xr/theme.js';
import { ballPosition, DEFAULT_KMH, flightMs, makeDeliveries, PATH, PHYS, SPEED_OPTIONS } from './core/ball-path.js';
import { FootballScene } from './xr/football-scene.js';
import { BallRig } from './xr/ball.js';
import { FOOTBALL_SKIN } from './skin.js';
import { crossedLine, GLOVE, KeeperScore, meetGlove, pairNormal, SAVE, sweepGlove } from './core/goalkeeping.js';
import { MouseGloves, PlayerGloves } from './xr/gloves.js';
import { SaveCallout } from './xr/save-callout.js';

// The gloves are on the hands on these screens: practice before the first shot, every shot, and the pause.
const GLOVE_PHASES = new Set([PHASE.READY, PHASE.PLAYING, PHASE.BETWEEN, PHASE.PAUSED]);
const SAVE_LINGER = 0.6; // s after a save (or a catch) before the shot is closed and the next one is set up
const SWISH_SPEED = 4.5; // m/s: a hand moving this fast (a dive, a punch) whooshes

const LEAD_IN = 1.75; // s: the striker takes his run-up (see RUN in xr/football-scene.js, it starts 1.55 s out) and draws his foot back
const GAP = 2.2; // s between deliveries
const TOLERANCE = BASE_TOLERANCE.base; // 7 deg near the centre; eye mode widens it toward the edge (core/engine.js toleranceFor)
const CAL_ANGLE = 14; // degrees to each side for the calibration dots
const CAL_DIST = 2.4;
const PREFS_KEY = 'otb.prefs.football.v1'; // football's speeds are not cricket's, so its choice is stored apart
const LOCK_ON_MS = 100; // guide ring: on the ball this long before it turns green
const LOCK_OFF_MS = 150; // and off the ball this long before it goes back to white (no flicker)
const MAX_FLIGHT_STEP = 0.05; // s: the most the ball's clock moves in one frame (see stepPlay; the same rule as cricket)
const KEEPER_STEP = 1 / 240; // s: the carry-on past the keeper is moved in steps this small, so no frame skips the hands

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
    this.scene3d = new FootballScene();
    this.anchor.add(this.scene3d.root);
    this.ball = new BallRig();
    this.anchor.add(this.ball.group);
    // Hand play: the gloves follow the player's hands, and a shot they meet is saved (or caught). The eye-tracking score does
    // not change: it still follows the ball and still ends at the ball's arrival; the gloves get the ball after that.
    this.gloves = new PlayerGloves(this.world);
    this.anchor.add(this.gloves.group);
    this.callout = new SaveCallout();
    this.anchor.add(this.callout.mesh);
    this.keeper = new KeeperScore();
    this.held = null; // a caught ball, held in the gloves until the next shot
    this.savedOnce = false;
    this.swishAt = -Infinity;
    // Desktop emulator only: the PC control stands in for the hands (a headset never uses it). The dev keeper wins over it.
    this.mouseGloves = new MouseGloves(this.world);
    this.anchor.add(this.mouseGloves.hint);
    this.gloves.override = () => (import.meta.env.DEV ? this.devKeeperPose() : null) ?? this.mouseGloves.pose(this.anchor);
    this.calDots = this.makeCalibrationDots();
    this.anchor.add(this.calDots);
    this.headDot = this.makeHeadDot();
    this.anchor.add(this.headDot);
    this.readyDot = this.makeReadyDot();
    this.anchor.add(this.readyDot);

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
    this.cleanupFuncs.push(() => this.mouseGloves.dispose());

    this.ui = new Ui(this.world, this.anchorEntity, (id) => this.onPress(id), FOOTBALL_SKIN);
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

  // Watch-only game: hands and controllers only select, so their 3D models are never drawn. The SDK's thin pointer ray and
  // cursor stay, and show only while pointing at a button.
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
    const objs = [this.ball.group, this.gloves.group, this.callout.mesh, this.readyDot, this.calDots, this.headDot];
    const was = objs.map((o) => o.visible);
    try {
      objs.forEach((o) => (o.visible = true));
      this.ball.group.traverse((o) => {
        if (o.material?.map) r.initTexture?.(o.material.map);
      });
      this.gloves.group.traverse((o) => {
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
      return SPEED_OPTIONS.find((s) => s.id === id) ?? SPEED_OPTIONS.find((s) => s.kmh === DEFAULT_KMH);
    } catch (_) {
      return SPEED_OPTIONS.find((s) => s.kmh === DEFAULT_KMH);
    }
  }
  loadGuide() {
    try {
      return JSON.parse(this.storage?.getItem(PREFS_KEY) ?? '{}').guide !== false; // on unless the player turned it off
    } catch (_) {
      return true;
    }
  }
  saveSpeed() {
    try {
      this.storage?.setItem(PREFS_KEY, JSON.stringify({ speed: this.speed.id, guide: this.guide }));
    } catch (_) {
      /* preferences are optional */
    }
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

  // A soft glow on the ball at the striker's foot while he gets set, so the eyes are already where the shot will start. It fades
  // in over the lead-in and is gone the moment the ball is struck.
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
      hand: this.keeper.shots > 0 ? this.keeper.summary() : null, // the gloves' line on the scorecard, beside the eye counts
    };
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
        if (IN_HUB && f.phase === PHASE.MODE) window.location.href = new URL('../../', window.location.href).href; // football sits one level below ON THE BALL, which sits below the lobby
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
      case 'btn:retry2':
        if (f.retry()) {
          this.flash = null;
          this.streak = 0;
          this.bestStreak = 0;
          this.keeper.reset();
          this.callout.hide();
          this.held = null;
          this.finishedTs = null;
          this.nextAt = null;
          this.toReady();
        }
        break;
      case 'btn:exit':
      case 'btn:exit2':
        this.cur = null;
        this.roll = null;
        this.held = null;
        this.ball.show(false);
        this.flash = null;
        this.finishedTs = null;
        this.nextAt = null;
        this.streak = 0;
        this.bestStreak = 0;
        this.toStart();
        break;
      default:
        break;
    }
  }

  // Football opens straight on the "how should we follow the ball" choice, like cricket does.
  toStart() {
    this.keeper.reset();
    this.callout.hide();
    this.held = null;
    this.flow.exit();
    this.flow.selectSport('football');
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
    // Real flight time for this shot: its release speed and how high it arrives.
    const dur = flightMs(b.delivery.height, this.speed.kmh);
    this.cur = { ...b, dur, kmh: this.speed.kmh, t0: this.time + LEAD_IN, released: false, locked: false, onSince: null, offSince: null, trial: new Trial(f.mode, dur, TOLERANCE) };
    this.nextAt = null;
    this.held = null; // the caught ball goes back to the striker
    this.roll = null;
    this.showPhase();
  }

  // Throw away the ball in flight (pause, hidden page, session end). It is not scored and will be replayed.
  interruptPlay() {
    const f = this.flow;
    if (f.phase !== PHASE.PLAYING && f.phase !== PHASE.BETWEEN) return;
    this.cur = null;
    this.nextAt = null;
    this.roll = null;
    this.held = null;
    this.ball.show(false);
    this.callout.hide();
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

  stepPlay(dt, time) {
    const c = this.cur;
    if (!c) return;
    this.roll = null;
    const f = this.flow;
    // Once the ball is struck, its clock moves at most MAX_FLIGHT_STEP per frame. A frame hitch (a busy PC running the emulator,
    // a GC pause) then holds the ball still for that frame instead of jumping it ahead, so the gaze is always compared with where
    // the ball was actually drawn, and the ball cannot jump past the gloves. At a headset's steady frame rate nothing changes.
    const step = Math.min(dt, MAX_FLIGHT_STEP);
    const lead = c.released ? (c.flight += step) : time - c.t0;
    if (lead < 0) {
      this.scene3d.setDelivery(lead); // seconds to the strike: the striker draws his foot back
      // The real football is on the spot from the start, so the eyes begin on the actual ball.
      this.readyDot.visible = false;
      const p0 = ballPosition(0, c.delivery.lane, c.delivery.curve, c.delivery.height, c.kmh, c.delivery.dip);
      this.local.set(p0[0], p0[1], p0[2]);
      this.world3.copy(this.local);
      this.anchor.localToWorld(this.world3);
      this.ball.rest(this.local, this.world3.distanceTo(this.o), dt);
      return;
    }
    if (!c.released) {
      c.released = true;
      c.flight = Math.min(lead, MAX_FLIGHT_STEP);
      this.readyDot.visible = false;
      this.ball.show(true);
      const p0 = ballPosition(0, c.delivery.lane, c.delivery.curve, c.delivery.height, c.kmh, c.delivery.dip);
      this.local.set(p0[0], p0[1], p0[2]);
      this.world3.copy(this.local);
      this.anchor.localToWorld(this.world3);
      this.sfx.play('kick', 0.6, { kmh: c.kmh, pos: this.world3 });
    }
    this.scene3d.setDelivery(c.flight); // seconds since the strike: the follow-through after the ball has gone
    const ms = c.flight * 1000;
    if (ms >= c.dur) {
      // Past the arrival point the eye score is finished. Now it is the keeper's: the ball carries on toward the goal, and the
      // gloves can meet it. clearIn3d: it only swerves aside if it would really pass through the face, so a shot at the body
      // carries straight on through the space in front of it, where the hands are.
      if (!c.roll) {
        c.roll = startRoll((u) => ballPosition(u, c.delivery.lane, c.delivery.curve, c.delivery.height, c.kmh, c.delivery.dip), c.dur, 0.5, true);
        c.prev = [c.roll.p[0], c.roll.p[1], c.roll.p[2]];
      }
      if (c.caught) {
        this.placeHeld();
        if (time - c.caught.at >= SAVE_LINGER) this.finishBall(time);
        return;
      }
      // Small steps through this frame; the gloves are taken along their own path from last frame to this one.
      const n = Math.max(1, Math.ceil(step / KEEPER_STEP));
      for (let i = 1; i <= n && !c.caught; i++) {
        stepRoll(c.roll, step / n);
        if (!c.touched) this.tryGloves(c, time, (i - 1) / n, i / n);
        this.judgeShot(c, time);
      }
      if (c.caught) {
        this.placeHeld();
        return;
      }
      this.placeRoll(c.roll, step);
      const lingered = c.decided && c.decided.kind !== SAVE.GOAL && time - c.decided.at >= SAVE_LINGER;
      if (c.roll.p[2] >= 1.0 || c.roll.rest || lingered) this.finishBall(time);
      return;
    }
    const t01 = ms / c.dur;
    const p = ballPosition(t01, c.delivery.lane, c.delivery.curve, c.delivery.height, c.kmh, c.delivery.dip);
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

  // ------------------------------------------------------------------ goalkeeping
  // Did a glove meet the ball between the last frame and this one? Both are swept (the ball and the palm each moved this frame),
  // so a fast shot or a fast dive cannot slip through. On contact the ball is caught (two hands together, a shot slow enough to
  // hold) or leaves the gloves by plain physics (core/goalkeeping.js): pushed out by a square block, only bent by a fingertip.
  // f0..f1: which part of this frame the step covers; each palm is taken at that point of its path from last frame to this one.
  tryGloves(c, time, f0 = 0, f1 = 1) {
    const g = this.gloves;
    const p = c.roll.p;
    const prev = c.prev;
    c.prev = [p[0], p[1], p[2]];
    if (g.anyTracked()) c.glovesSeen = true;
    if (!prev || c.decided) return false;
    const reach = g.pcDriven ? GLOVE.pcReach : GLOVE.reach;
    const at = (gl, f) => [gl.prevPalm.x + (gl.palm.x - gl.prevPalm.x) * f, gl.prevPalm.y + (gl.palm.y - gl.prevPalm.y) * f, gl.prevPalm.z + (gl.palm.z - gl.prevPalm.z) * f];
    let best = null;
    for (const gl of g.sides) {
      if (!gl.ok || !gl.prevOk) continue;
      const hit = sweepGlove(prev, p, at(gl, f0), at(gl, f1), reach);
      if (hit && (!best || hit.t < best.hit.t)) best = { hit, gl };
    }
    if (!best) return false;
    const together = g.together();
    let gv = best.gl.velocity(time);
    if (together) {
      const a = g.left.velocity(time);
      const b = g.right.velocity(time);
      gv = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    const v = c.roll.v;
    // two hands together are one surface: the bounce is off the pair, not off the edge of the palm touched first
    const ft = f0 + (f1 - f0) * best.hit.t;
    const n = together ? pairNormal(best.hit.ball, at(g.left, ft), at(g.right, ft)) : best.hit.normal;
    const res = meetGlove(v, gv, n, together);
    const speed = Math.hypot(v[0] - gv[0], v[1] - gv[1], v[2] - gv[2]);
    c.touched = true;
    c.deflect = res.kind;
    const cp = best.hit.ball;
    this.world3.set(cp[0], cp[1], cp[2]);
    this.anchor.localToWorld(this.world3);
    this.sfx.play('glove', 0.4 + 0.4 * Math.min(1, speed / 30), { kmh: Math.max(60, speed * 3.6), pos: this.world3 });
    g.pulse(together ? 'both' : best.gl.side, Math.min(1, 0.55 + speed / 50), res.kind === SAVE.CATCH ? 60 : 45);
    if (res.kind !== SAVE.CATCH) g.react(together ? 'both' : best.gl.side, time); // the fingers spring wide (a catch closes them)
    if (import.meta.env.DEV) {
      console.info(`[otb] glove ${together ? 'both' : best.gl.side} ${res.kind} ball=${speed.toFixed(1)}m/s hand=${Math.hypot(...gv).toFixed(1)}m/s out=[${res.v.map((x) => x.toFixed(1)).join(',')}]`);
    }
    if (res.kind === SAVE.CATCH) {
      c.caught = { at: time };
      c.roll.v = [0, 0, 0];
      this.decide(c, SAVE.CATCH, time);
      return true;
    }
    // Off the glove: from the contact point, just clear of the palm, with its new velocity.
    c.roll.p = [cp[0] + n[0] * 0.01, cp[1] + n[1] * 0.01, cp[2] + n[2] * 0.01];
    c.roll.v = res.v;
    c.roll.rest = false;
    return true;
  }

  // Is the shot decided yet? Over the line (inside the posts, under the bar) is a goal, touched or not. A touched ball that is
  // going back out (or has stopped) short of the line is a save.
  judgeShot(c, time) {
    if (c.decided) return;
    const r = c.roll;
    if (crossedLine(r.p)) this.decide(c, SAVE.GOAL, time);
    else if (c.touched && (r.v[2] <= 0 || r.rest)) this.decide(c, c.deflect, time);
  }

  // The shot is decided: the keeper's tally takes it and the call-out says it. A shot with no glove tracked while it came
  // through is not counted and not called (like a sensor failure: never a goal against the player). Warm-up: called, not counted.
  decide(c, kind, time) {
    if (c.decided) return;
    c.decided = { kind, at: time };
    if (!c.glovesSeen) return;
    const res = this.keeper.record({ kind, touched: !!c.touched }, { count: !c.warmup, kmh: c.kmh });
    this.callout.show(res);
    if (res.saved) {
      this.savedOnce = true;
    } else {
      this.sfx.play('bounce', 0.3); // into the net
    }
    if (import.meta.env.DEV) console.info(`[otb] keeper ${kind}${c.touched && kind === SAVE.GOAL ? ' (touched)' : ''} ${this.keeper.line()}`);
  }

  // Where a caught ball sits: in front of the palms, between the two gloves, moving with the hands.
  placeHeld(dt = 0) {
    const g = this.gloves;
    this._held ??= new Vector3(0, -0.35, -0.85);
    if (g.left.ok || g.right.ok) {
      const a = g.left.ok ? g.left.palm : g.right.palm;
      const b = g.right.ok ? g.right.palm : g.left.palm;
      this._held.copy(a).add(b).multiplyScalar(0.5);
      this._held.z -= PHYS.ballRadius * 0.75;
    }
    this.local.copy(this._held);
    this.world3.copy(this.local);
    this.anchor.localToWorld(this.world3);
    this.ball.rest(this.local, this.world3.distanceTo(this.o), dt);
  }

  updateGloves(dt, time) {
    const on = GLOVE_PHASES.has(this.flow.phase);
    this.gloves.setEnabled(on);
    if (!on) this.mouseGloves.reset();
    this.mouseGloves.showHint(on && !this.savedOnce);
    this.gloves.update(this.anchor, dt, time);
    // the hands: open wide from the striker's last steps until the shot is decided, cupped round a held ball
    const c = this.cur;
    this.gloves.setAlert(!!c && !c.decided && !c.caught && time >= c.t0 - 0.45);
    this.gloves.setHold(!!c?.caught || !!this.held);
    // a dive or a punch whooshes
    for (const gl of this.gloves.sides) {
      if (!gl.ok || this.gloves.pcDriven) continue;
      const sp = Math.hypot(...gl.velocity(time));
      if (sp > SWISH_SPEED && time - this.swishAt > 0.5) {
        this.swishAt = time;
        this.world3.copy(gl.palm);
        this.anchor.localToWorld(this.world3);
        this.sfx.play('swish', 0.1 + 0.25 * Math.min(1, (sp - SWISH_SPEED) / 8), { pos: this.world3 });
      }
    }
  }

  // DEV ONLY (compiled out of production builds): a simulated keeper. window.__otb.keeper = 'hands' puts both gloves together
  // where the shot will pass, 'one' puts only the left glove there (the right well wide), 'miss' puts both well wide; null
  // leaves the PC control or the real hands in charge.
  devKeeperPose() {
    const mode = window.__otb?.keeper;
    if (!mode) return null;
    this._dk ??= { left: { p: new Vector3() }, right: { p: new Vector3() } };
    const c = this.cur;
    let x = 0;
    let y = -0.2;
    const z = -0.48; // where a keeper's hands really are: elbows bent, under half a metre in front of the eyes
    if (c?.released) {
      if (c.devPass === undefined) {
        const r = startRoll((u) => ballPosition(u, c.delivery.lane, c.delivery.curve, c.delivery.height, c.kmh, c.delivery.dip), c.dur, 0.5, true);
        for (let i = 0; i < 800 && r.p[2] < z && !r.rest; i++) stepRoll(r, 0.004);
        c.devPass = r.p.slice();
      }
      x = c.devPass[0];
      y = c.devPass[1];
    } else if (this.held) return { left: { p: this._dk.left.p }, right: { p: this._dk.right.p } }; // hold still with the ball
    if (mode === 'miss') x += x >= 0 ? -0.9 : 0.9;
    const gapL = mode === 'one' ? 0 : -0.15;
    const gapR = mode === 'one' ? 0.6 : 0.15;
    // the grip sits behind the palm: put the palm centre (grip + palmOut toward the ball) on the line
    this._dk.left.p.set(x + gapL, y, z + GLOVE.palmOut);
    this._dk.right.p.set(x + gapR, y, z + GLOVE.palmOut);
    return this._dk;
  }

  finishBall(time) {
    const c = this.cur;
    const f = this.flow;
    const summary = c.trial.finish();
    // the keeper's call, if the ball has not made it yet (a no-op when it has): touched and kept out is a save, else a goal
    if (!c.decided) this.decide(c, c.touched ? c.deflect : SAVE.GOAL, time);
    this.cur = null;
    this.held = c.caught ? true : null; // a caught ball stays in the gloves while the next shot is set up
    this.roll = c.caught ? null : c.roll ?? null; // otherwise the ball is not removed: it rolls on (in the net, or back out) and rests
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
      const best = Math.max(Number(this.storage?.getItem('otb-football-best-green')) || 0, f.counts().green);
      this.storage?.setItem('otb-football-best-green', String(best));
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
    // the ball waits on the grass from the start of the build-up until it is struck, and is never left behind
    this.scene3d.setBallAtRest(this.flow.phase === PHASE.PLAYING && !!this.cur && !this.cur.released);
    this.ui.update();
    this.updateHeadDot();
    this.updateGloves(dt, time); // before the ball moves, so the save test uses this frame's gloves

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
          stepRoll(this.roll, dt);
          this.placeRoll(this.roll, dt);
        }
        if (this.held) this.placeHeld(dt);
        if (this.nextAt !== null && time >= this.nextAt) this.beginBall();
        break;
      default:
        break;
    }
    this.callout.update(dt);
    if (this.flash && this.flash.until < time && this.flow.phase !== PHASE.SCORECARD) {
      this.flash = null;
      this.refreshUi();
    }
  }
}

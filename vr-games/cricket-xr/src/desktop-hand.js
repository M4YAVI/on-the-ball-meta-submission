import { CFG } from './config.js';
import { addWristFade, skin, trackedHands } from './hands.js';
import { applyCurl, basisQuaternion, buildCurlRig, desiredHandPose, easePose, wantsBothHands } from './hand-anim.js';
import {
  AssetManager,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';

// Mouse-controlled hands for visitors without a headset: the pointer moves a hand on the plane
// where balls arrive. It switches itself off as soon as an XR session starts.
// The hands are the same rigged models the headset uses, and they move like a fielder's (hand-anim.js):
// palms turn to face the ball, all the fingers soften into a cup as it nears and close round it once
// it is caught. A ball coming at the body brings the other hand across, so the two make one cup
// (pairing); a wide ball is a one-handed stretch.
const CATCH_PLANE_Z = CFG.arriveZ;
const SIDES = ['left', 'right'];
const SX = { left: -1, right: 1 };

export class DesktopHand {
  constructor(world) {
    this.world = world;
    this.position = new Vector3(0, 1.2, CATCH_PLANE_Z);
    this.active = false;
    this.seen = false; // has the pointer moved over the canvas yet?
    const params = new URLSearchParams(globalThis.location?.search || '');
    this.handMode = params.get('hand') || 'right'; // 'right' | 'left' | 'both'
    // Where each hand's palm is this frame (null: that hand is not in use). game.js reads these.
    this.palms = { left: null, right: null };
    this.pair = 0; // 0..1: how far the partner hand has come across to make a two-handed cup
    this.paired = false;
    this.wasPaired = false;

    this.plane = new Plane(new Vector3(0, 0, 1), -CATCH_PLANE_Z); // the plane z = CATCH_PLANE_Z
    this.ray = new Raycaster();
    this.ndc = new Vector2();
    this.hit = new Vector3();

    this.marker = new Group();
    // The ring shows the catch reach around the hand; it draws over the hand so it never hides.
    const material = new MeshBasicMaterial({ color: 0x7fe6ff, transparent: true, opacity: 0.55, side: DoubleSide, depthTest: false });
    this.marker.add(new Mesh(new RingGeometry(0.2, 0.225, 48), material));
    this.marker.renderOrder = 10;
    this.marker.visible = false;
    world.createTransformEntity(this.marker);

    this.viz = {};
    for (const side of SIDES) {
      const v = this.buildHand(side);
      if (!v) continue;
      v.group.visible = false;
      world.createTransformEntity(v.group);
      this.viz[side] = v;
    }

    this.ctx = { palm: null, head: null, ballPos: null, ballVel: null, ballActive: false, holding: false, side: 'right', pair: false };
    this.target = { normal: new Vector3(), fingers: new Vector3(), openness: 0.8, gap: 0.32, proximity: 0 };
    this.headPos = new Vector3();
    this.q = new Quaternion();

    const el = window; // the page can hold more than one canvas; accept the pointer over any of them
    this.gripSum = new Vector3();
    this.gripPrev = new Vector3();
    this.gripKnown = false;
    this.tmp = new Vector3();
    const onMove = (e) => {
      const cv = e.target;
      if (!cv || cv.tagName !== 'CANVAS') return; // ignore the emulator's panels and page UI
      const r = cv.getBoundingClientRect();
      if (document.pointerLockElement === cv) {
        // Emulator Play mode: the pointer is locked, so accumulate its movement.
        this.ndc.x = Math.max(-1, Math.min(1, this.ndc.x + (e.movementX / r.width) * 2));
        this.ndc.y = Math.max(-1, Math.min(1, this.ndc.y - (e.movementY / r.height) * 2));
      } else {
        this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
      this.seen = true;
      this.gripKnown = false;
    };
    const onKeyDown = (e) => {
      if (e.key === 'h' || e.key === 'H') {
        this.cycleHandMode();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('keydown', onKeyDown);
    this.dispose = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('keydown', onKeyDown);
    };
  }

  cycleHandMode() {
    if (this.handMode === 'right') this.handMode = 'left';
    else if (this.handMode === 'left') this.handMode = 'both';
    else this.handMode = 'right';
  }

  // Stands the model's hand upright, palm towards the coach (thumb to -x for a right hand, +x for a
  // left), with the palm centre at the group's origin: the resting frame hand-anim.js poses from.
  // The model's own bind pose is not upright, so the turn is worked out from its joints.
  buildHand(side) {
    let gltf;
    try {
      gltf = AssetManager.getGLTF('hand-' + side);
    } catch (e) {
      return null; // the ring alone still works
    }
    if (!gltf) return null;
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const at = (name) => model.getObjectByName(name).getWorldPosition(new Vector3());
    const wrist = at('wrist');
    const knuckle = at('middle-finger-phalanx-proximal');
    const fingers = at('middle-finger-tip').sub(wrist).normalize();
    const across = at('index-finger-metacarpal').sub(at('pinky-finger-metacarpal'));
    across.addScaledVector(fingers, -across.dot(fingers)).normalize();
    const out = new Vector3().crossVectors(across, fingers);
    // For a right hand `out` is the palm side; a left hand is its mirror image, so there it is the back.
    const palmOut = side === 'left' ? out.clone().negate() : out.clone();
    // The finger rig reads the bind pose, so it is built before anything is moved.
    const rig = buildCurlRig(model, palmOut);
    // Model axes (index side, fingers, out) -> world: fingers up, palm facing the coach.
    const from = new Matrix4().makeBasis(across, fingers, out);
    const to = side === 'left'
      ? new Matrix4().makeBasis(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1))
      : new Matrix4().makeBasis(new Vector3(-1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, -1));
    const turn = to.multiply(from.transpose());

    model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = skin;
        o.frustumCulled = false;
        addWristFade(model, o); // without it the skin shader discards the whole hand
      }
    });
    const inner = new Group();
    inner.add(model);
    inner.quaternion.setFromRotationMatrix(turn);
    const palm = wrist.clone().lerp(knuckle, 0.55).applyMatrix4(turn);
    inner.position.copy(palm).negate();
    const group = new Group();
    group.add(inner);
    group.scale.setScalar(1.4); // the desktop camera sits further back than a player's eyes, so it reads larger
    return {
      group,
      rig,
      side,
      pose: { normal: new Vector3(0, 0, -1), fingers: new Vector3(0, 1, 0), openness: 0.8, gap: 0.32 },
      pos: new Vector3(),
    };
  }

  // A controller moved by hand (emulator handle) takes control back from the mouse.
  controllerMoved(player) {
    if (!player || !player.gripSpaces) return false;
    this.gripSum.set(0, 0, 0);
    for (const side of ['left', 'right']) {
      const g = player.gripSpaces[side];
      if (g && g.visible) this.gripSum.add(g.getWorldPosition(this.tmp));
    }
    const moved = this.gripKnown && this.gripSum.distanceTo(this.gripPrev) > 0.06;
    this.gripPrev.copy(this.gripSum);
    this.gripKnown = true;
    return moved;
  }

  hideHands() {
    this.active = false;
    this.marker.visible = false;
    this.palms.left = null;
    this.palms.right = null;
    for (const side of SIDES) if (this.viz[side]) this.viz[side].group.visible = false;
  }

  // game: the game system (ball, aim, state), so the hands can react to the ball. dt: seconds.
  update(player, game = null, dt = 1 / 60) {
    const inSession = !!this.world.session;
    // Check if live XR hands or controllers are actively providing input
    const liveHandsPresent = inSession && player && player.gripSpaces &&
      (player.gripSpaces.left?.visible || player.gripSpaces.right?.visible ||
       (trackedHands.left?.joints?.wrist && trackedHands.left?.mesh?.visible) ||
       (trackedHands.right?.joints?.wrist && trackedHands.right?.mesh?.visible));

    if (inSession && liveHandsPresent) {
      // In active WebXR session with live or emulated XR hands:
      // Real WebXR hand tracking takes full priority. Never let the mouse hijack or hide hands.
      // The tracked hands are never posed from here: their fingers always come from the real joints.
      this.seen = false;
      this.hideHands();
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = true;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = true;
      return;
    }

    if (this.seen && inSession && this.controllerMoved(player)) {
      this.seen = false;
    }
    if (!this.seen) {
      this.hideHands();
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = true;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = true;
      return;
    }
    let scale;
    if (inSession) {
      // Flat preview in emulator when no hands are connected:
      // Map pointer across comfortable catch zone: +-1.2m left/right and 0.25m up to 2.2m
      this.position.set(this.ndc.x * 1.2, 1.25 + this.ndc.y * 0.95, CATCH_PLANE_Z);
      scale = 1;
    } else {
      this.ray.setFromCamera(this.ndc, this.world.camera);
      if (this.ray.ray.intersectPlane(this.plane, this.hit)) {
        this.position.set(
          Math.min(1.5, Math.max(-1.5, this.hit.x)),
          Math.min(2.4, Math.max(0.25, this.hit.y)),
          CATCH_PLANE_Z,
        );
      }
      scale = 1.4;
    }
    this.active = true;
    this.marker.position.copy(this.position);
    this.marker.visible = true;
    this.poseHands(game, dt, scale, inSession);
    // Only in desktop mode when no XR session is active, hide stationary dummy hand models
    if (!inSession) {
      if (trackedHands.left && trackedHands.left.mesh) trackedHands.left.mesh.visible = false;
      if (trackedHands.right && trackedHands.right.mesh) trackedHands.right.mesh.visible = false;
    }
  }

  // Places and poses both hands: the lead hand on the pointer, the partner coming across to make a cup.
  poseHands(game, dt, scale, inSession) {
    const mode = this.handMode;
    const lead = mode === 'left' ? 'left' : 'right';
    const holding = !!(game && game.heldBy);
    const flying = !!(game && game.state === 'flying');
    if (game) {
      (inSession && game.player?.head ? game.player.head : this.world.camera).getWorldPosition(this.headPos);
    } else {
      this.world.camera.getWorldPosition(this.headPos);
    }
    // Remember whether the hands were together at the moment of the catch: they stay round the ball.
    if (holding && !this.wasHolding) this.wasPaired = this.paired;
    this.wasHolding = holding;
    const want = mode === 'both' || wantsBothHands(game && {
      state: game.state,
      holding,
      twoHanded: game.twoHanded,
      wasPaired: this.wasPaired,
      isWide: game.isWide,
      aimX: game.aim ? game.aim.x : 0,
      headX: this.headPos.x,
    });
    this.pair += ((want ? 1 : 0) - this.pair) * (1 - Math.exp(-dt * (want ? 9 : 5)));
    this.paired = this.pair > 0.5;

    const ctx = this.ctx;
    ctx.head = this.headPos;
    ctx.ballPos = game && game.ball ? game.ball.position : null;
    ctx.ballVel = game ? game.vel : null;
    ctx.ballActive = flying;
    ctx.holding = holding;
    ctx.pair = this.pair > 0.05;

    for (const side of SIDES) {
      const v = this.viz[side];
      const isLead = side === lead;
      const k = isLead ? 1 : this.pair; // how present this hand is
      const used = isLead || this.pair > 0.05;
      if (!used) {
        this.palms[side] = null;
        if (v) v.group.visible = false;
        continue;
      }
      // Half the gap between the palms, to each side of the pointer; the partner rises in from below.
      const half = ctx.pair ? (v ? v.pose.gap : 0.12) * 0.5 : 0;
      const pos = v ? v.pos : (this.palms[side] = this.palms[side] || new Vector3());
      pos.copy(this.position);
      pos.x += SX[side] * half * this.pair;
      if (!isLead) {
        pos.y -= 0.25 * (1 - k);
        pos.z += 0.12 * (1 - k);
      }
      this.palms[side] = pos;
      if (!v) continue;

      ctx.palm = pos;
      ctx.side = side;
      desiredHandPose(ctx, this.target);
      easePose(v.pose, this.target, dt, holding);
      basisQuaternion(v.pose.fingers, v.pose.normal, side, this.q);
      applyCurl(v.rig, v.pose.openness);
      v.group.position.copy(pos);
      v.group.quaternion.copy(this.q);
      v.group.scale.setScalar(scale);
      v.group.visible = true;
    }
  }
}

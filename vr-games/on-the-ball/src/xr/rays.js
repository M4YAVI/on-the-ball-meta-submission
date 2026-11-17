// Where the player is looking from, one source at a time and always labelled. There is deliberately no function here that
// returns a head ray under an eye label: the source string that comes back is the one that was actually read.

import { Quaternion, Vector3 } from '@iwsdk/core';

export class Rays {
  constructor(world) {
    this.world = world;
    this.q = new Quaternion();
    this.fwd = new Vector3(0, 0, -1);
    this.gazeSeenAt = -Infinity; // last time the runtime reported a tracked gaze pose
  }

  // In a headset the viewer's pose comes from the player rig; on a flat screen it is the camera.
  inSession() {
    return !!this.world.session;
  }

  headRay(origin, dir) {
    const head = this.inSession() ? this.world.player.head : this.world.camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(origin);
    head.getWorldQuaternion(this.q);
    dir.copy(this.fwd).applyQuaternion(this.q);
    return Number.isFinite(origin.x + origin.y + origin.z + dir.x + dir.y + dir.z);
  }

  // The runtime's gaze ray, or false when the runtime has no valid gaze pose this frame.
  eyeRay(origin, dir) {
    const p = this.world.player;
    if (p.gazeOrigin !== 'tracked') return false;
    p.eyeSpace.updateWorldMatrix(true, false);
    p.eyeSpace.getWorldPosition(origin);
    p.eyeSpace.getWorldQuaternion(this.q);
    dir.copy(this.fwd).applyQuaternion(this.q);
    return Number.isFinite(origin.x + origin.y + origin.z + dir.x + dir.y + dir.z);
  }

  // Did the runtime grant the gaze feature, and has a gaze pose appeared?
  gazeGranted() {
    const f = this.world.session?.enabledFeatures;
    return Array.isArray(f) ? f.includes('gaze-tracking') : false;
  }

  noteGaze(time) {
    if (this.world.player.gazeOrigin === 'tracked') this.gazeSeenAt = time;
  }

  // Emulator (IWER) input is never real eyes; it is labelled "simulated".
  static emulated() {
    return typeof window !== 'undefined' && window.IWER_DEVICE !== undefined;
  }
}

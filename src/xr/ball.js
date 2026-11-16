// The ball and the ring that marks the live ball (deck slide 5). The ball is drawn at least ~0.9 degrees across so it can be
// followed from the bowler's end; the ring is a fixed ~3.4 degrees around it. A white ball (the one used under lights) with a
// soft glow, so it stands out against the dark nets from the moment it leaves the hand.
//
// Guide ring: while the player is on the ball the ring eases to green, and eases back to white when they are not. It never
// turns red mid-ball. It is feedback only; scoring does not read it.

import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, SphereGeometry, SRGBColorSpace } from '@iwsdk/core';
import { drawnRadius, ringRadius } from '../core/ball-path.js';

const WHITE = new Color('#ffffff');
const GREEN = new Color('#3DDC84');

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function leather() {
  return canvasTex(512, 256, (x) => {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#fbf8ef');
    g.addColorStop(1, '#e6e0cf');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
    // the seam: a raised ridge with two rows of stitches
    x.fillStyle = '#b9b09a';
    x.fillRect(0, 122, 512, 12);
    x.fillStyle = '#8a2a2a';
    for (let i = 0; i < 64; i++) {
      x.fillRect(i * 8 + 1, 113, 4, 3);
      x.fillRect(i * 8 + 1, 140, 4, 3);
    }
  });
}

function glowTex() {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,240,0.55)');
    g.addColorStop(0.35, 'rgba(255,250,220,0.18)');
    g.addColorStop(1, 'rgba(255,250,220,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export class BallRig {
  constructor() {
    this.group = new Group();
    this.ball = new Mesh(
      new SphereGeometry(1, 28, 18),
      new MeshStandardMaterial({ map: leather(), roughness: 0.45, metalness: 0, emissive: '#d8d2c0', emissiveIntensity: 0.55 }),
    );
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    this.glow.renderOrder = 29;
    this.ring = new Mesh(
      new RingGeometry(0.93, 1, 72),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.ring.renderOrder = 30;
    this.group.add(this.glow, this.ball, this.ring);
    this.group.visible = false;
    this.spin = 0;
    this.lock = 0; // 0 white .. 1 green, eased
    this.age = 0; // seconds since release
  }

  show(v) {
    this.group.visible = v;
    if (v) {
      this.age = 0;
      this.lock = 0;
      this.ring.material.color.copy(WHITE);
    }
  }

  // locked: the player is on the ball right now (null = guide off, the ring stays white).
  setLock(locked, dt) {
    const target = locked ? 1 : 0;
    const rate = locked ? 14 : 8; // turns green quickly, fades back a little slower
    this.lock += (target - this.lock) * Math.min(1, dt * rate);
    this.ring.material.color.copy(WHITE).lerp(GREEN, this.lock);
    this.ring.material.opacity = 0.85 + 0.15 * this.lock;
  }

  // local: ball position in the parent's frame. dist: distance from the viewer's eyes (metres). eyeWorld: the eyes in world space
  // (the ring and glow turn to face them).
  place(local, dist, eyeWorld, dt) {
    this.age += dt;
    this.group.position.copy(local);
    const r = drawnRadius(dist);
    this.ball.scale.setScalar(r);
    // a short bright flash as it leaves the hand, then a steady soft glow
    const flash = Math.max(0, 1 - this.age / 0.18);
    this.glow.scale.setScalar(r * (5 + 6 * flash));
    this.glow.lookAt(eyeWorld);
    const ring = ringRadius(dist) * (1 + 0.08 * this.lock); // a touch larger when locked
    this.ring.scale.setScalar(ring);
    this.ring.lookAt(eyeWorld);
    this.spin += dt * 18;
    this.ball.rotation.set(this.spin * 0.6, this.spin, 0);
  }
}

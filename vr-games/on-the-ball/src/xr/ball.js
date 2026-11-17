// The ball and the ring that marks the live ball (deck slide 5). The ball is drawn at least ~0.9 degrees across so it can be
// followed from the bowler's end; the ring is a fixed ~3.4 degrees around it. A red leather cricket ball with a cream seam,
// as in the deck (slide 5 picture, slide 12 "The ball: a red sphere"). To stay easy to follow against grass and sky, the ball is
// lit from inside (emissive), carries a soft warm glow, and always has the white ring around it.
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
  t.anisotropy = 8;
  return t;
}

function leather() {
  return canvasTex(1024, 512, (x) => {
    x.scale(2, 2);
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#d0242a');
    g.addColorStop(1, '#9c1519');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 256);
    // polished leather: a faint lighter band
    x.fillStyle = 'rgba(255,190,180,0.10)';
    x.fillRect(0, 40, 512, 30);
    // the seam: a raised ridge with two rows of cream stitches
    x.fillStyle = '#7d1014';
    x.fillRect(0, 122, 512, 12);
    x.fillStyle = '#f1e7cf';
    for (let i = 0; i < 64; i++) {
      x.fillRect(i * 8 + 1, 113, 4, 3);
      x.fillRect(i * 8 + 1, 140, 4, 3);
    }
  });
}

function glowTex() {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,225,200,0.55)');
    g.addColorStop(0.35, 'rgba(255,170,140,0.2)');
    g.addColorStop(1, 'rgba(255,170,140,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export class BallRig {
  constructor() {
    this.group = new Group();
    this.ball = new Mesh(
      new SphereGeometry(1, 64, 40),
      new MeshStandardMaterial({ map: leather(), roughness: 0.4, metalness: 0, emissive: '#e0262c', emissiveIntensity: 0.6 }),
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

  // After arrival: the ball flies on past the player and stays visible where it comes to rest. Ball only: no ring, no glow.
  coast(local, dist, dt) {
    this.group.visible = true;
    this.group.position.copy(local);
    this.ball.scale.setScalar(drawnRadius(dist));
    this.glow.visible = false;
    this.ring.visible = false;
    if (dt > 0) {
      this.spin += dt * 10;
      this.ball.rotation.set(this.spin * 0.6, this.spin, 0);
    }
  }

  show(v) {
    this.group.visible = v;
    this.glow.visible = true;
    this.ring.visible = true;
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

// The tennis ball and the ring that marks the live ball (deck slide 5). The ball is drawn at least ~1 degree across so it can be
// followed from the far baseline; the ring is a fixed ~3.4 degrees around it. An optic-yellow ball with its white seam, lit from
// inside (emissive) with a soft glow, and always the white ring around it, so it stays easy to follow against the court, fence
// and sky.
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

// Optic-yellow felt with the white curved seam of a tennis ball (two joined lobes, like a baseball's), drawn on an
// equirectangular map. The seam is a true 3D curve on the sphere, not a sine wave, and the felt carries a fine fuzz.
export function tennisTexture() {
  return canvasTex(1024, 512, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#e2ee32');
    grad.addColorStop(0.5, '#d4e51c');
    grad.addColorStop(1, '#c4d916');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    let s = 12345; // a fixed seed so the felt looks the same on every load
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,170,0.10)' : 'rgba(120,150,0,0.10)';
      g.fillRect(rnd() * W, rnd() * H, 2, 2);
    }
    const k = 0.4;
    const pts = [];
    for (let i = 0; i <= 720; i++) {
      const t = (i / 720) * Math.PI * 2;
      const x = (1 - k) * Math.cos(t) + k * Math.cos(3 * t);
      const y = (1 - k) * Math.sin(t) - k * Math.sin(3 * t);
      const z = 2 * Math.sqrt(k * (1 - k)) * Math.cos(2 * t);
      const lon = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1;
      const lat = 0.5 - Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI;
      pts.push([lon * W, lat * H]);
    }
    const stroke = (width, color) => {
      g.lineWidth = width;
      g.strokeStyle = color;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const dx of [-W, 0, W]) {
        g.beginPath();
        let prev = null;
        for (const [x, y] of pts) {
          if (prev && Math.abs(x - prev[0]) < W / 2) g.lineTo(x + dx, y);
          else g.moveTo(x + dx, y);
          prev = [x, y];
        }
        g.stroke();
      }
    };
    stroke(20, 'rgba(110,130,0,0.45)'); // the groove the seam sits in
    stroke(12, '#f8f8f0'); // the white seam
  });
}

function glowTex() {
  return canvasTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(235,245,255,0.55)');
    g.addColorStop(0.35, 'rgba(170,205,255,0.2)');
    g.addColorStop(1, 'rgba(170,205,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export class BallRig {
  constructor() {
    this.group = new Group();
    this.ball = new Mesh(
      new SphereGeometry(1, 64, 40),
      new MeshStandardMaterial({ map: tennisTexture(), roughness: 0.85, metalness: 0, emissive: '#d8e83a', emissiveIntensity: 0.3 }),
    );
    this.glow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
    );
    this.glow.renderOrder = 29;
    this.ring = new Mesh(
      new RingGeometry(0.86, 1, 72),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.ring.renderOrder = 30;
    this.group.add(this.glow, this.ball, this.ring);
    this.group.visible = false;
    this.spin = 0;
    this.lock = 0; // 0 white .. 1 green, eased
    this.age = 0; // seconds since the strike
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

  // Before the strike the real tennis ball is already there, so the eyes start on the actual ball. Ball only: no ring, no glow.
  rest(local, dist, dt) {
    this.group.visible = true;
    this.group.position.copy(local);
    this.ball.scale.setScalar(drawnRadius(dist));
    this.glow.visible = false;
    this.ring.visible = false;
    this.spin += dt * 2;
    this.ball.rotation.set(0, this.spin, 0);
  }

  // locked: the player is on the ball right now (null = guide off, the ring stays white).
  setLock(locked, dt) {
    const target = locked ? 1 : 0;
    const rate = locked ? 14 : 8; // turns green quickly, fades back a little slower
    this.lock += (target - this.lock) * Math.min(1, dt * rate);
    this.ring.material.color.copy(WHITE).lerp(GREEN, this.lock);
    this.ring.material.opacity = 0.85 + 0.15 * this.lock;
  }

  // local: ball position in the parent's frame. dist: distance from the viewer's eyes (metres). eyeWorld: the eyes in world
  // space (the ring and glow turn to face them).
  place(local, dist, eyeWorld, dt) {
    this.age += dt;
    this.group.position.copy(local);
    const r = drawnRadius(dist);
    this.ball.scale.setScalar(r);
    // a short bright flash as it leaves the racket, then a steady soft glow
    const flash = Math.max(0, 1 - this.age / 0.18);
    this.glow.scale.setScalar(r * (4 + 4 * flash));
    this.glow.lookAt(eyeWorld);
    const ring = ringRadius(dist) * (1 + 0.08 * this.lock); // a touch larger when locked
    this.ring.scale.setScalar(ring);
    this.ring.lookAt(eyeWorld);
    this.spin += dt * 14;
    this.ball.rotation.set(this.spin * 0.8, this.spin * 0.3, this.spin * 0.2); // a served ball spins about its side axis
  }
}

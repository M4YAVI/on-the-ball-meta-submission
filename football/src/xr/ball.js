// The football and the ring that marks the live ball (deck slide 5). The ball is drawn at least ~1 degree across so it can be
// followed from the edge of the penalty area; the ring is a fixed ~3.4 degrees around it. A white football with dark panels, lit
// from inside (emissive) with a soft cool glow, and always the white ring around it, so it stays easy to follow against grass,
// stands and sky.
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

// White leather with the 12 dark pentagons of a truncated icosahedron, laid out on an equirectangular map. The pentagons sit
// at the icosahedron's vertices: the two poles and two rings of five at +/-26.57 degrees latitude.
export function footballTexture() {
  return canvasTex(512, 256, (g, W, H) => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#f4f4ee');
    grad.addColorStop(1, '#d9dad2');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const centres = [
      [0, 90],
      [0, -90],
    ];
    for (let k = 0; k < 5; k++) {
      centres.push([k * 72, 26.57], [k * 72 + 36, -26.57]);
    }
    const lat0 = (lat) => ((90 - lat) / 180) * H;
    const lon0 = (lon) => ((lon % 360) / 360) * W;
    g.fillStyle = '#1b1d20';
    g.strokeStyle = '#9a9c96';
    g.lineWidth = 1.5;
    for (const [lon, lat] of centres) {
      const stretch = 1 / Math.max(0.18, Math.cos((lat * Math.PI) / 180)); // equirectangular maps squeeze the poles
      for (const dx of [-W, 0, W]) {
        g.beginPath();
        for (let j = 0; j < 5; j++) {
          const a = (j / 5) * Math.PI * 2 - Math.PI / 2;
          const px = lon0(lon) + dx + Math.cos(a) * 26 * stretch * (Math.abs(lat) > 80 ? 3 : 1);
          const py = lat0(lat) + Math.sin(a) * 26;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
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
      new SphereGeometry(1, 28, 18),
      new MeshStandardMaterial({ map: footballTexture(), roughness: 0.45, metalness: 0, emissive: '#e4e8ee', emissiveIntensity: 0.45 }),
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
    this.age = 0; // seconds since the strike
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

  // local: ball position in the parent's frame. dist: distance from the viewer's eyes (metres). eyeWorld: the eyes in world
  // space (the ring and glow turn to face them).
  place(local, dist, eyeWorld, dt) {
    this.age += dt;
    this.group.position.copy(local);
    const r = drawnRadius(dist);
    this.ball.scale.setScalar(r);
    // a short bright flash as it leaves the boot, then a steady soft glow
    const flash = Math.max(0, 1 - this.age / 0.18);
    this.glow.scale.setScalar(r * (5 + 6 * flash));
    this.glow.lookAt(eyeWorld);
    const ring = ringRadius(dist) * (1 + 0.08 * this.lock); // a touch larger when locked
    this.ring.scale.setScalar(ring);
    this.ring.lookAt(eyeWorld);
    this.spin += dt * 14;
    this.ball.rotation.set(this.spin * 0.8, this.spin * 0.3, this.spin * 0.2); // a driven shot spins about its side axis
  }
}

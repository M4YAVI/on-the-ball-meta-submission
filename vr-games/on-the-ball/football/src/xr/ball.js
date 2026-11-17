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
  t.anisotropy = 8;
  return t;
}

// A real football: white leather with 12 black pentagons and 20 white hexagons (a truncated icosahedron), seams between every
// panel. Painted per pixel from the nearest panel centre, so the panels meet the way they do on the real ball and nothing is
// stretched at the poles.
export function footballTexture() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const norm = (v) => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n]; };
  const pent = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) pent.push(norm([0, a, b]), norm([a, b, 0]), norm([b, 0, a]));
  const hex = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) hex.push(norm([x, y, z]));
  for (const a of [-1 / phi, 1 / phi]) for (const b of [-phi, phi]) hex.push(norm([0, a, b]), norm([a, b, 0]), norm([b, 0, a]));
  const cells = [...pent.map((c) => ({ c, p: true })), ...hex.map((c) => ({ c, p: false }))];
  return canvasTex(1024, 512, (g, W, H) => {
    const img = g.createImageData(W, H);
    for (let py = 0; py < H; py++) {
      const lat = Math.PI * (0.5 - (py + 0.5) / H);
      const cl = Math.cos(lat), sl = Math.sin(lat);
      for (let px = 0; px < W; px++) {
        const lon = ((px + 0.5) / W) * Math.PI * 2;
        const x = cl * Math.cos(lon), y = sl, z = cl * Math.sin(lon);
        let d1 = -2, d2 = -2, p1 = false;
        for (const k of cells) {
          const d = k.c[0] * x + k.c[1] * y + k.c[2] * z;
          if (d > d1) { d2 = d1; d1 = d; p1 = k.p; } else if (d > d2) d2 = d;
        }
        const edge = Math.acos(Math.min(1, d2)) - Math.acos(Math.min(1, d1)); // radians to the seam, about zero on it
        const seam = Math.max(0, 1 - edge / 0.045); // a soft groove about 2.5 degrees wide
        let r, gr, b;
        if (p1) { r = 22; gr = 24; b = 28; } else { r = 246; gr = 246; b = 240; }
        const shade = 1 - 0.1 * (1 - cl) - 0.03 * Math.sin(px * 0.9) * Math.sin(py * 0.9); // faint leather grain
        const k = shade * (1 - 0.55 * seam * seam);
        const i = (py * W + px) * 4;
        img.data[i] = r * k; img.data[i + 1] = gr * k; img.data[i + 2] = b * k; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
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
      new MeshStandardMaterial({ map: footballTexture(), roughness: 0.4, metalness: 0, emissive: '#e4e8ee', emissiveIntensity: 0.3 }),
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
    this.glow.visible = true;
    this.ring.visible = true;
    if (v) {
      this.age = 0;
      this.lock = 0;
      this.ring.material.color.copy(WHITE);
    }
  }

  // Before the strike the real football is already there, so the eyes start on the actual ball. Ball only: no ring, no glow.
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

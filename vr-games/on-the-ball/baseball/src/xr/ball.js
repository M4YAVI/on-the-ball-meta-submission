// The baseball and the ring that marks the live ball (deck slide 5). The ball is drawn close to its real size (never under a 0.35 degree radius) and the ring marks it from the mound; it can be
// followed from the mound; the ring is a fixed ~3.4 degrees around it. Off-white cowhide with the red double stitching (the
// texture is the one baseball-xr draws), lit from inside (emissive) with a soft glow, and always the white ring around it.
//
// Guide ring: while the player is on the ball the ring eases to green, and eases back to white when they are not. It never
// turns red mid-ball. It is feedback only; scoring does not read it.

import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, SphereGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { BALL_MIN_DEG, drawnRadius, ringRadius } from '../core/ball-path.js';

// The texture (from baseball-xr): the figure-of-eight seam and its red double stitching. The seam is the true 3D curve of a baseball (two lobes that meet), and each stitch is
// placed in 3D on the sphere, then projected into the texture, so it reads correctly all round.

const TW = 1024;
const TH = 512;

// The seam: a closed curve on the unit sphere, r(t) = (a cos t + b cos 3t, a sin t - b sin 3t,
// 2 sqrt(ab) sin 2t) with a + b = 1. Mapped so its flattest axis is the sphere's vertical,
// which keeps it away from the texture's poles.
const A = 0.7;
const B = 0.3;
const C = 2 * Math.sqrt(A * B);
function seam(t, out) {
  const x = A * Math.cos(t) + B * Math.cos(3 * t);
  const z = A * Math.sin(t) - B * Math.sin(3 * t);
  const y = C * Math.sin(2 * t);
  return out.set(x, y, z).normalize();
}

// Unit-sphere point -> canvas pixel, matching three.js SphereGeometry's UVs.
function toPixel(p) {
  const phi = Math.atan2(p.z, -p.x);
  const u = (phi < 0 ? phi + Math.PI * 2 : phi) / (Math.PI * 2);
  const theta = Math.acos(Math.max(-1, Math.min(1, p.y)));
  return [u * TW, (theta / Math.PI) * TH];
}

function line(ctx, a, b) {
  const [x0, y0] = toPixel(a);
  const [x1, y1] = toPixel(b);
  if (Math.abs(x1 - x0) > TW / 2) return; // would wrap round the texture's edge
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export function leatherTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2eee4';
  ctx.fillRect(0, 0, TW, TH);

  // Grain: faint flecks, from a fixed seed so every ball looks the same.
  let s = 11;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(120,100,70,0.07)' : 'rgba(255,255,255,0.25)';
    ctx.fillRect(rand() * TW, rand() * TH, 1 + rand() * 2, 1 + rand() * 2);
  }

  const p = new Vector3();
  const q = new Vector3();
  const tan = new Vector3();
  const side = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  const N = 900;

  // The seam groove: a soft darker line where the two hide pieces meet.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(150,135,110,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i < N; i++) {
    seam((i / N) * Math.PI * 2, p);
    seam(((i + 1) / N) * Math.PI * 2, q);
    line(ctx, p, q);
  }

  // 108 double stitches (a real ball has 108), slanted like a row of V's either side of the seam.
  ctx.strokeStyle = '#c4122b';
  ctx.lineWidth = 3.2;
  const STITCHES = 108;
  for (let i = 0; i < STITCHES; i++) {
    const t = (i / STITCHES) * Math.PI * 2;
    seam(t, p);
    seam(t + 0.004, q);
    tan.subVectors(q, p).normalize();
    side.crossVectors(tan, p).normalize();
    for (const sgn of [1, -1]) {
      a.copy(p).addScaledVector(side, sgn * 0.075).addScaledVector(tan, -0.022).normalize();
      b.copy(p).addScaledVector(side, sgn * 0.022).addScaledVector(tan, 0.022).normalize();
      line(ctx, a, b);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const WHITE = new Color('#ffffff');
const GREEN = new Color('#3DDC84');

function glowTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,244,200,0.55)');
  g.addColorStop(0.35, 'rgba(255,230,170,0.2)');
  g.addColorStop(1, 'rgba(255,230,170,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class BallRig {
  constructor() {
    this.group = new Group();
    this.ball = new Mesh(
      new SphereGeometry(1, 64, 40),
      new MeshStandardMaterial({ map: leatherTexture(), roughness: 0.6, metalness: 0, emissive: '#d9d4c4', emissiveIntensity: 0.28 }),
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
    this.spinAxis = new Vector3(0.3, 0.2, 0.93).normalize();
    this.spinRps = 3; // drawn turns per second (see drawnRps in core/pitches.js)
    this.lock = 0; // 0 white .. 1 green, eased
    this.age = 0; // seconds since the release
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

  // Before the release the real ball is already in the pitcher's hand, so the eyes start on the actual ball. Ball only: no ring,
  // no glow. Smaller than in flight (it sits in a hand): about the real size.
  rest(local, dist) {
    this.group.visible = true;
    this.group.position.copy(local);
    this.ball.scale.setScalar(drawnRadius(dist, BALL_MIN_DEG.hand));
    this.glow.visible = false;
    this.ring.visible = false;
    this.ball.rotation.set(0.4, 0.9, 0);
  }

  // locked: the player is on the ball right now (null = guide off, the ring stays white).
  setLock(locked, dt) {
    const target = locked ? 1 : 0;
    const rate = locked ? 14 : 8; // turns green quickly, fades back a little slower
    this.lock += (target - this.lock) * Math.min(1, dt * rate);
    this.ring.material.color.copy(WHITE).lerp(GREEN, this.lock);
    this.ring.material.opacity = 0.85 + 0.15 * this.lock;
  }

  // The pitch's own spin: its axis and how fast it is drawn (a four-seamer backspins, a slider is a gyro, a knuckleball hardly turns).
  setSpin(axis, rps) {
    this.spinAxis.set(axis[0], axis[1], axis[2]).normalize();
    this.spinRps = rps;
  }

  // local: ball position in the parent's frame. dist: distance from the viewer's eyes (metres). eyeWorld: the eyes in world
  // space (the ring and glow turn to face them).
  place(local, dist, eyeWorld, dt) {
    this.age += dt;
    this.glow.visible = true;
    this.ring.visible = true;
    this.group.position.copy(local);
    const r = drawnRadius(dist, BALL_MIN_DEG.flight);
    this.ball.scale.setScalar(r);
    // a short bright flash as it leaves the hand, then a steady soft glow
    const flash = Math.max(0, 1 - this.age / 0.18);
    this.glow.scale.setScalar(r * (9 + 8 * flash));
    this.glow.lookAt(eyeWorld);
    const ring = ringRadius(dist) * (1 + 0.08 * this.lock); // a touch larger when locked
    this.ring.scale.setScalar(ring);
    this.ring.lookAt(eyeWorld);
    this.ball.rotateOnAxis(this.spinAxis, this.spinRps * Math.PI * 2 * dt);
  }
}

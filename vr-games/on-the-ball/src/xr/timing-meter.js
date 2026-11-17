// A timing meter on the right of the view: EARLY (top), PERFECT (middle), LATE (bottom). It is always there while you bat, dim, so
// you know what to aim for; each time the bat meets the ball a marker lands on it where your timing was and that zone lights up.
// It is feedback for the shot only: it is not the eye-tracking score and does not touch the scoreboard or the verdicts.

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { TIMING } from '../core/bat-physics.js';

const W = 256;
const H = 640;
const BAR_TOP = 92;
const BAR_BOT = 596;
const HALF = (BAR_BOT - BAR_TOP) / 2;
const MID = (BAR_TOP + BAR_BOT) / 2;
const PERFECT_PX = (TIMING.perfectHalf / TIMING.scale) * HALF;
const SHOW_S = 2.6;
const IDLE = 0.55;

const ZONES = [
  { id: 'early', label: 'EARLY', y0: BAR_TOP, y1: MID - PERFECT_PX, base: '#7a5a1c', lit: '#F5A524' },
  { id: 'perfect', label: 'PERFECT', y0: MID - PERFECT_PX, y1: MID + PERFECT_PX, base: '#1d6b45', lit: '#3DDC84' },
  { id: 'late', label: 'LATE', y0: MID + PERFECT_PX, y1: BAR_BOT, base: '#7a5a1c', lit: '#F5A524' },
];

export class TimingMeter {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(0.46, 1.15),
      new MeshBasicMaterial({ map: this.tex, transparent: true, opacity: IDLE, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
    this.mesh.position.set(1.05, 0.0, -2.6); // right of the line of the ball (about 22 degrees out), inside the view of the glasses
    this.age = Infinity;
    this.enabled = false;
    this.draw(null);
  }

  draw(timing, perfect = false) {
    const x = this.canvas.getContext('2d');
    x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(8,20,14,0.72)';
    x.beginPath();
    x.roundRect(6, 6, W - 12, H - 12, 36);
    x.fill();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#ffffff';
    x.font = '800 44px system-ui, sans-serif';
    x.fillText('TIMING', W / 2, 52);
    for (const z of ZONES) {
      x.fillStyle = timing && timing.zone === z.id ? z.lit : z.base;
      x.fillRect(30, z.y0 + 2, W - 60, z.y1 - z.y0 - 4);
    }
    if (timing) {
      const y = MID + timing.off * HALF;
      x.fillStyle = '#ffffff';
      x.strokeStyle = 'rgba(8,20,14,0.9)';
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(14, y - 22);
      x.lineTo(46, y);
      x.lineTo(14, y + 22);
      x.closePath();
      x.stroke();
      x.fill();
      x.fillRect(46, y - 3, W - 92, 6);
      x.beginPath();
      x.moveTo(W - 14, y - 22);
      x.lineTo(W - 46, y);
      x.lineTo(W - 14, y + 22);
      x.closePath();
      x.stroke();
      x.fill();
    }
    // the zone names go on top of the marker line, so they stay readable
    for (const z of ZONES) {
      const on = timing && timing.zone === z.id;
      x.lineJoin = 'round';
      x.font = `800 ${z.id === 'perfect' ? 38 : 40}px system-ui, sans-serif`;
      x.lineWidth = 8;
      x.strokeStyle = on ? z.lit : z.base;
      x.strokeText(z.label, W / 2, (z.y0 + z.y1) / 2 + 2);
      x.fillStyle = on ? '#08140e' : 'rgba(255,255,255,0.8)';
      x.fillText(z.label, W / 2, (z.y0 + z.y1) / 2 + 2);
    }
    if (timing && perfect) {
      x.fillStyle = '#FFD34D';
      x.font = '900 28px system-ui, sans-serif';
      x.fillText('OUT OF THE GROUND', W / 2, BAR_BOT + 22, W - 24);
    }
    this.tex.needsUpdate = true;
  }

  // The bat met the ball: timing = timingOf(...), perfect = it was a perfect shot (it goes out of the ground).
  show(timing, perfect) {
    this.draw(timing, perfect);
    this.age = 0;
    this.mesh.material.opacity = 1;
  }

  // Whether the meter is on view (while the player has the bat in hand).
  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.mesh.visible = on;
    if (!on) this.clear();
  }

  clear() {
    if (this.age !== Infinity) this.draw(null);
    this.age = Infinity;
    this.mesh.material.opacity = IDLE;
  }

  update(dt) {
    if (!this.enabled || this.age === Infinity) return;
    this.age += dt;
    if (this.age >= SHOW_S) {
      this.clear();
      return;
    }
    this.mesh.material.opacity = Math.min(1, (SHOW_S - this.age) / 0.5 + IDLE);
  }
}

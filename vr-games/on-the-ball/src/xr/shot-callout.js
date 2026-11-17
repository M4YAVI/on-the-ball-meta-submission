// A short call-out after a hit ("SIX!", "FOUR!", "Edged", "Blocked", "Nice shot") with the speed off the bat. It floats high
// in front of the player for a moment and fades. It is feedback for the shot only: it is not the eye-tracking score and does
// not touch the scoreboard.

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

const STYLE = Object.freeze({
  six: { title: 'SIX!', color: '#FFD34D' },
  four: { title: 'FOUR!', color: '#3DDC84' },
  edge: { title: 'Edged', color: '#F5A524' },
  block: { title: 'Blocked', color: '#E8EEF2' },
  shot: { title: 'Nice shot', color: '#E8EEF2' },
});
const SHOW_S = 1.7;

export class ShotCallout {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(1.1, 0.4125),
      new MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 31;
    this.mesh.visible = false;
    this.mesh.position.set(0, 0.42, -3.2); // above the line of the ball, inside the glasses' 25 degree upper edge
    this.age = Infinity;
  }

  show(kind, kmh) {
    const s = STYLE[kind];
    if (!s) return;
    const x = this.canvas.getContext('2d');
    const { width: w, height: h } = this.canvas;
    x.clearRect(0, 0, w, h);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.font = '900 190px system-ui, sans-serif';
    x.lineWidth = 18;
    x.strokeStyle = 'rgba(8,20,14,0.85)';
    x.strokeText(s.title, w / 2, h * 0.4);
    x.fillStyle = s.color;
    x.fillText(s.title, w / 2, h * 0.4);
    if (Number.isFinite(kmh) && kmh > 1) {
      x.font = '700 64px system-ui, sans-serif';
      x.lineWidth = 10;
      const sub = `${Math.round(kmh)} km/h off the bat`;
      x.strokeText(sub, w / 2, h * 0.84);
      x.fillStyle = '#ffffff';
      x.fillText(sub, w / 2, h * 0.84);
    }
    this.tex.needsUpdate = true;
    this.age = 0;
    this.mesh.visible = true;
  }

  hide() {
    this.age = Infinity;
    this.mesh.visible = false;
  }

  update(dt) {
    if (!this.mesh.visible) return;
    this.age += dt;
    if (this.age >= SHOW_S) {
      this.hide();
      return;
    }
    const pop = Math.min(1, this.age / 0.15);
    const fade = Math.min(1, (SHOW_S - this.age) / 0.4);
    this.mesh.material.opacity = pop * fade;
    this.mesh.scale.setScalar(0.85 + 0.15 * pop * (2 - pop));
  }
}

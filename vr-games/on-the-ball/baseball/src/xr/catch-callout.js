// A short call-out after each pitch ("POP!", "CAUGHT! 3 in a row", "MISSED") with the umpire's call under it ("STRIKE", "Framed:
// STRIKE", "Ball"). It floats in front of the player for a moment and fades. It is feedback for the catch only: it is not the
// eye-tracking score and does not touch the scoreboard's green / amber / red.

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

const SHOW_S = 1.7;
const GOOD = '#3DDC84';
const BAD = '#F5A524';

export class CatchCallout {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(1.5, 0.5625),
      new MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 31;
    this.mesh.visible = false;
    this.mesh.position.set(0, 0.42, -3.2); // above the line of the ball, inside the glasses' 25 degree upper edge
    this.age = Infinity;
  }

  // result: { title, sub, good } from HandScore.record
  show(result) {
    const x = this.canvas.getContext('2d');
    const { width: w, height: h } = this.canvas;
    x.clearRect(0, 0, w, h);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.font = '900 150px system-ui, sans-serif';
    let size = 150;
    while (size > 60 && x.measureText(result.title).width > w - 60) {
      size -= 10;
      x.font = `900 ${size}px system-ui, sans-serif`;
    }
    x.lineWidth = 16;
    x.strokeStyle = 'rgba(8,20,14,0.85)';
    x.strokeText(result.title, w / 2, h * 0.38);
    x.fillStyle = result.good ? GOOD : BAD;
    x.fillText(result.title, w / 2, h * 0.38);
    if (result.sub) {
      x.font = '800 84px system-ui, sans-serif';
      x.lineWidth = 12;
      x.strokeText(result.sub, w / 2, h * 0.8);
      x.fillStyle = '#ffffff';
      x.fillText(result.sub, w / 2, h * 0.8);
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

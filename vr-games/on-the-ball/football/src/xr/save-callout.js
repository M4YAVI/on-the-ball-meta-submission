// Subtle, realistic call-out badge for goalkeeping saves and goals.
// Appears above the line of sight after the shot crosses the goal plane and cleanly fades.
//
// Scoring separation (principle-boundary-discipline):
// This is strictly feedback for the physical goalkeeping save; it does not touch the
// primary eye-tracking verdict or the 20-dot score dots.

import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

const SHOW_DURATION = 1.6; // s
const COLOR_SAVE = '#22c55e'; // Clean athletic green
const COLOR_GOAL = '#f59e0b'; // Amber / gold

export class SaveCallout {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;

    this.mesh = new Mesh(
      new PlaneGeometry(1.5, 0.5625),
      new MeshBasicMaterial({
        map: this.tex,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.mesh.renderOrder = 31;
    this.mesh.visible = false;
    this.mesh.position.set(0, 0.45, -3.2); // Comfortably in view above goal line
    this.age = Infinity;
  }

  show(result) {
    const ctx = this.canvas.getContext('2d');
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const title = result.title || (result.saved ? 'SAVE!' : 'GOAL');
    const isSave = !!result.saved;

    // Main title (e.g. "SAVE!", "CLEAN CATCH!", "PUNCHED!", "GOAL")
    ctx.font = '900 140px system-ui, sans-serif';
    let size = 140;
    while (size > 60 && ctx.measureText(title).width > w - 80) {
      size -= 10;
      ctx.font = `900 ${size}px system-ui, sans-serif`;
    }

    // Outer dark stroke for high readability against bright stadium lights
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(10, 15, 20, 0.85)';
    ctx.strokeText(title, w / 2, h * 0.38);

    ctx.fillStyle = isSave ? COLOR_SAVE : COLOR_GOAL;
    ctx.fillText(title, w / 2, h * 0.38);

    // Subtitle (e.g. "3 in a row", "Parried at 90 km/h")
    if (result.sub) {
      ctx.font = '800 76px system-ui, sans-serif';
      ctx.lineWidth = 12;
      ctx.strokeStyle = 'rgba(10, 15, 20, 0.85)';
      ctx.strokeText(result.sub, w / 2, h * 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(result.sub, w / 2, h * 0.8);
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
    if (this.age >= SHOW_DURATION) {
      this.hide();
      return;
    }

    const pop = Math.min(1, this.age / 0.12);
    const fade = Math.min(1, (SHOW_DURATION - this.age) / 0.35);
    this.mesh.material.opacity = pop * fade;
    this.mesh.scale.setScalar(0.9 + 0.1 * pop * (2 - pop));
  }
}

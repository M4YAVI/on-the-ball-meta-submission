// Flat panels drawn with the 2D canvas and shown as textured planes. Drawing them from code keeps the app free of image
// files and fonts, and gives every target its own hover and pressed look (the glasses have no gaze cursor).

import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { COLORS, FONT, OUTCOME } from './theme.js';

export class Card {
  // w, h: size in metres. px: canvas pixels per metre (kept modest: panels are viewed at about 2 m).
  constructor(w, h, px = 560) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(w * px);
    this.canvas.height = Math.round(h * px);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.anisotropy = 4;
    this.mesh = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false, depthWrite: false, depthTest: false }), // panels draw over the scene
    );
    this.mesh.renderOrder = 20;
  }

  get width() {
    return this.canvas.width;
  }
  get height() {
    return this.canvas.height;
  }

  draw(fn) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    fn(c, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

export function panelBase(c, w, h, { radius = 28, fill = COLORS.panel, edge = COLORS.edge, alpha = 0.96 } = {}) {
  c.save();
  c.globalAlpha = alpha;
  roundRect(c, 2, 2, w - 4, h - 4, radius);
  c.fillStyle = fill;
  c.fill();
  c.globalAlpha = 1;
  c.lineWidth = 2;
  c.strokeStyle = edge;
  c.stroke();
  c.restore();
}

export function text(c, str, x, y, { size = 32, weight = 600, color = COLORS.text, align = 'left', base = 'middle', font = FONT, alpha = 1 } = {}) {
  c.save();
  c.globalAlpha = alpha;
  c.font = `${weight} ${size}px ${font}`;
  c.textAlign = align;
  c.textBaseline = base;
  c.fillStyle = color;
  c.fillText(str, x, y);
  c.restore();
}

// The largest font size (<= size) at which `str` fits in `maxW` pixels.
export function fit(c, str, maxW, size, weight = 700) {
  c.save();
  c.font = `${weight} ${size}px ${FONT}`;
  const w = c.measureText(str).width;
  c.restore();
  return w > maxW ? Math.max(12, Math.floor((size * maxW) / w)) : size;
}

// Wrap `str` into lines of at most `maxW` pixels, drawn from (x, y) downward. Returns the y after the last line.
export function paragraph(c, str, x, y, maxW, { size = 28, weight = 500, color = COLORS.dim, lineH = 1.3, align = 'left' } = {}) {
  c.save();
  c.font = `${weight} ${size}px ${FONT}`;
  const words = String(str).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  c.restore();
  let yy = y;
  for (const l of lines) {
    text(c, l, align === 'center' ? x + maxW / 2 : x, yy, { size, weight, color, align, base: 'top' });
    yy += size * lineH;
  }
  return yy;
}

// Outcome symbols, drawn as strokes so they never depend on a font: check, wave (~), cross, dash.
export function symbol(c, kind, cx, cy, r, color) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = Math.max(2, r * 0.26);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  if (kind === 'check') {
    c.moveTo(cx - r * 0.5, cy + r * 0.02);
    c.lineTo(cx - r * 0.12, cy + r * 0.4);
    c.lineTo(cx + r * 0.52, cy - r * 0.38);
  } else if (kind === 'cross') {
    c.moveTo(cx - r * 0.42, cy - r * 0.42);
    c.lineTo(cx + r * 0.42, cy + r * 0.42);
    c.moveTo(cx + r * 0.42, cy - r * 0.42);
    c.lineTo(cx - r * 0.42, cy + r * 0.42);
  } else if (kind === 'wave') {
    c.moveTo(cx - r * 0.55, cy + r * 0.08);
    c.bezierCurveTo(cx - r * 0.3, cy - r * 0.4, cx - r * 0.1, cy - r * 0.4, cx, cy + r * 0.02);
    c.bezierCurveTo(cx + r * 0.1, cy + r * 0.44, cx + r * 0.3, cy + r * 0.44, cx + r * 0.55, cy - r * 0.08);
  } else {
    c.moveTo(cx - r * 0.46, cy);
    c.lineTo(cx + r * 0.46, cy);
  }
  c.stroke();
  c.restore();
}

// One result dot: filled colour with its symbol inside. `status` null draws an empty slot.
export function dot(c, cx, cy, r, status) {
  if (!status) {
    c.save();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = Math.max(2, r * 0.18);
    c.beginPath();
    c.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    c.stroke();
    c.restore();
    return;
  }
  const o = OUTCOME[status];
  c.save();
  c.fillStyle = o.color;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
  symbol(c, o.symbol, cx, cy, r, COLORS.ink);
}

// Pill button. state: { hover, pressed, disabled }. The hover look is a white ring (the deck's "this is what you are looking at").
export function pill(c, x, y, w, h, label, { hover = false, pressed = false, disabled = false, primary = false, sub = null } = {}) {
  const fill = disabled ? '#141a21' : primary ? COLORS.accent : COLORS.panelHi;
  const color = disabled ? COLORS.faint : primary ? COLORS.ink : COLORS.text;
  c.save();
  if (pressed && !disabled) c.translate(0, 3);
  roundRect(c, x, y, w, h, h / 2);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = hover && !disabled ? 5 : 2;
  c.strokeStyle = hover && !disabled ? COLORS.white : COLORS.edge;
  c.stroke();
  const maxW = w - h * 0.7;
  if (sub) {
    text(c, label, x + w / 2, y + h * 0.36, { size: fit(c, label, maxW, h * 0.32), weight: 700, color, align: 'center' });
    text(c, sub, x + w / 2, y + h * 0.72, { size: fit(c, sub, maxW, h * 0.2, 500), weight: 500, color: disabled ? COLORS.faint : primary ? '#173022' : COLORS.dim, align: 'center' });
  } else {
    text(c, label, x + w / 2, y + h / 2 + 1, { size: fit(c, label, maxW, h * 0.38), weight: 700, color, align: 'center' });
  }
  c.restore();
}

// Round icon button (retry, close, pause...). kind: 'retry' | 'close' | 'pause' | 'play'
export function roundButton(c, w, h, kind, { hover = false, pressed = false } = {}) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2 - 4;
  c.save();
  if (pressed) c.translate(0, 3);
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = COLORS.panel;
  c.fill();
  c.lineWidth = hover ? 6 : 2;
  c.strokeStyle = hover ? COLORS.white : COLORS.edge;
  c.stroke();
  c.strokeStyle = COLORS.white;
  c.fillStyle = COLORS.white;
  c.lineWidth = r * 0.14;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const k = r * 0.42;
  if (kind === 'close') {
    c.beginPath();
    c.moveTo(cx - k, cy - k);
    c.lineTo(cx + k, cy + k);
    c.moveTo(cx + k, cy - k);
    c.lineTo(cx - k, cy + k);
    c.stroke();
  } else if (kind === 'retry') {
    const R = k * 1.05;
    const a1 = 1.6 * Math.PI;
    c.beginPath();
    c.arc(cx, cy, R, -0.1 * Math.PI, a1);
    c.stroke();
    const px = cx + R * Math.cos(a1);
    const py = cy + R * Math.sin(a1);
    const tx = -Math.sin(a1);
    const ty = Math.cos(a1);
    const nx = Math.cos(a1);
    const ny = Math.sin(a1);
    c.beginPath();
    c.moveTo(px + tx * k * 0.75, py + ty * k * 0.75);
    c.lineTo(px + nx * k * 0.55, py + ny * k * 0.55);
    c.lineTo(px - nx * k * 0.55, py - ny * k * 0.55);
    c.closePath();
    c.fill();
  } else if (kind === 'pause') {
    c.fillRect(cx - k * 0.7, cy - k, k * 0.55, k * 2);
    c.fillRect(cx + k * 0.15, cy - k, k * 0.55, k * 2);
  } else if (kind === 'play') {
    c.beginPath();
    c.moveTo(cx - k * 0.6, cy - k);
    c.lineTo(cx + k * 0.95, cy);
    c.lineTo(cx - k * 0.6, cy + k);
    c.closePath();
    c.fill();
  }
  c.restore();
}

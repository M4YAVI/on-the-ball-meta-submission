import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

// A small name tag for a touch target (a ball you pinch). Drawn in 400 px/m units but held at 4x the pixels, because
// these sit about 0.7 m from the eyes, where a Quest needs ~20 px/deg for the words to look sharp.
export function makeLabel(text, width = 0.34, height = 0.085) {
  const SS = 4;
  const lw = Math.round(width * 400);
  const lh = Math.round(height * 400);
  const c = document.createElement('canvas');
  c.width = lw * SS;
  c.height = lh * SS;
  const ctx = c.getContext('2d');
  ctx.scale(SS, SS);
  ctx.fillStyle = 'rgba(14,22,38,0.82)';
  ctx.beginPath();
  ctx.roundRect(2, 2, lw - 4, lh - 4, 20);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(lh * 0.46)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lw / 2, lh / 2, lw * 0.92);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: DoubleSide }),
  );
}

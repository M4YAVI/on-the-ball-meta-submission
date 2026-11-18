// The goalkeeper glove model: drawn only (the save test uses the palm centre in core/goalkeeping.js, never this mesh).
//
// Built like a real pro keeper glove: a padded, slightly cupped hand body; a thick latex palm that wraps past the edges; long,
// fat "roll finger" fingers (latex wrapped round the sides, white on top) with a slight forward curl; an opposed thumb; a black
// neoprene cuff with a wide wrap strap and a velcro tab. The player mostly sees the BACK of the gloves (the palms face the
// striker), so the backhand carries the design, kept clean so it reads at arm's length in a headset: white, a bold
// cyan-to-blue sweep, a blue knuckle panel, faint stitching. No dark stripes on the fingers: at that size they read as dirt.
//
// Local axes: +Y toward the fingertips, +Z out of the palm (toward the ball), -Z out of the back of the hand (toward the
// player). The origin is the palm centre, which is where the hand's grip pose is, so the glove sits on the hand.
// With the palm toward the striker, local +X is the player's LEFT: the right glove's thumb is at +X, the left glove's at -X.
//
// Geometry, materials and textures are made once and shared by both gloves.

import {
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
} from '@iwsdk/core';
import { createSleeveStub, GLOVE_SCALE } from './arm-model.js';

const ACCENT = '#14c8ff';
const ACCENT_DEEP = '#2448ff';

// ------------------------------------------------------------------ textures
function canvasTex(w, h, draw, color = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new CanvasTexture(c);
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// a fixed pseudo-random sequence, so both gloves (and every load) look the same
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// German contact latex: pale grey-white, a fine open-cell grain, faint grip zones.
function latexColor() {
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#eceae6';
    x.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 9000; i++) {
      const v = 200 + Math.floor(r() * 45);
      x.fillStyle = `rgba(${v},${v + 2},${v + 4},0.55)`;
      x.fillRect(r() * w, r() * h, 1.4, 1.4);
    }
    // the palm's flex lines, where the latex creases
    x.strokeStyle = 'rgba(150,158,166,0.45)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(w * 0.12, h * 0.62);
    x.quadraticCurveTo(w * 0.5, h * 0.55, w * 0.9, h * 0.64);
    x.moveTo(w * 0.62, h * 0.08);
    x.quadraticCurveTo(w * 0.52, h * 0.45, w * 0.7, h * 0.92);
    x.stroke();
    // the wrist cut: a printed accent band where the latex palm meets the strap
    x.fillStyle = '#1b2230';
    x.fillRect(0, h * 0.9, w, h * 0.1);
    x.fillStyle = ACCENT;
    x.fillRect(0, h * 0.88, w, h * 0.022);
  });
}

function latexBump() {
  return canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#808080';
      x.fillRect(0, 0, w, h);
      const r = rng(5);
      for (let i = 0; i < 5000; i++) {
        const v = Math.floor(90 + r() * 90);
        x.fillStyle = `rgb(${v},${v},${v})`;
        x.beginPath();
        x.arc(r() * w, r() * h, 0.6 + r() * 1.2, 0, Math.PI * 2);
        x.fill();
      }
    },
    false,
  );
}

// The backhand print. u runs across the hand (x), v from the wrist (0) to the knuckles (1).
function backColor() {
  return canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = '#f5f7fa';
    x.fillRect(0, 0, w, h);
    // the bold sweep across the back of the hand
    const g = x.createLinearGradient(0, h, w, 0);
    g.addColorStop(0, ACCENT_DEEP);
    g.addColorStop(1, ACCENT);
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(0, h * 0.78);
    x.bezierCurveTo(w * 0.35, h * 0.62, w * 0.6, h * 0.5, w, h * 0.3);
    x.lineTo(w, h * 0.52);
    x.bezierCurveTo(w * 0.62, h * 0.7, w * 0.35, h * 0.86, 0, h);
    x.closePath();
    x.fill();
    // a thin second stripe
    x.strokeStyle = ACCENT;
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(0, h * 0.68);
    x.bezierCurveTo(w * 0.35, h * 0.52, w * 0.6, h * 0.4, w, h * 0.2);
    x.stroke();
    // the knuckle panel: a clean blue band across the top of the hand, where the fingers start
    const k = x.createLinearGradient(0, 0, w, 0);
    k.addColorStop(0, ACCENT_DEEP);
    k.addColorStop(1, ACCENT);
    x.fillStyle = k;
    x.beginPath();
    x.roundRect(w * 0.05, h * 0.04, w * 0.9, h * 0.13, 22);
    x.fill();
    // stitching round the edge, faint
    x.setLineDash([10, 8]);
    x.strokeStyle = 'rgba(60,80,110,0.22)';
    x.lineWidth = 2.5;
    x.beginPath();
    x.roundRect(w * 0.035, h * 0.03, w * 0.93, h * 0.94, 40);
    x.stroke();
  });
}

function backBump() {
  return canvasTex(
    256,
    256,
    (x, w, h) => {
      x.fillStyle = '#7a7a7a';
      x.fillRect(0, 0, w, h);
      x.fillStyle = '#9a9a9a'; // the knuckle panel is a little raised
      x.fillRect(w * 0.05, h * 0.04, w * 0.9, h * 0.13);
      x.strokeStyle = '#5a5a5a'; // seams sink in
      x.lineWidth = 2;
      x.strokeRect(w * 0.035, h * 0.03, w * 0.93, h * 0.94);
    },
    false,
  );
}

// Knitted neoprene for the cuff: dark, fine ribs.
function knitColor() {
  const t = canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#1a1e26';
    x.fillRect(0, 0, w, h);
    x.strokeStyle = '#262c37';
    x.lineWidth = 2;
    for (let i = 0; i < w; i += 6) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i, h);
      x.stroke();
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

// The wrap strap: black latex with an accent band.
function strapColor() {
  const t = canvasTex(512, 64, (x, w, h) => {
    x.fillStyle = '#111419';
    x.fillRect(0, 0, w, h);
    x.fillStyle = ACCENT;
    x.fillRect(0, h * 0.42, w, h * 0.16);
    x.fillStyle = 'rgba(255,255,255,0.08)';
    x.fillRect(0, 0, w, h * 0.1);
  });
  t.wrapS = RepeatWrapping;
  return t;
}

// The logo patch on the velcro tab, readable from the player's side.
function patchColor() {
  return canvasTex(256, 128, (x, w, h) => {
    x.fillStyle = '#0f1216';
    x.beginPath();
    x.roundRect(0, 0, w, h, 28);
    x.fill();
    x.strokeStyle = ACCENT;
    x.lineWidth = 6;
    x.beginPath();
    x.roundRect(8, 8, w - 16, h - 16, 22);
    x.stroke();
    x.fillStyle = '#ffffff';
    x.font = '900 64px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('OTB', w / 2, h / 2 + 3);
  });
}

// ------------------------------------------------------------------ geometry helpers
// The hand body's outline: narrower at the wrist, wide at the knuckles, rounded corners. Centred on the palm centre.
function handShape(grow = 0) {
  const s = new Shape();
  const bw = 0.041 + grow;
  const tw = 0.051 + grow;
  const b = -0.05 - grow;
  const t = 0.05 + grow;
  const r = 0.016;
  s.moveTo(-bw + r, b);
  s.lineTo(bw - r, b);
  s.quadraticCurveTo(bw, b, bw + 0.001, b + r);
  s.lineTo(tw, t - r);
  s.quadraticCurveTo(tw, t, tw - r, t);
  s.lineTo(-tw + r, t);
  s.quadraticCurveTo(-tw, t, -tw, t - r);
  s.lineTo(-bw - 0.001, b + r);
  s.quadraticCurveTo(-bw, b, -bw + r, b);
  return s;
}

// A padded slab of the hand outline, from z0 to z1 (bevelled), cupped so its edges come forward toward the ball, with a flat
// (planar) texture mapping across the hand.
function slab(grow, z0, z1, bevel) {
  const depth = Math.max(0.001, z1 - z0 - 2 * bevel);
  const g = new ExtrudeGeometry(handShape(grow), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 5, curveSegments: 12 });
  g.translate(0, 0, z0 + bevel);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const W = 0.051 + grow + bevel;
  const H = 0.05 + grow + bevel;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, pos.getZ(i) + 2.2 * x * x + 0.6 * Math.max(0, y) * Math.max(0, y)); // cupped across, and curling at the top
    uv.setXY(i, (x + W) / (2 * W), (y + H) / (2 * H));
  }
  g.computeVertexNormals();
  return g;
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const latex = new MeshStandardMaterial({ map: latexColor(), bumpMap: latexBump(), bumpScale: 0.6, roughness: 0.93, metalness: 0 });
  const back = new MeshStandardMaterial({ map: backColor(), bumpMap: backBump(), bumpScale: 0.8, roughness: 0.42, metalness: 0.02 });
  const white = new MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.45, metalness: 0.02 });
  const spine = new MeshStandardMaterial({ color: '#16191f', roughness: 0.5, metalness: 0.05 });
  const accent = new MeshStandardMaterial({ color: ACCENT, roughness: 0.4, metalness: 0.05, emissive: ACCENT, emissiveIntensity: 0.08 });
  const knit = new MeshStandardMaterial({ map: knitColor(), roughness: 0.9, metalness: 0 });
  const strap = new MeshStandardMaterial({ map: strapColor(), roughness: 0.6, metalness: 0.02 });
  const patch = new MeshStandardMaterial({ map: patchColor(), roughness: 0.55, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });

  // a real wrist is wider than it is deep: the cuff is an oval, about 10 x 6.5 cm
  const cuff = new CylinderGeometry(0.043, 0.047, 0.075, 28, 1, true);
  cuff.scale(1.12, 1, 0.7);
  const strapBand = new CylinderGeometry(0.0465, 0.0475, 0.04, 28, 1, true);
  strapBand.scale(1.13, 1, 0.72);
  const rim = new TorusGeometry(0.046, 0.0045, 8, 32);
  rim.rotateX(Math.PI / 2);
  rim.scale(1.12, 1, 0.7);
  const tab = new ExtrudeGeometry(
    (() => {
      const s = new Shape();
      const w = 0.032;
      const h = 0.019;
      const r = 0.009;
      s.moveTo(-w + r, -h);
      s.lineTo(w - r, -h);
      s.quadraticCurveTo(w, -h, w, -h + r);
      s.lineTo(w, h - r);
      s.quadraticCurveTo(w, h, w - r, h);
      s.lineTo(-w + r, h);
      s.quadraticCurveTo(-w, h, -w, h - r);
      s.lineTo(-w, -h + r);
      s.quadraticCurveTo(-w, -h, -w + r, -h);
      return s;
    })(),
    { depth: 0.004, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 3, curveSegments: 8 },
  );

  SHARED = {
    latex,
    back,
    white,
    spine,
    accent,
    knit,
    strap,
    patch,
    body: slab(0, -0.032, -0.002, 0.008), // the backhand's padded body (a keeper glove's back is thick foam)
    palm: slab(0.0035, -0.007, 0.012, 0.005), // the latex palm, a little bigger: it wraps past the edges
    cuff,
    strapBand,
    rim,
    tab,
    patchPlane: new PlaneGeometry(0.056, 0.03),
    caps: new Map(),
  };
  return SHARED;
}

function capsule(r, len) {
  const S = shared();
  const key = `${r.toFixed(4)}:${len.toFixed(4)}`;
  if (!S.caps.has(key)) S.caps.set(key, new CapsuleGeometry(r, Math.max(0.001, len), 6, 14));
  return S.caps.get(key);
}

// One finger segment, standing on the origin along +Y: latex wrapped round it, the backhand colour on top, a black spine.
function segment(len, r, withSpine) {
  const S = shared();
  const g = new Group();
  const core = len - 2 * r;
  const lat = new Mesh(capsule(r, core), S.latex);
  lat.scale.set(1, 1, 0.92);
  lat.position.set(0, len / 2, 0.0015);
  const top = new Mesh(capsule(r * 0.97, core), S.white);
  top.scale.set(1.02, 1, 0.78);
  top.position.set(0, len / 2, -0.004);
  g.add(lat, top);
  if (withSpine) {
    const sp = new Mesh(capsule(r * 0.46, core * 0.9), S.spine);
    sp.scale.set(1.35, 1, 0.55);
    sp.position.set(0, len / 2, -0.0105);
    g.add(sp);
  }
  return g;
}

// A whole finger: two segments, the outer one curled forward (toward the palm) by `curl` radians.
function finger(len, r, curl) {
  const g = new Group();
  const a = len * 0.56;
  const b = len * 0.5;
  g.add(segment(a, r, false));
  const tip = new Group();
  tip.position.y = a - r * 0.9;
  tip.rotation.x = curl;
  tip.add(segment(b, r * 0.96, false));
  g.add(tip);
  g.userData.tip = tip;
  return g;
}

/**
 * A keeper glove for one hand.
 * @param {'left'|'right'} side
 */
export function createGloveModel(side = 'left') {
  const S = shared();
  const root = new Group();
  root.name = `keeper-glove-${side}`;
  const sign = side === 'left' ? -1 : 1; // which side the thumb is on (see the axes above)

  // hand body: the white padded back, the latex palm in front
  root.add(new Mesh(S.body, S.back), new Mesh(S.palm, S.latex));

  // fingers: index (thumb side) to little finger; a real glove's spread, lengths and a little fan
  // (long, fat "roll" fingers: a keeper glove's fingers are well past the hand's own)
  const fingers = [
    { x: 0.0375, y: 0.043, len: 0.084, r: 0.0137, fan: -0.08, curl: 0.16 },
    { x: 0.0126, y: 0.047, len: 0.093, r: 0.014, fan: -0.02, curl: 0.14 },
    { x: -0.0126, y: 0.045, len: 0.088, r: 0.0136, fan: 0.04, curl: 0.16 },
    { x: -0.0375, y: 0.037, len: 0.072, r: 0.0125, fan: 0.11, curl: 0.2 },
  ];
  const rigFingers = [];
  for (const [i, f] of fingers.entries()) {
    const g = finger(f.len, f.r, f.curl);
    g.position.set(sign * f.x, f.y, -0.002);
    g.rotation.z = sign * f.fan; // index leans to the thumb side, little finger away from it
    g.rotation.x = 0.06;
    root.add(g);
    // the index (i = 0) fans toward the thumb and the little finger (i = 3) away from it when the hand opens wide
    rigFingers.push({ g, tip: g.userData.tip, fan: f.fan, curl: f.curl, open: (i - 1.5) * 0.12 });
  }

  // the thumb: low on the thumb side, angled out and turned in toward the palm, curled at the tip
  const thumb = new Group();
  thumb.position.set(sign * 0.047, -0.016, 0.003);
  thumb.rotation.set(0.42, sign * -0.25, sign * -0.72);
  thumb.add(segment(0.044, 0.0148, false));
  const tt = new Group();
  tt.position.y = 0.044 - 0.012;
  tt.rotation.x = 0.28;
  tt.add(segment(0.038, 0.0142, false));
  thumb.add(tt);
  root.add(thumb);

  // The arm's sleeve comes out of the cuff, straight, and the arm itself joins it (see arm-model.js).
  root.add(createSleeveStub());

  // Pose the hand. curl: [thumb, index, middle, ring, little], each 0 (open) ... 1 (closed round a ball). spread: 0 (relaxed) ...
  // 1 (fingers fanned wide, ready). Cheap: only rotations of a few groups.
  root.userData.setPose = (curl, spread) => {
    for (let i = 0; i < 4; i++) {
      const f = rigFingers[i];
      const c = curl[i + 1];
      f.g.rotation.x = 0.06 + c * 1.12;
      f.tip.rotation.x = f.curl + c * 1.25;
      f.g.rotation.z = sign * (f.fan + f.open * spread);
    }
    const c = curl[0];
    thumb.rotation.x = 0.42 + c * 0.55;
    thumb.rotation.z = sign * (-0.72 + c * 0.95 - spread * 0.14);
    tt.rotation.x = 0.28 + c * 0.75;
  };
  root.userData.setPose([0, 0, 0, 0, 0], 0);
  root.scale.setScalar(GLOVE_SCALE);

  // the wrist: neoprene cuff, the wide wrap strap, its velcro tab with the patch (on the back, readable from behind), a rim
  const cuff = new Mesh(S.cuff, S.knit);
  cuff.position.set(0, -0.083, -0.013);
  const band = new Mesh(S.strapBand, S.strap);
  band.position.set(0, -0.068, -0.013);
  const tab = new Mesh(S.tab, S.spine);
  tab.position.set(-sign * 0.006, -0.068, -0.0476); // inner face just inside the strap's back (-0.0472): flush, not sticking out
  tab.rotation.set(0, Math.PI, sign * 0.06);
  const patch = new Mesh(S.patchPlane, S.patch);
  patch.position.set(-sign * 0.006, -0.068, -0.054); // just outside the tab's outer face (-0.0536)
  patch.rotation.set(0, Math.PI, sign * 0.06); // faces -Z: the player reads it the right way round
  root.add(cuff, band, tab, patch);

  return root;
}

// Fewer draw calls for scenery that never moves. Every mesh is one draw call per eye, and the Quest browser draws each eye on its
// own, so a stadium built from dozens of small parts costs dozens of calls twice a frame (Meta's guidance for Quest 3: under 200
// draw calls a frame). Meshes of a static group that share a material (and draw order) are baked into one mesh: same look,
// one call. Only plain meshes are merged; anything animated (a skinned striker, a ball) is left as it is.

import { BufferAttribute, BufferGeometry, Matrix4, Mesh } from '@iwsdk/core';

const ATTRS = ['position', 'normal', 'uv'];

function canMerge(o) {
  return o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !Array.isArray(o.material) && !o.morphTargetInfluences && o.visible;
}

// What a material looks like: two separate materials with the same settings draw the same, so they can share one mesh.
const LOOK_KEYS = ['type', 'transparent', 'opacity', 'side', 'depthWrite', 'depthTest', 'alphaTest', 'vertexColors', 'roughness', 'metalness', 'flatShading', 'fog', 'toneMapped', 'polygonOffset', 'polygonOffsetFactor', 'blending', 'sheen', 'emissiveIntensity'];
const MAP_KEYS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap'];
function look(m) {
  // a material with its own shader changes (set on the material itself) is only ever itself
  if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') || m.isShaderMaterial) return m.uuid;
  const parts = LOOK_KEYS.map((k) => m[k]);
  for (const k of ['color', 'emissive', 'sheenColor']) parts.push(m[k]?.getHexString?.());
  for (const k of MAP_KEYS) parts.push(m[k]?.uuid);
  return parts.join(',');
}

// Bake the geometries (each with its matrix relative to the root) into one indexed geometry, or null if their attributes differ.
function bake(parts) {
  const names = ATTRS.filter((n) => parts[0].geo.attributes[n]);
  for (const { geo } of parts) {
    if (Object.keys(geo.attributes).some((n) => !ATTRS.includes(n))) return null;
    for (const n of names) if (!geo.attributes[n] || geo.attributes[n].itemSize !== parts[0].geo.attributes[n].itemSize) return null;
    for (const n of ATTRS) if (!!geo.attributes[n] !== names.includes(n)) return null;
  }
  let vCount = 0;
  let iCount = 0;
  for (const { geo } of parts) {
    vCount += geo.attributes.position.count;
    iCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const out = new BufferGeometry();
  const arrays = {};
  for (const n of names) arrays[n] = new Float32Array(vCount * parts[0].geo.attributes[n].itemSize);
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vOff = 0;
  let iOff = 0;
  for (const { geo, matrix } of parts) {
    const g = geo.clone();
    g.applyMatrix4(matrix);
    const n0 = g.attributes.position.count;
    for (const n of names) {
      const a = g.attributes[n];
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arrays[n][(vOff + i) * a.itemSize + k] = a.getComponent(i, k);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index[iOff + i] = g.index.getX(i) + vOff;
    else for (let i = 0; i < n0; i++) index[iOff + i] = vOff + i;
    iOff += g.index ? g.index.count : n0;
    vOff += n0;
    g.dispose();
  }
  for (const n of names) out.setAttribute(n, new BufferAttribute(arrays[n], parts[0].geo.attributes[n].itemSize));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// Merge the static meshes under `root` that share a material. skip(o): true for objects (and their children) to leave alone.
// Returns how many draw calls it saved.
export function mergeStatic(root, skip = () => false) {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const walk = (o) => {
    if (o !== root && skip(o)) return;
    if (o !== root && canMerge(o)) {
      const key = `${look(o.material)}|${o.renderOrder}|${o.castShadow}|${o.receiveShadow}|${o.frustumCulled}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    }
    for (const c of [...o.children]) walk(c);
  };
  walk(root);
  let saved = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((m) => ({ geo: m.geometry, matrix: new Matrix4().multiplyMatrices(inv, m.matrixWorld) }));
    const geo = bake(parts);
    if (!geo) continue;
    const merged = new Mesh(geo, meshes[0].material);
    merged.name = `merged:${meshes[0].name || meshes[0].material.name || 'static'}`;
    merged.renderOrder = meshes[0].renderOrder;
    merged.castShadow = meshes[0].castShadow;
    merged.receiveShadow = meshes[0].receiveShadow;
    merged.frustumCulled = meshes[0].frustumCulled;
    for (const m of meshes) {
      m.removeFromParent();
      // a mesh that had children keeps them where they were (re-parented to the root, same world place)
      for (const c of [...m.children]) root.attach(c);
    }
    root.add(merged);
    saved += meshes.length - 1;
  }
  return saved;
}

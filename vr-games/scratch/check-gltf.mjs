import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:8080/cricket/');
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const world = window.__world;
  if (!world) return { error: 'no world' };
  const am = window.__world?.assetManager || (window.AssetManager);
  
  // Let's traverse the scene to see what meshes exist in the world
  const meshes = [];
  world.scene.traverse((obj) => {
    if (obj.isMesh) {
      meshes.push({
        name: obj.name,
        parentName: obj.parent?.name,
        isInstanced: !!obj.isInstancedMesh,
        hasMultiMat: Array.isArray(obj.material),
        matCount: Array.isArray(obj.material) ? obj.material.length : 1,
        geoVerts: obj.geometry?.attributes?.position?.count
      });
    }
  });
  return { meshCount: meshes.length, samples: meshes.slice(0, 15) };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();

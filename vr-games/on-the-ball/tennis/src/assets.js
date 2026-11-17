import { AssetType, defineAssets } from '@iwsdk/core';

// The server is the same CC0 Quaternius character as cricket's bowler and football's striker (public/models/coach.glb, see public/CC0-1.0.txt).
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

export default defineAssets({
  server: { url: url('models/coach.glb'), type: AssetType.GLTF, name: 'Server', priority: 'critical' },
});

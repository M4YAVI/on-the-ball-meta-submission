import { AssetType, defineAssets } from '@iwsdk/core';

// The striker is the same CC0 Quaternius character as cricket's bowler (public/models/coach.glb, see public/CC0-1.0.txt).
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

export default defineAssets({
  striker: { url: url('models/coach.glb'), type: AssetType.GLTF, name: 'Striker', priority: 'critical' },
});

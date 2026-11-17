import { AssetType, defineAssets } from '@iwsdk/core';

// The pitcher is a CC0 Quaternius character painted into a baseball uniform (public/models/pitcher.glb, the same file baseball-xr
// uses; see public/CC0-1.0.txt and ASSETS.md in vr-games/baseball-xr).
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

export default defineAssets({
  pitcher: { url: url('models/pitcher.glb'), type: AssetType.GLTF, name: 'Pitcher', priority: 'critical' },
});

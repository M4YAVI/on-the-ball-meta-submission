import { AssetType, defineAssets } from '@iwsdk/core';

// Evaluated by both the app and the editor: deterministic, no side effects.
// The bowler is CC0 (Quaternius), see ASSETS.md.
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

export default defineAssets({
  bowler: { url: url('models/coach.glb'), type: AssetType.GLTF, name: 'Bowler', priority: 'critical' },
});

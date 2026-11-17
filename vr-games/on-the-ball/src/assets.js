import { AssetType, defineAssets } from '@iwsdk/core';

// Evaluated by both the app and the editor: deterministic, no side effects.
// The bowler and the ground's scenery (trees, bushes, fence, tent, rocks) are CC0 (Quaternius / Kenney), see public/CC0-1.0.txt.
const url = (file) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/u, '')}`;

const model = (file, name) => ({ url: url(`models/${file}`), type: AssetType.GLTF, name, priority: 'critical' });

export default defineAssets({
  bowler: model('coach.glb', 'Bowler'),
  'tree-oak': model('tree_oak.glb', 'Oak tree'),
  'tree-pine': model('tree_pine.glb', 'Pine tree'),
  'tree-pine-tall': model('tree_pine_tall.glb', 'Tall pine tree'),
  'tree-fat': model('tree_fat.glb', 'Round tree'),
  bush: model('bush.glb', 'Bush'),
  'bush-large': model('bush_large.glb', 'Large bush'),
  fence: model('fence.glb', 'Fence'),
  tent: model('tent.glb', 'Pavilion tent'),
  'rock-large': model('rock_large.glb', 'Large rock'),
  'rock-small': model('rock_small.glb', 'Small rock'),
});

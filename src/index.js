import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GameSystem } from './game.js';
import { HistoryStore } from './core/history.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  world.registerSystem(GameSystem);

  // Same XR start as Glove Up and Bulb Rush: the SDK's own VR button (xr.offer "always") plus ?autoxr=1 from a lobby.
  if (new URLSearchParams(window.location.search).has('autoxr')) {
    setTimeout(async () => {
      try {
        if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
        await world.launchXR();
      } catch (e) {
        console.warn('Auto XR launch notice:', e);
      }
    }, 600);
  }

  // Flat-screen page controls: the player can see what is saved on this device, and delete it (privacy, T21).
  let store;
  try {
    store = new HistoryStore(window.localStorage);
  } catch (_) {
    store = new HistoryStore(null);
  }
  const play = document.getElementById('otb-play');
  play?.addEventListener('click', async () => {
    try {
      if (window.IWER_DEVICE) window.IWER_DEVICE.primaryInputMode = 'hand';
      await world.launchXR();
    } catch (e) {
      play.textContent = 'VR is not available here';
    }
  });
  const del = document.getElementById('otb-delete');
  const exp = document.getElementById('otb-export');
  del?.addEventListener('click', () => {
    store.clear();
    del.textContent = 'Deleted';
  });
  exp?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([store.exportJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'on-the-ball-sessions.json';
    a.click();
    URL.revokeObjectURL(url);
  });
});

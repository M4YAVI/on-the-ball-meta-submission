import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { LobbySystem } from './lobby.js';

World.create(document.getElementById('scene-container'), projectOptions).then((world) => {
  window.__world = world;
  world.registerSystem(LobbySystem);

  const loader = document.getElementById('lobby-loader');
  if (loader) {
    loader.classList.add('loaded');
    setTimeout(() => loader.remove(), 500);
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('autoxr')) {
    setTimeout(async () => {
      try {
        if (window.IWER_DEVICE) {
          window.IWER_DEVICE.primaryInputMode = 'hand';
        }
        await world.launchXR();
      } catch (e) {
        console.warn('Auto XR launch notice:', e);
      }
    }, 600);
  }
});


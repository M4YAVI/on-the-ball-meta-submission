import { Raycaster, Vector2 } from '@iwsdk/core';

// On PC and mobile 2D, pointer and touch stand in for the gaze ray and pinch.
// Supports mouse hover, touch tap, click, and keyboard shortcuts (1-3, Enter, Space).
export class DesktopPointer {
  constructor(world, onSelect) {
    this.raycaster = new Raycaster();
    this.ndc = new Vector2();
    this.moved = false; // until pointer moves or touches, the ring rests on the first tile
    this.el = world.renderer.domElement;
    this.lastSelectTime = 0;
    let downX = 0;
    let downY = 0;

    const triggerSelect = (clientX, clientY) => {
      const now = performance.now();
      if (now - this.lastSelectTime < 300) return;
      this.lastSelectTime = now;
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        this.updateCoords(clientX, clientY);
      }
      onSelect(this.ndc);
    };

    this.el.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
      this.updateCoords(e.clientX, e.clientY);
    });

    this.el.addEventListener('pointermove', (e) => {
      this.updateCoords(e.clientX, e.clientY);
    });

    this.el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 20) {
        triggerSelect(e.clientX, e.clientY);
      }
    });

    this.el.addEventListener('click', (e) => {
      triggerSelect(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') triggerSelect();
      else if (/^[1-9]$/.test(e.key)) {
        window.dispatchEvent(new CustomEvent('lobby-select-game', { detail: { index: Number(e.key) - 1 } }));
      }
    });
  }

  updateCoords(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      this.moved = true;
    }
  }

  ray(camera) {
    this.raycaster.setFromCamera(this.ndc, camera);
    return this.raycaster.ray;
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { guideStep, GUIDE_TEXT } from '../src/guide.js';
import { CFG, gridSize } from '../src/config.js';

test('Guide: returns touch instructions on touch devices outside XR', () => {
  assert.equal(guideStep(false, false, true), 'touch');
  assert.equal(guideStep(false, true, true), 'touch');
  assert.equal(GUIDE_TEXT.touch, 'Tap a sport to launch.');
});

test('Guide: returns desktop click instructions on non-touch devices outside XR', () => {
  assert.equal(guideStep(false, false, false), 'desktop');
  assert.equal(guideStep(false, true, false), 'desktop');
  assert.equal(GUIDE_TEXT.desktop, 'Point at a sport. Click.');
});

test('Guide: in XR, gaze and pinch take precedence regardless of touch capability', () => {
  assert.equal(guideStep(true, false, true), 'look');
  assert.equal(guideStep(true, true, true), 'pinch');
  assert.equal(guideStep(true, false, false), 'look');
  assert.equal(guideStep(true, true, false), 'pinch');
});

test('Responsive: portrait mode FOV stays within readable bounds (40-85 deg)', () => {
  const W = 375;
  const H = 667;
  const metresWide = gridSize().w / 0.88;
  const metresHigh = metresWide * (H / W);
  const fov = 2 * Math.atan(metresHigh / 2 / CFG.grid.distance) * (180 / Math.PI);
  assert.ok(fov < 85, `FOV ${fov.toFixed(1)} deg must be less than 85 deg (was previously 96.9 deg)`);
  assert.ok(fov > 50, `FOV ${fov.toFixed(1)} deg must be greater than 50 deg`);
});

test('Responsive: desktop landscape FOV maintains original 45.6 deg', () => {
  const W = 1920;
  const H = 1080;
  const frameH = Math.min(H, (W * 502) / 757);
  const metresHigh = (gridSize().h / 0.51) * (H / frameH);
  const fov = 2 * Math.atan(metresHigh / 2 / CFG.grid.distance) * (180 / Math.PI);
  assert.ok(Math.abs(fov - 45.66) < 0.1, `Desktop FOV must remain 45.66 deg`);
});


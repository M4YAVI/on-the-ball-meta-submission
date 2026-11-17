import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sfx, FILES } from '../src/xr/audio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('FILES registry holds all 4 sport release sounds alongside legacy sounds', () => {
  assert.equal(FILES.ui, 'ui.ogg');
  assert.equal(FILES.confirm, 'confirm.ogg');
  assert.equal(FILES.good, 'coin.ogg');
  assert.equal(FILES.bounce, 'hit.ogg');
  assert.equal(FILES.done, 'level_up.ogg');
  assert.equal(FILES.bowling, 'bowling.ogg');
  assert.equal(FILES.pitch, 'pitch.ogg');
  assert.equal(FILES.racket, 'racket.ogg');
  assert.equal(FILES.kick, 'kick.ogg');
});

test('sport release sound files exist and have non-zero size across all 4 sports', () => {
  const sportDirs = [
    path.join(ROOT, 'public', 'audio'),
    path.join(ROOT, 'baseball', 'public', 'audio'),
    path.join(ROOT, 'football', 'public', 'audio'),
    path.join(ROOT, 'tennis', 'public', 'audio'),
  ];

  const releaseSounds = ['bowling.ogg', 'pitch.ogg', 'racket.ogg', 'kick.ogg'];

  for (const dir of sportDirs) {
    for (const snd of releaseSounds) {
      const p = path.join(dir, snd);
      assert.ok(fs.existsSync(p), `Missing audio asset: ${p}`);
      const stat = fs.statSync(p);
      assert.ok(stat.size > 500, `Audio asset ${p} is too small (${stat.size} bytes)`);
    }
  }
});

test('speed scaling: faster ball speeds yield higher pitch and stronger volume', () => {
  const sfx = new Sfx();
  const slow = sfx.calcSpeedAndPitch('bowling', 0.5, { kmh: 70, detune: false });
  const mid = sfx.calcSpeedAndPitch('bowling', 0.5, { kmh: 100, detune: false });
  const fast = sfx.calcSpeedAndPitch('bowling', 0.5, { kmh: 145, detune: false });

  assert.ok(fast.playbackRate > mid.playbackRate, `Fast pitch (${fast.playbackRate}) should be > mid pitch (${mid.playbackRate})`);
  assert.ok(mid.playbackRate > slow.playbackRate, `Mid pitch (${mid.playbackRate}) should be > slow pitch (${slow.playbackRate})`);
  assert.ok(fast.finalVolume > slow.finalVolume, `Fast volume (${fast.finalVolume}) should be > slow volume (${slow.finalVolume})`);
  assert.equal(mid.speedPitchMult.toFixed(2), '1.00', '100 km/h is reference baseline');
});

test('pitch variation: micro-jitter ensures consecutive throws at the same speed differ', () => {
  const sfx = new Sfx();
  const rates = new Set();
  for (let i = 0; i < 25; i++) {
    const res = sfx.calcSpeedAndPitch('bowling', 0.5, { kmh: 120 });
    rates.add(res.playbackRate.toFixed(4));
  }
  // With micro-jitter enabled, 25 consecutive deliveries must produce diverse pitch variations
  assert.ok(rates.size >= 18, `Expected high pitch diversity across 25 throws, got ${rates.size} distinct rates`);
});

test('3D positional panner: creates HRTF panner node with exact 3D coordinates', () => {
  const pannerCalls = [];
  const mockPanner = {
    panningModel: '',
    distanceModel: '',
    refDistance: 0,
    maxDistance: 0,
    rolloffFactor: 0,
    positionX: { setValueAtTime: (v) => pannerCalls.push(['x', v]) },
    positionY: { setValueAtTime: (v) => pannerCalls.push(['y', v]) },
    positionZ: { setValueAtTime: (v) => pannerCalls.push(['z', v]) },
  };

  const sfx = new Sfx();
  sfx.ctx = {
    currentTime: 1.5,
    createPanner: () => mockPanner,
  };

  const p = sfx.getPanner({ x: -0.22, y: 0.95, z: -18.2 });
  assert.ok(p, 'Panner node created');
  assert.equal(mockPanner.panningModel, 'HRTF');
  assert.equal(mockPanner.distanceModel, 'inverse');
  assert.deepEqual(pannerCalls, [
    ['x', -0.22],
    ['y', 0.95],
    ['z', -18.2],
  ]);
});

test('VR listener tracking: updates listener position, forward, and up vectors from camera', () => {
  const listenerUpdates = {};
  const mockListener = {
    positionX: { setValueAtTime: (v) => { listenerUpdates.posX = v; } },
    positionY: { setValueAtTime: (v) => { listenerUpdates.posY = v; } },
    positionZ: { setValueAtTime: (v) => { listenerUpdates.posZ = v; } },
    forwardX: { setValueAtTime: (v) => { listenerUpdates.fwdX = v; } },
    forwardY: { setValueAtTime: (v) => { listenerUpdates.fwdY = v; } },
    forwardZ: { setValueAtTime: (v) => { listenerUpdates.fwdZ = v; } },
    upX: { setValueAtTime: (v) => { listenerUpdates.upX = v; } },
    upY: { setValueAtTime: (v) => { listenerUpdates.upY = v; } },
    upZ: { setValueAtTime: (v) => { listenerUpdates.upZ = v; } },
  };

  const sfx = new Sfx();
  sfx.ctx = {
    currentTime: 2.0,
    listener: mockListener,
  };

  const mockCamera = {
    getWorldPosition(v) { v.set(0.1, 1.6, 0.05); },
    getWorldDirection(v) { v.set(0.0, -0.1, -0.99); },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 0.99, 0.1, 0, 0, -0.1, 0.99, 0, 0, 0, 0, 1] },
  };

  sfx.updateListener(mockCamera);
  assert.equal(listenerUpdates.posX, 0.1);
  assert.equal(listenerUpdates.posY, 1.6);
  assert.equal(listenerUpdates.posZ, 0.05);
  assert.equal(listenerUpdates.fwdX, 0.0);
  assert.equal(listenerUpdates.fwdY, -0.1);
  assert.equal(listenerUpdates.fwdZ, -0.99);
  assert.equal(listenerUpdates.upY, 0.99);
});

test('procedural fallback synthesis: builds audio graph nodes without crashing', () => {
  const createdNodes = [];
  const mockParam = () => ({
    value: 0,
    setValueAtTime: () => {},
    exponentialRampToValueAtTime: () => {},
  });
  const mockNode = () => ({
    connect: (n) => n,
    start: () => {},
    stop: () => {},
    frequency: mockParam(),
    gain: mockParam(),
    Q: mockParam(),
  });

  const sfx = new Sfx();
  sfx.ctx = {
    currentTime: 0.1,
    sampleRate: 44100,
    createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
    createBufferSource: () => {
      const n = mockNode();
      createdNodes.push('bufferSource');
      return n;
    },
    createBiquadFilter: () => {
      const n = mockNode();
      createdNodes.push('biquadFilter');
      return n;
    },
    createGain: () => {
      const n = mockNode();
      createdNodes.push('gain');
      return n;
    },
    createOscillator: () => {
      const n = mockNode();
      createdNodes.push('oscillator');
      return n;
    },
  };

  const sports = ['bowling', 'pitch', 'racket', 'kick'];
  for (const s of sports) {
    createdNodes.length = 0;
    sfx.synthFallback(s, mockNode(), 0.5, 1.1);
    assert.ok(createdNodes.length > 0, `Expected synthesized audio nodes for ${s}`);
  }
});

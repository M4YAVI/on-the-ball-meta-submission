import {
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';

// Generated sound (no audio files) plus pooled particles and a ball trail.
// Everything is allocated up front, nothing in the frame loop.

// Kenney sound effects (CC0), decoded on first use. Until a file is ready, the generated
// tone for the same event plays instead, so the game is never silent.
const FILES = { catch: 'catch', hit: 'hit', coin: 'coin', hurt: 'hurt', level: 'level_up', ui: 'ui' };

export class Sound {
  constructor() {
    this.ctx = null;
    this.noise = null;
    this.buffers = {};
  }

  unlock() {
    try {
      const first = !this.ctx;
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (first) this.preload();
    } catch (e) {
      this.ctx = null;
    }
  }

  preload() {
    const base = import.meta.env.BASE_URL;
    for (const [name, file] of Object.entries(FILES)) {
      fetch(`${base}audio/${file}.ogg`)
        .then((r) => r.arrayBuffer())
        .then((data) => this.ctx.decodeAudioData(data))
        .then((buffer) => {
          this.buffers[name] = buffer;
        })
        .catch(() => {
          /* keep the generated fallback */
        });
    }
  }

    // Plays a decoded file; returns false when it is not ready so the caller can fall back.
  file(name, volume = 0.7, rate = 1.0) {
    const buffer = this.buffers[name];
    if (!this.ctx || !buffer) return false;
    try {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      gain.gain.value = volume;
      src.connect(gain).connect(this.ctx.destination);
      src.start();
      return true;
    } catch (e) {
      return false;
    }
  }

  // English willow bat sweet spot crack (willow-on-leather nodal resonance)
  noiseCrack() {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      // 1. Blade body fundamental
      const bladeOsc = this.ctx.createOscillator();
      const bladeGain = this.ctx.createGain();
      bladeOsc.type = 'sine';
      bladeOsc.frequency.setValueAtTime(260, t);
      bladeOsc.frequency.exponentialRampToValueAtTime(140, t + 0.045);
      bladeGain.gain.setValueAtTime(0.65, t);
      bladeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      bladeOsc.connect(bladeGain).connect(this.ctx.destination);
      bladeOsc.start(t);
      bladeOsc.stop(t + 0.06);

      // 2. English willow sweet spot modal resonance
      const sweetOsc = this.ctx.createOscillator();
      const sweetGain = this.ctx.createGain();
      sweetOsc.type = 'triangle';
      sweetOsc.frequency.setValueAtTime(960, t);
      sweetOsc.frequency.exponentialRampToValueAtTime(800, t + 0.04);
      sweetGain.gain.setValueAtTime(0.55, t);
      sweetGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      sweetOsc.connect(sweetGain).connect(this.ctx.destination);
      sweetOsc.start(t);
      sweetOsc.stop(t + 0.05);

      // 3. Instantaneous strike snap
      const snapOsc = this.ctx.createOscillator();
      const snapGain = this.ctx.createGain();
      snapOsc.type = 'sine';
      snapOsc.frequency.setValueAtTime(3600, t);
      snapGain.gain.setValueAtTime(0.45, t);
      snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      snapOsc.connect(snapGain).connect(this.ctx.destination);
      snapOsc.start(t);
      snapOsc.stop(t + 0.02);
    } catch (e) {}
  }

  crack() {
    if (!this.file('hit', 0.9)) this.noiseCrack();
  }

  // Flesh-on-hard-leather bare hand catch: cupped palm cavity pop + stinging skin slap + palm muscle shock thud
  handCatch(speed = 60) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const speedNorm = Math.min(1.3, Math.max(0.7, speed / 60));

      // 1. Dense palm muscle shock thud
      const thudOsc = this.ctx.createOscillator();
      const thudGain = this.ctx.createGain();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(190 * speedNorm, t);
      thudOsc.frequency.exponentialRampToValueAtTime(75, t + 0.04);
      thudGain.gain.setValueAtTime(0.75 * speedNorm, t);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      thudOsc.connect(thudGain).connect(this.ctx.destination);
      thudOsc.start(t);
      thudOsc.stop(t + 0.06);

      // 2. Cupped-palm air-pocket cavity pop (the hollow cupped hands acoustic)
      const cavityOsc = this.ctx.createOscillator();
      const cavityGain = this.ctx.createGain();
      cavityOsc.type = 'triangle';
      cavityOsc.frequency.setValueAtTime(520 * speedNorm, t);
      cavityOsc.frequency.exponentialRampToValueAtTime(310, t + 0.035);
      cavityGain.gain.setValueAtTime(0.55 * speedNorm, t);
      cavityGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      cavityOsc.connect(cavityGain).connect(this.ctx.destination);
      cavityOsc.start(t);
      cavityOsc.stop(t + 0.045);

      // 3. Stinging skin-on-leather slap transient
      const slapOsc = this.ctx.createOscillator();
      const slapGain = this.ctx.createGain();
      slapOsc.type = 'triangle';
      slapOsc.frequency.setValueAtTime(2600 * speedNorm, t);
      slapGain.gain.setValueAtTime(0.50 * speedNorm, t);
      slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      slapOsc.connect(slapGain).connect(this.ctx.destination);
      slapOsc.start(t);
      slapOsc.stop(t + 0.03);
    } catch (e) {}
  }

  caught(speed = 60) {
    const jitter = 1.0 + (Math.random() * 2 - 1) * 0.04;
    const rate = Math.min(1.25, Math.max(0.85, speed / 60)) * jitter;
    if (!this.file('catch', 0.85, rate)) {
      this.handCatch(speed);
    }
  }

  missed() {
    if (!this.file('hurt', 0.5)) this.tone(220, 110, 0.35, 'sawtooth');
  }

  over() {
    if (!this.file('level', 0.7)) this.tone(392, 784, 0.5, 'triangle');
  }

  start() {
    if (!this.file('ui', 0.6)) this.tone(520, 780, 0.12, 'triangle', 0.15);
  }
}

const BURST_COUNT = 32;
const BURST_LIFE = 0.45;
const TRAIL_COUNT = 9;

export class Effects {
  constructor(world) {
    const geo = new SphereGeometry(0.012, 8, 6);
    this.bits = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      const mesh = new Mesh(geo, new MeshBasicMaterial({ color: 0xffd23f, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.bits.push({ mesh, vel: new Vector3(), life: 0 });
    }

    const trailGeo = new SphereGeometry(0.07, 10, 8);
    this.trail = [];
    for (let i = 0; i < TRAIL_COUNT; i++) {
      const mesh = new Mesh(trailGeo, new MeshBasicMaterial({ color: 0xff6a5a, transparent: true }));
      mesh.visible = false;
      world.createTransformEntity(mesh);
      this.trail.push(mesh);
    }
    this.trailHead = 0;
    this.trailTimer = 0;
  }

  burst(position) {
    for (const bit of this.bits) {
      bit.mesh.position.copy(position);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 0.7;
      bit.vel.set(Math.cos(angle) * speed, Math.sin(angle) * speed + 0.35, (Math.random() - 0.75) * 0.3);
      bit.life = BURST_LIFE;
      bit.mesh.visible = true;
      bit.mesh.scale.setScalar(1);
      bit.mesh.material.opacity = 1;
    }
  }

  // Drops a fading ghost of the ball every few frames.
  trailPoint(position, dt) {
    this.trailTimer += dt;
    if (this.trailTimer < 0.025) return;
    this.trailTimer = 0;
    const ghost = this.trail[this.trailHead];
    this.trailHead = (this.trailHead + 1) % TRAIL_COUNT;
    ghost.position.copy(position);
    ghost.userData.life = 1;
    ghost.visible = true;
  }

  clearTrail() {
    for (const ghost of this.trail) {
      ghost.visible = false;
      ghost.userData.life = 0;
    }
  }

  update(dt) {
    for (const bit of this.bits) {
      if (!bit.mesh.visible) continue;
      bit.life -= dt;
      if (bit.life <= 0) {
        bit.mesh.visible = false;
        continue;
      }
      bit.vel.y -= 3 * dt;
      bit.mesh.position.addScaledVector(bit.vel, dt);
      const k = bit.life / BURST_LIFE;
      bit.mesh.scale.setScalar(k);
      bit.mesh.material.opacity = k;
    }
    for (const ghost of this.trail) {
      if (!ghost.visible) continue;
      ghost.userData.life -= dt * 4;
      if (ghost.userData.life <= 0) {
        ghost.visible = false;
        continue;
      }
      ghost.scale.setScalar(ghost.userData.life);
      ghost.material.opacity = ghost.userData.life * 0.5;
    }
  }
}

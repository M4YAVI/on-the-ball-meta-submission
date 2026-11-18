// Tiny sound player (CC0 Kenney sounds in public/audio + sport-specific acoustics).
// Sound is a nicety: anything that fails here is ignored.

export const FILES = Object.freeze({
  ui: 'ui.ogg',
  confirm: 'confirm.ogg',
  good: 'coin.ogg',
  bounce: 'hit.ogg',
  done: 'level_up.ogg',
  bowling: 'bowling.ogg',
  pitch: 'pitch.ogg',
  racket: 'racket.ogg',
  kick: 'kick.ogg',
});

const _scratchPos = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
const _scratchDir = { x: 0, y: 0, z: -1, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
const _scratchUp = { x: 0, y: 1, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.buffers = {};
    this.muted = false;
    this.noise = null;
  }

  // Must run from a user action (a pinch or click) so the browser lets sound start.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { });
      return;
    }
    try {
      const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.ctx.destination);

      const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
      for (const [name, file] of Object.entries(FILES)) {
        fetch(`${base}audio/${file}`)
          .then((r) => r.arrayBuffer())
          .then((b) => this.ctx.decodeAudioData(b))
          .then((buf) => {
            this.buffers[name] = buf;
          })
          .catch(() => { });
      }
    } catch (_) {
      this.ctx = null;
    }
  }

  // Keeps the 3D audio listener matched to the VR player's headset (camera).
  updateListener(camera) {
    if (!this.ctx || !camera) return;
    try {
      const l = this.ctx.listener;
      if (!l) return;

      if (typeof camera.getWorldPosition === 'function') {
        camera.getWorldPosition(_scratchPos);
      } else if (camera.position) {
        _scratchPos.set(camera.position.x || 0, camera.position.y || 0, camera.position.z || 0);
      }

      if (typeof camera.getWorldDirection === 'function') {
        camera.getWorldDirection(_scratchDir);
      }

      const te = camera.matrixWorld?.elements;
      if (te && te.length >= 7) {
        _scratchUp.set(te[4], te[5], te[6]);
      }

      const t = this.ctx.currentTime;
      if (l.positionX) {
        l.positionX.setValueAtTime(_scratchPos.x, t);
        l.positionY.setValueAtTime(_scratchPos.y, t);
        l.positionZ.setValueAtTime(_scratchPos.z, t);
        l.forwardX.setValueAtTime(_scratchDir.x, t);
        l.forwardY.setValueAtTime(_scratchDir.y, t);
        l.forwardZ.setValueAtTime(_scratchDir.z, t);
        l.upX.setValueAtTime(_scratchUp.x, t);
        l.upY.setValueAtTime(_scratchUp.y, t);
        l.upZ.setValueAtTime(_scratchUp.z, t);
      } else if (typeof l.setPosition === 'function') {
        l.setPosition(_scratchPos.x, _scratchPos.y, _scratchPos.z);
        l.setOrientation(_scratchDir.x, _scratchDir.y, _scratchDir.z, _scratchUp.x, _scratchUp.y, _scratchUp.z);
      }
    } catch (_) { }
  }

  // Spatial PannerNode configured for HRTF 3D spatialization on Meta Quest / WebXR
  getPanner(pos) {
    if (!this.ctx || !pos) return null;
    try {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 1.8;
      p.maxDistance = 50.0;
      p.rolloffFactor = 0.8;

      const px = pos.x ?? pos[0] ?? 0;
      const py = pos.y ?? pos[1] ?? 0;
      const pz = pos.z ?? pos[2] ?? 0;

      const t = this.ctx.currentTime;
      if (p.positionX) {
        p.positionX.setValueAtTime(px, t);
        p.positionY.setValueAtTime(py, t);
        p.positionZ.setValueAtTime(pz, t);
      } else if (typeof p.setPosition === 'function') {
        p.setPosition(px, py, pz);
      }
      return p;
    } catch (_) {
      return null;
    }
  }

  // Calculate speed-scaled pitch and volume, plus subtle pitch jitter to avoid repetitive machine-gun effect
  calcSpeedAndPitch(name, volume, opts) {
    const kmh = typeof opts === 'number' ? opts : (opts?.kmh || opts?.speed || 0);
    let speedPitchMult = 1.0;
    let speedGainMult = 1.0;

    if (kmh > 0) {
      // Sports speed range [50 .. 160 km/h].
      // 100 km/h is baseline (1.0).
      // 145 km/h reaches ~1.20 pitch (sharper, faster) and ~1.15 volume (stronger).
      // 70 km/h drops to ~0.88 pitch (deeper, slower) and ~0.90 volume.
      const clamped = Math.min(160, Math.max(50, kmh));
      const norm = (clamped - 100) / 60;
      speedPitchMult = 1.0 + norm * 0.22;
      speedGainMult = 1.0 + norm * 0.15;
    }

    // Micro-jitter (+/- 5%) so identical velocities still sound natural and organic
    const applyDetune = typeof opts === 'object' && opts.detune !== undefined ? opts.detune : true;
    const jitter = applyDetune ? (1.0 + (Math.random() * 2 - 1) * 0.05) : 1.0;

    const basePitch = (typeof opts === 'object' && opts.pitch) ? opts.pitch : 1.0;
    const playbackRate = basePitch * speedPitchMult * jitter;
    const finalVolume = volume * speedGainMult;

    return { playbackRate, finalVolume, kmh, speedPitchMult };
  }

  // Shared noise buffer for procedural synthesis fallback
  noiseBuffer() {
    if (!this.noise && this.ctx) {
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  // Procedural fallback synthesis in case audio buffer is still decoding
  synthFallback(name, dest, volume, speedPitchMult) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    try {
      if (name === 'bowling' || name === 'pitch') {
        // Air whoosh and seam release
        const isPitch = name === 'pitch';
        const dur = isPitch ? 0.22 : 0.20;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = isPitch ? 1.8 : 1.6;
        const startFreq = (isPitch ? 800 : 480) * speedPitchMult;
        const endFreq = (isPitch ? 2500 : 1420) * speedPitchMult;
        filter.frequency.setValueAtTime(startFreq, t);
        filter.frequency.exponentialRampToValueAtTime(endFreq, t + dur);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(volume * 0.8, t + 0.035);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

        src.connect(filter).connect(gain).connect(dest);
        src.start(t);
        src.stop(t + dur + 0.02);

        // Seam release click transient
        const seamOsc = this.ctx.createOscillator();
        const seamGain = this.ctx.createGain();
        seamOsc.type = 'sine';
        seamOsc.frequency.setValueAtTime((isPitch ? 2800 : 3400) * speedPitchMult, t);
        seamGain.gain.setValueAtTime(volume * 0.35, t);
        seamGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
        seamOsc.connect(seamGain).connect(dest);
        seamOsc.start(t);
        seamOsc.stop(t + 0.025);
      } else if (name === 'racket') {
        // Racket string pop + frame resonance + launch slice
        const dur = 0.24;
        const stringOsc = this.ctx.createOscillator();
        const stringGain = this.ctx.createGain();
        stringOsc.type = 'triangle';
        stringOsc.frequency.setValueAtTime(440 * speedPitchMult, t);
        stringOsc.frequency.exponentialRampToValueAtTime(160 * speedPitchMult, t + 0.05);
        stringGain.gain.setValueAtTime(volume * 0.75, t);
        stringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        stringOsc.connect(stringGain).connect(dest);
        stringOsc.start(t);
        stringOsc.stop(t + 0.06);

        // High string ping transient
        const pingOsc = this.ctx.createOscillator();
        const pingGain = this.ctx.createGain();
        pingOsc.type = 'sine';
        pingOsc.frequency.setValueAtTime(1850 * speedPitchMult, t);
        pingGain.gain.setValueAtTime(volume * 0.3, t);
        pingGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        pingOsc.connect(pingGain).connect(dest);
        pingOsc.start(t);
        pingOsc.stop(t + 0.025);

        // Follow-through slice whoosh
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200 * speedPitchMult;
        filter.Q.value = 1.6;
        const swishGain = this.ctx.createGain();
        swishGain.gain.setValueAtTime(0.001, t);
        swishGain.gain.exponentialRampToValueAtTime(volume * 0.45, t + 0.04);
        swishGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filter).connect(swishGain).connect(dest);
        src.start(t);
        src.stop(t + dur + 0.02);
      } else if (name === 'bat' || name === 'edge') {
        // Willow on leather. A clean middle is a short, hollow "tock": a sharp click, a woody ring around 1 kHz and a little low
        // body. An edge is thin and clicky with almost no body. Louder and brighter the harder the ball is struck.
        const edge = name === 'edge';
        const click = this.ctx.createBufferSource();
        click.buffer = this.noiseBuffer();
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = edge ? 3800 : 2400;
        const clickGain = this.ctx.createGain();
        clickGain.gain.setValueAtTime(volume * (edge ? 0.9 : 1.1), t);
        clickGain.gain.exponentialRampToValueAtTime(0.001, t + (edge ? 0.012 : 0.018));
        click.connect(hp).connect(clickGain).connect(dest);
        click.start(t);
        click.stop(t + 0.03);

        const ring = this.ctx.createBufferSource();
        ring.buffer = this.noiseBuffer();
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = (edge ? 2600 : 1050) * speedPitchMult;
        bp.Q.value = edge ? 9 : 14;
        const ringGain = this.ctx.createGain();
        ringGain.gain.setValueAtTime(volume * (edge ? 1.6 : 3.2), t);
        ringGain.gain.exponentialRampToValueAtTime(0.001, t + (edge ? 0.05 : 0.11));
        ring.connect(bp).connect(ringGain).connect(dest);
        ring.start(t);
        ring.stop(t + 0.13);

        if (!edge) {
          const body = this.ctx.createOscillator();
          const bodyGain = this.ctx.createGain();
          body.type = 'sine';
          body.frequency.setValueAtTime(320 * speedPitchMult, t);
          body.frequency.exponentialRampToValueAtTime(170, t + 0.06);
          bodyGain.gain.setValueAtTime(volume * 0.7, t);
          bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
          body.connect(bodyGain).connect(dest);
          body.start(t);
          body.stop(t + 0.08);
        }
      } else if (name === 'swish') {
        // The bat cutting the air on a hard swing.
        const dur = 0.26;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 1.2;
        filter.frequency.setValueAtTime(380, t);
        filter.frequency.exponentialRampToValueAtTime(900, t + dur * 0.45);
        filter.frequency.exponentialRampToValueAtTime(420, t + dur);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(volume, t + dur * 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(filter).connect(gain).connect(dest);
        src.start(t);
        src.stop(t + dur + 0.02);
      } else if (name === 'bounce') {
        // Authentic cricket pitch / turf bounce: compacted turf thud + leather contact thack + grass seam bite
        const dur = 0.11;
        const thudOsc = this.ctx.createOscillator();
        const thudGain = this.ctx.createGain();
        thudOsc.type = 'sine';
        thudOsc.frequency.setValueAtTime(140 * speedPitchMult, t);
        thudOsc.frequency.exponentialRampToValueAtTime(65 * speedPitchMult, t + 0.04);
        thudGain.gain.setValueAtTime(volume * 0.85, t);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.046);
        thudOsc.connect(thudGain).connect(dest);
        thudOsc.start(t);
        thudOsc.stop(t + 0.055);

        // Ground leather contact thack
        const contactOsc = this.ctx.createOscillator();
        const contactGain = this.ctx.createGain();
        contactOsc.type = 'triangle';
        contactOsc.frequency.setValueAtTime(1350 * speedPitchMult, t);
        contactGain.gain.setValueAtTime(volume * 0.45, t);
        contactGain.gain.exponentialRampToValueAtTime(0.001, t + 0.016);
        contactOsc.connect(contactGain).connect(dest);
        contactOsc.start(t);
        contactOsc.stop(t + 0.02);

        // Seam grass bite
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 3200 * speedPitchMult;
        filter.Q.value = 2.0;
        const raspGain = this.ctx.createGain();
        raspGain.gain.setValueAtTime(volume * 0.35, t);
        raspGain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
        src.connect(filter).connect(raspGain).connect(dest);
        src.start(t);
        src.stop(t + 0.035);
      } else if (name === 'kick') {
        // Boot-to-ball low end thump + slap
        const dur = 0.22;
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110 * speedPitchMult, t);
        osc.frequency.exponentialRampToValueAtTime(45 * speedPitchMult, t + 0.08);
        oscGain.gain.setValueAtTime(volume * 0.9, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.connect(oscGain).connect(dest);
        osc.start(t);
        osc.stop(t + 0.1);

        // Leather slap
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 450 * speedPitchMult;
        const slapGain = this.ctx.createGain();
        slapGain.gain.setValueAtTime(volume * 0.5, t);
        slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.connect(filter).connect(slapGain).connect(dest);
        src.start(t);
        src.stop(t + 0.05);
      } else if (name === 'glove') {
        // A ball into a catcher's mitt: a dull, padded leather "pop" (a low thump with a short muffled slap on top), harder the faster it came.
        const thump = this.ctx.createOscillator();
        const thumpGain = this.ctx.createGain();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(190 * speedPitchMult, t);
        thump.frequency.exponentialRampToValueAtTime(70, t + 0.07);
        thumpGain.gain.setValueAtTime(volume * 1.1, t);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        thump.connect(thumpGain).connect(dest);
        thump.start(t);
        thump.stop(t + 0.11);

        const slap = this.ctx.createBufferSource();
        slap.buffer = this.noiseBuffer();
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1300 * speedPitchMult;
        bp.Q.value = 0.9;
        const slapGain = this.ctx.createGain();
        slapGain.gain.setValueAtTime(volume * 1.2, t);
        slapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        slap.connect(bp).connect(slapGain).connect(dest);
        slap.start(t);
        slap.stop(t + 0.06);
      }
    } catch (_) { }
  }

  play(name, volume = 0.5, opts = {}) {
    if (this.muted || !this.ctx) return;
    try {
      const { playbackRate, finalVolume, speedPitchMult } = this.calcSpeedAndPitch(name, volume, opts);
      const pos = typeof opts === 'object' ? opts.pos : null;
      const panner = this.getPanner(pos);
      const dest = panner || this.masterGain || this.ctx.destination;
      if (panner) panner.connect(this.masterGain || this.ctx.destination);

      if (this.buffers[name]) {
        const src = this.ctx.createBufferSource();
        const gain = this.ctx.createGain();
        gain.gain.value = finalVolume;
        src.buffer = this.buffers[name];
        src.playbackRate.value = playbackRate;
        src.connect(gain).connect(dest);
        src.start();
      } else {
        this.synthFallback(name, dest, finalVolume, speedPitchMult);
      }
    } catch (_) {
      /* ignore */
    }
  }
}

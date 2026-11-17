// Tiny sound player (CC0 Kenney sounds in public/audio). Sound is a nicety: anything that fails here is ignored.

const FILES = { ui: 'ui.ogg', confirm: 'confirm.ogg', good: 'coin.ogg', bounce: 'hit.ogg', done: 'level_up.ogg' };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.muted = false;
  }

  // Must run from a user action (a pinch or click) so the browser lets sound start.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const base = import.meta.env.BASE_URL;
      for (const [name, file] of Object.entries(FILES)) {
        fetch(`${base}audio/${file}`)
          .then((r) => r.arrayBuffer())
          .then((b) => this.ctx.decodeAudioData(b))
          .then((buf) => {
            this.buffers[name] = buf;
          })
          .catch(() => {});
      }
    } catch (_) {
      this.ctx = null;
    }
  }

  play(name, volume = 0.5) {
    if (this.muted || !this.ctx || !this.buffers[name]) return;
    try {
      const src = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      src.buffer = this.buffers[name];
      src.connect(gain).connect(this.ctx.destination);
      src.start();
    } catch (_) {
      /* ignore */
    }
  }
}

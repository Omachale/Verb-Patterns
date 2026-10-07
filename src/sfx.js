// All sound effects are synthesised live with the Web Audio API — no audio files.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Browsers only allow audio after a user gesture, so call this from input handlers.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      this.out.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  get on() { return this.ctx && !this.muted; }
  get now() { return this.ctx.currentTime; }

  _env(t, peak, attack, decay, dest = this.out) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }
  _osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }
  _noise(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
    return s;
  }
  _filter(type, freq, q, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  }

  key() {
    if (!this.on) return;
    const t = this.now;
    this._noise(t, 0.04, this._filter("bandpass", 2400 + Math.random() * 900, 1.5, this._env(t, 0.3, 0.002, 0.035)));
    this._osc("sine", 170, t, 0.06, this._env(t, 0.12, 0.002, 0.05));
  }

  correct() {
    if (!this.on) return;
    const t = this.now;
    [660, 990].forEach((f, i) => this._osc("triangle", f, t + i * 0.09, 0.3, this._env(t + i * 0.09, 0.3, 0.01, 0.25)));
  }

  wrong() {
    if (!this.on) return;
    const t = this.now;
    const o = this._osc("square", 160, t, 0.4, this._filter("lowpass", 900, 1, this._env(t, 0.28, 0.01, 0.35)));
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
  }

  tick() {
    if (!this.on) return;
    const t = this.now;
    this._osc("sine", 1500, t, 0.05, this._env(t, 0.15, 0.002, 0.04));
  }

  boing() {
    if (!this.on) return;
    const t = this.now;
    const o = this._osc("sine", 220, t, 0.25, this._env(t, 0.22, 0.01, 0.2));
    o.frequency.exponentialRampToValueAtTime(520, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.2);
  }

  scrape() {
    if (!this.on) return;
    const t = this.now;
    const bp = this._filter("bandpass", 350, 4, this._env(t, 0.25, 0.03, 0.33));
    bp.frequency.linearRampToValueAtTime(900, t + 0.35);
    this._noise(t, 0.4, bp);
  }

  // Marker squeaking on the whiteboard.
  squeak() {
    if (!this.on) return;
    const t = this.now;
    const dur = 0.05 + Math.random() * 0.12;
    const o = this._osc("sine", 1900 + Math.random() * 900, t, dur, this._env(t, 0.035, 0.01, dur));
    const lfo = this._osc("sine", 30 + Math.random() * 15, t, dur, this.ctx.createGain());
    const depth = this.ctx.createGain();
    depth.gain.value = 140;
    lfo.disconnect();
    lfo.connect(depth);
    depth.connect(o.frequency);
  }

  // Teacher yelling: distorted "wah-wah" gibberish syllables.
  yell() {
    if (!this.on) return;
    const t = this.now;
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.35;
    shaper.connect(bus);
    bus.connect(this.out);
    const syllables = [0.18, 0.16, 0.3, 0.14, 0.16, 0.45];
    let st = t;
    syllables.forEach((len, i) => {
      const f0 = 170 + Math.random() * 50 - i * 6;
      const env = this._env(st, 0.9, 0.025, len, shaper);
      const formant = this._filter("bandpass", 500, 3, env);
      formant.frequency.setValueAtTime(450, st);
      formant.frequency.linearRampToValueAtTime(1100 + Math.random() * 300, st + len * 0.4);
      formant.frequency.linearRampToValueAtTime(600, st + len);
      const o = this._osc("sawtooth", f0, st, len + 0.05, formant);
      o.frequency.linearRampToValueAtTime(f0 * (i === syllables.length - 1 ? 0.7 : 0.9), st + len);
      st += len + 0.05;
    });
  }

  creak() {
    if (!this.on) return;
    const t = this.now;
    const o = this._osc("sawtooth", 55, t, 0.9, this._filter("bandpass", 900, 7, this._env(t, 0.2, 0.06, 0.8)));
    o.frequency.linearRampToValueAtTime(85, t + 0.4);
    o.frequency.linearRampToValueAtTime(45, t + 0.85);
  }

  latch() {
    if (!this.on) return;
    const t = this.now;
    this._noise(t, 0.05, this._filter("bandpass", 1600, 2, this._env(t, 0.35, 0.002, 0.05)));
    this._osc("sine", 90, t, 0.12, this._env(t, 0.3, 0.003, 0.1));
  }

  fanfare() {
    if (!this.on) return;
    const t = this.now;
    [523, 659, 784, 1047].forEach((f, i) =>
      this._osc("triangle", f, t + i * 0.11, 0.8, this._env(t + i * 0.11, 0.22, 0.01, i === 3 ? 0.7 : 0.18)));
  }

  // Playground "na-na na-na-na" taunt.
  taunt() {
    if (!this.on) return;
    const t = this.now;
    const notes = [[784, 0.22], [659, 0.22], [880, 0.15], [784, 0.15], [659, 0.3],
                   [784, 0.22], [659, 0.22], [880, 0.15], [784, 0.15], [659, 0.3]];
    let st = t;
    for (const [f, d] of notes) {
      this._osc("square", f, st, d, this._filter("lowpass", 2200, 1, this._env(st, 0.12, 0.01, d * 0.9)));
      st += d;
    }
  }

  doom() {
    if (!this.on) return;
    const t = this.now;
    [196, 185, 174].forEach((f, i) =>
      this._osc("sawtooth", f / 2, t + i * 0.3, 0.4, this._filter("lowpass", 600, 1, this._env(t + i * 0.3, 0.2, 0.02, i === 2 ? 0.9 : 0.25))));
  }
}

// Sound must never break the game: if a phone's audio engine throws, just skip the sound.
for (const name of Object.getOwnPropertyNames(Sfx.prototype)) {
  const fn = Object.getOwnPropertyDescriptor(Sfx.prototype, name).value;   // skips getters
  if (name === "constructor" || typeof fn !== "function") continue;
  Sfx.prototype[name] = function (...args) {
    try { return fn.apply(this, args); } catch (err) { console.warn(`sfx.${name} failed`, err); }
  };
}

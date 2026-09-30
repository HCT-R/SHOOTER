/* ========================================================================
   10-audio.js — every sound is synthesised at runtime (no audio files)
   ======================================================================== */

class SfxEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.noiseBuf = null;
    this.voices = 0;
    this._musicTimer = 0;
    this._step = 0;
    this.intensity = 0;
  }

  /* browsers require a user gesture before audio can start */
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    try { this._build(AC); } catch (e) {
      // a machine with no audio output should still be able to play
      this.ctx = null;
      this.enabled = false;
    }
  }

  _build(AC) {
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 8;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.master);

    // a shared reverb tail gives the facility a concrete-corridor feel
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = this._impulse(1.6, 2.6);
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.28;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.noiseBuf = this._noise(2.0);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  get t() { return this.ctx.currentTime; }

  /* budget guard: a 40-alien horde must not spawn 200 simultaneous voices */
  _ok(cost) {
    cost = cost || 1;
    if (!this.enabled || !this.ctx) return false;
    if (this.voices > 34) return false;
    this.voices += cost;
    setTimeout(() => { this.voices -= cost; }, 220);
    return true;
  }

  _env(node, when, peak, attack, decay) {
    const g = node.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
    g.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  /* ---- weapon fire ------------------------------------------------- */
  shot(kind, vol) {
    if (kind === 'plasma') { this.plasma(vol); return; }
    if (kind === 'railgun') { this.railgun(vol); return; }
    if (!this._ok()) return;
    vol = vol === undefined ? 1 : vol;
    const t = this.t;
    const table = {
      pistol:  { lo: 240, hi: 1800, dur: 0.16, body: 0.55, crack: 0.9, q: 2 },
      smg:     { lo: 300, hi: 2600, dur: 0.09, body: 0.34, crack: 0.7, q: 3 },
      rifle:   { lo: 180, hi: 2200, dur: 0.19, body: 0.62, crack: 1.0, q: 2 },
      shotgun: { lo: 110, hi: 1400, dur: 0.34, body: 0.95, crack: 1.0, q: 1.2 },
      minigun: { lo: 260, hi: 2400, dur: 0.07, body: 0.32, crack: 0.6, q: 3 },
      rocket:  { lo: 90,  hi: 900,  dur: 0.50, body: 1.0,  crack: 0.5, q: 1 },
      autocannon: { lo: 130, hi: 1200, dur: 0.23, body: 0.92, crack: 1.1, q: 1.3 }
    };
    const cfg = table[kind] || table.pistol;

    // noise crack through a sweeping band-pass = the "snap" of a muzzle blast
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.85 + Math.random() * 0.3;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = cfg.q;
    bp.frequency.setValueAtTime(cfg.hi, t);
    bp.frequency.exponentialRampToValueAtTime(cfg.lo, t + cfg.dur);
    const ng = this.ctx.createGain();
    this._env(ng, t, 0.5 * cfg.crack * vol, 0.001, cfg.dur);
    n.connect(bp); bp.connect(ng); ng.connect(this.sfxBus);
    ng.connect(this.verb);
    n.start(t); n.stop(t + cfg.dur + 0.05);

    // low sine thump = the chest-punch of the round leaving the barrel
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(cfg.lo * 0.9, t);
    o.frequency.exponentialRampToValueAtTime(40, t + cfg.dur * 0.9);
    const og = this.ctx.createGain();
    this._env(og, t, 0.5 * cfg.body * vol, 0.002, cfg.dur * 0.9);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + cfg.dur + 0.05);

    // The action and receiver are a separate transient from the muzzle blast.
    // Its short delayed tick keeps even a rapid SMG mechanically distinct.
    if (kind !== 'rocket') {
      const action = this.ctx.createBufferSource();
      action.buffer = this.noiseBuf;
      action.playbackRate.value = kind === 'shotgun' ? 0.7 : 1.8;
      const metal = this.ctx.createBiquadFilter();
      metal.type = 'bandpass';
      metal.frequency.value = kind === 'shotgun' ? 1700 : kind === 'autocannon' ? 2400 : 3800;
      metal.Q.value = 5;
      const ag = this.ctx.createGain();
      const at = t + (kind === 'shotgun' ? 0.2 : 0.022);
      this._env(ag, at, (kind === 'shotgun' ? 0.22 : kind === 'autocannon' ? 0.15 : 0.065) * vol, 0.001, 0.045);
      action.connect(metal); metal.connect(ag); ag.connect(this.sfxBus);
      action.start(at); action.stop(at + 0.075);
    }
  }

  railgun(vol) {
    if (!this._ok(3)) return;
    vol = vol === undefined ? 1 : vol;
    const t = this.t;
    // A fast rising coil transient releases into a low electromagnetic boom.
    const coil = this.ctx.createOscillator();
    coil.type = 'triangle';
    coil.frequency.setValueAtTime(420, t);
    coil.frequency.exponentialRampToValueAtTime(5400, t + 0.035);
    coil.frequency.exponentialRampToValueAtTime(150, t + 0.46);
    const cg = this.ctx.createGain();
    this._env(cg, t, 0.34 * vol, 0.03, 0.46);
    coil.connect(cg); cg.connect(this.sfxBus); cg.connect(this.verb);
    coil.start(t); coil.stop(t + 0.55);

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(165, t + 0.025);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.4);
    const sg = this.ctx.createGain();
    this._env(sg, t + 0.025, 0.75 * vol, 0.003, 0.42);
    sub.connect(sg); sg.connect(this.sfxBus);
    sub.start(t); sub.stop(t + 0.52);

    const snap = this.ctx.createBufferSource();
    snap.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(5800, t);
    bp.frequency.exponentialRampToValueAtTime(450, t + 0.32);
    const ng = this.ctx.createGain();
    this._env(ng, t + 0.028, 0.6 * vol, 0.001, 0.3);
    snap.connect(bp); bp.connect(ng); ng.connect(this.sfxBus); ng.connect(this.verb);
    snap.start(t); snap.stop(t + 0.4);
  }

  plasma(vol) {
    if (!this._ok(2)) return;
    vol = vol === undefined ? 1 : vol;
    const t = this.t;
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(1250 + Math.random() * 100, t);
    carrier.frequency.exponentialRampToValueAtTime(105, t + 0.24);
    mod.frequency.setValueAtTime(740, t);
    mod.frequency.exponentialRampToValueAtTime(95, t + 0.19);
    depth.gain.setValueAtTime(1150, t);
    depth.gain.exponentialRampToValueAtTime(12, t + 0.2);
    mod.connect(depth); depth.connect(carrier.frequency);
    const gain = this.ctx.createGain();
    this._env(gain, t, 0.32 * vol, 0.003, 0.26);
    carrier.connect(gain); gain.connect(this.sfxBus); gain.connect(this.verb);
    carrier.start(t); mod.start(t);
    carrier.stop(t + 0.3); mod.stop(t + 0.3);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 4400;
    const crack = this.ctx.createGain();
    this._env(crack, t, 0.16 * vol, 0.001, 0.055);
    noise.connect(filter); filter.connect(crack); crack.connect(this.sfxBus);
    noise.start(t); noise.stop(t + 0.08);
  }

  grenade(stage) {
    if (!this._ok()) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const detonate = stage === 'detonate';
    o.type = detonate ? 'sine' : 'triangle';
    o.frequency.setValueAtTime(detonate ? 1700 : 580, t);
    o.frequency.exponentialRampToValueAtTime(detonate ? 95 : 210, t + (detonate ? 0.4 : 0.14));
    this._env(g, t, detonate ? 0.24 : 0.2, 0.002, detonate ? 0.45 : 0.16);
    o.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    o.start(t); o.stop(t + 0.55);
    if (!detonate) this.reload('out');
  }

  dash() {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(4300, t + 0.08);
    bp.frequency.exponentialRampToValueAtTime(350, t + 0.23);
    const g = this.ctx.createGain();
    this._env(g, t, 0.22, 0.025, 0.22);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.3);
  }

  footstep(vol) {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 550;
    const g = this.ctx.createGain();
    this._env(g, t, 0.12 * vol, 0.001, 0.055);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.08);
  }

  /* one continuous looping voice rather than a shot per tick */
  flame(vol) {
    if (!this.enabled || !this.ctx) return;
    if (!this._flameNode) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 1.2;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 120;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      n.connect(lp); lp.connect(hp); hp.connect(g); g.connect(this.sfxBus);
      n.start();
      this._flameNode = { n: n, g: g, lp: lp };
    }
    this._flameNode.g.gain.setTargetAtTime(0.34 * (vol === undefined ? 1 : vol), this.t, 0.03);
  }

  flameStop() {
    if (this._flameNode) this._flameNode.g.gain.setTargetAtTime(0, this.t, 0.08);
  }

  spinup(on, rate) {
    if (!this.enabled || !this.ctx) return;
    if (!this._spinNode) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
      o.start();
      this._spinNode = { o: o, g: g };
    }
    const s = this._spinNode;
    s.o.frequency.setTargetAtTime(40 + rate * 110, this.t, 0.06);
    s.g.gain.setTargetAtTime(on ? 0.1 * rate : 0, this.t, 0.08);
  }

  dryFire() {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 2.4;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2200;
    const g = this.ctx.createGain();
    this._env(g, t, 0.16, 0.001, 0.045);
    n.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.1);
  }

  reload(stage) {
    if (!this._ok()) return;
    const t = this.t;
    const f = stage === 'out' ? 1500 : stage === 'in' ? 900 : 2600;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.07);
    const g = this.ctx.createGain();
    this._env(g, t, 0.09, 0.001, 0.07);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6;
    o.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.12);
  }

  /* ---- impacts ------------------------------------------------------ */
  hitFlesh() {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.4 + Math.random() * 0.2;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.12);
    const g = this.ctx.createGain();
    this._env(g, t, 0.2, 0.002, 0.11);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.2);
  }

  hitWall() {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 1.6 + Math.random() * 0.8;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 + Math.random() * 2200;
    bp.Q.value = 4;
    const g = this.ctx.createGain();
    this._env(g, t, 0.12, 0.001, 0.07);
    n.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.12);
  }

  gib() {
    if (!this._ok()) return;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.55;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2000, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    const g = this.ctx.createGain();
    this._env(g, t, 0.34, 0.003, 0.3);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    n.start(t); n.stop(t + 0.4);
  }

  explode(power) {
    if (!this._ok(3)) return;
    power = power === undefined ? 1 : power;
    const t = this.t;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.playbackRate.value = 0.32;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.9 * power);
    const g = this.ctx.createGain();
    this._env(g, t, 0.85 * power, 0.004, 0.95 * power);
    n.connect(lp); lp.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    n.start(t); n.stop(t + 1.2 * power);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6 * power);
    const og = this.ctx.createGain();
    this._env(og, t, 0.95 * power, 0.005, 0.7 * power);
    o.connect(og); og.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.9 * power);
  }

  /* ---- creatures ---------------------------------------------------- */
  screech(pitch, vol) {
    if (!this._ok()) return;
    pitch = pitch === undefined ? 1 : pitch;
    vol = vol === undefined ? 1 : vol;
    const t = this.t;
    const dur = 0.26 + Math.random() * 0.2;
    const base = (280 + Math.random() * 180) * pitch;

    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.7, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.55, t + dur);

    // a second detuned oscillator makes it read as organic, not synthetic
    const o2 = this.ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.setValueAtTime(base * 2.42, t);
    o2.frequency.exponentialRampToValueAtTime(base * 0.8, t + dur);

    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 22 + Math.random() * 26;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = base * 0.28;
    lfo.connect(lfoG); lfoG.connect(o.frequency);

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 3.2;
    bp.Q.value = 3.5;

    const g = this.ctx.createGain();
    this._env(g, t, 0.16 * vol, 0.012, dur);
    o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(this.sfxBus); g.connect(this.verb);
    o.start(t); o2.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  spit() {
    if (!this._ok()) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = this.ctx.createGain();
    this._env(g, t, 0.14, 0.004, 0.18);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400;
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.25);
  }

  /* ---- player / UI --------------------------------------------------- */
  hurt() {
    if (!this._ok()) return;
    const t = this.t;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.22);
    const g = this.ctx.createGain();
    this._env(g, t, 0.3, 0.004, 0.22);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.3);
  }

  pickup(kind) {
    if (!this._ok()) return;
    const t = this.t;
    const table = {
      ammo: [660, 990],
      health: [523, 784, 1046],
      armor: [440, 660, 880],
      money: [1320, 1760],
      weapon: [392, 523, 659, 880]
    };
    const notes = table[kind] || table.ammo;
    for (let i = 0; i < notes.length; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      const g = this.ctx.createGain();
      const tt = t + i * 0.055;
      this._env(g, tt, 0.14, 0.004, 0.1);
      o.connect(g); g.connect(this.sfxBus);
      o.start(tt); o.stop(tt + 0.16);
    }
  }

  ui(kind) {
    if (!this._ok()) return;
    const t = this.t;
    const f = kind === 'tick' ? 1200 : kind === 'wave' ? 180 : kind === 'crit' ? 1560 : 520;
    const o = this.ctx.createOscillator();
    o.type = kind === 'wave' ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f, t);
    if (kind === 'wave') o.frequency.exponentialRampToValueAtTime(70, t + 0.7);
    // a crit is a rising ping so it cuts through sustained weapon fire
    if (kind === 'crit') o.frequency.exponentialRampToValueAtTime(2600, t + 0.05);
    const g = this.ctx.createGain();
    this._env(g, t, kind === 'wave' ? 0.24 : kind === 'crit' ? 0.09 : 0.07, 0.004,
      kind === 'wave' ? 0.7 : kind === 'crit' ? 0.09 : 0.06);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = kind === 'wave' ? 700 : kind === 'crit' ? 7000 : 4000;
    o.connect(lp); lp.connect(g); g.connect(this.sfxBus);
    if (kind === 'wave') g.connect(this.verb);
    o.start(t); o.stop(t + 0.9);
  }

  /* ---- generative score --------------------------------------------- */
  /* a 16-step pulse whose density and brightness track combat intensity */
  updateMusic(dt, intensity) {
    if (!this.ctx) return;
    if (!this.musicOn) {
      this.musicBus.gain.setTargetAtTime(0, this.t, 0.4);
      return;
    }
    this.intensity = damp(this.intensity, intensity, 1.2, dt);
    this.musicBus.gain.setTargetAtTime(0.13 + this.intensity * 0.1, this.t, 0.5);

    const bpm = 92 + this.intensity * 42;
    const stepDur = 60 / bpm / 4;
    this._musicTimer -= dt;
    if (this._musicTimer > 0) return;
    this._musicTimer = Math.max(-stepDur, this._musicTimer) + stepDur;

    const t = this.t + 0.02;
    const step = this._step++ % 16;
    const scale = [0, 3, 5, 7, 10];
    const root = 41.2; // E1

    // Slowly moving minor pads keep the facility alive between attacks.
    if ((this._step - 1) % 32 === 0) {
      const padDuration = stepDur * 31;
      const chord = ((this._step - 1) >> 5) % 2 ? [0, 5, 10] : [0, 3, 7];
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 550 + this.intensity * 800;
      const gain = this.ctx.createGain();
      this._env(gain, t, 0.13, 0.55, Math.max(0.7, padDuration - 0.55));
      lp.connect(gain); gain.connect(this.musicBus);
      for (let i = 0; i < chord.length; i++) {
        const pad = this.ctx.createOscillator();
        pad.type = 'triangle';
        pad.frequency.value = root * 4 * Math.pow(2, chord[i] / 12);
        pad.detune.value = (i - 1) * 6;
        pad.connect(lp); pad.start(t); pad.stop(t + padDuration + 0.1);
      }
    }

    if (this.intensity > 0.32 && (step % 2 === 0 || this.intensity > 0.75)) {
      const hat = this.ctx.createBufferSource();
      hat.buffer = this.noiseBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7200;
      const hg = this.ctx.createGain();
      this._env(hg, t, (step % 4 === 2 ? 0.17 : 0.09) * this.intensity, 0.001, 0.045);
      hat.connect(hp); hp.connect(hg); hg.connect(this.musicBus);
      hat.start(t); hat.stop(t + 0.07);
    }

    if (step % 4 === 0) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
      const g = this.ctx.createGain();
      this._env(g, t, 0.9, 0.003, 0.17);
      o.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + 0.24);
    }
    if (step % 8 === 4 && this.intensity > 0.15) {
      const n = this.ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.playbackRate.value = 1.4;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1800;
      const g = this.ctx.createGain();
      this._env(g, t, 0.3 * this.intensity, 0.002, 0.1);
      n.connect(hp); hp.connect(g); g.connect(this.musicBus);
      n.start(t); n.stop(t + 0.16);
    }
    if (step % 2 === 0 || this.intensity > 0.5) {
      const deg = scale[(step * 3 + (this._step >> 4)) % scale.length];
      const oct = step % 8 === 0 ? 1 : 2;
      const f = root * Math.pow(2, deg / 12) * oct;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(300 + this.intensity * 1900, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + stepDur * 1.8);
      lp.Q.value = 7;
      const g = this.ctx.createGain();
      this._env(g, t, 0.2, 0.006, stepDur * 1.7);
      o.connect(lp); lp.connect(g); g.connect(this.musicBus);
      o.start(t); o.stop(t + stepDur * 2.2);
    }
  }

  setMaster(v) { if (this.master) this.master.gain.value = v; }
}

const sfx = new SfxEngine();

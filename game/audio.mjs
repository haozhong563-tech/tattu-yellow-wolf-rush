/* Original, procedural game audio. No recorded songs or external audio requests.
 * Call unlock() from the first pointer/keyboard gesture. Gameplay rushes default
 * to 5 s; pass 15 explicitly when auditioning the complete original cues.
 * onBeat({ beat, bar, strength, track, time }) uses the AudioContext clock.
 */
const DEFAULT_RUSH_SECONDS = 5;
const MAX_VOICES = 128;
const midi = note => 440 * 2 ** ((note - 69) / 12);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const rewardType = value => ({ bomb: 'drone', shuffle: 'rift', rush: 'overdrive', nova: 'rift' })[value] || (['hammer', 'drone', 'rift', 'overdrive'].includes(value) ? value : 'rift');
const CHARGE_SECONDS = { hammer: .46, drone: .68, rift: .58, overdrive: .72 };

const COMPOSITIONS = [
  { name: '雷霆起跑', bpm: 132, root: 42, wave: 'sawtooth', kick: [0,4,8,12], snare: [4,12], hat: 2, swing: 0, progression: [0,7,3,5], bass: [0,-1,0,7,0,-1,12,-1,0,0,-1,7,0,-1,10,7], motif: [12,-1,19,15,-1,19,22,-1,19,15,12,-1,10,12,15,19], chord: [0,3,7], gate: .68 },
  { name: '霓虹追猎', bpm: 174, root: 38, wave: 'square', kick: [0,6,10], snare: [4,12], hat: 1, swing: .03, progression: [0,3,10,5], bass: [0,-1,-1,0,12,-1,0,-1,7,-1,0,10,-1,0,-1,7], motif: [19,15,-1,12,19,-1,22,19,24,-1,22,19,15,12,-1,10], chord: [0,3,7,10], gate: .45 },
  { name: '晶能脉冲', bpm: 142, root: 40, wave: 'sawtooth', kick: [0,4,8,12], snare: [12], hat: 2, swing: 0, progression: [0,0,3,7], bass: [-1,0,0,0,-1,0,0,7,-1,0,0,0,-1,3,7,12], motif: [12,19,24,27,24,19,12,15,12,19,24,22,19,15,10,7], chord: [0,3,7], gate: .36 },
  { name: '超载重击', bpm: 146, root: 36, wave: 'sawtooth', kick: [0,3,10,14], snare: [8], hat: 1, swing: .1, progression: [0,0,8,7], bass: [0,0,-1,-1,12,-1,0,-1,0,7,0,-1,3,0,-1,10], motif: [12,-1,-1,19,-1,15,-1,-1,22,-1,19,-1,15,-1,10,-1], chord: [0,3,7,10], gate: .9 },
  { name: 'FPV 穿云', bpm: 164, root: 45, wave: 'triangle', kick: [0,3,6,10,14], snare: [4,12], hat: 1, swing: .06, progression: [0,5,10,7], bass: [0,-1,7,0,-1,12,0,-1,5,0,-1,7,0,-1,10,12], motif: [12,16,19,-1,24,19,16,12,14,17,21,-1,26,21,17,14], chord: [0,4,7], gate: .55 },
  { name: '午夜电路', bpm: 128, root: 41, wave: 'sawtooth', kick: [0,4,8,12], snare: [4,12], hat: 2, swing: .02, progression: [0,8,3,10], bass: [0,-1,12,-1,0,-1,12,7,0,-1,12,-1,0,7,10,12], motif: [12,-1,15,-1,19,-1,22,19,15,-1,12,-1,10,12,15,-1], chord: [0,3,7,10], gate: .85 },
  { name: '黄金燃点', bpm: 156, root: 39, wave: 'sawtooth', kick: [0,4,8,12], snare: [4,12], hat: 1, swing: 0, progression: [0,5,8,10], bass: [0,0,-1,12,0,0,-1,7,0,0,-1,12,3,3,7,10], motif: [24,24,-1,22,19,19,-1,15,19,22,24,27,24,-1,22,19], chord: [0,3,7], gate: .5 },
  { name: '星环跃迁', bpm: 140, root: 43, wave: 'triangle', kick: [0,7,10,14], snare: [4,12], hat: 2, swing: .14, progression: [0,5,3,10], bass: [0,-1,-1,12,-1,7,-1,0,0,-1,10,-1,7,0,-1,12], motif: [19,-1,24,22,-1,19,15,-1,17,-1,22,19,-1,15,12,10], chord: [0,3,7,14], gate: .8 },
  { name: '裂空极速', bpm: 172, root: 37, wave: 'square', kick: [0,6,9,14], snare: [4,11,12], hat: 1, swing: .07, progression: [0,7,10,3], bass: [0,-1,0,-1,7,0,-1,12,0,-1,3,0,-1,7,10,-1], motif: [12,19,-1,24,22,19,-1,15,12,15,19,-1,22,24,19,10], chord: [0,3,7], gate: .4 },
  { name: '塔塔觉醒', bpm: 150, root: 44, wave: 'sawtooth', kick: [0,4,8,12], snare: [4,12], hat: 1, swing: 0, progression: [0,8,3,10], bass: [0,-1,0,12,0,-1,7,12,0,-1,0,12,0,7,10,12], motif: [12,19,24,19,15,22,27,22,10,17,22,17,12,19,24,31], chord: [0,3,7], gate: .65 },
];

export const TRACKS = Object.freeze(COMPOSITIONS.map(({ name, bpm }) => Object.freeze({ name, bpm })));

export class GameAudio {
  constructor() {
    this.enabled = true;
    this.haptics = true;
    this.context = null;
    this._voices = new Set();
    this._beatTimers = new Set();
    this._lastFX = new Map();
    this._lastHaptic = -100;
    this._scheduler = null;
    this._music = null;
    this._paused = false;
    this._destroyed = false;
    this._generation = 0;
    this._noiseCursor = 0;
    this._graphNodes = [];
    this._contextTransition = Promise.resolve();
  }

  async unlock() {
    if (this._destroyed) return;
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return;
    if (!this.context) {
      try {
        this.context = new Audio({ latencyHint: 'interactive' });
        this._makeGraph();
      } catch {
        this.context = null;
        return;
      }
    }
    if (!this._paused && this.context.state !== 'running' && this.context.state !== 'closed') {
      try { await this.context.resume(); } catch { /* A later gesture can retry. */ }
    }
  }

  _makeGraph() {
    const ctx = this.context;
    this._master = ctx.createGain();
    this._master.gain.value = this.enabled ? .7 : 0;
    this._compressor = ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -15;
    this._compressor.knee.value = 15;
    this._compressor.ratio.value = 6;
    this._compressor.attack.value = .003;
    this._compressor.release.value = .16;
    this._fxBus = ctx.createGain();
    this._fxBus.gain.value = .58;
    this._musicBus = ctx.createGain();
    this._musicBus.gain.value = .62;
    this._musicDuck = ctx.createGain();
    this._musicDuck.gain.value = 1;
    this._leadBus = ctx.createGain();
    this._leadBus.gain.value = .8;
    this._delay = ctx.createDelay(1);
    this._delay.delayTime.value = .18;
    this._feedback = ctx.createGain();
    this._feedback.gain.value = .24;
    this._wet = ctx.createGain();
    this._wet.gain.value = .15;
    this._echoFilter = ctx.createBiquadFilter();
    this._echoFilter.type = 'lowpass';
    this._echoFilter.frequency.value = 2500;
    this._fxBus.connect(this._master);
    this._musicBus.connect(this._musicDuck);
    this._musicDuck.connect(this._master);
    this._leadBus.connect(this._musicBus);
    this._leadBus.connect(this._delay);
    this._delay.connect(this._echoFilter);
    this._echoFilter.connect(this._feedback);
    this._feedback.connect(this._delay);
    this._echoFilter.connect(this._wet);
    this._wet.connect(this._musicBus);
    this._master.connect(this._compressor);
    this._graphNodes = [this._fxBus, this._musicBus, this._musicDuck, this._leadBus, this._delay, this._feedback, this._wet, this._echoFilter, this._master, this._compressor];
    if (ctx.createWaveShaper) {
      // Final soft ceiling also catches the compressor's attack transient.
      const safety = ctx.createWaveShaper(), curve = new Float32Array(2049);
      for (let i = 0; i < curve.length; i++) curve[i] = .95 * Math.tanh(i / 1024 - 1);
      safety.curve = curve;
      this._compressor.connect(safety); safety.connect(ctx.destination);
      this._graphNodes.push(safety);
    } else this._compressor.connect(ctx.destination);
    this._noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this._noiseBuffer.getChannelData(0);
    let seed = 0x74617461;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = (seed >>> 0) / 0xffffffff * 2 - 1;
    }
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.context && this._master) {
      const now = this.context.currentTime;
      this._master.gain.cancelScheduledValues(now);
      this._master.gain.setTargetAtTime(this.enabled ? .7 : 0, now, .018);
    }
  }

  setHaptics(value) { this.haptics = Boolean(value); }

  _vibrate(pattern) {
    if (!this.haptics || this._paused || this._destroyed || this.context?.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - this._lastHaptic < .065) return;
    this._lastHaptic = now;
    try { globalThis.navigator?.vibrate?.(pattern); } catch { /* Optional hardware. */ }
  }

  _available(kind, spacing = 0) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || !this.enabled || this._paused || this._destroyed) return false;
    const last = this._lastFX.get(kind) ?? -100;
    if (ctx.currentTime - last < spacing) return false;
    this._lastFX.set(kind, ctx.currentTime);
    return true;
  }

  _register(sources, nodes, group) {
    const voice = { sources, nodes, group, ended: 0, disposed: false };
    this._voices.add(voice);
    for (const source of sources) source.onended = () => {
      voice.ended++;
      if (voice.ended >= sources.length) this._dispose(voice, false);
    };
    return voice;
  }

  _voiceBudget() {
    if (this._voices.size < MAX_VOICES) return true;
    // Retire an old transient before adding another; preserve the music groove.
    for (const voice of this._voices) if (voice.group !== 'music') {
      this._dispose(voice);
      return true;
    }
    return false;
  }

  _route(gain, bus, options, time, duration, nodes) {
    const ctx = this.context;
    if (ctx.createStereoPanner && (options.pan !== undefined || options.panTo !== undefined)) {
      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(clamp(options.pan || 0, -.8, .8), time);
      if (options.panTo !== undefined) pan.pan.linearRampToValueAtTime(clamp(options.panTo, -.8, .8), time + duration);
      gain.connect(pan); pan.connect(bus); nodes.push(pan);
    } else gain.connect(bus);
  }

  _dispose(voice, stop = true) {
    if (voice.disposed) return;
    voice.disposed = true;
    for (const source of voice.sources) {
      source.onended = null;
      if (stop) { try { source.stop(); } catch { /* Already stopped. */ } }
    }
    for (const node of voice.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
    this._voices.delete(voice);
  }

  _tone(frequency, time, duration, volume, options = {}) {
    if (!this.enabled || this._destroyed || !this.context || !this._voiceBudget()) return;
    const ctx = this.context, gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    const end = time + duration;
    filter.type = options.filterType || 'lowpass';
    filter.Q.value = options.resonance || .65;
    filter.frequency.setValueAtTime(options.cutoff || 6500, time);
    if (options.cutoffEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(30, options.cutoffEnd), end);
    const attack = Math.min(options.attack || .004, duration * (options.rise ? .88 : .25));
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(clamp(volume, .0002, .8), time + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, end);
    filter.connect(gain);
    const bus = options.lead ? this._leadBus : options.music ? this._musicBus : this._fxBus;
    const nodes = [filter, gain], sources = [];
    this._route(gain, bus, options, time, duration, nodes);
    const detunes = options.unison ? [-7, 7] : [0];
    for (const detune of detunes) {
      const osc = ctx.createOscillator();
      osc.type = options.wave || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, frequency), time);
      if (options.peak) osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.peak), time + duration * .46);
      if (options.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), time + duration * .8);
      osc.detune.value = detune;
      osc.connect(filter); sources.push(osc); nodes.push(osc);
    }
    this._register(sources, nodes, options.group || (options.music || options.lead ? 'music' : 'fx'));
    for (const source of sources) { source.start(time); source.stop(end + .02); }
  }

  _noise(time, duration, volume, frequency = 6000, options = {}) {
    if (!this.enabled || this._destroyed || !this.context || !this._voiceBudget()) return;
    const ctx = this.context, source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    source.buffer = this._noiseBuffer;
    filter.type = options.type || 'highpass';
    filter.frequency.setValueAtTime(frequency, time);
    filter.Q.value = .8;
    if (options.to) filter.frequency.exponentialRampToValueAtTime(options.to, time + duration);
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(clamp(volume, .0002, .45), time + Math.min(options.attack || .003, duration * (options.rise ? .88 : .3)));
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    source.connect(filter); filter.connect(gain);
    const nodes = [source, filter, gain];
    this._route(gain, options.music ? this._musicBus : this._fxBus, options, time, duration, nodes);
    this._register([source], nodes, options.group || (options.music ? 'music' : 'fx'));
    this._noiseCursor = (this._noiseCursor + .173) % .8;
    source.start(time, this._noiseCursor); source.stop(time + duration + .015);
  }

  _kick(time, strength = 1, hard = false) {
    this._tone(hard ? 168 : 138, time, .31, .75 * strength, { to: hard ? 43 : 48, music: true });
    this._tone(82, time, .13, .09 * strength, { wave: 'triangle', to: 36, music: true });
    this._noise(time, .022, .13 * strength, 4800, { music: true });
  }

  _snare(time, strength = 1, tight = false) {
    this._noise(time, tight ? .12 : .2, .37 * strength, 1600, { music: true, type: 'highpass' });
    this._tone(192, time, .095, .21 * strength, { to: 145, music: true, wave: 'triangle' });
    if (!tight) this._noise(time + .014, .13, .13 * strength, 2600, { music: true });
  }

  tap() {
    this._vibrate(6);
    if (!this._available('tap', .035)) return;
    const now = this.context.currentTime;
    this._tone(720, now, .065, .13, { to: 1150, wave: 'sine' });
    this._noise(now, .026, .035, 3800);
  }

  swap(valid = true) {
    this._vibrate(valid ? 9 : [8, 30, 8]);
    if (!this._available('swap', .055)) return;
    const now = this.context.currentTime;
    this._tone(valid ? 500 : 260, now, .11, .17, { to: valid ? 850 : 145, wave: 'triangle' });
    this._noise(now, .085, .065, 1400, { type: 'bandpass', to: valid ? 3800 : 500 });
  }

  clear(chain = 1, special = false) {
    this._vibrate(special ? [24, 24, 40] : 10);
    if (!this._available('clear', .035)) return;
    const now = this.context.currentTime, transpose = Math.min(12, Math.max(0, chain - 1) * 2);
    [0, 4, 7, 12].slice(0, special ? 4 : 3).forEach((note, i) => {
      this._tone(midi(72 + transpose + note), now + i * .026, .18, .14 - i * .013, { wave: 'triangle', pan: (i - 1) * .25 });
      this._tone(midi(84 + transpose + note), now + i * .026, .105, .027);
    });
    this._noise(now, special ? .31 : .08, special ? .18 : .07, special ? 750 : 3500, { type: special ? 'bandpass' : 'highpass', to: special ? 5500 : 6500 });
    if (special) this._tone(115, now, .42, .38, { to: 32 });
  }

  collect() {
    if (!this._available('collect', .045)) return;
    const now = this.context.currentTime;
    this._tone(midi(88), now, .18, .105);
    this._tone(midi(95), now + .055, .22, .065);
  }

  /** Anticipation only: no hit and no haptic. Returns its suggested length in seconds. */
  rewardCharge(type = 'hammer') {
    type = rewardType(type);
    const duration = CHARGE_SECONDS[type];
    if (!this._available('reward-charge', .16)) return duration;
    for (const voice of [...this._voices]) if (voice.group === 'charge') this._dispose(voice);
    const now = this.context.currentTime, group = 'charge';
    this._tone(type === 'rift' ? 34 : 48, now, duration, .16, { to: type === 'overdrive' ? 145 : 108, rise: true, attack: duration * .78, group });
    this._noise(now, duration, .19, 380, { type: 'bandpass', to: 7200, rise: true, attack: duration * .8, group, pan: -.24, panTo: .2 });
    if (type === 'drone') {
      // A pair of propeller harmonics travels across the stereo field and bends down on approach.
      this._tone(185, now, duration, .08, { wave: 'sawtooth', peak: 590, to: 225, cutoff: 1600, cutoffEnd: 3200, rise: true, attack: duration * .55, pan: -.7, panTo: .6, group });
      this._tone(371, now + .025, duration - .025, .055, { wave: 'triangle', peak: 1160, to: 430, rise: true, attack: duration * .52, pan: -.6, panTo: .65, group });
    } else if (type === 'hammer') {
      this._noise(now + duration * .35, duration * .62, .12, 1700, { type: 'bandpass', to: 6400, rise: true, attack: duration * .48, pan: -.35, panTo: .05, group });
    } else {
      [0, 7, 12].forEach((note, i) => this._tone(midi(48 + note), now + i * .055, duration - i * .055, .046, { wave: 'sawtooth', to: midi(67 + note), rise: true, attack: duration * .63, cutoff: 850, cutoffEnd: 4700, pan: (i - 1) * .33, group }));
    }
    return duration;
  }

  /** Call exactly when a real reward strikes; power is clamped to 0.5–1.6. */
  rewardImpact(type = 'hammer', power = 1) {
    type = rewardType(type);
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this._paused || this._destroyed) return;
    const now = ctx.currentTime;
    if (now - (this._lastFX.get('reward-impact') ?? -100) < .11) return;
    this._lastFX.set('reward-impact', now);
    this._vibrate(type === 'hammer' ? [28, 24, 42] : type === 'drone' ? [16, 35, 22, 35, 28] : type === 'rift' ? [18, 28, 55] : [34, 30, 55]);
    for (const voice of [...this._voices]) if (voice.group === 'charge') this._dispose(voice);
    if (!this.enabled) return;
    const gain = Math.sqrt(clamp(Number(power) || 1, .5, 1.6));
    this._musicDuck.gain.cancelScheduledValues(now);
    this._musicDuck.gain.setValueAtTime(.55, now);
    this._musicDuck.gain.linearRampToValueAtTime(1, now + .46);
    if (type === 'hammer') {
      this._tone(175, now, .68, .58 * gain, { to: 35 });
      this._tone(310, now, .19, .14 * gain, { wave: 'triangle', to: 78 });
      this._noise(now, .055, .31 * gain, 3100, { type: 'highpass' });
      this._noise(now + .018, .32, .23 * gain, 1800, { type: 'bandpass', to: 260 });
      [621, 997, 1627, 2381].forEach((frequency, i) => this._tone(frequency, now + i * .003, .31 - i * .045, .055 * gain, { wave: 'triangle', cutoff: 5500, pan: (i - 1.5) * .16 }));
    } else if (type === 'drone') {
      [-.58, .5, .04].forEach((pan, i) => {
        const at = now + i * .085;
        this._tone(155 - i * 14, at, .47, .29 * gain, { to: 39, pan });
        this._noise(at, .19, .18 * gain, 2400, { type: 'bandpass', to: 330, pan });
        this._noise(at, .033, .13 * gain, 6200, { pan });
      });
      this._tone(82, now + .16, .62, .23 * gain, { to: 30 });
    } else if (type === 'rift') {
      this._tone(104, now, .95, .53 * gain, { to: 25 });
      this._tone(1390, now, .12, .095 * gain, { wave: 'sawtooth', to: 180, cutoff: 5400 });
      this._noise(now, .39, .25 * gain, 8100, { type: 'bandpass', to: 370 });
      for (let i = 0; i < 5; i++) {
        this._noise(now + .022 + i * .034, .032, .08 * gain, 4900 + i * 500, { pan: i % 2 ? .58 : -.58 });
        this._tone(2100 - i * 275, now + .022 + i * .034, .055, .033 * gain, { wave: 'square', to: 330, cutoff: 3900, pan: i % 2 ? .58 : -.58 });
      }
    } else {
      this._tone(196, now, 1.05, .61 * gain, { to: 31 });
      this._tone(385, now, .38, .14 * gain, { wave: 'triangle', to: 66 });
      this._noise(now, .065, .29 * gain, 6200);
      this._noise(now + .014, .66, .25 * gain, 2600, { type: 'bandpass', to: 290 });
      [48, 55, 60].forEach((note, i) => this._tone(midi(note), now + .04 + i * .014, .65, .055 * gain, { wave: 'sawtooth', unison: true, cutoff: 4500, cutoffEnd: 580, pan: (i - 1) * .4 }));
      this._noise(now + .12, .46, .09 * gain, 5200, { pan: -.5, panTo: .5 });
    }
  }

  /** Earned-reward reveal flourish, 0.8 s. No impact or vibration is scheduled. */
  cinematic(type = 'hammer') {
    type = rewardType(type);
    if (!this._available('cinematic', .5)) return .8;
    const now = this.context.currentTime;
    const notes = { hammer: [55, 62, 67, 74], drone: [60, 67, 72, 79], rift: [58, 65, 70, 77], overdrive: [60, 64, 67, 72, 76] }[type];
    this._noise(now, .34, .075, 750, { type: 'bandpass', to: 6200, rise: true, attack: .24 });
    notes.forEach((note, i) => {
      const time = now + .11 + i * .065;
      this._tone(midi(note), time, .39, .088, { wave: 'triangle', pan: (i / (notes.length - 1) - .5) * .7 });
      this._tone(midi(note + 12), time, .22, .028);
    });
    this._tone(56, now + .21, .55, .13, { to: 44 });
    return .8;
  }

  win() {
    this.stopRush();
    this._vibrate([35, 60, 35, 60, 80]);
    if (!this._available('win', .6)) return;
    const now = this.context.currentTime;
    [60, 64, 67, 72, 76, 79, 84].forEach((note, i) => {
      this._tone(midi(note), now + i * .085, .58, .16, { wave: 'triangle', unison: true, cutoff: 5000, cutoffEnd: 1800 });
      this._tone(midi(note + 12), now + i * .085, .33, .04);
    });
    this._noise(now + .5, .7, .1, 4200);
  }

  lose() {
    this.stopRush();
    this._vibrate([20, 50, 20]);
    if (!this._available('lose', .6)) return;
    const now = this.context.currentTime;
    [67, 63, 60, 55].forEach((note, i) => this._tone(midi(note), now + i * .14, .35, .13, { wave: 'triangle', cutoff: 2300 }));
  }

  startRush(trackIndex = 0, onBeat, durationSeconds = DEFAULT_RUSH_SECONDS) {
    this.stopRush();
    if (this._destroyed) return;
    const index = ((Math.trunc(Number(trackIndex) || 0) % TRACKS.length) + TRACKS.length) % TRACKS.length;
    const generation = this._generation;
    const duration = Number.isFinite(durationSeconds) ? clamp(durationSeconds, 1, 15) : DEFAULT_RUSH_SECONDS;
    this._music = { index, onBeat, duration, start: null, nextStep: 0, elapsed: 0, lastBeat: -1 };
    void this.unlock().then(() => {
      if (!this.context || this._destroyed || generation !== this._generation || !this._music || this._paused) return;
      this._begin();
    });
  }

  _begin() {
    const music = this._music;
    if (!music || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    music.start = now + .025 - music.elapsed;
    const stepDuration = 60 / COMPOSITIONS[music.index].bpm / 4;
    music.nextStep = Math.ceil(music.elapsed / stepDuration);
    this._delay.delayTime.setValueAtTime(stepDuration * 3, now);
    this._musicBus.gain.cancelScheduledValues(now);
    this._musicBus.gain.setValueAtTime(.0001, now);
    this._musicBus.gain.linearRampToValueAtTime(.62, now + .03);
    this._musicBus.gain.setValueAtTime(.62, Math.max(now + .04, music.start + music.duration - .13));
    this._musicBus.gain.linearRampToValueAtTime(.0001, Math.max(now + .05, music.start + music.duration));
    if (music.elapsed === 0) {
      this._noise(now + .025, .7, .16, 8200, { to: 600, type: 'bandpass', music: true });
      this._tone(180, now + .025, .5, .2, { to: 42, music: true });
    }
    this._tick();
    if (this._music) this._scheduler = setInterval(() => this._tick(), 25);
  }

  _tick() {
    const music = this._music, ctx = this.context;
    if (!music || !ctx || this._paused || ctx.state !== 'running' || music.start === null) return;
    const elapsed = ctx.currentTime - music.start;
    if (elapsed >= music.duration) { this.stopRush(); return; }
    const track = COMPOSITIONS[music.index], stepDuration = 60 / track.bpm / 4;
    // Discard late notes after an OS interruption; never burst a backlog of drums.
    music.nextStep = Math.max(music.nextStep, Math.floor(Math.max(0, elapsed - .025) / stepDuration));
    while (music.nextStep * stepDuration < music.duration) {
      const index = music.nextStep;
      const swing = index % 2 ? track.swing * stepDuration : 0;
      const time = music.start + index * stepDuration + swing;
      if (time > ctx.currentTime + .105) break;
      music.nextStep++;
      if (time < ctx.currentTime - .025) continue;
      this._scheduleStep(track, index, Math.max(ctx.currentTime, time), stepDuration);
      if (index % 4 === 0 && index / 4 > music.lastBeat) {
        music.lastBeat = index / 4;
        const event = { beat: index / 4, bar: Math.floor(index / 16), strength: index % 16 === 0 ? 1 : .55, track: music.index, time };
        const timer = setTimeout(() => {
          this._beatTimers.delete(timer);
          if (this._music !== music || this._paused) return;
          try { music.onBeat?.(event); } catch { /* Visual callback must not stop audio. */ }
        }, Math.max(0, (time - ctx.currentTime) * 1000));
        this._beatTimers.add(timer);
      }
    }
  }

  _scheduleStep(track, index, time, stepDuration) {
    if (!this.enabled) return;
    const step = index % 16, bar = Math.floor(index / 16);
    const phase = index * stepDuration / this._music.duration;
    const root = track.root + track.progression[bar % track.progression.length];
    const fill = (bar % 4 === 3 && step >= 12) || phase > .88;
    const drop = phase > .53 && phase < .88;
    const hard = this._music.index === 3 || this._music.index === 6;
    const breakStep = bar % 4 === 3 && step === 14 && this._music.index === 3;
    if (track.kick.includes(step) && !breakStep) this._kick(time, drop ? 1 : .88, hard);
    if (track.snare.includes(step)) this._snare(time, drop ? 1 : .88, this._music.index === 1 || this._music.index === 8);
    if (step % track.hat === 0) {
      const open = step % 4 === 2 && track.hat === 2;
      this._noise(time, open ? .15 : .035, step % 4 === 2 ? .16 : .065, open ? 5200 : 7000, { music: true });
    }
    if (fill && step % 2 === 1) {
      this._snare(time, .18 + (step - 11) * .04, true);
      this._noise(time + stepDuration * .5, .027, .05, 8200, { music: true });
    }
    if (step === 0 && bar > 0 && bar % 2 === 0) {
      this._noise(time, .65, .13, 5800, { music: true, to: 1600 });
    }
    const bass = track.bass[step];
    if (bass >= 0 && !breakStep) {
      const duration = stepDuration * (this._music.index === 3 ? 1.8 : .84);
      this._tone(midi(root + bass), time, duration, hard ? .16 : .115, { music: true, wave: track.wave === 'triangle' ? 'sawtooth' : track.wave, cutoff: drop ? 1900 : 950, cutoffEnd: 150, resonance: hard ? 3 : 1.2 });
      this._tone(midi(root + bass - 12), time, duration, .1, { music: true });
    }
    const note = track.motif[(step + (bar % 2 ? 8 : 0)) % 16];
    if (note >= 0 && !breakStep) {
      const octave = drop && bar % 2 === 0 ? 12 : 0;
      const sparse = this._music.index === 5 || this._music.index === 7;
      this._tone(midi(root + note + octave), time, stepDuration * track.gate + .07, sparse ? .07 : .048, { lead: true, wave: track.wave, unison: this._music.index !== 1 && this._music.index !== 8, cutoff: drop ? 6500 : 3900, cutoffEnd: 1100, pan: step % 2 ? .24 : -.24 });
    }
    const chordSteps = this._music.index === 7 ? [0,3,7,10] : this._music.index === 5 ? [0,8] : [0];
    if (chordSteps.includes(step)) {
      const duration = this._music.index === 7 ? stepDuration * 2 : stepDuration * 5.5;
      for (const [i, note] of track.chord.entries()) this._tone(midi(root + 12 + note), time + i * .005, duration, .028, { lead: true, wave: 'sawtooth', unison: true, attack: .035, cutoff: drop ? 3000 : 1500, cutoffEnd: 550, pan: (i - 1) * .25 });
    }
    if (bar % 4 === 3 && step === 8) this._noise(time, stepDuration * 7, .11, 400, { music: true, type: 'bandpass', to: 8200, attack: stepDuration * 2 });
  }

  _clearTimers() {
    if (this._scheduler !== null) clearInterval(this._scheduler);
    this._scheduler = null;
    for (const timer of this._beatTimers) clearTimeout(timer);
    this._beatTimers.clear();
  }

  stopRush() {
    this._generation++;
    this._clearTimers();
    this._music = null;
    for (const voice of [...this._voices]) if (voice.group === 'music') this._dispose(voice);
    if (this.context && this._musicBus) {
      const now = this.context.currentTime;
      this._musicBus.gain.cancelScheduledValues(now);
      this._musicBus.gain.setTargetAtTime(.0001, now, .012);
    }
  }

  suspend() {
    if (this._destroyed || this._paused) return;
    this._paused = true;
    this._generation++;
    const ctx = this.context;
    if (this._music && ctx && this._music.start !== null) this._music.elapsed = clamp(ctx.currentTime - this._music.start, 0, this._music.duration);
    this._clearTimers();
    for (const voice of [...this._voices]) this._dispose(voice);
    if (ctx && ctx.state === 'running') this._contextTransition = ctx.suspend().catch(() => {});
  }

  async resume() {
    if (this._destroyed || !this._paused) return;
    this._paused = false;
    const generation = ++this._generation;
    await this._contextTransition;
    if (this._destroyed || this._paused || generation !== this._generation) return;
    await this.unlock();
    if (this._destroyed || this._paused || generation !== this._generation) return;
    if (this._music && this._music.elapsed < this._music.duration) this._begin();
    else if (this._music) this.stopRush();
  }

  destroy() {
    if (this._destroyed) return;
    this.stopRush();
    this._destroyed = true;
    for (const voice of [...this._voices]) this._dispose(voice);
    for (const node of this._graphNodes) { try { node.disconnect(); } catch { /* Already closed. */ } }
    this._graphNodes.length = 0;
    this._lastFX.clear();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
    this._noiseBuffer = null;
  }
}

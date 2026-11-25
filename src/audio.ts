// Multi-Bus Procedural WebAudio Synthesizer & Adaptive Darksynth BGM Engine
// Bus layout (audio-design skill):
//   SFX   -> sfxLowpass (Witch-Time) -> sfxBus -> masterComp -> destination
//   Music -> musicLowpass (Duck/Menu) -> musicDuckBus -> musicBus -> masterComp -> destination

const BPM = 130;
const STEP_DUR = 60 / BPM / 4; // 16th note = ~0.1154s

// D Minor / Phrygian cyberpunk bassline (MIDI notes -> Hz)
const BASS_PATTERN = [
  38, 38, 50, 38, 38, 38, 41, 38, 38, 38, 45, 38, 43, 38, 41, 40,
  34, 34, 46, 34, 34, 34, 41, 34, 36, 36, 48, 36, 36, 43, 45, 48,
];

// High-energy Hyper/Boss Arpeggio (MIDI notes)
const ARP_PATTERN = [
  62, 65, 69, 74, 72, 69, 65, 69, 62, 65, 69, 76, 74, 69, 65, 67,
  58, 62, 65, 70, 69, 65, 62, 65, 60, 64, 67, 72, 76, 72, 67, 64,
];

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function sliderToGain(slider01: number): number {
  if (slider01 <= 0.001) return 0;
  const clamped = Math.max(0, Math.min(1, slider01));
  return clamped * clamped; // Perceptual squared taper
}

export class CyberAudio {
  private ctx: AudioContext | null = null;
  private sfxLowpass: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicLowpass: BiquadFilterNode | null = null;
  private musicDuckBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private sfxVolume = 0.85;
  private bgmVolume = 0.65;
  private bgmMuted = false;

  // Beat-synced lookahead BGM state
  private nextStepTime = 0;
  private stepIndex = 0;
  private bgmRunning = false;

  private xpChain = 0;
  private lastXpTime = 0;
  private lastHitSfx = 0;
  private lastKillSfx = 0;

  public unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -13;
      comp.knee.value = 14;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.14;
      comp.connect(this.ctx.destination);

      // SFX Bus
      this.sfxLowpass = this.ctx.createBiquadFilter();
      this.sfxLowpass.type = 'lowpass';
      this.sfxLowpass.frequency.value = 20000;
      this.sfxLowpass.Q.value = 0.8;

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = sliderToGain(this.sfxVolume) * 0.72;
      this.sfxLowpass.connect(this.sfxBus);
      this.sfxBus.connect(comp);

      // Music Bus with dedicated Ducking + Lowpass stage
      this.musicLowpass = this.ctx.createBiquadFilter();
      this.musicLowpass.type = 'lowpass';
      this.musicLowpass.frequency.value = 18000;
      this.musicLowpass.Q.value = 0.7;

      this.musicDuckBus = this.ctx.createGain();
      this.musicDuckBus.gain.value = 1.0;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.bgmMuted ? 0 : sliderToGain(this.bgmVolume) * 0.42;

      this.musicLowpass.connect(this.musicDuckBus);
      this.musicDuckBus.connect(this.musicBus);
      this.musicBus.connect(comp);

      const len = Math.floor(this.ctx.sampleRate * 0.4);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.nextStepTime = this.ctx.currentTime + 0.05;
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setVolumes(bgmVol: number, sfxVol: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, bgmVol));
    this.sfxVolume = Math.max(0, Math.min(1, sfxVol));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.musicBus) {
      const target = this.bgmMuted ? 0 : sliderToGain(this.bgmVolume) * 0.42;
      this.musicBus.gain.setTargetAtTime(target, t, 0.025);
    }
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(sliderToGain(this.sfxVolume) * 0.72, t, 0.025);
    }
  }

  public toggleBgmMute(): boolean {
    this.bgmMuted = !this.bgmMuted;
    this.setVolumes(this.bgmVolume, this.sfxVolume);
    return this.bgmMuted;
  }

  public isBgmMuted(): boolean {
    return this.bgmMuted;
  }

  public getVolumes(): { bgm: number; sfx: number } {
    return { bgm: this.bgmVolume, sfx: this.sfxVolume };
  }

  // Smooth click-free lowpass sweep for Witch-Time / Perfect Dodge!
  public setBulletTimeMuffle(active: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    this.sfxLowpass.frequency.setTargetAtTime(active ? 720 : 20000, this.ctx.currentTime, 0.035);
  }

  // Duck music by ~-11 dB + warm filter during upgrade modals, pause menus, or Witch-Time
  public setMusicDucked(ducked: boolean): void {
    if (!this.ctx || !this.musicDuckBus || !this.musicLowpass) return;
    const t = this.ctx.currentTime;
    this.musicDuckBus.gain.setTargetAtTime(ducked ? 0.28 : 1.0, t, ducked ? 0.03 : 0.14);
    this.musicLowpass.frequency.setTargetAtTime(ducked ? 680 : 18000, t, ducked ? 0.04 : 0.14);
  }

  // Lookahead Adaptive Synthwave Sequencer driven by ctx.currentTime (zero frame-rate drift!)
  // intensity: 0 = Stage 1 groove, 1 = Stage 2 / Combo percussion, 2 = Boss / Hyper / Frenzy lead arp
  public stepAdaptiveBgm(active: boolean, intensity: 0 | 1 | 2, ducked: boolean): void {
    if (!this.ctx || !this.musicLowpass || !this.noiseBuf || this.ctx.state !== 'running') return;
    this.setMusicDucked(ducked);

    if (!active || this.bgmMuted || this.bgmVolume <= 0.01) {
      this.bgmRunning = false;
      return;
    }

    const now = this.ctx.currentTime;
    if (!this.bgmRunning || this.nextStepTime < now - 0.25) {
      this.bgmRunning = true;
      this.nextStepTime = now + 0.03;
    }

    while (this.nextStepTime < now + 0.13) {
      this.scheduleSynthStep(this.stepIndex, this.nextStepTime, intensity);
      this.stepIndex = (this.stepIndex + 1) % 32;
      this.nextStepTime += STEP_DUR;
    }
  }

  private scheduleSynthStep(step: number, t: number, intensity: 0 | 1 | 2): void {
    if (!this.ctx || !this.musicLowpass || !this.noiseBuf) return;
    const barStep = step % 16;

    // 1. Four-on-the-floor Cyber Sub-Kick (steps 0, 4, 8, 12)
    if (barStep % 4 === 0) {
      const kick = this.ctx.createOscillator();
      const kg = this.ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(150, t);
      kick.frequency.exponentialRampToValueAtTime(38, t + 0.11);
      kg.gain.setValueAtTime(0.46, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      kick.connect(kg).connect(this.musicLowpass);
      kick.start(t);
      kick.stop(t + 0.14);
    }

    // 2. Rolling Off-Beat Darksynth Saw Bass (ducked slightly on kick steps)
    const isKickStep = barStep % 4 === 0;
    const bassFreq = midiToHz(BASS_PATTERN[step]);
    const bass = this.ctx.createOscillator();
    const bFilter = this.ctx.createBiquadFilter();
    const bg = this.ctx.createGain();
    bass.type = 'sawtooth';
    bass.frequency.setValueAtTime(bassFreq, t);
    bFilter.type = 'lowpass';
    bFilter.Q.value = 3.2;
    bFilter.frequency.setValueAtTime(isKickStep ? 420 : 1050, t);
    bFilter.frequency.exponentialRampToValueAtTime(155, t + STEP_DUR * 0.88);
    bg.gain.setValueAtTime(isKickStep ? 0.11 : 0.24, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 0.92);
    bass.connect(bFilter).connect(bg).connect(this.musicLowpass);
    bass.start(t);
    bass.stop(t + STEP_DUR);

    // 3. Stem 2 (intensity >= 1): Metallic 16th Hi-Hats & Backbeat Snare Clap
    if (intensity >= 1) {
      const hat = this.ctx.createBufferSource();
      hat.buffer = this.noiseBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6800;
      const hg = this.ctx.createGain();
      const openAccent = barStep % 4 === 2;
      hg.gain.setValueAtTime(openAccent ? 0.11 : 0.045, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + (openAccent ? 0.065 : 0.028));
      hat.connect(hp).connect(hg).connect(this.musicLowpass);
      hat.start(t);
      hat.stop(t + 0.075);

      if (barStep === 4 || barStep === 12) {
        const sn = this.ctx.createBufferSource();
        sn.buffer = this.noiseBuf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1850;
        bp.Q.value = 1.1;
        const sg = this.ctx.createGain();
        sg.gain.setValueAtTime(0.22, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        sn.connect(bp).connect(sg).connect(this.musicLowpass);
        sn.start(t);
        sn.stop(t + 0.12);
      }
    }

    // 4. Stem 3 (intensity >= 2): High-Octave Neon Overdrive Lead Arpeggio!
    if (intensity >= 2) {
      const arpFreq = midiToHz(ARP_PATTERN[step]);
      const lead = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lead.type = step % 2 === 0 ? 'square' : 'sawtooth';
      lead.detune.value = step % 3 === 0 ? 7 : -7;
      lead.frequency.setValueAtTime(arpFreq, t);
      lg.gain.setValueAtTime(0.085, t);
      lg.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 0.85);
      lead.connect(lg).connect(this.musicLowpass);
      lead.start(t);
      lead.stop(t + STEP_DUR * 0.9);
    }
  }

  // =========================================================================
  // Layered Weapon & Combat SFX
  // =========================================================================
  public playKunai(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(hyper ? 3800 : 2900, t);
    bp.Q.value = 2.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(hyper ? 0.06 : 0.075, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    n.connect(bp).connect(ng).connect(this.sfxLowpass);
    n.start(t);
    n.stop(t + 0.05);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = hyper ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(hyper ? 1380 : 960, t);
    osc.frequency.exponentialRampToValueAtTime(hyper ? 220 : 145, t + 0.07);
    g.gain.setValueAtTime(hyper ? 0.065 : 0.085, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    osc.connect(g).connect(this.sfxLowpass);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playArc(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(hyper ? 3100 : 2300, t);
    bp.Q.value = 3.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(hyper ? 0.22 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp).connect(g).connect(this.sfxLowpass);
    src.start(t);
    src.stop(t + 0.14);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(hyper ? 230 : 185, t);
    sub.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    sg.gain.setValueAtTime(0.16, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.115);
    sub.connect(sg).connect(this.sfxLowpass);
    sub.start(t);
    sub.stop(t + 0.12);
  }

  public playLaser(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    for (const detune of [-12, 12]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(hyper ? 540 : 380, t);
      osc.frequency.exponentialRampToValueAtTime(hyper ? 115 : 82, t + 0.28);
      g.gain.setValueAtTime(0.095, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.29);
      osc.connect(g).connect(this.sfxLowpass);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  }

  public playGravityWell(collapse: boolean, hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    if (!collapse) {
      // Dark singularity implosion hum
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hyper ? 180 : 140, t);
      osc.frequency.exponentialRampToValueAtTime(52, t + 0.32);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(g).connect(this.sfxLowpass);
      osc.start(t);
      osc.stop(t + 0.36);
    } else {
      // Singularity Collapse: upward vacuum zip -> seismic sub drop
      const zip = this.ctx.createOscillator();
      const zg = this.ctx.createGain();
      zip.type = 'sawtooth';
      zip.frequency.setValueAtTime(90, t);
      zip.frequency.exponentialRampToValueAtTime(hyper ? 640 : 420, t + 0.08);
      zip.frequency.exponentialRampToValueAtTime(28, t + 0.36);
      zg.gain.setValueAtTime(hyper ? 0.26 : 0.18, t);
      zg.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      zip.connect(zg).connect(this.sfxLowpass);
      zip.start(t);
      zip.stop(t + 0.4);
    }
  }

  public playOrbitalStrike(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    // High-energy orbital ion beam impact + sub shock
    const beam = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    beam.type = 'sawtooth';
    beam.frequency.setValueAtTime(hyper ? 920 : 680, t);
    beam.frequency.exponentialRampToValueAtTime(34, t + 0.32);
    bg.gain.setValueAtTime(hyper ? 0.24 : 0.18, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    beam.connect(bg).connect(this.sfxLowpass);
    beam.start(t);
    beam.stop(t + 0.35);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(hyper ? 2200 : 1500, t);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(hyper ? 0.24 : 0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    n.connect(lp).connect(ng).connect(this.sfxLowpass);
    n.start(t);
    n.stop(t + 0.3);
  }

  public playBossTelegraph(): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 2; k++) {
      const st = t + k * 0.11;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(740, st);
      o.frequency.setValueAtTime(980, st + 0.045);
      g.gain.setValueAtTime(0.09, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.095);
      o.connect(g).connect(this.sfxLowpass);
      o.start(st);
      o.stop(st + 0.1);
    }
  }

  public playPowerup(kind: 'magnet' | 'frenzy' | 'revive'): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const freqs =
      kind === 'magnet'
        ? [392, 523.25, 659.25, 1046.5]
        : kind === 'frenzy'
        ? [440, 587.33, 880, 1174.66, 1760]
        : [261.63, 392, 523.25, 659.25, 1046.5, 1567.98];
    freqs.forEach((f, idx) => {
      if (!this.ctx || !this.sfxLowpass) return;
      const st = t + idx * 0.045;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = kind === 'frenzy' ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.16, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.26);
      o.connect(g).connect(this.sfxLowpass);
      o.start(st);
      o.stop(st + 0.28);
    });
  }

  public playHit(crit: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (t - this.lastHitSfx < 0.03) return;
    this.lastHitSfx = t;

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(crit ? 210 : 165, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.065);
    sg.gain.setValueAtTime(crit ? 0.18 : 0.11, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    sub.connect(sg).connect(this.sfxLowpass);
    sub.start(t);
    sub.stop(t + 0.075);

    if (crit) {
      for (const [freq, dur] of [
        [1185, 0.14],
        [1890, 0.11],
      ]) {
        const ring = this.ctx.createOscillator();
        const rg = this.ctx.createGain();
        ring.type = 'triangle';
        ring.frequency.setValueAtTime(freq, t);
        rg.gain.setValueAtTime(0.075, t);
        rg.gain.exponentialRampToValueAtTime(0.001, t + dur);
        ring.connect(rg).connect(this.sfxLowpass);
        ring.start(t);
        ring.stop(t + dur + 0.01);
      }
    }
  }

  public playKillCrunch(combo: number): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (t - this.lastKillSfx < 0.045) return;
    this.lastKillSfx = t;

    const pitchMult = Math.pow(2, ((combo % 10) * 0.65) / 12);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680 * pitchMult, t);
    osc.frequency.exponentialRampToValueAtTime(240 * pitchMult, t + 0.085);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(this.sfxLowpass);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playPerfectDodge(): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(280, t);
    sub.frequency.exponentialRampToValueAtTime(36, t + 0.38);
    sg.gain.setValueAtTime(0.32, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    sub.connect(sg).connect(this.sfxLowpass);
    sub.start(t);
    sub.stop(t + 0.42);

    for (const [idx, f] of [880, 1318.5, 1760].entries()) {
      const o = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + idx * 0.03);
      og.gain.setValueAtTime(0.12, t + idx * 0.03);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(og).connect(this.sfxLowpass);
      o.start(t + idx * 0.03);
      o.stop(t + 0.3);
    }
  }

  public playExplosion(heavy: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const dur = heavy ? 0.38 : 0.22;
    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(heavy ? 165 : 130, t);
    sub.frequency.exponentialRampToValueAtTime(24, t + dur);
    sg.gain.setValueAtTime(heavy ? 0.36 : 0.2, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    sub.connect(sg).connect(this.sfxLowpass);
    sub.start(t);
    sub.stop(t + dur + 0.02);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(heavy ? 1250 : 920, t);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(heavy ? 0.26 : 0.14, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.85);
    src.connect(lp).connect(ng).connect(this.sfxLowpass);
    src.start(t);
    src.stop(t + dur);
  }

  public playDash(): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(650, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.13);
    bp.Q.value = 1.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(bp).connect(ng).connect(this.sfxLowpass);
    n.start(t);
    n.stop(t + 0.16);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.12);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g).connect(this.sfxLowpass);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  public playXpGem(): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    if (t - this.lastXpTime < 0.025) return;
    if (t - this.lastXpTime < 0.45) {
      this.xpChain = Math.min(18, this.xpChain + 1);
    } else {
      this.xpChain = 0;
    }
    this.lastXpTime = t;
    const freq = 540 * Math.pow(2, (this.xpChain * 0.85) / 12);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, t + 0.06);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    osc.connect(g).connect(this.sfxLowpass);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playFanfare(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const notes = hyper
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      : [440, 554.37, 659.25, 880];
    notes.forEach((n, idx) => {
      if (!this.ctx || !this.sfxLowpass) return;
      const start = t + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = hyper ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(n, start);
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      osc.connect(g).connect(this.sfxLowpass);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }
}

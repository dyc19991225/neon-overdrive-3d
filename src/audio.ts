// Studio-Grade Procedural Stereo WebAudio Synthesizer, Spatial Panner, Convolver Reverb & 3-Biome Synthwave Engine
import type { StageId } from './config';

const BPM = 130;
const STEP_DUR = 60 / BPM / 4; // ~0.1154s per 16th-note

interface BiomeScore {
  bass: number[]; // 32 steps
  arp: number[]; // 64 steps (4 bars)
  pads: [number, number, number][]; // 4 bars of 3-note voicings
}

const BIOME_SCORES: Record<StageId, BiomeScore> = {
  // Neon Ruins: D-Minor / Darksynth Cyberpunk Anthem (D - Bb - Gm - A)
  ruins: {
    bass: [
      38, 38, 50, 38, 38, 38, 41, 38, 34, 34, 46, 34, 34, 34, 41, 34,
      31, 31, 43, 31, 31, 31, 38, 31, 33, 33, 45, 33, 36, 36, 43, 37,
    ],
    arp: [
      62, 65, 69, 74, 72, 69, 65, 69, 58, 62, 65, 70, 69, 65, 62, 65,
      55, 58, 62, 67, 70, 67, 62, 58, 57, 61, 64, 69, 73, 69, 64, 61,
      62, 69, 74, 77, 76, 74, 69, 65, 58, 65, 70, 74, 72, 70, 65, 62,
      55, 62, 67, 70, 74, 70, 67, 62, 57, 64, 69, 73, 76, 73, 69, 67,
    ],
    pads: [
      [50, 57, 65],
      [46, 53, 62],
      [43, 50, 58],
      [45, 52, 61],
    ],
  },
  // Magma Foundry: Heavy Industrial E-Phrygian Dominant (E - F - G - F)
  foundry: {
    bass: [
      28, 28, 40, 28, 29, 28, 40, 28, 29, 29, 41, 29, 32, 29, 41, 29,
      31, 31, 43, 31, 31, 29, 40, 28, 29, 29, 41, 29, 34, 32, 29, 28,
    ],
    arp: [
      52, 56, 59, 64, 65, 64, 59, 56, 53, 57, 60, 65, 68, 65, 60, 57,
      55, 59, 62, 67, 68, 67, 62, 59, 53, 56, 60, 65, 64, 60, 56, 53,
      52, 59, 64, 68, 71, 68, 64, 59, 53, 60, 65, 68, 72, 68, 65, 60,
      55, 62, 67, 71, 74, 71, 67, 62, 56, 59, 64, 68, 71, 68, 65, 59,
    ],
    pads: [
      [40, 47, 56],
      [41, 48, 57],
      [43, 50, 59],
      [41, 47, 56],
    ],
  },
  // Cryo Quantum Nexus: Shimmering F#-Minor / Dorian Crystalline Pulse (F#m - D - A - E)
  cryo: {
    bass: [
      42, 42, 54, 42, 42, 45, 49, 42, 38, 38, 50, 38, 38, 42, 45, 38,
      45, 45, 57, 45, 45, 49, 52, 45, 40, 40, 52, 40, 44, 47, 52, 49,
    ],
    arp: [
      66, 69, 73, 78, 80, 78, 73, 69, 62, 66, 69, 74, 76, 74, 69, 66,
      69, 73, 76, 81, 80, 76, 73, 69, 64, 68, 71, 76, 78, 76, 71, 68,
      66, 73, 78, 81, 85, 81, 78, 73, 62, 69, 74, 78, 81, 78, 74, 69,
      69, 76, 80, 81, 85, 80, 76, 73, 64, 71, 76, 80, 83, 80, 76, 71,
    ],
    pads: [
      [54, 61, 69],
      [50, 57, 66],
      [57, 64, 73],
      [52, 59, 68],
    ],
  },
};

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function sliderToGain(slider01: number): number {
  if (slider01 <= 0.001) return 0;
  const clamped = Math.max(0, Math.min(1, slider01));
  return clamped * clamped;
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class CyberAudio {
  private ctx: AudioContext | null = null;
  private sfxLowpass: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  private sfxReverbSend: GainNode | null = null;

  private musicLowpass: BiquadFilterNode | null = null;
  private musicDuckBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private musicEchoSend: GainNode | null = null;

  private noiseBuf: AudioBuffer | null = null;

  private sfxVolume = 0.85;
  private bgmVolume = 0.65;
  private bgmMuted = false;
  private stageTheme: StageId = 'ruins';

  private nextStepTime = 0;
  private stepIndex = 0;
  private bgmRunning = false;

  private xpChain = 0;
  private lastXpTime = 0;
  private lastHitSfx = 0;
  private lastKillSfx = 0;
  private lastSawSfx = 0;

  public unlock(): void {
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      // Master Glue Compressor / Limiter
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 5.5;
      comp.attack.value = 0.0025;
      comp.release.value = 0.14;
      comp.connect(this.ctx.destination);

      // SFX Bus + Bullet-Time Muffle Filter
      this.sfxLowpass = this.ctx.createBiquadFilter();
      this.sfxLowpass.type = 'lowpass';
      this.sfxLowpass.frequency.value = 20000;
      this.sfxLowpass.Q.value = 0.75;

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = sliderToGain(this.sfxVolume) * 0.74;
      this.sfxLowpass.connect(this.sfxBus);
      this.sfxBus.connect(comp);

      // Procedural Stereo Cyber-Hall Convolver Reverb (feeds into sfxLowpass so volume & muffle apply!)
      const convolver = this.ctx.createConvolver();
      convolver.buffer = this.buildStereoReverbImpulse(1.25, 2.9);
      this.sfxReverbSend = this.ctx.createGain();
      this.sfxReverbSend.gain.value = 0.34;
      const revHp = this.ctx.createBiquadFilter();
      revHp.type = 'highpass';
      revHp.frequency.value = 210;
      this.sfxReverbSend.connect(revHp).connect(convolver).connect(this.sfxLowpass);

      // Music Bus + Menu/Witch-Time Ducking
      this.musicLowpass = this.ctx.createBiquadFilter();
      this.musicLowpass.type = 'lowpass';
      this.musicLowpass.frequency.value = 18500;
      this.musicLowpass.Q.value = 0.7;

      this.musicDuckBus = this.ctx.createGain();
      this.musicDuckBus.gain.value = 1.0;

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.bgmMuted ? 0 : sliderToGain(this.bgmVolume) * 0.44;

      this.musicLowpass.connect(this.musicDuckBus);
      this.musicDuckBus.connect(this.musicBus);
      this.musicBus.connect(comp);

      // Stereo Dotted-Eighth Ping-Pong Delay for BGM Lead & Pads
      this.musicEchoSend = this.ctx.createGain();
      this.musicEchoSend.gain.value = 0.28;
      const delayL = this.ctx.createDelay(1.0);
      const delayR = this.ctx.createDelay(1.0);
      delayL.delayTime.value = STEP_DUR * 3;
      delayR.delayTime.value = STEP_DUR * 3;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.32;
      const echoLp = this.ctx.createBiquadFilter();
      echoLp.type = 'lowpass';
      echoLp.frequency.value = 3400;

      this.musicEchoSend.connect(echoLp).connect(delayL);
      delayL.connect(delayR);
      delayR.connect(fb).connect(delayL);

      if (typeof this.ctx.createStereoPanner === 'function') {
        const panL = this.ctx.createStereoPanner();
        const panR = this.ctx.createStereoPanner();
        panL.pan.value = -0.68;
        panR.pan.value = 0.68;
        delayL.connect(panL).connect(this.musicLowpass);
        delayR.connect(panR).connect(this.musicLowpass);
      } else {
        delayL.connect(this.musicLowpass);
        delayR.connect(this.musicLowpass);
      }

      // Shared White/Pink-ish Noise Buffer
      const len = Math.floor(this.ctx.sampleRate * 0.5);
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

  private buildStereoReverbImpulse(durationSec: number, decay: number): AudioBuffer {
    const rate = this.ctx!.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx!.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const buf = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const tNorm = i / length;
        const env = Math.pow(1 - tNorm, decay);
        const white = Math.random() * 2 - 1;
        // Progressive high-frequency air absorption
        const damp = 0.32 + (1 - tNorm) * 0.45;
        lp = lp + damp * (white - lp);
        buf[i] = lp * env * 0.65;
      }
    }
    return impulse;
  }

  private routeSfx(pan = 0, reverbWet = 0): AudioNode {
    if (!this.ctx || !this.sfxLowpass) {
      throw new Error('Audio not initialized');
    }
    const clampedPan = Math.max(-0.88, Math.min(0.88, pan));
    const usePan = Math.abs(clampedPan) > 0.025 && typeof this.ctx.createStereoPanner === 'function';
    if (!usePan && reverbWet <= 0.001) {
      return this.sfxLowpass;
    }

    const input = this.ctx.createGain();
    input.gain.value = 1.0;

    if (usePan) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clampedPan;
      input.connect(panner).connect(this.sfxLowpass);
    } else {
      input.connect(this.sfxLowpass);
    }

    if (reverbWet > 0.001 && this.sfxReverbSend) {
      const send = this.ctx.createGain();
      send.gain.value = reverbWet;
      input.connect(send).connect(this.sfxReverbSend);
    }
    return input;
  }

  public setStageTheme(stage: StageId): void {
    this.stageTheme = stage;
  }

  public setVolumes(bgmVol: number, sfxVol: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, bgmVol));
    this.sfxVolume = Math.max(0, Math.min(1, sfxVol));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.musicBus) {
      const target = this.bgmMuted ? 0 : sliderToGain(this.bgmVolume) * 0.44;
      this.musicBus.gain.setTargetAtTime(target, t, 0.025);
    }
    if (this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(sliderToGain(this.sfxVolume) * 0.74, t, 0.025);
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

  public setBulletTimeMuffle(active: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    this.sfxLowpass.frequency.setTargetAtTime(active ? 720 : 20000, this.ctx.currentTime, 0.035);
  }

  public setMusicDucked(ducked: boolean): void {
    if (!this.ctx || !this.musicDuckBus || !this.musicLowpass) return;
    const t = this.ctx.currentTime;
    this.musicDuckBus.gain.setTargetAtTime(ducked ? 0.28 : 1.0, t, ducked ? 0.03 : 0.14);
    this.musicLowpass.frequency.setTargetAtTime(ducked ? 680 : 18500, t, ducked ? 0.04 : 0.14);
  }

  // =========================================================================
  // 4-Bar (64-Step) Biome-Specific Synthwave Sequencer
  // =========================================================================
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
      this.stepIndex = (this.stepIndex + 1) % 64;
      this.nextStepTime += STEP_DUR;
    }
  }

  private scheduleSynthStep(step: number, t: number, intensity: 0 | 1 | 2): void {
    if (!this.ctx || !this.musicLowpass || !this.noiseBuf) return;
    const score = BIOME_SCORES[this.stageTheme];
    const barStep = step % 16;
    const barIdx = Math.floor(step / 16) % 4;
    const isKickStep = barStep % 4 === 0;

    // 1. Punchy Layered Cyber Kick (Sub Sweep + Beater Click)
    if (isKickStep) {
      const kick = this.ctx.createOscillator();
      const kg = this.ctx.createGain();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(158, t);
      kick.frequency.exponentialRampToValueAtTime(36, t + 0.115);
      kg.gain.setValueAtTime(0.48, t);
      kg.gain.exponentialRampToValueAtTime(0.001, t + 0.135);
      kick.connect(kg).connect(this.musicLowpass);
      kick.start(t);
      kick.stop(t + 0.145);

      const click = this.ctx.createOscillator();
      const cg = this.ctx.createGain();
      click.type = 'triangle';
      click.frequency.setValueAtTime(920, t);
      click.frequency.exponentialRampToValueAtTime(110, t + 0.018);
      cg.gain.setValueAtTime(0.14, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
      click.connect(cg).connect(this.musicLowpass);
      click.start(t);
      click.stop(t + 0.025);
    }

    // 2. Sidechained Rolling Darksynth Bassline
    const bassFreq = midiToHz(score.bass[step % 32]);
    const bass = this.ctx.createOscillator();
    const bFilter = this.ctx.createBiquadFilter();
    const bg = this.ctx.createGain();
    bass.type = this.stageTheme === 'cryo' ? 'square' : 'sawtooth';
    bass.frequency.setValueAtTime(bassFreq, t);
    bFilter.type = 'lowpass';
    bFilter.Q.value = this.stageTheme === 'foundry' ? 4.8 : 3.2;
    bFilter.frequency.setValueAtTime(isKickStep ? 390 : 1220, t);
    bFilter.frequency.exponentialRampToValueAtTime(150, t + STEP_DUR * 0.9);
    bg.gain.setValueAtTime(isKickStep ? 0.10 : 0.25, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 0.94);
    bass.connect(bFilter).connect(bg).connect(this.musicLowpass);
    bass.start(t);
    bass.stop(t + STEP_DUR);

    // 3. Warm Stereo Detuned Synth Pad Chords on Bar Downbeats
    if (barStep === 0 && intensity >= 1) {
      const chord = score.pads[barIdx];
      const padDur = STEP_DUR * 15.5;
      chord.forEach((midi, idx) => {
        if (!this.ctx || !this.musicLowpass) return;
        const osc = this.ctx.createOscillator();
        const flt = this.ctx.createBiquadFilter();
        const pg = this.ctx.createGain();
        osc.type = this.stageTheme === 'cryo' ? 'triangle' : 'sawtooth';
        osc.frequency.setValueAtTime(midiToHz(midi), t);
        osc.detune.value = (idx - 1) * 9;
        flt.type = 'lowpass';
        flt.frequency.setValueAtTime(this.stageTheme === 'cryo' ? 2200 : 1450, t);
        pg.gain.setValueAtTime(0.001, t);
        pg.gain.linearRampToValueAtTime(0.052, t + 0.14);
        pg.gain.exponentialRampToValueAtTime(0.001, t + padDur);
        osc.connect(flt).connect(pg);
        if (typeof this.ctx.createStereoPanner === 'function') {
          const p = this.ctx.createStereoPanner();
          p.pan.value = (idx - 1) * 0.45;
          pg.connect(p).connect(this.musicLowpass);
        } else {
          pg.connect(this.musicLowpass);
        }
        if (this.musicEchoSend && idx === 2) {
          pg.connect(this.musicEchoSend);
        }
        osc.start(t);
        osc.stop(t + padDur + 0.05);
      });
    }

    // 4. Crisp Hi-Hats + Layered Gated Synthwave Snare
    if (intensity >= 1) {
      const hat = this.ctx.createBufferSource();
      hat.buffer = this.noiseBuf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const hg = this.ctx.createGain();
      const openAccent = barStep % 4 === 2;
      hg.gain.setValueAtTime(openAccent ? 0.105 : 0.042, t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + (openAccent ? 0.068 : 0.026));
      hat.connect(hp).connect(hg).connect(this.musicLowpass);
      hat.start(t);
      hat.stop(t + 0.075);

      if (barStep === 4 || barStep === 12) {
        // Snare tonal body
        const body = this.ctx.createOscillator();
        const bodyG = this.ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(this.stageTheme === 'foundry' ? 245 : 210, t);
        body.frequency.exponentialRampToValueAtTime(92, t + 0.085);
        bodyG.gain.setValueAtTime(0.18, t);
        bodyG.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        body.connect(bodyG).connect(this.musicLowpass);
        body.start(t);
        body.stop(t + 0.095);

        // Snare gated noise snap
        const sn = this.ctx.createBufferSource();
        sn.buffer = this.noiseBuf;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = this.stageTheme === 'foundry' ? 2350 : 1900;
        bp.Q.value = 1.05;
        const sg = this.ctx.createGain();
        sg.gain.setValueAtTime(0.24, t);
        sg.gain.exponentialRampToValueAtTime(0.001, t + 0.125);
        sn.connect(bp).connect(sg).connect(this.musicLowpass);
        sn.start(t);
        sn.stop(t + 0.135);
      }
    }

    // 5. High-Intensity Melodic Lead Arpeggio with Stereo Ping-Pong Echo!
    if (intensity >= 2) {
      const arpFreq = midiToHz(score.arp[step]);
      const lead = this.ctx.createOscillator();
      const lFilter = this.ctx.createBiquadFilter();
      const lg = this.ctx.createGain();

      if (this.stageTheme === 'cryo') {
        lead.type = step % 4 === 0 ? 'sine' : 'triangle';
      } else if (this.stageTheme === 'foundry') {
        lead.type = 'sawtooth';
      } else {
        lead.type = step % 2 === 0 ? 'square' : 'sawtooth';
      }
      lead.detune.value = step % 3 === 0 ? 8 : -8;
      lead.frequency.setValueAtTime(arpFreq, t);

      lFilter.type = 'lowpass';
      lFilter.frequency.setValueAtTime(this.stageTheme === 'cryo' ? 4800 : 3200, t);
      lFilter.frequency.exponentialRampToValueAtTime(950, t + STEP_DUR * 0.85);

      lg.gain.setValueAtTime(0.088, t);
      lg.gain.exponentialRampToValueAtTime(0.001, t + STEP_DUR * 0.88);
      lead.connect(lFilter).connect(lg).connect(this.musicLowpass);
      if (this.musicEchoSend && step % 2 === 0) {
        lg.connect(this.musicEchoSend);
      }
      lead.start(t);
      lead.stop(t + STEP_DUR * 0.92);
    }
  }

  // =========================================================================
  // Tactile UI & Ultimate / Objective / Biome SFX
  // =========================================================================
  public playUiClick(confirm = false): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, confirm ? 0.18 : 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = confirm ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(confirm ? 587.33 : 780, t);
    o.frequency.exponentialRampToValueAtTime(confirm ? 1174.66 : 1120, t + (confirm ? 0.085 : 0.045));
    g.gain.setValueAtTime(confirm ? 0.12 : 0.075, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (confirm ? 0.095 : 0.05));
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }

  public playOverdriveUltimate(): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.72);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(280, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.62);
    sg.gain.setValueAtTime(0.34, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.68);

    for (const [idx, freq] of [293.66, 440, 587.33, 880, 1174.66].entries()) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      o.detune.value = (idx - 2) * 10;
      const panOut = this.routeSfx((idx - 2) * 0.28, 0.55);
      o.frequency.setValueAtTime(freq * 0.84, t + idx * 0.028);
      o.frequency.exponentialRampToValueAtTime(freq, t + idx * 0.028 + 0.085);
      g.gain.setValueAtTime(0.115, t + idx * 0.028);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.58);
      o.connect(g).connect(panOut);
      o.start(t + idx * 0.028);
      o.stop(t + 0.6);
    }
  }

  public playBeaconTick(progress01: number): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.24);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    const freq = 440 * Math.pow(2, progress01 * 1.15);
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.12, t + 0.085);
    g.gain.setValueAtTime(0.095, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.105);
  }

  public playHazardErupt(cryo: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (cryo) {
      const out = this.routeSfx(pan, 0.55);
      for (const f of [1046.5, 1396.9, 2093]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f * randRange(0.97, 1.03), t);
        o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.3);
        g.gain.setValueAtTime(0.11, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.34);
      }
    } else {
      this.playExplosion(true, pan);
    }
  }

  public playSniperShot(pan = 0): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(pan, 0.22);
    const pMult = randRange(0.94, 1.06);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1480 * pMult, t);
    o.frequency.exponentialRampToValueAtTime(240 * pMult, t + 0.095);
    g.gain.setValueAtTime(0.085, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.11);
  }

  // =========================================================================
  // Core Weapon & Spatial Combat SFX (With ±6% Pitch Humanization!)
  // =========================================================================
  public playKunai(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const pMult = randRange(0.94, 1.06);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime((hyper ? 3900 : 2950) * pMult, t);
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
    osc.frequency.setValueAtTime((hyper ? 1400 : 980) * pMult, t);
    osc.frequency.exponentialRampToValueAtTime((hyper ? 225 : 150) * pMult, t + 0.07);
    g.gain.setValueAtTime(hyper ? 0.065 : 0.085, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    osc.connect(g).connect(this.sfxLowpass);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // Dedicated Serrated Plasma Buzzsaw Shred SFX
  public playSawHit(hyper: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (t - this.lastSawSfx < 0.085) return;
    this.lastSawSfx = t;

    const out = this.routeSfx(pan, hyper ? 0.25 : 0.12);
    const pMult = randRange(0.93, 1.07);

    const saw = this.ctx.createOscillator();
    const flt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime((hyper ? 520 : 390) * pMult, t);
    saw.frequency.exponentialRampToValueAtTime((hyper ? 880 : 620) * pMult, t + 0.055);
    flt.type = 'bandpass';
    flt.frequency.value = (hyper ? 1850 : 1350) * pMult;
    flt.Q.value = 3.2;
    g.gain.setValueAtTime(hyper ? 0.13 : 0.095, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    saw.connect(flt).connect(g).connect(out);
    saw.start(t);
    saw.stop(t + 0.08);
  }

  public playArc(hyper: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(pan, hyper ? 0.42 : 0.26);
    const pMult = randRange(0.94, 1.06);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime((hyper ? 3200 : 2350) * pMult, t);
    bp.Q.value = 3.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(hyper ? 0.22 : 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.14);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime((hyper ? 235 : 185) * pMult, t);
    sub.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    sg.gain.setValueAtTime(0.16, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.115);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.12);
  }

  public playLaser(hyper: boolean): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, hyper ? 0.5 : 0.34);
    for (const detune of [-14, 0, 14]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = detune === 0 ? 'square' : 'sawtooth';
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(hyper ? 560 : 395, t);
      osc.frequency.exponentialRampToValueAtTime(hyper ? 112 : 82, t + 0.3);
      g.gain.setValueAtTime(0.075, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.31);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.32);
    }
  }

  public playGravityWell(collapse: boolean, hyper: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(pan, collapse ? 0.58 : 0.32);
    if (!collapse) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hyper ? 185 : 142, t);
      osc.frequency.exponentialRampToValueAtTime(50, t + 0.32);
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.36);
    } else {
      const zip = this.ctx.createOscillator();
      const zg = this.ctx.createGain();
      zip.type = 'sawtooth';
      zip.frequency.setValueAtTime(92, t);
      zip.frequency.exponentialRampToValueAtTime(hyper ? 680 : 440, t + 0.08);
      zip.frequency.exponentialRampToValueAtTime(28, t + 0.38);
      zg.gain.setValueAtTime(hyper ? 0.26 : 0.19, t);
      zg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      zip.connect(zg).connect(out);
      zip.start(t);
      zip.stop(t + 0.42);
    }
  }

  public playOrbitalStrike(hyper: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(pan, hyper ? 0.62 : 0.42);
    const pMult = randRange(0.95, 1.05);

    const beam = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    beam.type = 'sawtooth';
    beam.frequency.setValueAtTime((hyper ? 940 : 690) * pMult, t);
    beam.frequency.exponentialRampToValueAtTime(32, t + 0.34);
    bg.gain.setValueAtTime(hyper ? 0.24 : 0.18, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
    beam.connect(bg).connect(out);
    beam.start(t);
    beam.stop(t + 0.38);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(hyper ? 2350 : 1550, t);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(hyper ? 0.24 : 0.16, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(lp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.32);
  }

  public playBossTelegraph(): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.48);
    for (let k = 0; k < 2; k++) {
      const st = t + k * 0.11;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(740, st);
      o.frequency.setValueAtTime(995, st + 0.045);
      g.gain.setValueAtTime(0.095, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.1);
      o.connect(g).connect(out);
      o.start(st);
      o.stop(st + 0.11);
    }
  }

  public playPowerup(kind: 'magnet' | 'frenzy' | 'revive'): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.55);
    const freqs =
      kind === 'magnet'
        ? [392, 523.25, 659.25, 1046.5]
        : kind === 'frenzy'
        ? [440, 587.33, 880, 1174.66, 1760]
        : [261.63, 392, 523.25, 659.25, 1046.5, 1567.98];
    freqs.forEach((f, idx) => {
      if (!this.ctx) return;
      const st = t + idx * 0.045;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = kind === 'frenzy' ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, st);
      g.gain.setValueAtTime(0.16, st);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.28);
      o.connect(g).connect(out);
      o.start(st);
      o.stop(st + 0.3);
    });
  }

  public playHit(crit: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (t - this.lastHitSfx < 0.03) return;
    this.lastHitSfx = t;

    const pMult = randRange(0.94, 1.06);
    const out = crit ? this.routeSfx(pan, 0.22) : this.sfxLowpass;

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime((crit ? 215 : 168) * pMult, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.065);
    sg.gain.setValueAtTime(crit ? 0.18 : 0.11, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.075);

    if (crit) {
      for (const [freq, dur] of [
        [1185 * pMult, 0.14],
        [1890 * pMult, 0.11],
      ]) {
        const ring = this.ctx.createOscillator();
        const rg = this.ctx.createGain();
        ring.type = 'triangle';
        ring.frequency.setValueAtTime(freq, t);
        rg.gain.setValueAtTime(0.075, t);
        rg.gain.exponentialRampToValueAtTime(0.001, t + dur);
        ring.connect(rg).connect(out);
        ring.start(t);
        ring.stop(t + dur + 0.01);
      }
    }
  }

  public playKillCrunch(combo: number, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    if (t - this.lastKillSfx < 0.045) return;
    this.lastKillSfx = t;

    const out = Math.abs(pan) > 0.12 ? this.routeSfx(pan, 0) : this.sfxLowpass;
    const pitchMult = Math.pow(2, ((combo % 10) * 0.65) / 12) * randRange(0.96, 1.04);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(690 * pitchMult, t);
    osc.frequency.exponentialRampToValueAtTime(235 * pitchMult, t + 0.085);
    g.gain.setValueAtTime(0.115, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.095);
  }

  public playPerfectDodge(): void {
    if (!this.ctx || !this.sfxLowpass) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.68);
    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(285, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.4);
    sg.gain.setValueAtTime(0.32, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 0.44);

    for (const [idx, f] of [880, 1318.5, 1760].entries()) {
      const o = this.ctx.createOscillator();
      const og = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + idx * 0.03);
      og.gain.setValueAtTime(0.12, t + idx * 0.03);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(og).connect(out);
      o.start(t + idx * 0.03);
      o.stop(t + 0.32);
    }
  }

  public playExplosion(heavy: boolean, pan = 0): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const dur = heavy ? 0.42 : 0.24;
    const pMult = randRange(0.93, 1.07);
    const out = this.routeSfx(pan, heavy ? 0.58 : 0.30);

    const sub = this.ctx.createOscillator();
    const sg = this.ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime((heavy ? 168 : 132) * pMult, t);
    sub.frequency.exponentialRampToValueAtTime(23, t + dur);
    sg.gain.setValueAtTime(heavy ? 0.36 : 0.21, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + dur + 0.02);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime((heavy ? 1320 : 960) * pMult, t);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(heavy ? 0.26 : 0.145, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.88);
    src.connect(lp).connect(ng).connect(out);
    src.start(t);
    src.stop(t + dur);
  }

  public playDash(): void {
    if (!this.ctx || !this.sfxLowpass || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const out = this.routeSfx(0, 0.25);
    const pMult = randRange(0.96, 1.04);

    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(640 * pMult, t);
    bp.frequency.exponentialRampToValueAtTime(2550 * pMult, t + 0.13);
    bp.Q.value = 1.8;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(bp).connect(ng).connect(out);
    n.start(t);
    n.stop(t + 0.16);

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190 * pMult, t);
    osc.frequency.exponentialRampToValueAtTime(780 * pMult, t + 0.12);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g).connect(out);
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
    const out = this.routeSfx(0, hyper ? 0.65 : 0.38);
    const notes = hyper
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
      : [440, 554.37, 659.25, 880];
    notes.forEach((n, idx) => {
      if (!this.ctx) return;
      const start = t + idx * 0.055;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = hyper ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(n, start);
      g.gain.setValueAtTime(0.18, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.connect(g).connect(out);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }
}


import { AgentRole } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbBus: GainNode | null = null;
  private scale: number[] = [0, 3, 5, 7, 10]; // A Minor Pentatonic: A, C, D, E, G
  
  // Voice Management
  private activeVoices: Map<string, AudioNode[]> = new Map();
  private maxVoices: Record<AgentRole, number> = {
    pulse: 2,   // Only 2 ritual percussions allowed at once
    motif: 3,   // 3 singing bowl layers max
    drone: 1,   // Single unified wind/nature drone
    breath: 2   // 2 bamboo/human phrases max
  };

  // iOS/Android WebAudio unlock flag: Prevents multiple resume() calls
  private contextResumed: boolean = false;

  constructor() {}

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25; // Quiet, humble master volume
      this.master.connect(this.ctx.destination);

      this.reverbBus = this.ctx.createGain();
      this.reverbBus.gain.value = 0.7;
      
      // Infinite Zen Reverb/Delay chain
      const delay = this.ctx.createDelay();
      delay.delayTime.value = 0.8;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.6;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;

      this.reverbBus.connect(delay);
      delay.connect(filter);
      filter.connect(fb);
      fb.connect(delay);
      delay.connect(this.master);
    }
    
    // iOS/Android WebAudio unlock: Resume AudioContext if suspended
    // WARNING: In iOS 14+, must call on actual user gesture (tap, touch) to unlock
    // Calling from async/deferred handlers may not work
    if (this.ctx.state === 'suspended' && !this.contextResumed) {
      try {
        await this.ctx.resume();
        this.contextResumed = true;
      } catch (err) {
        console.warn('[AudioEngine] Failed to resume context:', err);
        // Silently continue - context may resume on next gesture
      }
    }
  }

  get currentTime() { return this.ctx?.currentTime || 0; }

  // Semi-creative Trigger: Ensures aesthetic coherence
  // fix: Made agentId optional in the options parameter to resolve the error where the default value {} was missing a required property.
  triggerAgent(role: AgentRole, yRatio: number, intensity: number, options: { noteIndex?: number; pan?: number; agentId?: string } = {}) {
    if (!this.ctx || !this.master || !this.reverbBus) return;
    
    // Voice Limiting: If too many agents of same role exist, thin the texture
    const currentActiveCount = Array.from(this.activeVoices.keys()).filter(id => id.includes(role)).length;
    if (currentActiveCount >= this.maxVoices[role]) {
      // Logic: If it's too chaotic, we simply don't trigger or we fade out oldest.
      // For simplicity in Zen Mode, we just ignore new triggers if we are at peak "harmony".
      if (Math.random() > 0.2) return; 
    }

    const t = this.ctx.currentTime;
    const panner = this.ctx.createStereoPanner();
    panner.pan.setValueAtTime(options.pan || 0, t);
    panner.connect(this.master);

    switch (role) {
      case 'pulse': this.playRitualPercussion(yRatio, intensity, t, panner); break;
      case 'motif': this.playZenMotif(yRatio, intensity, t, options.noteIndex || 0, panner); break;
      case 'drone': this.playUnifiedNature(yRatio, intensity, t, panner); break;
      case 'breath': this.playEtherealBreath(yRatio, intensity, t, panner); break;
    }
  }

  private playRitualPercussion(yRatio: number, intensity: number, t: number, dest: AudioNode) {
    if (!this.ctx || !this.reverbBus) return;
    
    const freq = (yRatio < 0.5) ? 880 : 220;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(intensity * 0.1, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
    
    osc.connect(env);
    env.connect(dest);
    env.connect(this.reverbBus);
    osc.start(t);
    osc.stop(t + 3.1);
  }

  private playZenMotif(yRatio: number, intensity: number, t: number, noteIndex: number, dest: AudioNode) {
    if (!this.ctx || !this.reverbBus) return;
    
    // Pitch quantization to safe pentatonic scale
    const freq = this.quantizeToScale(yRatio, noteIndex);
    
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    
    // Soft breathing pitch modulation
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.2;
    lfoGain.gain.value = 2;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    lfo.start(t);

    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(intensity * 0.08, t + 2.0); // Very slow attack
    env.gain.linearRampToValueAtTime(intensity * 0.04, t + 5.0);
    env.gain.exponentialRampToValueAtTime(0.001, t + 10.0);
    
    osc.connect(env);
    env.connect(dest);
    env.connect(this.reverbBus);
    osc.start(t);
    osc.stop(t + 10.1);
  }

  private playUnifiedNature(yRatio: number, intensity: number, t: number, dest: AudioNode) {
    if (!this.ctx || !this.reverbBus) return;
    
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(10);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400 + (1 - yRatio) * 800, t);
    filter.Q.value = 2;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(intensity * 0.05, t + 5.0);
    env.gain.linearRampToValueAtTime(0, t + 10.0);
    
    noise.connect(filter);
    filter.connect(env);
    env.connect(this.reverbBus);
    noise.start(t);
    noise.stop(t + 10.1);
  }

  private playEtherealBreath(yRatio: number, intensity: number, t: number, dest: AudioNode) {
    if (!this.ctx || !this.reverbBus) return;
    const freq = this.quantizeToScale(yRatio, 0) * 0.5; // Deep breath

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(intensity * 0.04, t + 3.0);
    env.gain.linearRampToValueAtTime(0, t + 8.0);
    
    osc.connect(env);
    env.connect(this.reverbBus);
    osc.start(t);
    osc.stop(t + 8.1);
  }

  private quantizeToScale(yRatio: number, noteOffset: number): number {
    const baseFreq = 220; // A3
    const invY = 1 - Math.max(0, Math.min(1, yRatio));
    const degree = this.scale[(Math.floor(invY * 5) + noteOffset) % this.scale.length];
    const octave = Math.floor(invY * 2);
    return baseFreq * Math.pow(2, octave + (degree / 12));
  }

  private createNoiseBuffer(duration: number): AudioBuffer {
    if (!this.ctx) throw new Error("No context");
    const frameCount = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, frameCount, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < frameCount; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }
}

export const audioEngine = new AudioEngine();

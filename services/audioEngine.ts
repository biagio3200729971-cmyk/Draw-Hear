
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

  // Immediate audio path: Direct response to touch/pointer
  private immediateOscillator: OscillatorNode | null = null;
  private immediateEnvelope: GainNode | null = null;
  private immediatePanner: StereoPannerNode | null = null;

  constructor() {}

  // SYNCHRONOUS context initialization and unlock
  unlockIfNeeded() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.25;
      this.master.connect(this.ctx.destination);

      this.reverbBus = this.ctx.createGain();
      this.reverbBus.gain.value = 0.7;
      
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
    
    // Synchronous resume - no await
    if (this.ctx.state === 'suspended' && !this.contextResumed) {
      try {
        this.ctx.resume();
        this.contextResumed = true;
      } catch (err) {
        // Silently ignore
      }
    }
  }

  // SYNCHRONOUS context unlock - must be called in event handler
  ensureContextSync() {
    this.unlockIfNeeded();
  }

  async ensureContext() {
    // For backward compatibility with existing code
    this.ensureContextSync();
  }

  get currentTime() { return this.ctx?.currentTime || 0; }

  // ========================
  // IMMEDIATE AUDIO PATH
  // ========================

  // Called on pointerdown/touchstart - immediate attack
  immediateAttack(x: number, y: number) {
    this.ensureContextSync();
    if (!this.ctx || !this.master) return;

    // Stop any existing immediate sound
    this.immediateRelease();

    const t = this.ctx.currentTime;
    const yRatio = y / window.innerHeight;
    
    // Create new oscillator for immediate response
    this.immediateOscillator = this.ctx.createOscillator();
    this.immediateEnvelope = this.ctx.createGain();
    this.immediatePanner = this.ctx.createStereoPanner();

    // Set pan based on x position
    const pan = (x / window.innerWidth) * 2 - 1;
    this.immediatePanner.pan.setValueAtTime(pan, t);

    // Frequency based on y position
    const freq = (yRatio < 0.5) ? 880 : 220;
    this.immediateOscillator.type = 'sine';
    this.immediateOscillator.frequency.setValueAtTime(freq, t);

    // Immediate envelope attack
    this.immediateEnvelope.gain.setValueAtTime(0, t);
    this.immediateEnvelope.gain.linearRampToValueAtTime(0.2, t + 0.01); // Fast attack

    // Connect nodes
    this.immediateOscillator.connect(this.immediateEnvelope);
    this.immediateEnvelope.connect(this.immediatePanner);
    this.immediatePanner.connect(this.master);

    // Start immediately
    this.immediateOscillator.start(t);
  }

  // Called on pointermove/touchmove - modulate frequency
  immediateModulation(x: number, y: number) {
    if (!this.ctx || !this.immediateOscillator || !this.immediatePanner) return;

    const t = this.ctx.currentTime;
    const yRatio = y / window.innerHeight;
    const pan = (x / window.innerWidth) * 2 - 1;

    // Update frequency
    const freq = (yRatio < 0.5) ? 880 : 220;
    this.immediateOscillator.frequency.setTargetAtTime(freq, t, 0.02); // 20ms smoothing

    // Update pan
    this.immediatePanner.pan.setTargetAtTime(pan, t, 0.01);
  }

  // Called on pointerup/touchend - immediate release
  immediateRelease() {
    if (!this.ctx || !this.immediateOscillator || !this.immediateEnvelope) return;

    const t = this.ctx.currentTime;

    // Fast release
    this.immediateEnvelope.gain.setTargetAtTime(0, t, 0.05); // 50ms release
    this.immediateOscillator.stop(t + 0.1);

    // Cleanup
    this.immediateOscillator = null;
    this.immediateEnvelope = null;
    this.immediatePanner = null;
  }

  // ========================
  // BACKGROUND AUDIO PATH (original)
  // ========================

  triggerAgent(role: AgentRole, yRatio: number, intensity: number, options: { noteIndex?: number; pan?: number; agentId?: string } = {}) {
    if (!this.ctx || !this.master || !this.reverbBus) return;
    
    // Voice Limiting: If too many agents of same role exist, thin the texture
    const currentActiveCount = Array.from(this.activeVoices.keys()).filter(id => id.includes(role)).length;
    if (currentActiveCount >= this.maxVoices[role]) {
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

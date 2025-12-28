export interface Point {
  x: number;
  y: number;
  t: number;
  w: number;
}

export type AgentRole = 'pulse' | 'motif' | 'drone' | 'breath';

export interface Agent {
  id: string;
  role: AgentRole;
  points: Point[];
  center: { x: number; y: number };
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  intensity: number;
  // Zen Patterns
  sequence: boolean[]; // 16-step grid
  motifNotes: number[]; // Sequence of indices into the scale
  droneFreq: number;
  angle: number; // For lines: affects timbre
  // Animation/Lifecycle
  playPulse: number;
  breathOffset: number;
  createdAt: number;
}

export interface Scale {
  name: string;
  degrees: number[];
}

export interface AIAnalysis {
  title: string;
  description: string;
  mood: string;
}
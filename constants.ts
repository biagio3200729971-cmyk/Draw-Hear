import { Scale } from './types';

export const SCALES: Record<string, Scale> = {
  zen: { name: "禅", degrees: [0, 3, 5, 7, 10] }, // A Minor Pentatonic: A, C, D, E, G
};

export const INITIAL_SCALE_KEY = 'zen';
export const GLOBAL_BPM = 100;
export const TICK_RATE = (60 / GLOBAL_BPM) / 4; // 16th notes
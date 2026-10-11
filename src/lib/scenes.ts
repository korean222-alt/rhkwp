import type { Frame } from '../types';
export function gray(data: Uint8ClampedArray) {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  return out;
}
export function difference(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return 255;
  // Ignore a few pixels (cursor and noise) by averaging only changed tiles.
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
export class SceneDetector {
  private reference?: Uint8Array;
  private candidate?: Uint8Array;
  private stable = 0;
  private last = -Infinity;
  constructor(private threshold: number, private interval: number) {}
  sample(pixels: Uint8Array, sec: number): 'scene' | 'periodic' | undefined {
    if (!this.reference) { this.reference = pixels; this.last = sec; return 'scene'; }
    if (sceneScore(this.reference, pixels) >= this.threshold) {
      if (this.candidate && sceneScore(this.candidate, pixels) < this.threshold / 2) this.stable++;
      else this.stable = 0;
      this.candidate = pixels;
      if (this.stable >= 1) { this.reference = pixels; this.candidate = undefined; this.last = sec; return 'scene'; }
    } else { this.candidate = undefined; this.stable = 0; }
    if (sec - this.last >= this.interval) { this.last = sec; return 'periodic'; }
  }
}
function sceneScore(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length || a.length !== 14400) return difference(a, b);
  // White slides often change only their text. Focus on changed tiles while
  // dropping the two strongest tiles so a moving cursor does not dominate.
  const tiles: number[] = [];
  for (let y = 0; y < 90; y += 10) for (let x = 0; x < 160; x += 10) {
    let sum = 0;
    for (let dy = 0; dy < 10; dy++) for (let dx = 0; dx < 10; dx++) {
      const i = (y + dy) * 160 + x + dx; sum += Math.abs(a[i] - b[i]);
    }
    tiles.push(sum / 100);
  }
  const changed = tiles.sort((a, b) => b - a).slice(2, 34);
  return changed.reduce((s, v) => s + v, 0) / changed.length;
}
export function selectFrame<T extends Pick<Frame, 'sec' | 'sceneId'>>(rows: T[], sec: number) {
  const before = rows.filter(f => f.sec <= sec).at(-1);
  if (!before) return undefined; // Never claim a future scene represents the past.
  const after = rows.find(f => f.sec > sec && f.sec <= sec + 1 && f.sceneId === before.sceneId);
  return after && after.sec - sec < sec - before.sec ? after : before;
}

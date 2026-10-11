import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { time, parseTime } from '../src/lib/time';
import { SceneDetector, selectFrame, difference } from '../src/lib/scenes';
import { hasSpeech } from '../src/lib/vad';
import { combined } from '../src/lib/cues';
describe('timeline accuracy', () => {
  it('keeps millisecond carry and hour boundaries', () => {
    expect(time(59.9996, true)).toBe('00:01:00,000');
    expect(time(3600.125, true)).toBe('01:00:00,125');
    expect(parseTime('01:12:30')).toBe(4350);
    expect(() => parseTime('00:80:01')).toThrow();
    expect(() => parseTime('bad')).toThrow();
    expect(() => parseTime(-1)).toThrow();
  });
});
describe('scene selection and detection', () => {
  it('does not attach a future scene and allows a closer snapshot in the same scene', () => {
    const frames = [{ sec: 0, sceneId: 'a' }, { sec: 10, sceneId: 'a' }, { sec: 12, sceneId: 'b' }];
    expect(selectFrame(frames, -1)).toBeUndefined();
    expect(selectFrame(frames, 9.7)?.sec).toBe(10);
    expect(selectFrame(frames, 11.8)?.sec).toBe(10);
    expect(selectFrame(frames, 12)?.sceneId).toBe('b');
  });
  it('ignores cursors and waits for a stable changed screen', () => {
    const black = new Uint8Array(14400), white = new Uint8Array(14400).fill(220);
    const cursor = black.slice(); cursor.fill(255, 40, 75);
    expect(difference(black, cursor)).toBeLessThan(1);
    const detector = new SceneDetector(14, 10);
    expect(detector.sample(black, 0)).toBe('scene');
    expect(detector.sample(cursor, 1)).toBeUndefined();
    expect(detector.sample(white, 2)).toBeUndefined();
    expect(detector.sample(white, 3)).toBe('scene');
    expect(detector.sample(white, 4)).toBeUndefined();
    expect(detector.sample(white, 13)).toBe('periodic');
  });
  it('detects text changes spread across a white slide', () => {
    const before = new Uint8Array(14400).fill(255), after = before.slice();
    for (let y = 10; y < 70; y += 15) for (let x = 20; x < 140; x++) for (let h = 0; h < 3; h++) after[(y + h) * 160 + x] = 20;
    const detector = new SceneDetector(14, 10); detector.sample(before, 0);
    expect(detector.sample(after, 1)).toBeUndefined(); expect(detector.sample(after, 2)).toBe('scene');
  });
});
describe('local audio capture', () => {
  it('avoids Whisper hallucinations on silence while retaining quiet speech', () => {
    expect(hasSpeech(new Float32Array(16000))).toBe(false);
    expect(hasSpeech(Float32Array.from({ length: 16000 }, (_, i) => .008 * Math.sin(i / 6)))).toBe(true);
  });
  for (const rate of [44100, 48000]) it(`resamples ${rate} Hz with exact 5-second blocks and pause alignment`, () => {
    let AudioClass: new () => { process(inputs: Float32Array[][]): boolean; port: { onmessage: (m: unknown) => void }; total: number };
    const messages: { type: string; start?: number; samples?: Float32Array }[] = [];
    class Base { port = { postMessage: (m: typeof messages[number]) => messages.push(m), onmessage: () => {} }; }
    runInNewContext(readFileSync('public/audio-worklet.js', 'utf8'), { sampleRate: rate, Float32Array, AudioWorkletProcessor: Base, registerProcessor: (_: string, c: typeof AudioClass) => { AudioClass = c; } });
    const audio = new AudioClass!();
    const block = new Float32Array(128).fill(.25);
    // Feed exactly 12 seconds with varying render-quantum tail length.
    for (let i = 0; i < rate * 12; i += 128) audio.process([[block.subarray(0, Math.min(128, rate * 12 - i))]]);
    audio.port.onmessage({ data: { type: 'pause', request: 'p' } });
    for (let i = 0; i < 100; i++) audio.process([[block]]);
    expect(audio.total).toBe(192000);
    audio.port.onmessage({ data: { type: 'resume' } });
    for (let i = 0; i < rate; i += 128) audio.process([[block.subarray(0, Math.min(128, rate - i))]]);
    audio.port.onmessage({ data: { type: 'flush', request: 'f' } });
    const chunks = messages.filter(m => m.type === 'chunk');
    expect(chunks.map(m => m.start)).toEqual([0, 5, 10, 12]);
    expect(chunks.map(m => m.samples!.length)).toEqual([80000, 80000, 32000, 16000]);
    expect(chunks[0].samples![100]).toBeCloseTo(.25, 6);
  });
});
describe('AI-free notes', () => {
  it('attaches OCR once per scene, never outputs missing image paths', () => {
    const frames = [{ id: 'a', sec: 0, sceneId: 'a', type: 'scene' as const, ocr: '수요와 공급' }, { id: 'p', sec: 10, sceneId: 'a', type: 'periodic' as const, ocr: '' }, { id: 'b', sec: 20, sceneId: 'b', type: 'scene' as const, ocr: '시장 균형' }];
    const rows = [1, 11, 21].map(start => ({ id: `t${start}`, sessionId: 's', start, end: start + 1, text: '여기 보시면' }));
    const note = combined('강의', rows, frames, ['보시면'], new Set(['a']));
    expect(note.match(/> 화면 단서/g)).toHaveLength(2);
    expect(note).toContain('수요와 공급'); expect(note).toContain('시장 균형');
    expect(note).toContain('frames/0001.jpg'); expect(note).not.toContain('frames/0003.jpg');
  });
});

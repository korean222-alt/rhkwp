import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { time, parseTime } from '../src/lib/time';
import { SceneDetector, selectFrame, difference } from '../src/lib/scenes';
import { hasSpeech } from '../src/lib/vad';
import { combined } from '../src/lib/cues';
import { normalizeSettings } from '../src/lib/settings';
import { DEFAULT_SETTINGS } from '../src/types';
import { chooseLanguage, transcriptionIssue, audioWindows } from '../src/lib/speech';
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
  it('saves no periodic snapshots or subtitle-only changes in scene mode', () => {
    const slide = new Uint8Array(14400).fill(240);
    const detector = new SceneDetector(14, 0, 25);
    expect(detector.sample(slide, 0)).toBe('scene');
    for (let sec = 1; sec <= 70; sec++) {
      const caption = slide.slice();
      caption.fill(sec % 2 ? 0 : 100, 70 * 160);
      expect(detector.sample(caption, sec)).toBeUndefined();
    }
    const changed = slide.slice(); changed.fill(30, 0, 60 * 160);
    expect(detector.sample(changed, 71)).toBeUndefined();
    expect(detector.sample(changed, 72)).toBe('scene');
  });
});
describe('saved settings and speech quality', () => {
  it('upgrades old automatic-English and periodic defaults without losing image preferences', () => {
    const upgraded = normalizeSettings({ language: 'auto', interval: 10, quality: .5, ocr: false });
    expect(upgraded.language).toBe('korean'); expect(upgraded.snapshotMode).toBe('scene');
    expect(upgraded.ignoreBottom).toBe(25); expect(upgraded.quality).toBe(.5); expect(upgraded.ocr).toBe(false);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, language: 'auto', snapshotMode: 'manual' }).language).toBe('auto');
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, snapshotMode: 'manual' }).snapshotMode).toBe('manual');
    expect(normalizeSettings({ interval: -20, ignoreBottom: NaN, keywords: ['화면', 2] }).keywords).toEqual(['화면']);
  });
  it('selects Korean or English from acoustic scores and rejects invalid scores', () => {
    expect(chooseLanguage([-1, 3], 1, 0)).toBe(1);
    expect(chooseLanguage([4, 1], 1, 0)).toBe(0);
    expect(() => chooseLanguage([NaN, 1], 0, 1)).toThrow();
  });
  it('rejects the attached runaway loops while retaining normal repetitions', () => {
    const row = (text: string) => [{ text, timestamp: [0, 30] as [number, number] }];
    expect(transcriptionIssue(row('social and '.repeat(60)), 30)).toBeTruthy();
    expect(transcriptionIssue(row('players who are in a relationship with the '.repeat(30)), 30)).toBeTruthy();
    expect(transcriptionIssue(row('이 개념은 중요합니다. '.repeat(2) + '앞에서 살펴본 수요와 공급을 다시 설명하겠습니다.'), 12)).toBeUndefined();
    expect(transcriptionIssue(row('The price rises, then falls. The price rises, then falls. This example shows a market cycle.'), 12)).toBeUndefined();
  });
  it('splits mixed audio without losing samples or shifting the timeline', () => {
    const audio = new Float32Array(16000 * 15).fill(.1); audio.fill(0, 16000 * 4, 16000 * 4.5);
    const windows = audioWindows(audio, 6);
    expect(windows[0].audio.length / 16000).toBeGreaterThanOrEqual(4);
    expect(windows[0].audio.length / 16000).toBeLessThanOrEqual(4.5);
    expect(windows.reduce((n, w) => n + w.audio.length, 0)).toBe(audio.length);
    for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBeCloseTo(windows[i - 1].start + windows[i - 1].audio.length / 16000);
    expect(windows.every(w => w.audio.length <= 16000 * 6)).toBe(true);
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

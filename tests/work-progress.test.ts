import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Session } from '../src/types';
import { EMPTY_STATS, measuredRate, workProgress } from '../src/lib/work-progress';
import { migratePreferences, normalizeSettings } from '../src/lib/settings';
const lecture: Session = { id: 's', name: '강의', status: 'processing', source: 'screen', duration: 60, createdAt: 0, updatedAt: 0, settings: DEFAULT_SETTINGS, bytes: 1000, asrRate: 4 };
it('separates confirmed progress, failed audio, image bytes and measured ETA', () => {
  const p = workProgress(lecture, { ...EMPTY_STATS, doneSeconds: 30, pendingSeconds: 20, errorSeconds: 10, pending: 4, errors: 2, audioBytes: 800 });
  expect(p).toMatchObject({ percent: 50, total: 60, remaining: 30, eta: 80, imageBytes: 200 });
});
it('does not promise a live lecture end or reuse full-file length after early stop', () => {
  const stats = { ...EMPTY_STATS, doneSeconds: 30, pendingSeconds: 30, pending: 6 };
  expect(workProgress({ ...lecture, status: 'recording' }, stats).eta).toBeUndefined();
  expect(workProgress({ ...lecture, status: 'importing', expectedDuration: 600 }, stats).percent).toBe(5);
  expect(workProgress({ ...lecture, expectedDuration: 600 }, stats).total).toBe(60);
  expect(workProgress({ ...lecture, status: 'complete' }, { ...EMPTY_STATS, doneSeconds: 60 }).percent).toBe(100);
});
it('does not invent a speed before inference or accept broken timing data', () => {
  expect(measuredRate(undefined, 30, undefined)).toBeUndefined();
  expect(measuredRate(undefined, 30, 120000)).toBe(4);
  expect(measuredRate(4, 30, 60000)).toBeCloseTo(3.2);
  expect(measuredRate(4, 30, Infinity)).toBe(4);
  expect(measuredRate(4, 0, 60000)).toBe(4);
});
it('migrates former default capture preferences while preserving custom and archive settings', () => {
  expect(migratePreferences({ schemaVersion: 3, width: 960, quality: .7 })).toMatchObject({ schemaVersion: 4, width: 640, quality: .55 });
  expect(migratePreferences({ schemaVersion: 3, width: 1280, quality: .9 })).toMatchObject({ width: 1280, quality: .9 });
  expect(normalizeSettings({ schemaVersion: 3, width: 960, quality: .7 })).toMatchObject({ width: 960, quality: .7 });
  expect(normalizeSettings({ width: 1920 })).toMatchObject({ width: 1920 });
});

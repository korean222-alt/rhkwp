import { DEFAULT_SETTINGS, type Settings } from '../types';

export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === 'object' ? value as Partial<Settings> : {};
  const s = { ...DEFAULT_SETTINGS, ...raw };
  // Upgrade saved preferences too; changing defaults alone leaves old timers on.
  if (Number(raw.schemaVersion ?? 0) < 2) {
    s.snapshotMode = 'scene';
    s.ignoreBottom = 25;
    if (!raw.language || raw.language === 'auto') s.language = 'korean';
  }
  s.schemaVersion = 3;
  if (!['tiny', 'base', 'small', 'large-v3-turbo'].includes(s.model)) s.model = DEFAULT_SETTINGS.model;
  if (!['auto', 'wasm'].includes(s.device)) s.device = DEFAULT_SETTINGS.device;
  if (!['auto', 'korean', 'english'].includes(s.language)) s.language = DEFAULT_SETTINGS.language;
  if (!['scene', 'interval', 'manual'].includes(s.snapshotMode)) s.snapshotMode = 'scene';
  const bounded = (n: number, min: number, max: number, fallback: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  s.autoStopMinutes = Math.round(bounded(s.autoStopMinutes, 0, 120, 0));
  s.ignoreBottom = bounded(s.ignoreBottom, 0, 40, 25);
  s.sceneThreshold = bounded(s.sceneThreshold, 5, 45, 14);
  s.interval = bounded(s.interval, 5, 60, 10);
  s.width = bounded(s.width, 640, 1280, 960);
  s.quality = bounded(s.quality, .4, .9, .7);
  s.ocrWidth = bounded(s.ocrWidth, 960, 2560, 1920);
  // These legacy fields stay readable for old archives. New captures have no OCR.
  s.saveImages = true;
  s.ocr = false;
  s.keywords = Array.isArray(s.keywords) ? s.keywords.filter((v): v is string => typeof v === 'string') : [...DEFAULT_SETTINGS.keywords];
  return s;
}

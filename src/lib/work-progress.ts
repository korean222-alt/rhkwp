import type { ChunkStats, Session } from '../types';
export const EMPTY_STATS: ChunkStats = { pending: 0, errors: 0, done: 0, pendingSeconds: 0, errorSeconds: 0, doneSeconds: 0, audioBytes: 0 };
export function workProgress(session: Session, stats: ChunkStats) {
  const saved = stats.doneSeconds + stats.pendingSeconds + stats.errorSeconds;
  const live = session.status === 'recording' || session.status === 'importing';
  // A file has a known end; a live tab does not. Never invent a lecture end.
  const total = Math.max(saved, live ? session.expectedDuration || 0 : 0);
  const complete = session.status === 'complete' && stats.errors === 0 && stats.pending === 0;
  const percent = complete ? 100 : total > 0 ? Math.min(99, Math.floor(stats.doneSeconds / total * 100)) : 0;
  const remaining = stats.pendingSeconds + stats.errorSeconds;
  const eta = !live && stats.pendingSeconds > 0 && Number.isFinite(session.asrRate) && session.asrRate! > 0 ? Math.ceil(stats.pendingSeconds * session.asrRate!) : undefined;
  return { percent, total, processed: stats.doneSeconds, remaining, eta, live, imageBytes: Math.max(0, session.bytes - stats.audioBytes) };
}
export function durationLabel(seconds: number) {
  const n = Math.max(0, Math.ceil(seconds));
  if (n < 60) return `${n}초`;
  if (n < 3600) return `${Math.floor(n / 60)}분${n % 60 ? ` ${n % 60}초` : ''}`;
  return `${Math.floor(n / 3600)}시간${Math.floor(n % 3600 / 60) ? ` ${Math.floor(n % 3600 / 60)}분` : ''}`;
}
export function measuredRate(previous: number | undefined, audioSeconds: number, inferenceMs: number | undefined) {
  if (!inferenceMs || !Number.isFinite(inferenceMs) || audioSeconds <= 0) return previous;
  const rate = inferenceMs / 1000 / audioSeconds;
  if (rate <= 0 || rate > 3600) return previous;
  return previous && Number.isFinite(previous) ? previous * .6 + rate * .4 : rate;
}

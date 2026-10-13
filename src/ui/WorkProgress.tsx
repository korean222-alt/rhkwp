import { useEffect, useState } from 'react';
import * as db from '../lib/db';
import { EMPTY_STATS, durationLabel, workProgress } from '../lib/work-progress';
import { size } from '../lib/time';
import type { ChunkStats, EngineState, Session } from '../types';
export function WorkProgress({ session, engine, compact = false, storage = false }: { session: Session; engine?: EngineState; compact?: boolean; storage?: boolean }) {
  const [stats, setStats] = useState<ChunkStats>(), [error, setError] = useState(false);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    setStats(undefined); setError(false);
    if (session.status === 'complete') { setStats({ ...EMPTY_STATS, doneSeconds: session.duration }); return; }
    const refresh = async () => {
      try { const next = await db.chunkStats(session.id); if (active) { setStats(next); setError(false); } }
      catch { if (active) setError(true); }
    };
    void refresh();
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 200); };
    window.addEventListener('lens:changed', changed);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('lens:changed', changed); };
  }, [session.id, session.status]);
  if (!stats) return <p className="small">{error ? '처리 내역을 읽지 못했습니다. 새로고침 후 확인하세요.' : '처리 내역 확인 중…'}</p>;
  const p = workProgress(session, stats), current = engine?.sessionId === session.id;
  return <div className={`work-progress ${compact ? 'work-progress--compact' : ''}`} aria-label={`${session.name} 자막 처리 현황`}>
    <div className="work-progress-title"><strong>{session.status === 'complete' ? '자막 정리 완료' : `자막 처리 ${p.percent}%`}</strong><span>{p.live && !session.expectedDuration ? '현재 저장된 음성 기준' : p.total ? `${durationLabel(p.processed)} / ${durationLabel(p.total)}` : '첫 음성 블록 대기'}</span></div>
    <progress aria-label={`${session.name} 자막 처리율`} max={100} value={p.percent} />
    {session.status !== 'complete' && <p className="small">남은 음성 {durationLabel(p.remaining)}{stats.errors > 0 && ` · 재처리 필요 ${durationLabel(stats.errorSeconds)}`}{p.eta !== undefined ? ` · 처리 예상 약 ${durationLabel(p.eta)}` : stats.pending > 0 ? p.live ? ' · 녹화가 끝나면 예상 시간을 계산합니다' : ' · 예상 시간 계산을 위한 처리 속도 측정 중' : p.live ? ' · 새 음성을 기다리는 중' : ''}</p>}
    {current && engine?.phase === 'model' && <p className="small">음성 모델 준비 중{engine.progress !== undefined ? ` ${Math.round(engine.progress)}%` : ''} · {engine.message}</p>}
    {current && engine?.phase === 'transcribing' && <p className="small">현재 구간 {durationLabel(engine.batchProcessed || 0)} / {durationLabel(engine.batchDuration || 0)} 인식 중</p>}
    {!compact && p.eta !== undefined && <p className="tiny">예상 시간은 최근 처리 속도 기준이며 다른 강의의 대기와 모델 준비·다운로드 시간은 제외합니다.</p>}
    {storage && <div className="lecture-storage"><span>사진 {size(p.imageBytes)}</span><span>임시 음성 {size(stats.audioBytes)}</span>{!compact && <p className="small">성공적으로 자막을 만든 음성은 자동으로 지웁니다. 미처리·실패한 음성은 이어 처리를 위해 남습니다. 표시 용량은 저장한 이미지·음성 기준입니다.</p>}</div>}
  </div>;
}

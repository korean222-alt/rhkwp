import { Image, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { CaptureState } from '../lib/recorder';
import type { EngineState } from '../types';
import { time } from '../lib/time';
export function CaptureMini({ capture, engine, busy, toggle, snapshot, stop }: {
  capture: CaptureState; engine: EngineState; busy: boolean;
  toggle: () => void; snapshot: () => void; stop: () => void;
}) {
  return <main className="mini-capture">
    <div className="mini-top"><strong>LectureLens</strong><span><i className={capture.paused ? 'paused-dot' : 'recording-dot'} />{capture.paused ? '일시 정지' : '녹화 중'}</span></div>
    <div className="mini-clock">{time(capture.elapsed)}</div>
    <p className="mini-source" title={capture.sourceLabel}>{capture.sourceLabel}</p>
    <div className="mini-meter"><Volume2 size={15} /><progress aria-label="들어오는 소리" max={1} value={capture.level} /><small>{capture.hasAudio ? '소리 수신' : '화면만 저장'}</small></div>
    <p className="mini-processing" role="status">{engine.error || engine.message}</p>
    <div className="mini-actions"><button className="button secondary" disabled={busy} onClick={toggle}>{capture.paused ? <Play size={15} /> : <Pause size={15} />}{capture.paused ? '계속' : '일시 정지'}</button><button className="button secondary" disabled={busy || capture.paused} onClick={snapshot}><Image size={15} />장면 저장</button><button className="button stop" disabled={busy} onClick={stop}><Square size={14} />{busy ? '저장 중' : '종료'}</button></div>
    <p className="mini-hint">이 창을 닫아도 녹화는 계속됩니다. 원래 앱 탭은 열어 두세요.</p>
  </main>;
}

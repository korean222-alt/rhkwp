import { Image, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { CaptureState } from '../lib/recorder';
import { SnapshotControls } from './SnapshotControls';
import type { EngineState, Settings, SnapshotSettings } from '../types';
import { time } from '../lib/time';
export function CaptureMini({ capture, engine, busy, toggle, snapshot, stop, settings, snapshotUpdate, snapshotBusy, lectures, activeId, choose }: {
  capture: CaptureState; engine: EngineState; busy: boolean;
  toggle: () => void; snapshot: () => void; stop: () => void; settings: Settings; snapshotUpdate: (patch: Partial<SnapshotSettings>) => void; snapshotBusy: boolean;
  lectures: { id: string; name: string }[]; activeId: string; choose: (id: string) => void;
}) {
  return <main className="mini-capture">
    <div className="mini-top"><strong>LectureLens</strong><span><i className={capture.paused ? 'paused-dot' : 'recording-dot'} />{capture.paused ? '일시 정지' : '녹화 중'}</span></div>
    {lectures.length > 1 ? <label className="mini-lecture-select">조작할 강의<select aria-label="작은 창 강의 선택" value={activeId} onChange={e => choose(e.target.value)}>{lectures.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : <p className="mini-source">{lectures[0]?.name}</p>}
    <div className="mini-clock">{time(capture.elapsed)}</div>
    <p className="mini-source" title={capture.sourceLabel}>{capture.sourceLabel}</p>
    <div className="mini-meter"><Volume2 size={15} /><progress aria-label="들어오는 소리" max={1} value={capture.level} /><small>{capture.hasAudio ? '소리 수신' : '화면만 저장'}</small></div>
    {settings.autoStopMinutes > 0 && <p className="mini-hint">{settings.autoStopMinutes}분 무음 자동 종료 · 현재 {Math.floor(capture.silentSeconds)}초 무음</p>}
    <p className="mini-processing" role="status">{engine.sessionId && engine.sessionId !== activeId ? '다른 강의의 자막을 처리 중 · 이 강의 녹음은 따로 저장됩니다.' : engine.error || engine.message}</p>
    <div className="mini-actions"><button className="button secondary" disabled={busy} onClick={toggle}>{capture.paused ? <Play size={15} /> : <Pause size={15} />}{capture.paused ? '계속' : '일시 정지'}</button><button className="button secondary" disabled={busy || capture.paused} onClick={snapshot}><Image size={15} />장면 저장</button><button className="button stop" disabled={busy} onClick={stop}><Square size={14} />{busy ? '저장 중' : '종료'}</button></div>
    <SnapshotControls compact settings={settings} update={snapshotUpdate} busy={snapshotBusy || busy} />
    <p className="mini-hint">강의 창이 가려지거나 최소화되면 영상이 검게 캡처될 수 있습니다. 원본 영상이 보이게 두고 확인하세요.</p>
    <p className="mini-hint">이 창을 닫아도 녹화는 계속됩니다. 원래 앱 탭은 열어 두세요.</p>
  </main>;
}

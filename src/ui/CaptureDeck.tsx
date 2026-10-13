import { useState } from 'react';
import { Image, MonitorUp, Pause, Play, Plus, Square, Volume2, Pencil } from 'lucide-react';
import type { ActiveCapture } from '../lib/capture-group';
import { MAX_CAPTURES } from '../lib/display';
import type { SnapshotSettings, Folder, Session, EngineState } from '../types';
import { time } from '../lib/time';
import { SnapshotControls } from './SnapshotControls';
import { folderPath } from '../lib/folders';
import { WorkProgress } from './WorkProgress';
function CaptureInfo({ capture: c, folders, update }: { capture: ActiveCapture; folders: Folder[]; update: (patch: { name?: string; folderId?: string }) => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(c.name);
  return <div className="capture-info"><div>{editing ? <form onSubmit={e => { e.preventDefault(); if (draft.trim()) { update({ name: draft.trim() }); setEditing(false); } }}><input autoFocus aria-label={`${c.name} 새 이름`} maxLength={100} value={draft} onChange={e => setDraft(e.target.value)} disabled={c.busy} /><button className="button secondary" disabled={c.busy || !draft.trim()}>이름 저장</button><button type="button" className="text-link" onClick={() => setEditing(false)}>취소</button></form> : <button className="text-link" disabled={c.busy} onClick={() => { setDraft(c.name); setEditing(true); }}><Pencil size={14} /> 이름 변경</button>}</div><label>저장 폴더<select aria-label={`${c.name} 녹화 폴더`} value={c.folderId || ''} disabled={c.busy} onChange={e => update({ folderId: e.target.value || undefined })}><option value="">미분류</option>{folders.map(f => <option value={f.id} key={f.id}>{folderPath(f.id, folders)}</option>)}</select></label></div>;
}

export function CaptureDeck({ captures, name, setName, adding, add, stop, stopAll, toggle, snapshot, update, mini, focus, hidden, folders, folderId, setFolderId, updateInfo, sessions, engine }: {
  captures: ActiveCapture[]; name: string; setName: (value: string) => void; adding: boolean; add: () => void;
  stop: (id: string) => void; stopAll: () => void; toggle: (id: string) => void; snapshot: (id: string) => void;
  update: (id: string, patch: Partial<SnapshotSettings>) => void; mini: (id: string) => void; focus: (id: string) => void; hidden: boolean;
  folders: Folder[]; folderId: string; setFolderId: (id: string) => void; updateInfo: (id: string, patch: { name?: string; folderId?: string }) => void; sessions: Session[]; engine: EngineState;
}) {
  const tabs = captures.every(c => c.source === 'screen' && c.state.isTab && c.state.hasAudio);
  return <div className="capture-deck">
    {captures[0]?.source === 'screen' && <section className="panel parallel-toolbar" aria-label="동시 녹음 관리">
      <div className="section-heading"><div><h2>강의별로 따로 녹음 · {captures.length}/{MAX_CAPTURES}</h2><p className="small">서로 다른 탭에서 영상을 재생하세요. 각 탭의 소리를 분리해 저장하며 자막은 차례로 처리합니다.</p></div>{captures.length > 1 && <button className="button stop" onClick={stopAll} disabled={captures.some(c => c.busy)}>모두 종료·저장</button>}</div>
      <div className="parallel-add"><input aria-label="추가 강의 이름" maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="추가 강의 이름 (선택)" disabled={adding || !tabs || captures.length >= MAX_CAPTURES} /><button className="button primary" onClick={add} disabled={adding || !tabs || captures.length >= MAX_CAPTURES}><Plus size={17} />{adding ? '탭 연결 중…' : '다른 탭 강의 추가'}</button></div>
      <label className="launch-folder">추가 강의 저장 폴더<select aria-label="추가 강의 저장 폴더" value={folderId} onChange={e => setFolderId(e.target.value)} disabled={adding || !tabs || captures.length >= MAX_CAPTURES}><option value="">미분류</option>{folders.map(f => <option key={f.id} value={f.id}>{folderPath(f.id, folders)}</option>)}</select></label>
      <p className="small">{!tabs ? '동시 녹음은 모든 강의를 「Chrome 탭」과 「탭 오디오 공유」로 시작해야 합니다.' : '추가할 때마다 공유 창에서 새 강의 탭과 「탭 오디오 공유」를 선택하세요. 한 탭에서 여러 영상을 틀면 그 소리는 섞입니다.'}</p>
      <p className="small">지원 브라우저에서는 공유한 탭의 스피커 재생을 억제합니다. 영상 플레이어 자체를 음소거하면 녹음도 무음이 될 수 있으니 소리 레벨을 확인하세요.</p>
    </section>}
    {captures.map(c => <section key={c.id} className="capture-panel panel" data-session-id={c.id} aria-label={`${c.name} 녹화`} onFocus={() => focus(c.id)}>
      <div className="section-heading"><div><h3>{c.name}</h3><div className="recording-label"><i className={c.state.paused ? 'paused-dot' : 'recording-dot'} />{c.state.paused ? '일시 정지' : c.source === 'file' ? '파일을 재생하며 가져오는 중' : '강의를 캡처하고 있어요'}</div></div><span className="tag">5초마다 기기에 저장</span></div>
      <CaptureInfo capture={c} folders={folders} update={patch => updateInfo(c.id, patch)} />
      {sessions.find(s => s.id === c.id) && <WorkProgress session={sessions.find(s => s.id === c.id)!} engine={engine} storage />}
      <div className="capture-main"><div><span className="capture-clock">{time(c.state.elapsed)}</span><p>{c.state.sourceLabel}</p></div><div className="audio-meter"><span><Volume2 size={16} /> {c.state.hasAudio ? '들어오는 소리' : '오디오 트랙 없음'}</span><div>{Array.from({ length: 24 }, (_, i) => <i key={i} className={i / 24 < c.state.level ? 'lit' : ''} />)}</div><small>{c.state.hasAudio && c.state.elapsed > 8 && c.state.level < .005 ? '소리가 작거나 무음입니다. 공유 설정을 확인하세요.' : c.state.hasAudio ? c.source === 'file' ? '이 파일의 소리를 처리합니다' : c.state.isTab ? '이 강의 탭의 소리만 수신합니다' : '공유한 소리를 수신합니다' : '탭 오디오 공유를 켜야 자막이 만들어집니다.'}</small></div></div>
      {!c.state.hasAudio && !c.busy && <div className="notice warning">소리가 공유되지 않았습니다. 화면은 저장됩니다. 자막이 필요하면 종료 후 Chrome 탭의 「탭 오디오 공유」를 켜서 다시 시작하세요.</div>}
      {!c.state.background && !c.busy && <div className="notice warning">이 브라우저에서는 백그라운드 화면 저장을 지원하지 않습니다. 최신 PC Chrome 또는 Edge에서 열거나 이 앱을 화면에 띄워 두세요.</div>}
      {hidden && c.state.background && <div className="notice">앱의 백그라운드 녹화는 계속됩니다. 원본 영상이 검게 나오는지 확인하세요.</div>}
      <p className="notice warning">강의 창이 가려지거나 최소화되면 플랫폼에 따라 영상이 검은 화면으로 캡처되거나 캡처되지 않을 수 있습니다. 원본 영상이 보이게 두고 저장된 장면을 확인하세요.</p>
      {c.settings.autoStopMinutes > 0 && <p className="small" role="status">무음 자동 종료: {c.settings.autoStopMinutes}분 · 연속 무음 {Math.floor(c.state.silentSeconds)}초{!c.state.hasAudio && ' · 오디오 공유가 없어 자동 종료하지 않습니다.'}</p>}
      <details className="live-settings"><summary>녹화 중 촬영 설정 변경</summary><p className="small">이 강의에만 적용됩니다. 기존 사진은 유지하며 녹음은 계속됩니다.</p><SnapshotControls settings={c.settings} update={patch => update(c.id, patch)} busy={c.busy} /></details>
      <div className="capture-actions"><button className="button secondary" disabled={c.busy} onClick={() => toggle(c.id)}>{c.state.paused ? <Play size={17} /> : <Pause size={17} />}{c.state.paused ? '계속 녹화' : '일시 정지'}</button><button className="button secondary" disabled={c.busy || c.state.paused} onClick={() => snapshot(c.id)}><Image size={17} /> 장면 저장 <kbd>F9</kbd></button><button className="button secondary" disabled={c.busy} onClick={() => mini(c.id)}><MonitorUp size={17} />작은 상태 창</button><button className="button stop" disabled={c.busy} onClick={() => stop(c.id)}><Square size={15} fill="currentColor" />{c.busy ? '처리 중…' : '종료하고 정리하기'}</button></div>
      <p className="small">{c.source === 'file' ? '파일은 실제 재생 속도로 가져옵니다. 다른 작업을 해도 계속 처리됩니다.' : '앱과 강의 탭을 열어 두세요. 이 강의를 종료해도 다른 강의의 녹음은 계속됩니다. F9는 마지막으로 조작한 강의에 적용됩니다.'}</p>
    </section>)}
  </div>;
}

import { useEffect, useState } from 'react';
import type { SnapshotSettings as Options } from '../types';
export function SnapshotControls({ settings, update, busy = false, compact = false }: {
  settings: Options; update: (patch: Partial<Options>) => void; busy?: boolean; compact?: boolean;
}) {
  const [draft, setDraft] = useState<Partial<Options>>({});
  // Keep the control's clicked value visible while the frame worker and disk
  // acknowledge it. On success/failure, fall back to the authoritative settings.
  useEffect(() => { if (!busy) setDraft({}); }, [busy, settings.snapshotMode, settings.ignoreBottom, settings.sceneThreshold, settings.interval, settings.width, settings.quality, settings.autoStopMinutes]);
  const s = { ...settings, ...draft };
  const set = <K extends keyof Options>(key: K, value: Options[K]) => { setDraft(previous => ({ ...previous, [key]: value })); update({ [key]: value }); };
  return <fieldset className="snapshot-controls" disabled={busy}><label>자동 촬영<select aria-label="자동 촬영" value={s.snapshotMode} onChange={e => set('snapshotMode', e.target.value as Options['snapshotMode'])}><option value="scene">장면 전환만 · 기본</option><option value="manual">끄기 · 수동 저장만</option><option value="interval">장면 전환 + 일정 간격</option></select></label>
    {!compact && <p className="small">{s.snapshotMode === 'manual' ? '자동 사진 저장을 끕니다. 필요할 때 F9 또는 「장면 저장」을 누르세요.' : s.snapshotMode === 'interval' ? '장면 전환과 선택한 간격마다 사진을 저장합니다.' : '처음 화면 1장과 안정된 화면 전환만 저장합니다. 강사 움직임도 화면 변화로 감지될 수 있습니다.'}</p>}
    <div className="form-grid">
      {s.snapshotMode === 'interval' && <label>주기 스냅샷 간격<select aria-label="주기 스냅샷 간격" value={s.interval} onChange={e => set('interval', +e.target.value)}>{[5, 10, 20, 30, 60].map(n => <option key={n} value={n}>{n}초마다</option>)}</select></label>}
      {!compact && <>
        {s.snapshotMode !== 'manual' && <><label>장면 변화 기준 <span className="value">{s.sceneThreshold}</span><input aria-label="장면 변화 기준" type="range" min="5" max="45" value={s.sceneThreshold} onChange={e => set('sceneThreshold', +e.target.value)} /><small>낮게: 슬라이드 강의 · 높게: 움직임이 많은 영상</small></label><label>자막 영역 감지 제외<select aria-label="자막 영역 감지 제외" value={s.ignoreBottom} onChange={e => set('ignoreBottom', +e.target.value)}>{[0, 10, 20, 25, 30, 40].map(n => <option key={n} value={n}>{n === 0 ? '제외 안 함' : `화면 하단 ${n}%`}{n === 25 ? ' · 기본' : ''}</option>)}</select><small>선택한 영역의 자막 변화는 촬영 기준에서 제외합니다. 그 영역에만 있는 슬라이드 변화도 제외되며, 다른 위치의 자막은 감지될 수 있습니다.</small></label></>}
        <label>이미지 가로 크기<select aria-label="이미지 가로 크기" value={s.width} onChange={e => set('width', +e.target.value)}>{[640, 960, 1280, 1920].map(n => <option key={n} value={n}>{n}px{n === 640 ? ' · 용량 절약 기본' : n === 1920 ? ' · 선명하게' : ''}</option>)}</select></label><label>JPEG 품질 <span className="value">{Math.round(s.quality * 100)}%</span><input aria-label="JPEG 품질" type="range" min="40" max="90" value={s.quality * 100} onChange={e => set('quality', +e.target.value / 100)} /></label>
      </>}
    </div>
    {!compact && <p className="small">용량 절약 기본은 640px · JPEG 55%입니다. 작은 글자가 중요하면 해상도를 높이세요. 바꾼 값은 앞으로 찍는 사진에 적용되며 기존 사진은 그대로입니다.</p>}
    <label className="switch-row"><div><strong>무음 자동 종료·저장</strong>{!compact && <p>자막 생성 속도와 관계없이 입력 오디오의 연속 무음을 판단합니다. 음악·잡음은 소리로 감지될 수 있으며, 일시 정지 시간은 제외합니다. 오디오 공유가 있어야 동작합니다.</p>}</div><input type="checkbox" role="switch" aria-label="무음 자동 종료·저장" checked={s.autoStopMinutes > 0} onChange={e => set('autoStopMinutes', e.target.checked ? 5 : 0)} /></label>
    {s.autoStopMinutes > 0 && <label>몇 분 동안 무음이면 종료할까요?<input type="number" min={1} max={120} step={1} aria-label="무음 자동 종료 시간 (분)" value={s.autoStopMinutes} onChange={e => { if (e.target.value) set('autoStopMinutes', Math.max(1, Math.min(120, Math.round(+e.target.value)))); }} /><small>1~120분 · 종료 전에 저장되지 않은 마지막 오디오까지 저장합니다.</small></label>}
  </fieldset>;
}

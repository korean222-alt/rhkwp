import { SnapshotControls } from './SnapshotControls';
import { Download, SlidersHorizontal } from 'lucide-react';
import type { EngineState, Settings, SnapshotSettings } from '../types';
export function SettingsPanel({ settings: s, update, prepare, engine, busy, snapshotUpdate, snapshotBusy, recording }: {
  settings: Settings; update: (s: Settings) => void; prepare: () => void; engine: EngineState; busy: boolean; snapshotUpdate: (patch: Partial<SnapshotSettings>) => void; snapshotBusy: boolean; recording: boolean;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update({ ...s, [key]: value });
  return <div className="page narrow"><div className="page-title"><div className="eyebrow">MAKE IT YOURS</div><h1>내 강의에 맞게</h1><p>음성 모델과 언어는 다음 강의에 적용됩니다. 촬영 설정은 녹화 중에도 바꿀 수 있습니다.</p></div>
    <section className="panel settings-section"><h2><Download size={19} /> 음성 인식 모델</h2>
      <div className="model-options">{(['tiny', 'base', 'small', 'large-v3-turbo'] as const).map((model, i) => <button key={model} className={`model-option ${s.model === model ? 'selected' : ''}`} onClick={() => set('model', model)} disabled={busy} aria-pressed={s.model === model}>
        <span>{model}<small>{['가볍게 시작', '정확도와 속도', '정확도 우선', '상위 음성 모델'][i]}</small></span><i className="radio" />
      </button>)}</div>
      <p className="muted">처음 준비하거나 인식할 때 선택한 모델을 브라우저에 다운로드합니다. 별도 프로그램 설치 없이 같은 브라우저의 캐시를 사용합니다. 모바일과 CPU 환경은 tiny부터 시작하세요. 캐시가 삭제되면 다시 다운로드하며, 인식 정확도와 속도는 음질과 기기에 따라 달라집니다.</p>
      {s.model === 'large-v3-turbo' && <p className="notice warning">상위 모델은 첫 다운로드가 약 0.6~1.1GB이고 RAM·GPU 메모리도 더 사용합니다. WebGPU를 권장하며 CPU에서는 처리 시간이 길어집니다. 음질과 전문 용어에 따라 여전히 오인식할 수 있습니다. 이 모델은 이미지 글자 인식과 별개입니다.</p>}
      <div className="form-grid"><label>처리 장치<select value={s.device} onChange={e => set('device', e.target.value as Settings['device'])} disabled={busy}><option value="auto">자동 · WebGPU 우선</option><option value="wasm">CPU · 호환 모드 (WASM)</option></select></label><label>강의 언어<select aria-label="강의 언어" aria-describedby="language-help" value={s.language} onChange={e => set('language', e.target.value as Settings['language'])} disabled={busy}><option value="korean">한국어 · 기본</option><option value="auto">한국어 + 영어 · 혼합 인식</option><option value="english">영어</option></select><small id="language-help">말한 언어 그대로 자막을 만들며 영어로 번역하지 않습니다. 혼합 인식은 짧은 구간마다 언어를 판별해 처리 시간이 더 걸립니다. 짧은 외국어나 전문 용어는 틀릴 수 있습니다.</small></label></div>
      <button className="button secondary" disabled={busy} onClick={prepare}><Download size={17} /> {engine.phase === 'model' ? '모델 준비 중…' : '모델 미리 준비하기'}</button>
      {engine.phase === 'model' && <div className="progress-block"><span>{engine.message}</span><progress max={100} value={engine.progress} /></div>}
    </section>
    <section className="panel settings-section"><h2><SlidersHorizontal size={19} /> 장면과 스냅샷</h2>
      <p className="small">{recording ? '바꾸면 현재 진행 중인 모든 강의에 적용됩니다. 강의별 변경은 홈의 녹화 카드에서 할 수 있습니다.' : '다음 녹화의 사진 저장에 적용됩니다.'}</p>
      <SnapshotControls settings={s} update={snapshotUpdate} busy={snapshotBusy} />
      <p className="small">강의 화면의 글자를 자동으로 읽지 않습니다. 필요한 스크린샷은 「이미지 → TXT」에서 직접 변환하세요.</p>
    </section>
    <section className="panel settings-section"><h2>화면 단서 키워드</h2><p className="muted">이 말이 나온 시점의 저장된 화면 링크를 통합 노트에 붙입니다. 쉼표로 구분하세요.</p><textarea rows={4} value={s.keywords.join(', ')} onChange={e => set('keywords', e.target.value.split(',').map(v => v.trim()))} aria-label="화면 단서 키워드" /><div className="tag-list">{s.keywords.filter(Boolean).slice(0, 15).map((k, i) => <span key={`${k}:${i}`} className="tag">{k}</span>)}</div></section>
  </div>;
}

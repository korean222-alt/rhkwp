import { Download, Info, SlidersHorizontal } from 'lucide-react';
import type { EngineState, Settings } from '../types';
export function SettingsPanel({ settings: s, update, prepare, engine, busy }: {
  settings: Settings; update: (s: Settings) => void; prepare: () => void; engine: EngineState; busy: boolean;
}) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update({ ...s, [key]: value });
  return <div className="page narrow"><div className="page-title"><div className="eyebrow">MAKE IT YOURS</div><h1>내 강의에 맞게</h1><p>새로 시작하는 녹화에 적용됩니다. 기존 강의의 설정은 유지됩니다.</p></div>
    <section className="panel settings-section"><h2><Download size={19} /> 음성 인식 모델</h2>
      <div className="model-options">{(['tiny', 'base', 'small'] as const).map((model, i) => <button key={model} className={`model-option ${s.model === model ? 'selected' : ''}`} onClick={() => set('model', model)} disabled={busy} aria-pressed={s.model === model}>
        <span>{model}<small>{['가볍게 시작', '정확도와 속도', '정확도 우선'][i]}</small></span><i className="radio" />
      </button>)}</div>
      <p className="muted">첫 실행에는 모델을 다운로드합니다. 이후 같은 브라우저의 캐시를 사용합니다. CPU 환경에서는 tiny를 권장하며, 인식 정확도는 음질과 기기에 따라 달라집니다.</p>
      <div className="form-grid"><label>처리 장치<select value={s.device} onChange={e => set('device', e.target.value as Settings['device'])} disabled={busy}><option value="auto">자동 · WebGPU 우선</option><option value="wasm">CPU · 호환 모드 (WASM)</option></select></label><label>강의 언어<select value={s.language} onChange={e => set('language', e.target.value as Settings['language'])} disabled={busy}><option value="auto">한국어 + 영어 · 자동 인식</option><option value="korean">한국어 우선</option><option value="english">영어 우선</option></select><small>혼합 강의는 자동 인식을 선택하세요. 한 문장 안의 짧은 외국어는 오인식할 수 있습니다.</small></label></div>
      <button className="button secondary" disabled={busy} onClick={prepare}><Download size={17} /> {engine.phase === 'model' ? '모델 준비 중…' : '모델 미리 준비하기'}</button>
      {engine.phase === 'model' && <div className="progress-block"><span>{engine.message}</span><progress max={100} value={engine.progress} /></div>}
    </section>
    <section className="panel settings-section"><h2><SlidersHorizontal size={19} /> 장면과 스냅샷</h2>
      <div className="form-grid"><label>장면 변화 기준 <span className="value">{s.sceneThreshold}</span><input type="range" min="5" max="45" value={s.sceneThreshold} onChange={e => set('sceneThreshold', +e.target.value)} /><small>낮게: 슬라이드 강의 · 높게: 움직임이 많은 영상</small></label><label>주기 스냅샷 간격<select value={s.interval} onChange={e => set('interval', +e.target.value)}>{[5, 10, 20, 30, 60].map(n => <option key={n} value={n}>{n}초마다</option>)}</select></label><label>이미지 가로 크기<select value={s.width} onChange={e => set('width', +e.target.value)}>{[640, 960, 1280].map(n => <option key={n} value={n}>{n}px</option>)}</select></label><label>JPEG 품질 <span className="value">{Math.round(s.quality * 100)}%</span><input type="range" min="40" max="90" value={s.quality * 100} onChange={e => set('quality', +e.target.value / 100)} /></label></div>
      <label className="switch-row"><div><strong>이미지 보관</strong><p>끄면 OCR 처리 후 임시 이미지를 삭제합니다.</p></div><input type="checkbox" role="switch" checked={s.saveImages} onChange={e => set('saveImages', e.target.checked)} /></label>
      <label className="switch-row"><div><strong>한국어 + 영어 OCR</strong><p>장면 전환과 수동 저장 화면에서 글자를 추출합니다.</p></div><input type="checkbox" role="switch" checked={s.ocr} onChange={e => set('ocr', e.target.checked)} /></label>
      {s.ocr && <label>OCR 판독용 임시 해상도<select value={s.ocrWidth} onChange={e => set('ocrWidth', +e.target.value)}>{[960, 1920, 2560].map(n => <option key={n} value={n}>{n}px {n === 1920 ? '· 권장' : ''}</option>)}</select><small>원본 화면 크기를 넘겨 확대하지 않습니다. 고해상도 PNG에서 글자를 읽은 뒤 즉시 삭제하며, 보관용 JPEG 크기와는 별도입니다. OCR 대기 중에는 임시 저장 공간이 필요합니다.</small></label>}
      {!s.saveImages && !s.ocr && <p className="notice warning"><Info size={17} /> 이미지와 OCR이 모두 꺼져 있어 장면 시각만 저장됩니다.</p>}
    </section>
    <section className="panel settings-section"><h2>화면 단서 키워드</h2><p className="muted">이 말이 나온 시점의 화면 글자를 통합 노트에 자동으로 붙입니다. 쉼표로 구분하세요.</p><textarea rows={4} value={s.keywords.join(', ')} onChange={e => set('keywords', e.target.value.split(',').map(v => v.trim()))} aria-label="화면 단서 키워드" /><div className="tag-list">{s.keywords.filter(Boolean).slice(0, 15).map((k, i) => <span key={`${k}:${i}`} className="tag">{k}</span>)}</div></section>
  </div>;
}

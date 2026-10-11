import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Eye, KeyRound, Send, ShieldCheck, Square } from 'lucide-react';
import type { Session, Transcript } from '../types';
import { parseTime, time } from '../lib/time';
import { estimateTokens, estimatedCost, analyze, type AnalysisConfig } from '../lib/analysis';
export function AnalysisPanel({ session, rows }: { session: Session; rows: Transcript[] }) {
  const [key, setKey] = useState(() => localStorage.getItem('lens-ai-key') || sessionStorage.getItem('lens-ai-key') || '');
  const [remember, setRemember] = useState(() => !!localStorage.getItem('lens-ai-key'));
  const [model, setModel] = useState(() => localStorage.getItem('lens-ai-model') || '');
  const [question, setQuestion] = useState('이 강의의 핵심 개념을 근거 시각과 함께 정리해 주세요.');
  const [start, setStart] = useState('00:00:00'), [end, setEnd] = useState(time(session.duration));
  const [images, setImages] = useState(0), [steps, setSteps] = useState(4);
  const [budget, setBudget] = useState(0.5), [inputRate, setInputRate] = useState(3), [outputRate, setOutputRate] = useState(15);
  const [consent, setConsent] = useState(false), [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false), [logs, setLogs] = useState<string[]>([]), [answer, setAnswer] = useState('');
  const [error, setError] = useState(''), [usage, setUsage] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (remember) { localStorage.setItem('lens-ai-key', key); sessionStorage.removeItem('lens-ai-key'); }
    else { sessionStorage.setItem('lens-ai-key', key); localStorage.removeItem('lens-ai-key'); }
  }, [key, remember]);
  let text = '', validRange = false;
  try { const a = parseTime(start), b = parseTime(end); validRange = b > a && b <= session.duration + 1; text = rows.filter(r => r.end >= a && r.start <= b).map(r => `[${time(r.start)}] ${r.text}`).join('\n'); } catch { /* Validation shown on submit. */ }
  const tokens = estimateTokens(text + question);
  const estimate = estimatedCost(tokens + images * 2500, steps * 1600, inputRate, outputRate);
  const run = async () => {
    setError(''); setAnswer(''); setLogs([]); setUsage(''); setBusy(true);
    controller.current = new AbortController();
    try {
      if (!validRange) throw new Error('강의 길이 안에서 시작과 끝 시각을 입력하세요.');
      localStorage.setItem('lens-ai-model', model);
      const cfg: AnalysisConfig = { key, model, question, start: parseTime(start), end: parseTime(end), maxImages: images, maxSteps: steps, budget, inputRate, outputRate };
      const result = await analyze(session.id, cfg, controller.current.signal, message => setLogs(p => [...p, message]));
      setAnswer(result.text); setUsage(`입력 ${result.input.toLocaleString()} · 출력 ${result.output.toLocaleString()} 토큰 · 이미지 ${result.images}장 · 입력한 단가 기준 $${result.cost.toFixed(4)}`);
    } catch (e) { setError(controller.current.signal.aborted ? '분석을 취소했습니다. 이미 전송한 요청에는 요금이 발생할 수 있습니다.' : e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); controller.current = null; }
  };
  return <div className="analysis-layout"><section className="panel settings-section"><div className="section-heading"><h2><KeyRound size={19} /> 내 API 키로 분석</h2><span className="tag">선택 기능</span></div>
    <p className="muted">Claude API를 브라우저에서 직접 호출합니다. Claude 구독과 API 요금은 별도이며, 선택한 자료가 Anthropic으로 전송됩니다.</p>
    <label>Claude API 키<input type="password" value={key} autoComplete="off" placeholder="본인의 API 키" onChange={e => setKey(e.target.value)} disabled={busy} /></label>
    <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={busy} /> 이 기기에 키 기억하기</label>
    {remember && <p className="small warning-text">키가 브라우저에 평문으로 저장됩니다. 공용 PC에서는 사용하지 마세요.</p>}
    <label>모델 ID<input value={model} onChange={e => setModel(e.target.value)} placeholder="Claude 콘솔의 정확한 모델 ID" disabled={busy} /></label>
    <a className="text-link" href="https://platform.claude.com/docs/en/about-claude/models/overview" target="_blank" rel="noreferrer">현재 모델과 단가 확인 <ArrowUpRight size={14} /></a>
    <div className="form-grid"><label>시작 시각<input value={start} onChange={e => { setStart(e.target.value); setConsent(false); }} disabled={busy} /></label><label>끝 시각<input value={end} onChange={e => { setEnd(e.target.value); setConsent(false); }} disabled={busy} /></label><label>이미지 전송 상한<select value={images} onChange={e => { setImages(+e.target.value); setConsent(false); }} disabled={busy}>{[0, 1, 2, 3, 5].map(n => <option key={n} value={n}>{n === 0 ? '이미지 전송 안 함' : `최대 ${n}장`}</option>)}</select></label><label>API 호출 상한<select value={steps} onChange={e => setSteps(+e.target.value)} disabled={busy}>{[2, 4, 6].map(n => <option key={n} value={n}>최대 {n}회</option>)}</select></label></div>
    <details><summary>비용 보호 설정</summary><div className="form-grid"><label>예상 비용 상한 (USD)<input type="number" min="0.01" max="20" step="0.1" value={budget} onChange={e => setBudget(+e.target.value)} disabled={busy} /></label><label>입력 100만 토큰 / USD<input type="number" min="0.01" step="0.1" value={inputRate} onChange={e => setInputRate(+e.target.value)} disabled={busy} /></label><label>출력 100만 토큰 / USD<input type="number" min="0.01" step="0.1" value={outputRate} onChange={e => setOutputRate(+e.target.value)} disabled={busy} /></label></div></details>
    <p className="small">초기 입력 토큰 추정 {tokens.toLocaleString()}개 · 첫 입력 + 최대 출력 추정 ${estimate.toFixed(3)}. 후속 요청은 문맥을 다시 보내므로 비용이 늘어납니다. 단가는 예시값이니 모델 단가에 맞춰 수정하세요. 실제 결제 상한은 API 계정에서도 설정하세요.</p>
  </section><section className="panel settings-section"><h2>강의에 질문하기</h2><label className="sr-only" htmlFor="question">강의 질문</label><textarea id="question" value={question} onChange={e => setQuestion(e.target.value)} rows={4} disabled={busy} />
    <button className="text-link" onClick={() => setPreview(!preview)}><Eye size={16} /> 전송할 자막 확인 {preview ? '닫기' : ''}</button>
    {preview && <pre className="data-preview">{text || '선택한 구간의 자막이 없습니다.'}</pre>}
    <div className="notice"><ShieldCheck size={20} /><div>이 구간의 자막과 AI가 조회한 OCR이 Anthropic으로 전송됩니다.{images > 0 && ` 선택한 구간의 이미지도 최대 ${images}장 전송합니다.`} 오디오와 영상 원본은 전송하지 않습니다.</div></div>
    <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} /> 전송할 자료와 범위를 확인했습니다.</label>
    {busy ? <button className="button secondary" onClick={() => controller.current?.abort()}><Square size={15} /> 분석 취소</button> : <button className="button primary" disabled={!key || !model || !question.trim() || !consent || !validRange || !text} onClick={run}><Send size={16} /> 분석 시작</button>}
    {error && <div role="alert" className="notice warning">{error}</div>}
    {logs.length > 0 && <details open={busy}><summary>조회·전송 기록 ({logs.length})</summary><ol className="analysis-log">{logs.map((l, i) => <li key={i}>{l}</li>)}</ol></details>}
    {answer && <div className="answer"><span className="eyebrow">LECTURE ANSWER</span><p>{answer}</p><small>{usage}</small></div>}
  </section></div>;
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileText, Image, Search, Sparkles, Trash2, RefreshCw, Pencil } from 'lucide-react';
import type { Frame, Session, Transcript } from '../types';
import * as db from '../lib/db';
import { combined } from '../lib/cues';
import { download, exportZip, plain, safeName, srt } from '../lib/exporter';
import { parseTime, size, time } from '../lib/time';
import { selectFrame } from '../lib/scenes';
const AnalysisPanel = lazy(() => import('./AnalysisPanel').then(m => ({ default: m.AnalysisPanel })));
type Meta = Omit<Frame, 'image' | 'ocrImage'>;
function useImage(id?: string) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let current = '', active = true; setUrl('');
    if (id) void db.getFrame(id).then(frame => { if (frame?.image && active) { current = URL.createObjectURL(frame.image); setUrl(current); } });
    return () => { active = false; if (current) URL.revokeObjectURL(current); };
  }, [id]);
  return url;
}
function Thumbnail({ frame, open }: { frame: Meta; open: () => void }) {
  const url = useImage(frame.id);
  return <button className="frame-card" onClick={open}><div className="frame-image">{url ? <img src={url} loading="lazy" alt={`${time(frame.sec)} 강의 화면`} /> : <div className="image-empty"><FileText size={25} /> 이미지 없음</div>}<span className="time-badge">{time(frame.sec)}</span></div><div className="frame-caption"><span>{frame.type === 'manual' ? '수동 저장' : frame.type === 'scene' ? '장면 전환' : '주기 스냅샷'}</span><p>저장된 장면</p></div></button>;
}
function FrameViewer({ frame, close }: { frame: Meta; close: () => void }) {
  const url = useImage(frame.id);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [close]);
  return <div className="modal-backdrop" onClick={close}><div className="modal frame-modal" role="dialog" aria-modal="true" aria-labelledby="frame-title" onClick={e => e.stopPropagation()}><div className="section-heading"><h2 id="frame-title">{time(frame.sec)}의 화면</h2><button autoFocus className="button secondary" onClick={close}>닫기</button></div>{url ? <img className="frame-full" src={url} alt={`${time(frame.sec)} 스냅샷`} /> : <p>이 장면에 보관된 이미지가 없습니다.</p>}</div></div>;
}
export function SessionDetail({ session, back, remove, retry, busy, report }: {
  session: Session; back: () => void; remove: () => void; retry: () => void; busy: boolean; report: (e: unknown) => void;
}) {
  const [rows, setRows] = useState<Transcript[]>([]), [metas, setMetas] = useState<Meta[]>([]);
  const [imageIds, setImageIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState('transcript'), [search, setSearch] = useState(''), [queryTime, setQueryTime] = useState('00:00:00');
  const [view, setView] = useState<Meta>(), [limit, setLimit] = useState(24), [exporting, setExporting] = useState(false), [progress, setProgress] = useState(0), [copied, setCopied] = useState(false);
  const [timeline, setTimeline] = useState(session.showTimeline !== false);
  const [editId, setEditId] = useState(''), [draft, setDraft] = useState('');
  useEffect(() => {
    let active = true, timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const [t, f] = await Promise.all([db.transcripts(session.id), db.frameMeta(session.id)]);
      if (active) { setRows(t); setMetas(f); }
    };
    void refresh().catch(report);
    const change = () => { clearTimeout(timeout); timeout = setTimeout(() => void refresh().catch(report), 500); };
    window.addEventListener('lens:changed', change);
    return () => { active = false; clearTimeout(timeout); window.removeEventListener('lens:changed', change); };
  }, [session.id, report]);
  useEffect(() => {
    let active = true;
    void (async () => { const ids = new Set<string>(); for (const m of metas) if ((await db.getFrame(m.id))?.image) ids.add(m.id); if (active) setImageIds(ids); })();
    return () => { active = false; };
  }, [metas]);
  const note = combined(session.name, rows, metas, session.settings.keywords, imageIds, timeline);
  const filtered = rows.filter(r => r.text.toLowerCase().includes(search.toLowerCase()));
  const frames = metas.filter(f => time(f.sec).toLowerCase().includes(search.toLowerCase()));
  const toggleTimeline = async () => {
    try { const next = !timeline; await db.patchSession(session.id, { showTimeline: next }); setTimeline(next); } catch (e) { report(e); }
  };
  const exportAll = async () => { setExporting(true); setProgress(0); try { await exportZip(session.id, setProgress); } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) report(e); } finally { setExporting(false); } };
  const copy = async () => { try { await navigator.clipboard.writeText(tab === 'notes' ? note : plain(rows, timeline)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { report(new Error('클립보드 권한이 없습니다. 파일 다운로드를 이용하세요.')); } };
  const rename = async () => { const name = window.prompt('강의 이름', session.name); if (name?.trim()) try { await db.patchSession(session.id, { name: name.trim().slice(0, 100) }); } catch (e) { report(e); } };
  return <div className="page"><button className="back-link" onClick={back}><ArrowLeft size={16} /> 내 강의로</button><div className="detail-heading"><div><div className="eyebrow">YOUR LECTURE NOTES</div><h1>{session.name} <button className="icon-button" aria-label="강의 이름 수정" onClick={rename}><Pencil size={17} /></button></h1><p className="muted">{new Date(session.createdAt).toLocaleDateString('ko-KR')} <span>·</span> {time(session.duration)} <span>·</span> {metas.length}개 스냅샷 <span>·</span> {size(session.bytes)} <span>·</span> {session.settings.model}</p></div><div className="actions"><button className="button secondary" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '복사 완료' : '텍스트 복사'}</button><button className="button primary" onClick={exportAll} disabled={exporting || busy}><Download size={17} />{exporting ? `${progress}% 저장 중` : '전체 ZIP 다운로드'}</button></div></div>
    {session.warning && <div className="notice warning">{session.warning}</div>}
    {(session.status === 'interrupted' || session.status === 'processing') && !busy && <div className="recovery"><div><strong>기기에 저장된 자료가 있어요</strong><p>저장된 오디오와 장면부터 다시 처리할 수 있습니다. 화면 공유는 새 녹화에서 다시 선택하세요.</p></div><button className="button secondary" onClick={retry}><RefreshCw size={16} /> 저장된 구간 다시 처리</button></div>}
    {busy && <div className="notice"><span className="spinner" /> 처리 중입니다. 완료된 구간부터 확인할 수 있어요.</div>}
    <div className="tabs" role="tablist" aria-label="강의 자료">{[{ id: 'transcript', title: '자막', icon: FileText, count: rows.length }, { id: 'scenes', title: '장면', icon: Image, count: metas.length }, { id: 'notes', title: '통합 노트', icon: Copy }, { id: 'analysis', title: 'AI 분석', icon: Sparkles }].map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} id={`tab-${t.id}`} onClick={() => setTab(t.id)}><t.icon size={17} />{t.title}{t.count !== undefined && <span>{t.count}</span>}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {(tab === 'transcript' || tab === 'scenes') && <div className="content-toolbar"><label className="search"><Search size={17} /><input placeholder={tab === 'scenes' ? '장면 시각 검색' : '자막에서 검색'} aria-label="자료 검색" value={search} onChange={e => setSearch(e.target.value)} /></label><div className="jump-time"><input aria-label="조회할 시각" value={queryTime} onChange={e => setQueryTime(e.target.value)} placeholder="00:12:30" /><button className="button secondary" onClick={() => { try { const f = selectFrame(metas, parseTime(queryTime)); if (f) setView(f); else throw new Error('이 시각 이전에 저장된 화면이 없습니다.'); } catch (e) { report(e); } }}>시점 화면 보기</button></div></div>}
      {tab === 'transcript' && <section className="panel transcript-panel"><div className="section-heading"><p className="muted">타임라인을 끄면 자막 화면·TXT·복사·통합 노트에서 시간 표시를 숨깁니다. SRT 시간은 유지됩니다.</p><div className="actions"><button className="button secondary" role="switch" aria-label="타임라인" aria-checked={timeline} onClick={() => void toggleTimeline()}>타임라인 {timeline ? '켜짐' : '꺼짐'}</button><button className="text-link" onClick={() => download(new Blob([plain(rows, timeline)], { type: 'text/plain;charset=utf-8' }), `${safeName(session.name)}.txt`)}>TXT <Download size={14} /></button><button className="text-link" onClick={() => download(new Blob([srt(rows)], { type: 'text/plain;charset=utf-8' }), `${safeName(session.name)}.srt`)}>SRT <Download size={14} /></button></div></div>
        {filtered.length === 0 ? <div className="empty"><FileText size={32} /><h3>{search ? '검색 결과가 없어요' : '자막을 기다리고 있어요'}</h3><p>{search ? '다른 검색어로 찾아보세요.' : '소리가 있는 구간이 저장되면 자막이 생성됩니다.'}</p></div> : filtered.map(r => <div className={`transcript-row ${timeline ? '' : 'no-timeline'}`} key={r.id}>{timeline && <button className="timestamp" onClick={() => { const f = selectFrame(metas, r.start); if (f) setView(f); else report(new Error('이 시각에 저장된 화면이 없습니다.')); }}>{time(r.start)}</button>}{editId === r.id ? <div className="edit-row"><textarea autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label="자막 수정" /><button className="button secondary" onClick={async () => { try { if (!draft.trim()) throw new Error('자막을 빈 내용으로 저장할 수 없습니다.'); await db.editTranscript({ ...r, text: draft.trim() }); setEditId(''); } catch (e) { report(e); } }}>저장</button><button className="text-link" onClick={() => setEditId('')}>취소</button></div> : <><p>{r.text}</p><button className="icon-button edit-button" aria-label={`${time(r.start)} 자막 수정`} onClick={() => { setEditId(r.id); setDraft(r.text); }}><Pencil size={15} /></button></>}</div>)}
      </section>}
      {tab === 'scenes' && <><div className="frame-grid">{frames.slice(0, limit).map(f => <Thumbnail key={f.id} frame={f} open={() => setView(f)} />)}</div>{frames.length === 0 && <div className="panel empty"><Image size={32} /><h3>저장된 장면이 없어요</h3><p>화면 녹화 또는 동영상 파일에서 장면을 만들 수 있습니다.</p></div>}{frames.length > limit && <button className="button secondary load-more" onClick={() => setLimit(n => n + 24)}>장면 더 보기 ({frames.length - limit}개)</button>}</>}
      {tab === 'notes' && <section className="panel settings-section"><div className="section-heading"><h2>화면 정보까지 이어진 노트</h2><button className="button secondary" onClick={() => download(new Blob([note], { type: 'text/markdown;charset=utf-8' }), 'combined.md')}><Download size={16} /> Markdown 다운로드</button></div><p className="muted">화면을 가리키는 자막에 저장된 이미지 경로를 붙였습니다. 이미지까지 보려면 전체 ZIP을 받아 압축을 푸세요.</p><pre className="combined-note">{note}</pre></section>}
      {tab === 'analysis' && <Suspense fallback={<div className="panel empty">AI 분석 설정을 여는 중…</div>}><AnalysisPanel session={session} rows={rows} /></Suspense>}
    </div><div className="detail-footer"><ShieldCheckText /><button className="text-link danger" disabled={busy} onClick={remove}><Trash2 size={15} /> 이 강의 삭제</button></div>{view && <FrameViewer frame={view} close={() => setView(undefined)} />}
  </div>;
}
function ShieldCheckText() { return <p className="small">자료는 이 브라우저에 저장됩니다. 브라우저 데이터 삭제 전에 ZIP으로 보관하세요.</p>; }

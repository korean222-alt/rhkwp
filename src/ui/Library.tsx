import { useEffect, useState } from 'react';
import { BookOpen, Clock3, FolderOpen, HardDrive, Plus, Search, Trash2, Pencil } from 'lucide-react';
import type { Folder, Session, Transcript } from '../types';
import * as db from '../lib/db';
import { folderContains, folderPath } from '../lib/folders';
import { size, time } from '../lib/time';
import { WorkProgress } from './WorkProgress';
import type { EngineState } from '../types';
const status = { recording: '녹화 중', importing: '가져오는 중', interrupted: '이어 처리 가능', processing: '처리 대기', complete: '정리 완료' };
export function Library({ sessions, folders, busy, open, newLecture, report, folderId, setFolderId, engine }: {
  sessions: Session[]; folders: Folder[]; busy: boolean; open: (id: string, transcript?: string) => void; newLecture: (folderId?: string) => void; report: (e: unknown) => void;
  folderId: string; setFolderId: (id: string) => void; engine: EngineState;
}) {
  const [query, setQuery] = useState('');
  const [folderName, setFolderName] = useState(''), [adding, setAdding] = useState(false);
  const [matches, setMatches] = useState<Transcript[]>([]), [searching, setSearching] = useState(false);
  const [editId, setEditId] = useState(''), [draft, setDraft] = useState(''), [editing, setEditing] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false), [moveIds, setMoveIds] = useState<Set<string>>(new Set()), [moving, setMoving] = useState(false);
  useEffect(() => { if (!moveOpen) return; const close = (e: KeyboardEvent) => { if (e.key === 'Escape' && !moving) setMoveOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [moveOpen, moving]);
  const sorted = [...folders].sort((a, b) => folderPath(a.id, folders).localeCompare(folderPath(b.id, folders), 'ko'));
  const visible = sessions.filter(s => folderId === '*' || (folderId === '' ? !s.folderId : folderContains(folderId, s.folderId, folders)));
  useEffect(() => {
    let active = true; setMatches([]); setSearching(!!query.trim());
    const timer = setTimeout(() => {
      void db.searchTranscripts(query, new Set(visible.map(s => s.id))).then(rows => { if (active) { setMatches(rows); setSearching(false); } }).catch(e => { if (active) { setSearching(false); report(e); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  // Store refresh updates edited captions; ignore the derived array identity.
  }, [query, folderId, sessions, folders, report]);
  const filtered = visible.filter(s => s.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const children = sorted.filter(f => f.parentId === (folderId === '*' ? undefined : folderId));
  const available = sessions.filter(s => s.folderId !== folderId && !['recording', 'importing'].includes(s.status));
  const rename = async (id: string) => {
    if (!draft.trim() || busy || editing) return;
    setEditing(true);
    try { await db.updateSessionInfo(id, { name: draft }); setEditId(''); } catch (e) { report(e); } finally { setEditing(false); }
  };
  const createFolder = async () => {
    if (!folderName.trim() || busy || adding) return;
    setAdding(true);
    try {
      const parentId = folderId !== '*' && folderId ? folderId : undefined;
      if (folders.some(f => f.parentId === parentId && f.name === folderName.trim())) throw new Error('같은 위치에 같은 이름의 폴더가 있습니다.');
      const id = crypto.randomUUID(); await db.putFolder({ id, name: folderName.trim(), parentId, createdAt: Date.now() });
      setFolderName(''); setFolderId(id);
    } catch (e) { report(e); } finally { setAdding(false); }
  };
  return <div className="page"><div className="page-title"><div className="eyebrow">YOUR KNOWLEDGE LIBRARY</div><h1>내 강의</h1><p>학기·과목별로 정리하고 모든 강의의 자막에서 다시 찾아보세요.</p></div>
    <div className="library-stats"><span><BookOpen size={18} /><strong>{sessions.length}</strong> 강의</span><span><Clock3 size={18} /> 총 {Math.round(sessions.reduce((n, s) => n + s.duration, 0) / 60)}분</span><span><HardDrive size={18} /> {size(sessions.reduce((n, s) => n + s.bytes, 0))} 자료</span></div>
    <section className="panel folder-panel"><label>폴더 보기<select aria-label="폴더 보기" value={folderId} onChange={e => setFolderId(e.target.value)}><option value="*">모든 강의</option><option value="">미분류</option>{sorted.map(f => <option key={f.id} value={f.id}>{folderPath(f.id, folders)}</option>)}</select></label>
      <form className="folder-create" onSubmit={e => { e.preventDefault(); void createFolder(); }}><label>새 폴더 이름<input aria-label="새 폴더 이름" maxLength={100} placeholder="예: 2026년 2학기 / 현재 폴더 아래에 만들기" value={folderName} onChange={e => setFolderName(e.target.value)} disabled={busy || adding} /></label><button className="button secondary" disabled={busy || adding || !folderName.trim()}><Plus size={16} /> 폴더 만들기</button></form>
      {folderId !== '*' && folderId && <button className="text-link danger" disabled={busy} onClick={() => void db.deleteFolder(folderId).then(() => setFolderId('*')).catch(report)}><Trash2 size={14} /> 빈 폴더 삭제</button>}
      <p className="small">폴더를 선택한 뒤 만들면 하위 폴더가 됩니다. 강의의 폴더 선택으로 옮길 수 있습니다. 폴더 보기에는 하위 폴더 강의도 포함합니다.</p>
    </section>
    {children.length > 0 && <div className="subfolder-grid">{children.map(f => <button className="panel subfolder" key={f.id} onClick={() => setFolderId(f.id)}><FolderOpen size={21} /><strong>{f.name}</strong><span>{sessions.filter(s => folderContains(f.id, s.folderId, folders)).length}개 강의</span></button>)}</div>}
    {folderId !== '*' && folderId && <div className="section-heading folder-heading"><div><h2>{folderPath(folderId, folders)}</h2><p className="small">이 폴더에 강의를 이름별로 정리하세요. 동시 녹음한 강의도 각각 보관됩니다.</p></div><button className="button secondary" disabled={busy} onClick={() => { setMoveIds(new Set()); setMoveOpen(true); }}>기존 강의 넣기</button></div>}
    <div className="content-toolbar"><label className="search"><Search size={17} /><input aria-label="강의와 자막 전체 검색" placeholder="강의 이름 또는 자막 내용으로 검색" value={query} onChange={e => setQuery(e.target.value)} /></label><button className="button primary" disabled={busy} onClick={() => newLecture(folderId !== '*' ? folderId : undefined)}><Plus size={17} /> {folderId && folderId !== '*' ? '이 폴더에 새 강의' : '새 강의'}</button></div>
    {filtered.length ? <div className="lecture-grid">{filtered.map(s => <article key={s.id} className="lecture-card panel library-card"><button className="lecture-open" onClick={() => open(s.id)} aria-label={`${s.name} 강의 열기`}><div className="lecture-card-top"><span className="lecture-icon"><BookOpen size={23} /></span><span className={`status ${s.status}`}>{s.source === 'demo' ? '예시 자료' : status[s.status]}</span></div><h3>{s.name}</h3><p>{new Date(s.createdAt).toLocaleDateString('ko-KR')} · {time(s.duration)}</p></button>{editId === s.id ? <form className="lecture-rename" onSubmit={e => { e.preventDefault(); void rename(s.id); }}><input autoFocus maxLength={100} aria-label={`${s.name} 새 이름`} value={draft} disabled={editing} onChange={e => setDraft(e.target.value)} /><button className="button secondary" disabled={editing || !draft.trim()}>이름 저장</button><button type="button" className="text-link" disabled={editing} onClick={() => setEditId('')}>취소</button></form> : <button className="text-link" disabled={busy} aria-label={`${s.name} 이름 변경`} onClick={() => { setEditId(s.id); setDraft(s.name); }}><Pencil size={14} /> 이름 변경</button>}<WorkProgress compact session={s} engine={engine} storage /><label className="small">강의 폴더<select aria-label={`${s.name} 폴더`} disabled={busy} value={s.folderId || ''} onChange={e => void db.updateSessionInfo(s.id, { folderId: e.target.value || undefined }).catch(report)}><option value="">미분류</option>{sorted.map(f => <option key={f.id} value={f.id}>{folderPath(f.id, folders)}</option>)}</select></label></article>)}</div> : !query && <div className="panel empty"><FolderOpen size={32} /><h3>{sessions.length ? '이 폴더에 강의가 없어요' : '아직 저장된 강의가 없어요'}</h3><p>새 강의를 정리하거나 다른 폴더에서 옮겨보세요.</p></div>}
    {query.trim() && <section className="panel settings-section global-results"><h2>자막 검색 결과 {matches.length}개</h2>{searching ? <p role="status">자막을 찾고 있어요…</p> : matches.length ? <><p className="small">최대 80개를 표시합니다. 결과를 누르면 해당 자막으로 이동합니다.</p>{matches.map(r => <button className="search-result" key={r.id} onClick={() => open(r.sessionId, r.id)}><strong>{sessions.find(s => s.id === r.sessionId)?.name} · {time(r.start)}</strong><span>{r.text}</span></button>)}</> : <p>일치하는 자막이 없습니다.</p>}</section>}
    {moveOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="move-title"><h2 id="move-title">기존 강의를 이 폴더에 넣기</h2><p>{folderPath(folderId, folders)}로 옮길 강의를 선택하세요. 자막·사진·시간 정보는 유지하고 중복 복사하지 않습니다.</p><div className="move-list">{available.length ? available.map(s => <label className="check" key={s.id}><input type="checkbox" aria-label={`옮길 강의 ${s.name}`} checked={moveIds.has(s.id)} disabled={moving} onChange={e => setMoveIds(previous => { const next = new Set(previous); if (e.target.checked) next.add(s.id); else next.delete(s.id); return next; })} /><span><strong>{s.name}</strong><small>{folderPath(s.folderId, folders)}</small></span></label>) : <p>다른 폴더나 미분류에 옮길 강의가 없습니다.</p>}</div><div className="actions"><button className="button secondary" disabled={moving} onClick={() => setMoveOpen(false)}>취소</button><button className="button primary" disabled={busy || moving || !moveIds.size} onClick={() => { setMoving(true); void db.moveSessions([...moveIds], folderId).then(() => setMoveOpen(false)).catch(report).finally(() => setMoving(false)); }}>선택한 {moveIds.size}개 강의 넣기</button></div></section></div>}
  </div>;
}

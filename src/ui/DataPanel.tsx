import { useEffect, useRef, useState } from 'react';
import { Download, Upload, Trash2, ShieldCheck } from 'lucide-react';
import type { Session, Settings } from '../types';
import { size } from '../lib/time';
import { exportBackup, inspectBackup, restoreBackup, type BackupPreview } from '../lib/backup';
import { eraseLocalData } from '../lib/erase';
export function DataPanel({ sessions, settings, busy, setWorking, restored, report }: {
  sessions: Session[]; settings: Settings; busy: boolean; setWorking: (v: boolean) => void;
  restored: (settings: Settings) => void; report: (e: unknown) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setLocalWorking] = useState(false), [message, setMessage] = useState('');
  const [preview, setPreview] = useState<BackupPreview>(), [replace, setReplace] = useState(false), [confirm, setConfirm] = useState('');
  const [erase, setErase] = useState(false), [eraseConfirm, setEraseConfirm] = useState('');
  useEffect(() => {
    if (!erase) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape' && !working) setErase(false); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [erase, working]);
  const run = async (task: () => Promise<void>) => {
    if (busy || working) return;
    setLocalWorking(true); setWorking(true); setMessage('자료를 확인하고 있어요…');
    try { await task(); }
    catch (e) { setMessage(''); if (!(e instanceof DOMException && e.name === 'AbortError')) report(e); }
    finally { setLocalWorking(false); setWorking(false); }
  };
  const inspect = (file: File) => {
    setPreview(undefined); setReplace(false); setConfirm('');
    void run(async () => { const p = await inspectBackup(file); setPreview(p); setMessage('백업 내용을 확인했습니다. 아래에서 복원하세요.'); });
  };
  const duplicate = preview?.manifest.sessions.filter(s => sessions.some(current => current.id === s.id)).length || 0;
  return <section className="panel settings-section data-panel"><h2><ShieldCheck size={19} /> 내 데이터 가져가기</h2>
    <p>공용 PC를 떠나기 전에 전체 백업을 받고 자료를 삭제하세요. 새 기기나 새 사이트 주소에서도 이 ZIP을 넣으면 같은 폴더와 강의 자료를 복원할 수 있습니다.</p>
    {busy && <p className="notice">녹화·파일 대기열·음성 처리를 먼저 마쳐 주세요. 저장된 음성 처리는 상단의 일시 중지로 멈춘 뒤 백업할 수 있습니다.</p>}
    <div className="notice"><div><strong>전체 백업 ZIP에 포함되는 자료</strong><p>폴더, 강의 내역, 수정한 자막, 타임라인 설정, 장면 사진, 미처리·실패한 음성, 앱 설정을 담습니다. API 키·모델 캐시·원본 영상·저장되지 않은 AI 답변과 이미지 → TXT 입력은 포함하지 않습니다.</p><p>백업 ZIP은 암호화되지 않습니다. 다른 사람에게 공유하지 말고 개인 저장소에 보관하세요.</p></div></div>
    <div className="actions"><button className="button primary" disabled={busy || working} onClick={() => void run(() => exportBackup(settings, setMessage))}><Download size={17} /> 전체 백업 ZIP 받기</button><button className="button secondary" disabled={busy || working} onClick={() => input.current?.click()}><Upload size={17} /> 백업 ZIP 가져오기</button></div>
    <input ref={input} className="sr-only" aria-label="백업 ZIP 선택" type="file" accept=".zip,application/zip" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) inspect(f); }} />
    <p className="small">강의 안의 「전체 ZIP 다운로드」는 읽기용 자료입니다. 앱 복원에는 여기서 받은 「전체 백업 ZIP」을 사용하세요. 원본 백업을 재압축하지 마세요. 복원은 PC 최대 1GB, 모바일·저사양 기기는 180MB까지 지원합니다. 모델은 필요한 경우 다시 다운로드합니다.</p>
    {message && <p role="status" className="data-status">{working && <span className="spinner" />} {message}</p>}
    {preview && <div className="backup-preview"><h3>복원할 백업</h3><p>{preview.file.name} · {size(preview.file.size)}</p><p>{new Date(preview.manifest.createdAt).toLocaleString('ko-KR')} · {preview.manifest.folders.length}개 폴더 · {preview.manifest.sessions.length}개 강의 · {preview.manifest.frames.length}개 장면</p>
      <ul>{preview.manifest.sessions.slice(0, 5).map(s => <li key={s.id}>{s.name}</li>)}</ul>
      <label className="check"><input type="checkbox" checked={replace} disabled={busy || working} onChange={e => { setReplace(e.target.checked); setConfirm(''); }} /> 현재 폴더와 강의 자료를 백업 내용으로 모두 교체</label>
      {replace ? <><p className="warning-text">현재 {sessions.length}개 강의와 폴더가 삭제되고 이 백업으로 바뀝니다. 필요한 현재 자료는 먼저 백업하세요.</p><label>확인하려면 ‘복원’을 입력하세요<input aria-label="교체 복원 확인" value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy || working} /></label></> : <p className="small">기존 자료를 유지하고 새 강의만 추가합니다. 같은 ID의 강의 {duplicate}개는 중복 추가하지 않습니다. 백업의 앱 설정은 적용하며 API 키는 바꾸지 않습니다.</p>}
      <div className="actions"><button className="button primary" disabled={busy || working || replace && confirm !== '복원'} onClick={() => void run(async () => {
        const result = await restoreBackup(preview, replace, setMessage);
        restored(result.settings); setPreview(undefined); setMessage(`복원 완료 · ${result.imported}개 강의 추가 · 기존 ${result.skipped}개 유지`);
      })}>선택한 백업 복원</button><button className="button secondary" disabled={working} onClick={() => { setPreview(undefined); setMessage(''); }}>닫기</button></div>
    </div>}
    <div className="erase-block"><h3>공용 PC에서 사용을 마쳤나요?</h3><p className="small">이 사이트의 강의·폴더·임시 음성·API 키·설정·모델 캐시를 삭제합니다. 다운로드 폴더에 받은 ZIP과 원본 파일은 직접 정리해야 합니다. 다른 기기의 자료는 지우지 않습니다.</p>
      <button className="button secondary danger" disabled={busy || working} onClick={() => { setErase(true); setEraseConfirm(''); }}><Trash2 size={16} /> 내 데이터 전체 삭제</button>
    </div>
    {erase && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="erase-title"><h2 id="erase-title">이 브라우저의 내 데이터를 지울까요?</h2><p>강의 {sessions.length}개와 폴더, 음성, 사진, API 키, 설정, 모델 캐시를 지웁니다. 백업이 없으면 복구할 수 없습니다. 먼저 ZIP 저장이 완료됐는지 확인하세요.</p><label>삭제하려면 ‘삭제’를 입력하세요<input autoFocus aria-label="전체 삭제 확인" value={eraseConfirm} onChange={e => setEraseConfirm(e.target.value)} disabled={working} /></label><div className="actions"><button className="button secondary" disabled={working} onClick={() => setErase(false)}>취소</button><button className="button stop" disabled={busy || working || eraseConfirm !== '삭제'} onClick={() => void run(async () => {
      const remaining = await eraseLocalData();
      if (remaining.length) sessionStorage.setItem('lens-erase-warning', `강의와 API 키는 삭제했습니다. ${remaining.join(', ')} 삭제를 확인하지 못했습니다. 브라우저의 사이트 데이터 삭제도 실행하세요.`);
      window.location.reload();
    })}>모두 삭제</button></div></section></div>}
  </section>;
}

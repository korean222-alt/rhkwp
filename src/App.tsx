import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, BookOpen, Check, ChevronRight, CircleHelp, Clock3, Download, FileText, FolderOpen, HardDrive, Image, Info, LayoutDashboard, MonitorUp, Pause, Play, Plus, ScanLine, Settings2, ShieldCheck, Sparkles, Square, Upload, Volume2, X } from 'lucide-react';
import * as db from './lib/db';
import { Engine } from './lib/engine';
import { Recorder, type CaptureState } from './lib/recorder';
import { size, time } from './lib/time';
import { createDemo } from './lib/demo';
import { DEFAULT_SETTINGS, type EngineState, type Session, type Settings, type SnapshotSettings } from './types';
import { normalizeSettings } from './lib/settings';
import { SettingsPanel } from './ui/SettingsPanel';
import { SessionDetail } from './ui/SessionDetail';
import { CaptureMini } from './ui/CaptureMini';
import { SnapshotControls } from './ui/SnapshotControls';
const ImageText = lazy(() => import('./ui/ImageText'));
const statusText = { recording: '녹화 중', importing: '가져오는 중', interrupted: '이어 처리 가능', processing: '처리 대기', complete: '정리 완료' };
type View = 'home' | 'library' | 'settings' | 'help' | 'image-text';
function readSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem('lens-settings') || '{}');
    return normalizeSettings(parsed);
  } catch { return DEFAULT_SETTINGS; }
}
export default function App() {
  const [view, setView] = useState<View>('home'), [selected, setSelected] = useState<string>();
  const [sessions, setSessions] = useState<Session[]>([]), [settings, setSettings] = useState<Settings>(readSettings);
  const [name, setName] = useState(''), [search, setSearch] = useState('');
  const [engineState, setEngineState] = useState<EngineState>({ phase: 'idle', message: '준비됐어요', pending: 0 });
  const [capture, setCapture] = useState<CaptureState>(), [captureId, setCaptureId] = useState<string>(), [busy, setBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [queueActive, setQueueActive] = useState(false), [queueNames, setQueueNames] = useState<string[]>([]);
  const fileQueue = useRef<File[]>([]), queueSession = useRef<string | undefined>(undefined), queueLaunching = useRef(false);
  const pendingFiles = useRef<File[]>([]);
  const [toast, setToast] = useState(''), [consent, setConsent] = useState(false), [agreed, setAgreed] = useState(false);
  const [deleting, setDeleting] = useState<string>(), [hidden, setHidden] = useState(document.hidden);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const recorder = useRef<Recorder | undefined>(undefined), engine = useRef<Engine | undefined>(undefined), lockRelease = useRef<(() => void) | undefined>(undefined);
  const pendingFile = useRef<File | undefined>(undefined); const fileInput = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(reason?: string) => Promise<void>>(async () => {});
  const miniWindow = useRef<Window | undefined>(undefined), [miniHost, setMiniHost] = useState<HTMLElement>();
  const report = useCallback((e: unknown) => setToast(e instanceof Error ? e.message : String(e)), []);
  if (!engine.current) engine.current = new Engine(setEngineState);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => { setSessions(await db.listSessions()); setStorage(await navigator.storage?.estimate() || {}); };
    void (async () => {
      const locks = await navigator.locks?.query();
      if (!locks?.held?.some(l => l.name === 'lecturelens-capture')) {
        for (const s of await db.listSessions()) if (s.status === 'recording' || s.status === 'importing') await db.patchSession(s.id, { status: 'interrupted', warning: '캡처가 중단되었습니다. 저장 완료한 구간은 이어서 처리할 수 있습니다. 마지막 최대 5초는 저장되지 않았을 수 있습니다.' });
      }
      await refresh();
    })().catch(report);
    const change = () => { clearTimeout(timer); timer = setTimeout(() => void refresh().catch(report), 350); };
    const visibility = () => setHidden(document.hidden);
    window.addEventListener('lens:changed', change); document.addEventListener('visibilitychange', visibility);
    return () => { clearTimeout(timer); window.removeEventListener('lens:changed', change); document.removeEventListener('visibilitychange', visibility); };
  }, [report]);
  useEffect(() => { localStorage.setItem('lens-settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (recorder.current || engine.current?.isRunning()) { e.preventDefault(); e.returnValue = ''; } };
    const shortcut = (e: KeyboardEvent) => {
      if (e.key === 'F9' && recorder.current) { e.preventDefault(); void recorder.current.snapshot().catch(report); }
      if (e.key === 'Escape') { setConsent(false); setDeleting(undefined); }
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      if (dialog && e.key === 'Tab') {
        const targets = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')];
        const first = targets[0], last = targets.at(-1);
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', shortcut); };
  }, [report]);
  const startRef = useRef<(file?: File, queued?: boolean) => Promise<void>>(async () => {});
  const engineRunning = engine.current.isRunning();
  const capturing = !!capture;
  const activeSession = sessions.find(s => s.id === selected);
  const operating = !!capture || busy || queueActive || engine.current.isRunning();
  const navigate = (v: View) => { setSelected(undefined); setView(v); };
  const holdCaptureLock = async () => {
    if (!navigator.locks) throw new Error('최신 PC Chrome 또는 Edge가 필요합니다.');
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request('lecturelens-capture', { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('다른 탭에서 녹화 중입니다. 녹화를 마친 뒤 다시 시작하세요.')); return; }
        await new Promise<void>(release => { lockRelease.current = release; resolve(); });
      }).catch(reject);
    });
  };
  const cancelQueue = useCallback(() => { fileQueue.current = []; pendingFiles.current = []; setQueueNames([]); setQueueActive(false); }, []);
  const stop = async (automatic = false, reason?: string) => {
    if (!automatic) cancelQueue();
    const current = recorder.current; if (!current || busy) return;
    setBusy(true);
    try { await current.stop(); if (reason && captureId) { await db.patchSession(captureId, { warning: reason }); setToast(reason); } }
    catch (e) { report(e); }
    finally { miniWindow.current?.close(); miniWindow.current = undefined; setMiniHost(undefined); recorder.current = undefined; lockRelease.current?.(); lockRelease.current = undefined; setCapture(undefined); setCaptureId(undefined); setBusy(false); }
    const id = captureId;
    if (id) { setSelected(id); void engine.current!.start(id); }
  };
  stopRef.current = reason => stop(true, reason);
  const start = async (file?: File, queued = false) => {
    if (recorder.current || busy || engine.current!.isRunning() || (queueActive && !queued)) { report(new Error('현재 작업이 끝난 뒤 새 강의를 시작하세요.')); return; }
    if (!file && !Recorder.supported()) { report(new Error('화면 캡처는 HTTPS의 PC Chrome 또는 Edge에서 지원됩니다. 파일 가져오기는 사용할 수 있습니다.')); return; }
    setBusy(true); setToast('');
    let stream: MediaStream | undefined, createdId: string | undefined;
    try {
      // Capture must be the first asynchronous browser call after the button click.
      if (!file) stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: true });
      await holdCaptureLock(); await db.assertStorage();
      const id = crypto.randomUUID(); createdId = id;
      const session: Session = {
        id, name: (!queued && name.trim()) || file?.name.replace(/\.[^.]+$/, '') || `새 강의 ${new Date().toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
        createdAt: Date.now(), updatedAt: Date.now(), status: file ? 'importing' : 'recording',
        duration: 0, settings: { ...settings, keywords: settings.keywords.filter(Boolean) }, source: file ? 'file' : 'screen', bytes: 0,
      };
      await db.putSession(session); if (queued) queueSession.current = id;
      const rec = new Recorder(session, setCapture, reason => { void stopRef.current(reason); }, e => { report(e); if (/저장하지 못했습니다/.test(e.message)) void stop(); });
      recorder.current = rec;
      if (file) await rec.file(file); else await rec.screen(stream!);
      setCapture({ ...rec.state }); setCaptureId(id); setSelected(undefined); setView('home'); setName('');
      if (!rec.state.hasAudio) await db.patchSession(id, { warning: '공유된 오디오 트랙이 없습니다. 화면만 저장됩니다. 자막이 필요하면 녹화를 종료하고 Chrome 탭의 「탭 오디오 공유」를 켜서 다시 시작하세요.' });
      void engine.current!.start(id);
    } catch (e) {
      if (queued) cancelQueue();
      setCapture(undefined); setCaptureId(undefined);
      stream?.getTracks().forEach(t => t.stop()); await recorder.current?.cleanup(); recorder.current = undefined;
      lockRelease.current?.(); lockRelease.current = undefined;
      if (createdId) await db.deleteSession(createdId).catch(() => {});
      if (e instanceof DOMException && e.name === 'NotAllowedError') report(new Error('화면 공유가 취소되었거나 허용되지 않았습니다. 준비되면 다시 시작하세요.'));
      else report(e);
    } finally { setBusy(false); }
  };
  startRef.current = start;
  const beginFiles = (files: File[]) => {
    if (!files.length) return;
    if (files.length > 50) { report(new Error('한 번에 최대 50개 파일을 선택해 주세요.')); return; }
    pendingFiles.current = []; pendingFile.current = undefined;
    fileQueue.current = [...files]; queueSession.current = undefined;
    setQueueNames(files.map(f => f.name)); setQueueActive(true); setSelected(undefined); setView('home');
  };
  const requestStart = (file?: File) => {
    pendingFiles.current = []; pendingFile.current = file;
    if (localStorage.getItem('lens-consent') === '1') void start(file);
    else { setAgreed(false); setConsent(true); }
  };
  const requestFiles = (files: File[]) => {
    pendingFiles.current = files;
    if (localStorage.getItem('lens-consent') === '1') beginFiles(files);
    else { setAgreed(false); setConsent(true); }
  };
  useEffect(() => {
    if (!queueActive || capturing || busy || engineRunning || queueLaunching.current) return;
    let cancelled = false;
    queueLaunching.current = true;
    void (async () => {
      if (queueSession.current) {
        const previous = await db.getSession(queueSession.current);
        if (cancelled) return;
        if (previous?.status !== 'complete') { cancelQueue(); report(new Error('이전 파일 처리가 중단되어 대기열을 멈췄습니다. 저장된 강의를 확인한 뒤 다시 선택하세요.')); return; }
      }
      if (cancelled) return;
      const next = fileQueue.current.shift();
      setQueueNames(fileQueue.current.map(f => f.name));
      if (next) await startRef.current(next, true);
      else { setQueueActive(false); setToast('선택한 파일을 모두 정리했습니다. 내 강의에서 확인하세요.'); }
    })().catch(e => { cancelQueue(); report(e); }).finally(() => { queueLaunching.current = false; });
    return () => { cancelled = true; };
  }, [queueActive, capturing, busy, engineRunning, cancelQueue, report]);
  const snapshotUpdate = (patch: Partial<SnapshotSettings>) => {
    if (snapshotBusy) return;
    const next = normalizeSettings({ ...settings, ...patch });
    setSnapshotBusy(true);
    void (async () => {
      if (recorder.current) await recorder.current.updateSnapshots(next);
      setSettings(previous => ({ ...previous, snapshotMode: next.snapshotMode, ignoreBottom: next.ignoreBottom, sceneThreshold: next.sceneThreshold, interval: next.interval, width: next.width, quality: next.quality, autoStopMinutes: next.autoStopMinutes }));
    })().catch(report).finally(() => setSnapshotBusy(false));
  };
  const resumeProcessing = async (session: Session) => {
    try {
      if (operating) throw new Error('현재 작업을 마친 뒤 다시 처리하세요.');
      await db.retryErrors(session.id);
      await db.patchSession(session.id, { status: 'processing', settings: { ...session.settings, model: settings.model, device: settings.device, language: settings.language }, warning: session.source === 'demo' ? session.warning : undefined });
      void engine.current!.start(session.id);
    } catch (e) { report(e); }
  };
  const demo = async () => { setBusy(true); try { const id = await createDemo(); setSelected(id); } catch (e) { report(e); } finally { setBusy(false); } };
  const prepare = () => { void engine.current!.prepare(settings).catch(report); };
  const toggleCapture = () => { if (recorder.current) void (recorder.current.state.paused ? recorder.current.resume() : recorder.current.pause()).catch(report); };
  const takeSnapshot = () => { if (recorder.current) void recorder.current.snapshot().catch(report); };
  const openMini = async () => {
    type Pip = { requestWindow: (options: { width: number; height: number }) => Promise<Window> };
    const pip = (window as unknown as { documentPictureInPicture?: Pip }).documentPictureInPicture;
    if (!pip) { report(new Error('작은 상태 창은 최신 PC Chrome 또는 Edge에서 사용할 수 있습니다. 지원 브라우저에서 앱을 열어 주세요.')); return; }
    if (miniWindow.current && !miniWindow.current.closed) { miniWindow.current.focus(); return; }
    try {
      const target = await pip.requestWindow({ width: 400, height: 500 });
      target.document.title = 'LectureLens · 녹화 상태';
      for (const style of document.querySelectorAll('style,link[rel="stylesheet"]')) {
        const clone = style.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
        if (style.tagName === 'LINK') (clone as HTMLLinkElement).href = (style as HTMLLinkElement).href;
        target.document.head.appendChild(clone);
      }
      const host = target.document.createElement('div'); target.document.body.appendChild(host);
      miniWindow.current = target; setMiniHost(host);
      target.addEventListener('pagehide', () => { if (miniWindow.current === target) { miniWindow.current = undefined; setMiniHost(undefined); } }, { once: true });
    } catch (e) { report(e); }
  };
  return <div className="app-shell"><aside className="sidebar"><button className="brand" onClick={() => navigate('home')} aria-label="LectureLens 홈"><span className="brand-mark">L<i /></span><span>Lecture<span className="brand-light">Lens</span></span></button><span className="sidebar-caption">내 학습 공간</span>
    <nav aria-label="주 메뉴">{[{ id: 'home', title: '시작하기', icon: LayoutDashboard }, { id: 'library', title: '내 강의', icon: FolderOpen }, { id: 'image-text', title: '이미지 → TXT', icon: ScanLine }, { id: 'settings', title: '설정', icon: Settings2 }].map(n => <button key={n.id} className={`nav-item ${view === n.id && !selected ? 'active' : ''}`} onClick={() => navigate(n.id as View)}><n.icon size={19} /><span>{n.title}</span>{n.id === 'library' && <small>{sessions.length}</small>}</button>)}</nav>
    <button className="sidebar-new" onClick={() => navigate('home')}><Plus size={18} /> 새 강의 정리</button><div className="sidebar-bottom"><div className="local-card"><div><ShieldCheck size={19} /><strong>내 기기에서 처리</strong></div><p>강의 자료와 모델은<br />이 브라우저의 디스크에 보관돼요.</p><span className="tiny" title="브라우저 디스크 사용량입니다. 처리 중 사용하는 RAM 용량과는 다릅니다.">{size(storage.usage ?? 0)} 사용{storage.quota ? ` / ${size(storage.quota)}` : ''}</span><div className="storage-bar"><i style={{ width: `${Math.max(2, Math.min(100, (storage.usage ?? 0) / (storage.quota || 1) * 100))}%` }} /></div></div><button className="nav-item" onClick={() => navigate('help')}><CircleHelp size={18} /> 사용 가이드</button><div className="version">LectureLens <span>v1.1</span></div></div>
  </aside><main><header className="topbar"><div className="breadcrumbs">워크스페이스 <ChevronRight size={14} /> <strong>{selected ? '강의 노트' : { home: '시작하기', library: '내 강의', settings: '설정', help: '사용 가이드', 'image-text': '이미지 → TXT' }[view]}</strong></div><div className="local-pill"><i /> 로컬 처리 <ShieldCheck size={14} /></div></header>
    {toast && <div className="toast" role="alert"><Info size={19} /><p>{toast}</p><button className="icon-button" onClick={() => setToast('')} aria-label="알림 닫기"><X size={18} /></button></div>}
    {engineState.error && engineState.error !== toast && <div className="engine-alert notice warning"><Info size={17} /><div>{engineState.error}</div></div>}
    {(engineState.phase !== 'idle' || engine.current.isRunning()) && <div className="engine-banner" role="status"><span className="spinner" /><span>{engineState.message}</span>{engineState.device && <small>{engineState.device === 'webgpu' ? 'GPU' : 'CPU'}</small>}{engineState.progress !== undefined && <progress max="100" value={engineState.progress} />}{engineState.pending > 0 && <small>{engineState.pending}개 오디오 블록 대기</small>}{!capture && !queueActive && <button className="text-link" onClick={() => engine.current?.pause()}>처리 후 일시 중지</button>}</div>}
    {queueActive && <div className="queue-banner notice" role="status"><div><strong>파일을 순서대로 정리하고 있어요 · 다음 {queueNames.length}개 대기</strong><p className="small">{queueNames.slice(0, 3).join(' → ') || '현재 파일이 끝나면 대기열이 완료됩니다.'} 앱을 열어 두세요. 새로고침하면 아직 시작하지 않은 파일은 다시 선택해야 합니다.</p></div><button className="button secondary" onClick={cancelQueue}>다음 파일 처리 취소</button></div>}
    {activeSession ? <SessionDetail key={activeSession.id} session={activeSession} back={() => navigate('library')} remove={() => setDeleting(activeSession.id)} retry={() => void resumeProcessing(activeSession)} busy={engine.current.isRunning(activeSession.id) || activeSession.id === captureId} report={report} /> : <>
      {view === 'home' && <div className="page home-page"><section className="hero"><div><div className="eyebrow"><span /> FROM LECTURE TO KNOWLEDGE</div><h1>강의는 흐르고,<br />지식은 <em>남도록.</em></h1><p>화면과 소리를 자막과 장면 노트로.<br />AI가 읽기 좋은 학습 자료를 내 기기에서 만드세요.</p><div className="hero-tags"><span><Check size={14} /> 한국어 자막</span><span><Check size={14} /> 이미지 → TXT</span><span><Check size={14} /> 서버 업로드 없음</span></div></div><div className="hero-visual" aria-hidden="true"><div className="visual-top"><span className="dots">● ● ●</span><span>LECTURE → NOTES</span></div><div className="visual-paper"><span className="paper-label">01 / THE BIG IDEA</span><div className="paper-title">배움의 순간을<br />한 장의 노트로.</div><div className="paper-chart"><i /><i /><i /><i /><i /><i /></div></div><div className="floating-note"><ScanLine size={19} /><div><strong>화면과 자막이 연결됩니다</strong><span>[00:12:30] 이 그래프를 보시면…</span></div><span className="note-check"><Check size={15} /></span></div><div className="visual-bottom">{Array.from({ length: 35 }, (_, i) => <i key={i} style={{ height: `${8 + (Math.sin(i * 1.8) + 1) * 12}px` }} />)}</div></div></section>
        {capture ? <section className="capture-panel panel"><div className="section-heading"><div className="recording-label"><i className={capture.paused ? 'paused-dot' : 'recording-dot'} />{capture.paused ? '일시 정지' : recorder.current && sessions.find(s => s.id === captureId)?.source === 'file' ? '파일을 재생하며 가져오는 중' : '강의를 캡처하고 있어요'}</div><span className="tag">5초마다 기기에 저장</span></div><div className="capture-main"><div><span className="capture-clock">{time(capture.elapsed)}</span><p>{capture.sourceLabel}</p></div><div className="audio-meter"><span><Volume2 size={16} /> {capture.hasAudio ? '들어오는 소리' : '오디오 트랙 없음'}</span><div>{Array.from({ length: 24 }, (_, i) => <i key={i} className={i / 24 < capture.level ? 'lit' : ''} />)}</div><small>{capture.hasAudio && capture.elapsed > 8 && capture.level < 0.005 ? '소리가 작거나 무음입니다. 공유 설정을 확인하세요.' : capture.hasAudio ? '녹음 상태를 확인하세요' : '탭 오디오 공유를 켜야 자막이 만들어집니다.'}</small></div></div>
          {!capture.hasAudio && <div className="notice warning">소리가 공유되지 않았습니다. 화면은 저장됩니다. 자막이 필요하면 종료 후 Chrome 탭의 「탭 오디오 공유」를 켜서 다시 시작하세요.</div>}{!capture.background && <div className="notice warning">이 브라우저에서는 백그라운드 화면 저장을 지원하지 않습니다. 최신 PC Chrome 또는 Edge에서 열거나 이 앱을 화면에 띄워 두세요.</div>}{hidden && capture.background && <div className="notice">앱의 백그라운드 녹화는 계속됩니다. 원본 영상이 검게 나오는지 확인하세요.</div>}
          <p className="notice warning">강의 창이 가려지거나 최소화되면 플랫폼에 따라 영상이 검은 화면으로 캡처되거나 캡처되지 않을 수 있습니다. 원본 영상이 보이게 두고 저장된 장면을 확인하세요.</p>
          {settings.autoStopMinutes > 0 && <p className="small" role="status">무음 자동 종료: {settings.autoStopMinutes}분 · 연속 무음 {Math.floor(capture.silentSeconds)}초{!capture.hasAudio && ' · 오디오 공유가 없어 자동 종료하지 않습니다.'}</p>}<details className="live-settings"><summary>녹화 중 촬영 설정 변경</summary><p className="small">다음 사진부터 적용됩니다. 기존 사진은 유지하며 녹음은 계속됩니다.</p><SnapshotControls settings={settings} update={snapshotUpdate} busy={snapshotBusy || busy} /></details>
          <div className="capture-actions"><button className="button secondary" disabled={busy} onClick={toggleCapture}>{capture.paused ? <Play size={17} /> : <Pause size={17} />}{capture.paused ? '계속 녹화' : '일시 정지'}</button><button className="button secondary" disabled={busy || capture.paused} onClick={takeSnapshot}><Image size={17} /> 장면 저장 <kbd>F9</kbd></button><button className="button secondary" disabled={busy} onClick={() => void openMini()}><MonitorUp size={17} />작은 상태 창</button><button className="button stop" disabled={busy} onClick={() => void stop()}><Square size={15} fill="currentColor" />{busy ? '저장하며 종료 중…' : '종료하고 정리하기'}</button></div><p className="small">{sessions.find(s => s.id === captureId)?.source === 'file' ? '파일은 실제 재생 속도로 가져옵니다. 다른 작업을 해도 계속 처리됩니다.' : '공유한 강의 탭의 소리와 화면을 캡처합니다. 플랫폼에 따라 영상이 화면 밖에서 검게 나올 수 있습니다. 작은 상태 창으로 녹화를 제어하세요. 앱과 강의 탭은 열어 두고, 컴퓨터 절전 모드는 꺼 주세요.'}</p></section> : <section className="panel launch-panel"><div className="launch-top"><div><h2>새 강의 정리하기</h2><p>강의를 열고, 화면과 탭 소리를 공유해 주세요.</p></div><span className="tag soft"><MonitorUp size={14} /> PC Chrome · Edge 권장</span></div><label className="sr-only" htmlFor="lecture-name">강의 이름</label><input id="lecture-name" className="lecture-name" maxLength={100} placeholder="강의 이름을 입력하세요 (선택)" value={name} onChange={e => setName(e.target.value)} disabled={operating} /><div className="launch-actions"><button className="button primary large" onClick={() => requestStart()} disabled={operating}><MonitorUp size={20} /> 화면 녹화 시작 <ArrowRight size={18} /></button><button className="button secondary large" onClick={() => fileInput.current?.click()} disabled={operating}><Upload size={18} /> 파일 가져오기 · 여러 개</button><span className="launch-hint">MP4 · WebM · WAV · MP3<br />여러 개 선택하면 순서대로 처리해요</span></div><p className="small">강의 창을 가리거나 최소화하면 영상이 검게 캡처될 수 있습니다. 영상이 보이게 두고 첫 장면을 확인하세요.</p><div className="launch-bottom"><span><Volume2 size={15} /> 화면 선택창에서 <strong>탭 오디오 공유</strong>를 켜 주세요.</span><button className="text-link" disabled={operating} onClick={prepare}><Download size={14} /> 음성 모델 미리 준비</button></div></section>}
        <div className="steps-grid">{[{ icon: MonitorUp, title: '화면과 소리 캡처', text: '영상 전체 대신 필요한 순간의 스냅샷만 가볍게 저장해요.', num: '01' }, { icon: ScanLine, title: '자막 + 장면 노트', text: '말을 자막으로 바꾸고 필요한 순간의 화면을 연결해요.', num: '02' }, { icon: Sparkles, title: 'AI가 읽기 좋은 자료', text: '통합 노트를 다운로드하거나 내 API 키로 질문하세요.', num: '03' }].map(s => <div key={s.num} className="step-card"><div><s.icon size={21} /><span>{s.num}</span></div><h3>{s.title}</h3><p>{s.text}</p></div>)}</div>
        <div className="section-heading recent-heading"><div><h2>최근 강의</h2><p className="muted">정리한 지식, 다시 꺼내보세요.</p></div><button className="text-link" onClick={() => navigate('library')}>전체 보기 <ArrowRight size={15} /></button></div>
        {sessions.length ? <div className="lecture-grid">{sessions.slice(0, 3).map(s => <LectureCard key={s.id} session={s} open={() => setSelected(s.id)} />)}</div> : <div className="panel empty recent-empty"><div className="empty-icon"><BookOpen size={25} /></div><div><h3>첫 강의를 정리해 보세요</h3><p>시작이 궁금하다면 예시 강의로 자막과 노트를 둘러볼 수 있어요.</p></div><button className="button secondary" onClick={() => void demo()} disabled={operating}>예시 강의 둘러보기 <ArrowRight size={15} /></button></div>}
      </div>}
      {view === 'library' && <div className="page"><div className="page-title"><div className="eyebrow">YOUR KNOWLEDGE LIBRARY</div><h1>내 강의</h1><p>자막부터 화면까지, 한곳에서 다시 찾아보세요.</p></div><div className="library-stats"><span><BookOpen size={18} /> <strong>{sessions.length}</strong> 강의</span><span><Clock3 size={18} /> 총 {Math.round(sessions.reduce((s, v) => s + v.duration, 0) / 60)}분</span><span><HardDrive size={18} /> {size(sessions.reduce((s, v) => s + v.bytes, 0))} 자료</span></div><div className="content-toolbar"><label className="search"><FileText size={17} /><input aria-label="강의 이름 검색" placeholder="강의 이름으로 검색" value={search} onChange={e => setSearch(e.target.value)} /></label><button className="button primary" onClick={() => navigate('home')}><Plus size={17} /> 새 강의</button></div>{sessions.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).length ? <div className="lecture-grid">{sessions.filter(s => s.name.toLowerCase().includes(search.toLowerCase())).map(s => <LectureCard key={s.id} session={s} open={() => setSelected(s.id)} />)}</div> : <div className="panel empty"><FolderOpen size={32} /><h3>{search ? '일치하는 강의가 없어요' : '아직 저장된 강의가 없어요'}</h3><p>화면 녹화나 파일 가져오기로 시작해 보세요.</p><button className="button secondary" onClick={() => navigate('home')}>첫 강의 시작하기</button></div>}</div>}
      {view === 'settings' && <SettingsPanel settings={settings} update={setSettings} snapshotUpdate={snapshotUpdate} snapshotBusy={snapshotBusy || busy} recording={!!capture} prepare={prepare} engine={engineState} busy={operating} />}
      {view === 'image-text' && <Suspense fallback={<div className="page">이미지 변환 도구를 여는 중…</div>}><ImageText /></Suspense>}
      {view === 'help' && <Help />}
    </>}
    <footer className="app-footer"><span>LectureLens</span><a href="/third-party-notices.txt" target="_blank" rel="noreferrer">오픈소스 고지</a><p>더 가볍게 정리하고, 더 깊이 이해하세요.</p><span><ShieldCheck size={13} /> 내 기기 우선</span></footer>
  </main><input className="sr-only" type="file" multiple ref={fileInput} accept="video/mp4,video/webm,video/quicktime,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/ogg,.mp4,.webm,.wav,.mp3,.m4a,.ogg" onChange={e => { const files = [...(e.target.files || [])]; if (files.length) requestFiles(files); e.target.value = ''; }} aria-label="강의 파일 선택" />
    {miniHost && capture && createPortal(<CaptureMini capture={capture} engine={engineState} busy={busy} settings={settings} snapshotUpdate={snapshotUpdate} snapshotBusy={snapshotBusy} toggle={toggleCapture} snapshot={takeSnapshot} stop={() => void stop()} />, miniHost)}
    {consent && <div className="modal-backdrop"><section className="modal consent-modal" role="dialog" aria-modal="true" aria-labelledby="consent-title"><div className="consent-icon"><ShieldCheck size={29} /></div><div className="eyebrow">BEFORE YOUR FIRST LECTURE</div><h2 id="consent-title">개인 학습을 위한 공간입니다</h2><p>개인 학습용으로만 사용하세요. 강의 플랫폼 약관과 저작권 준수는 사용자 책임이며, 녹화본과 변환 결과를 타인에게 공유하지 마세요.</p><div className="notice"><HardDrive size={20} /><div>화면·오디오·자막은 기기에 저장됩니다. AI 분석은 별도로 전송 내용을 확인한 뒤 선택할 수 있습니다.</div></div><label className="check"><input autoFocus type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /> 안내를 읽고 개인 학습용으로 사용합니다.</label><div className="actions"><button className="button secondary" onClick={() => setConsent(false)}>취소</button><button className="button primary" disabled={!agreed} onClick={() => { localStorage.setItem('lens-consent', '1'); setConsent(false); if (pendingFiles.current.length) beginFiles(pendingFiles.current); else void start(pendingFile.current); }}>동의하고 시작 <ArrowRight size={16} /></button></div></section></div>}
    {deleting && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">이 강의를 삭제할까요?</h2><p>기기에 저장된 자막, 오디오, 이미지가 삭제됩니다. 필요한 자료는 먼저 ZIP으로 다운로드하세요.</p><div className="actions"><button autoFocus className="button secondary" onClick={() => setDeleting(undefined)}>취소</button><button className="button stop" onClick={async () => { try { await db.deleteSession(deleting); setDeleting(undefined); navigate('library'); } catch (e) { report(e); } }}>강의 삭제</button></div></section></div>}
  </div>;
}
function LectureCard({ session: s, open }: { session: Session; open: () => void }) {
  return <button className="lecture-card panel" onClick={open}><div className="lecture-card-top"><span className={`lecture-icon ${s.source}`}><BookOpen size={23} /></span><span className={`status ${s.status}`}>{s.source === 'demo' ? '예시 자료' : statusText[s.status]}</span></div><h3>{s.name}</h3><p>{new Date(s.createdAt).toLocaleDateString('ko-KR')}</p><div className="lecture-card-footer"><span><Clock3 size={14} />{time(s.duration)}</span><span>{size(s.bytes)}</span><ArrowRight size={16} /></div></button>;
}
function Help() {
  return <div className="page narrow"><div className="page-title"><div className="eyebrow">A LITTLE GUIDANCE</div><h1>처음부터, 차근차근</h1><p>설치 없이 강의를 학습 자료로 정리할 수 있습니다.</p></div><section className="panel settings-section"><h2>화면 녹화 → 자료 다운로드</h2><ol className="help-steps"><li><strong>PC Chrome 또는 Edge에서 강의를 엽니다.</strong><p>이 앱과 강의 탭을 함께 열어 두세요. 모바일에서는 화면 공유가 지원되지 않을 수 있습니다.</p></li><li><strong>「화면 녹화 시작」을 누릅니다.</strong><p>「Chrome 탭」에서 강의 탭을 선택하고 「탭 오디오 공유」를 체크하세요. 창이나 전체 화면의 오디오 지원은 OS에 따라 다릅니다.</p></li><li><strong>소리 레벨을 확인하고 강의를 재생합니다.</strong><p>「작은 상태 창」을 열면 다른 프로그램을 사용하면서도 녹화를 제어할 수 있습니다. 앱과 강의 탭은 닫지 마세요. F9는 앱에 포커스가 있을 때 동작하며, 작은 창의 「장면 저장」도 사용할 수 있습니다.</p></li><li><strong>「종료하고 정리하기」를 누릅니다.</strong><p>남은 자막 처리가 완료되면 전체 ZIP을 받으세요. 자막의 타임라인 버튼으로 시간 표시를 끄고 TXT를 받을 수 있습니다.</p></li></ol></section><section className="panel settings-section"><h2>알아 두면 좋은 점</h2>{[
    ['첫 모델 준비에는 인터넷이 필요해요', '음성 모델을 다운로드하며 이미지 → TXT를 처음 쓸 때는 글자 인식 언어 모델도 다운로드합니다. 모델은 브라우저 캐시에 보관되지만 브라우저가 공간 확보를 위해 삭제할 수 있습니다. 강의 자료를 서버에 업로드하지 않습니다.'],
    ['컴퓨터를 껐다 켜도 저장한 자료는 남아요', '같은 브라우저와 같은 주소로 접속하면 디스크에 저장된 강의를 다시 볼 수 있습니다. 브라우저 데이터 삭제나 저장 공간 정리로 지워질 수 있으니 중요한 결과는 ZIP으로 보관하세요. 처리 중에는 음성 모델과 현재 작업 자료가 RAM도 사용합니다.'],
    ['사진은 기본으로 장면 전환 때만 찍어요', '처음 화면과 안정된 화면 전환만 저장합니다. 하단 25%는 자막 영역으로 보고 변화 감지에서 제외합니다. 제외 범위는 설정에서 조절할 수 있습니다. 움직임이 많은 영상은 「자동 촬영 → 끄기」를 선택하고 필요한 장면만 직접 저장하세요.'],
    ['새로고침 후에는 저장된 구간을 이어 처리해요', '녹화 소스는 다시 공유해야 합니다. 내 강의에서 「저장된 구간 다시 처리」를 누르면 저장된 오디오와 장면을 처리합니다. 새로고침 직전 최대 5초는 저장되지 않았을 수 있습니다.'],
    ['파일 가져오기는 실제 재생 속도로 진행돼요', 'MP4, WebM, WAV, MP3 등 브라우저가 재생하는 코덱을 지원합니다. 여러 파일을 선택하면 한 강의의 녹음·자막 처리가 끝난 뒤 다음 파일로 넘어갑니다. 파일마다 별도 강의로 저장됩니다. 긴 파일도 순차 처리합니다. 파일의 오디오가 없으면 자막이 생성되지 않습니다.'],
    ['화면이 검게 보이면 보호된 영상일 수 있어요', '강의 창이 가려지거나 최소화되면 영상이 검게 캡처되거나 캡처되지 않을 수 있습니다. 플랫폼의 백그라운드 재생 정책이나 보호된 영상도 영향을 줍니다. 원본 영상이 보이게 두고 첫 장면을 확인하세요.'],
    ['자동 인식 결과는 확인해 주세요', '자막은 오인식할 수 있으며 연필 버튼으로 고칠 수 있습니다. 이미지를 직접 넣어 글자를 읽는 기능은 「이미지 → TXT」에 있고 입력과 결과는 저장하지 않습니다. CPU에서는 긴 강의 처리 시간이 길어질 수 있습니다.'],
    ['강의 사이트의 자동 재생과 여러 영상 녹음', '파일 여러 개는 대기열로 순서대로 처리할 수 있습니다. 학교·강의 사이트의 다음 강의 이동은 사이트별 지원이 필요하며 현재 자동으로 조작하지 않습니다. 같은 공유 탭 안에서 다음 영상으로 넘어가면 녹화는 계속됩니다. 여러 영상을 동시에 재생하면 소리가 섞이므로 한 번에 하나씩 재생하세요.'],
    ['브라우저 데이터는 기기마다 달라요', '로그인이나 클라우드 동기화가 없습니다. 다른 기기로 옮기거나 브라우저 데이터를 지우기 전에는 ZIP을 다운로드하세요. 결제 기능은 이 버전에 포함하지 않습니다.'],
  ].map(([title, text]) => <details key={title}><summary>{title}</summary><p>{text}</p></details>)}</section></div>;
}

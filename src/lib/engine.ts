import * as db from './db';
import type { EngineState, Settings, Transcript } from '../types';
import { transcriptionIssue } from './speech';
export class Engine {
  private worker?: Worker;
  private running = false; private stopped = false; private sessionId?: string;
  private onState: (state: EngineState) => void;
  private state: EngineState = { phase: 'idle', message: '처리할 강의를 기다리고 있어요', pending: 0 };
  constructor(onState: (state: EngineState) => void) { this.onState = onState; }
  private report(patch: Partial<EngineState>) { this.state = { ...this.state, ...patch }; this.onState({ ...this.state }); }
  private getWorker() {
    if (!this.worker) this.worker = new Worker(new URL('../workers/transcriber.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }
  private async request(data: object, transfer: Transferable[] = []) {
    const worker = this.getWorker();
    return new Promise<{ chunks?: { text: string; timestamp: [number | null, number | null] }[]; device?: string }>((resolve, reject) => {
      // Models on a CPU can take several minutes. A finite timeout allows recovery.
      const timeout = setTimeout(() => { this.worker?.terminate(); this.worker = undefined; reject(new Error('모델 처리가 15분 이상 응답하지 않았습니다. tiny 모델이나 CPU 모드로 다시 시도하세요.')); }, 15 * 60000);
      worker.onmessage = ({ data: reply }) => {
        if (reply.type === 'progress') { this.report({ phase: 'model', message: reply.message, progress: reply.progress }); return; }
        clearTimeout(timeout);
        if (reply.type === 'error') reject(new Error(reply.message)); else resolve(reply);
      };
      worker.onerror = () => { clearTimeout(timeout); worker.terminate(); this.worker = undefined; reject(new Error('음성 처리 작업이 중단되었습니다. 기기 메모리가 부족할 수 있습니다. tiny 모델로 재시도하세요.')); };
      worker.postMessage(data, transfer);
    });
  }
  async prepare(settings: Settings) {
    if (this.running) throw new Error('강의를 처리 중입니다. 처리가 끝난 뒤 모델을 준비하세요.');
    this.running = true; this.report({ phase: 'model', error: undefined, message: 'Whisper 모델을 기기에 준비하고 있어요' });
    try { const r = await this.request({ type: 'init', settings }); this.report({ phase: 'idle', progress: undefined, device: r.device, message: '모델 준비 완료 · 녹화를 시작할 수 있어요' }); }
    catch (e) { this.report({ phase: 'idle', error: e instanceof Error ? e.message : String(e) }); throw e; }
    finally { this.running = false; }
  }
  isRunning(id?: string) { return this.running && (!id || id === this.sessionId); }
  async start(id: string) {
    if (this.running) return;
    this.running = true; this.stopped = false; this.sessionId = id;
    this.report({ error: undefined, pending: 0 });
    try {
      if (!navigator.locks) throw new Error('이 브라우저는 안전한 이어하기를 지원하지 않습니다. 최신 PC Chrome 또는 Edge를 사용하세요.');
      await navigator.locks.request('lecturelens-processing', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('다른 탭에서 강의를 처리 중입니다. 다른 LectureLens 탭의 작업을 마친 뒤 다시 시도하세요.');
        await this.loop(id);
      });
    } catch (e) { this.report({ error: e instanceof Error ? e.message : String(e), phase: 'idle', message: '저장된 자료는 유지됩니다. 다시 처리할 수 있어요.' }); }
    finally {
      this.running = false; this.sessionId = undefined;
      this.report({ phase: 'idle', progress: undefined }); db.changed();
    }
  }
  private async loop(id: string) {
    while (!this.stopped) {
      const session = await db.getSession(id); if (!session) return;
      const live = session.status === 'recording' || session.status === 'importing';
      const chunks = await db.pendingChunks(id);
      const stats = await db.chunkStats(id); this.report({ pending: stats.pending, progress: undefined });
      const duration = chunks.reduce((s, c) => s + c.duration, 0);
      if (chunks.length && (!live || duration >= 29.9)) {
        const audio = new Float32Array(chunks.reduce((s, c) => s + c.samples.length, 0));
        let offset = 0;
        for (const c of chunks) { audio.set(c.samples, offset); offset += c.samples.length; }
        this.report({ phase: 'transcribing', message: `${Math.floor(chunks[0].start / 60)}분 구간의 자막을 만들고 있어요`, progress: undefined });
        try {
          const reply = await this.request({ type: 'transcribe', settings: session.settings, audio }, [audio.buffer]);
          // Validate again before committing text and releasing its source PCM.
          const issue = transcriptionIssue(reply.chunks ?? [], duration);
          if (issue) throw new Error(`${issue} 원음은 삭제하지 않고 보관합니다. 강의 언어를 확인하거나 다른 모델로 바꾼 뒤 저장된 구간을 다시 처리하세요.`);
          const start = chunks[0].start, end = start + duration;
          const rows: Transcript[] = (reply.chunks ?? []).filter(c => c.text.trim()).map((c, i) => ({
            id: `${chunks[0].id}:t${i}`, sessionId: id,
            start: Math.min(end, start + Math.max(0, c.timestamp[0] ?? 0)),
            end: Math.min(end, start + Math.max(c.timestamp[0] ?? 0, c.timestamp[1] ?? duration)), text: c.text.trim(),
          })).filter(c => c.end > c.start);
          await db.finishChunks(chunks, rows); this.report({ device: reply.device });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await db.failChunks(chunks, message); this.report({ error: message });
          const current = await db.getSession(id);
          if (current) await db.patchSession(id, { warning: message, ...(['recording', 'importing'].includes(current.status) ? {} : { status: 'interrupted' as const }) });
          // Stop retrying a broken model on every chunk; preserve future audio.
          return;
        }
        continue;
      }
      if (!live && chunks.length === 0) {
        const errors = stats.errors;
        await db.patchSession(id, { status: errors ? 'interrupted' : 'complete' });
        this.report({ message: errors ? '실패한 구간을 다시 처리할 수 있어요' : '자막과 장면 정리가 완료됐어요', pending: 0 });
        return;
      }
      this.report({ phase: 'idle', message: live ? '녹화 중 · 저장된 오디오를 모으고 있어요' : '처리 중' });
      // New saved audio/frames wake processing even when hidden-tab timers
      // are throttled. The timeout also covers changes between DB reads.
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); window.removeEventListener('lens:changed', wake); resolve(); };
        const timer = setTimeout(wake, 1000);
        window.addEventListener('lens:changed', wake, { once: true });
      });
    }
    await db.patchSession(id, { status: 'interrupted' });
  }
  pause() { this.stopped = true; }
}

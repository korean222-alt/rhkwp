import * as db from './db';
import { Recorder, type CaptureState } from './recorder';
import { MAX_CAPTURES, validateDisplay } from './display';
import type { Session, Settings, SnapshotSettings } from '../types';

export type ActiveCapture = { id: string; name: string; source: Session['source']; settings: Settings; state: CaptureState; busy: boolean; sourceId: string };
type Entry = { recorder: Recorder; value: ActiveCapture; starting: boolean; ending: boolean; ended: boolean; endReason?: string; actions: Promise<void>; pending: number };

export class CaptureGroup {
  private entries = new Map<string, Entry>();
  private releaseLock?: () => void;
  private adding = false;
  constructor(private changed: (captures: ActiveCapture[]) => void, private completed: (id: string, reason?: string) => void, private error: (e: unknown) => void) {}
  get size() { return this.entries.size; }
  get(id: string) { return this.entries.get(id)?.value; }
  private emit() { this.changed([...this.entries.values()].map(e => ({ ...e.value, state: { ...e.value.state }, settings: { ...e.value.settings } }))); }
  private action(entry: Entry, run: () => Promise<void>) {
    if (entry.starting || entry.ending) return Promise.resolve();
    entry.pending++; entry.value.busy = true; this.emit();
    const operation = entry.actions.then(run);
    entry.actions = operation.catch(() => {});
    return operation.finally(() => {
      entry.pending--; entry.value.busy = entry.ending || entry.pending > 0;
      if (this.entries.has(entry.value.id)) this.emit();
    });
  }
  private releaseIfEmpty() { if (!this.entries.size && !this.adding) { this.releaseLock?.(); this.releaseLock = undefined; } }
  private async holdLock() {
    if (this.releaseLock) return;
    if (!navigator.locks) throw new Error('최신 PC Chrome 또는 Edge가 필요합니다.');
    await new Promise<void>((resolve, reject) => {
      void navigator.locks.request('lecturelens-capture', { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('다른 LectureLens 앱 탭에서 녹화 중입니다. 그 앱의 「다른 탭 강의 추가」를 사용하세요.')); return; }
        await new Promise<void>(release => { this.releaseLock = release; resolve(); });
      }).catch(reject);
    });
  }
  async add(session: Session, source: MediaStream | File) {
    if (this.adding || this.size >= MAX_CAPTURES) throw new Error(`동시 녹화는 최대 ${MAX_CAPTURES}개까지 지원합니다.`);
    this.adding = true; let created = false;
    try {
      const display = source instanceof File ? { sourceId: '', isTab: false } : validateDisplay(source, [...this.entries.values()].map(e => ({ ...e.value, isTab: e.value.state.isTab, hasAudio: e.value.state.hasAudio })));
      await this.holdLock(); await db.assertStorage(); await db.putSession(session); created = true;
      const entry: Entry = { recorder: undefined!, value: { id: session.id, name: session.name, source: session.source, settings: session.settings, state: { elapsed: 0, silentSeconds: 0, level: 0, paused: false, hasAudio: false, sourceLabel: '', background: false, isTab: display.isTab }, busy: true, sourceId: display.sourceId }, starting: true, ending: false, ended: false, actions: Promise.resolve(), pending: 0 };
      entry.recorder = new Recorder(session, state => { entry.value.state = state; if (this.entries.has(session.id)) this.emit(); }, reason => {
        entry.ended = true; entry.endReason = reason;
        if (!entry.starting) void this.stop(session.id, reason);
      }, e => { this.error(e); if (/저장하지 못했습니다/.test(e.message)) { entry.ended = true; entry.endReason = e.message; if (!entry.starting) void this.stop(session.id, e.message); } });
      this.entries.set(session.id, entry); this.emit();
      if (source instanceof File) await entry.recorder.file(source); else await entry.recorder.screen(source);
      entry.starting = false; entry.value.busy = false; entry.value.state = { ...entry.recorder.state }; this.emit();
      if (!entry.value.state.hasAudio) await db.patchSession(session.id, { warning: '공유된 오디오 트랙이 없습니다. 화면만 저장됩니다. 자막이 필요하면 녹화를 종료하고 Chrome 탭의 「탭 오디오 공유」를 켜서 다시 시작하세요.' });
      if (entry.ended) await this.stop(session.id, entry.endReason);
    } catch (e) {
      const entry = this.entries.get(session.id); this.entries.delete(session.id);
      await entry?.recorder.cleanup();
      if (!(source instanceof File)) source.getTracks().forEach(t => t.stop());
      if (created) await db.deleteSession(session.id).catch(() => {});
      this.emit(); throw e;
    } finally { this.adding = false; this.releaseIfEmpty(); }
  }
  async stop(id: string, reason?: string) {
    const entry = this.entries.get(id); if (!entry || entry.ending) return;
    if (entry.starting) { entry.ended = true; entry.endReason = reason; return; }
    entry.ending = true; entry.value.busy = true; this.emit();
    try { await entry.actions; await entry.recorder.stop(); if (reason) await db.patchSession(id, { warning: reason }); }
    catch (e) { this.error(e); }
    finally { this.entries.delete(id); this.releaseIfEmpty(); this.emit(); this.completed(id, reason); }
  }
  async toggle(id: string) {
    const e = this.entries.get(id); if (!e) return;
    await this.action(e, async () => { if (e.recorder.state.paused) await e.recorder.resume(); else await e.recorder.pause(); });
  }
  async snapshot(id: string) {
    const e = this.entries.get(id); if (!e) return;
    await this.action(e, async () => { if (!e.recorder.state.paused) await e.recorder.snapshot(); });
  }
  async update(id: string, patch: Partial<SnapshotSettings>) {
    const e = this.entries.get(id); if (!e) return;
    await this.action(e, async () => { await e.recorder.updateSnapshots(patch); e.value.settings = { ...e.value.settings, ...patch }; });
  }
}

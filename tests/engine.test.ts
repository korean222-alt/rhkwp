import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AudioChunk, type Session, type Transcript } from '../src/types';
const store = vi.hoisted(() => ({ sessions: new Map<string, Session>(), chunks: new Map<string, AudioChunk[]>(), rows: [] as Transcript[] }));
vi.mock('../src/lib/db', () => ({
  getSession: async (id: string) => store.sessions.get(id),
  pendingChunks: async (id: string) => (store.chunks.get(id) || []).filter(c => c.status === 'pending').slice(0, 1),
  chunkStats: async (id: string) => ({ pending: (store.chunks.get(id) || []).filter(c => c.status === 'pending').length, errors: (store.chunks.get(id) || []).filter(c => c.status === 'error').length }),
  patchSession: async (id: string, patch: Partial<Session>) => Object.assign(store.sessions.get(id)!, patch),
  finishChunks: async (chunks: AudioChunk[], rows: Transcript[]) => { store.rows.push(...rows); chunks.forEach(c => { c.status = 'done'; c.samples = new Float32Array(0); }); },
  failChunks: async (chunks: AudioChunk[]) => chunks.forEach(c => { c.status = 'error'; }), changed: vi.fn(),
}));
import { Engine } from '../src/lib/engine';
let order: number[], inFlight: number, peak: number, failA: boolean;
class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  postMessage(data: { audio: Float32Array }) {
    const key = Math.round(data.audio[0] * 100); order.push(key); peak = Math.max(peak, ++inFlight);
    setTimeout(() => { inFlight--; this.onmessage?.({ data: key === 1 && failA ? { type: 'error', message: '강의 A 모델 오류' }
      : { type: 'result', chunks: [{ text: `강의 ${key}의 정상적인 설명입니다.`, timestamp: [0, data.audio.length / 16000] }], device: 'wasm' } }); }, 1);
  }
  terminate() {}
}
function lecture(id: string, key: number, blocks: number, status: Session['status'] = 'processing') {
  store.sessions.set(id, { id, name: id, source: 'screen', status, createdAt: 0, updatedAt: 0, duration: blocks * 30, settings: DEFAULT_SETTINGS, bytes: blocks * 30 * 64000 });
  store.chunks.set(id, Array.from({ length: blocks }, (_, i) => ({ id: `${id}-${i}`, sessionId: id, start: i * 30, duration: 30, status: 'pending', samples: new Float32Array(30 * 16000).fill(key / 100) })));
}
beforeEach(() => {
  store.sessions.clear(); store.chunks.clear(); store.rows = []; order = []; inFlight = 0; peak = 0; failA = false;
  vi.stubGlobal('Worker', FakeWorker); vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: (lock: object) => Promise<void>) => run({}) } });
});
afterEach(() => vi.unstubAllGlobals());
it('rotates isolated lectures fairly with a single model request at a time', async () => {
  lecture('A', 1, 2); lecture('B', 2, 2);
  const engine = new Engine(() => {}), running = engine.start('A'); void engine.start('B'); await running;
  expect(order).toEqual([1, 2, 1, 2]); expect(peak).toBe(1);
  expect(store.rows.filter(r => r.sessionId === 'A').map(r => r.start)).toEqual([0, 30]);
  expect([...store.sessions.values()].map(s => s.status)).toEqual(['complete', 'complete']);
  expect(engine.isRunning()).toBe(false);
});
it('keeps failed lecture audio while another lecture completes', async () => {
  lecture('A', 1, 1); lecture('B', 2, 1); failA = true;
  const engine = new Engine(() => {}), running = engine.start('A'); void engine.start('B'); await running;
  expect(store.sessions.get('A')!.status).toBe('interrupted'); expect(store.chunks.get('A')![0].samples.length).toBe(480000);
  expect(store.sessions.get('B')!.status).toBe('complete'); expect(store.rows.map(r => r.sessionId)).toEqual(['B']);
});
it('finishes a stopped lecture while another live lecture waits for more audio', async () => {
  lecture('live', 1, 0, 'recording'); lecture('stopped', 2, 1);
  let engine: Engine;
  engine = new Engine(() => { if (store.sessions.get('stopped')?.status === 'complete') engine.pause(); });
  const running = engine.start('live'); void engine.start('stopped'); await running;
  expect(order).toEqual([2]); expect(store.sessions.get('stopped')!.status).toBe('complete');
  expect(store.sessions.get('live')!.status).toBe('recording');
});

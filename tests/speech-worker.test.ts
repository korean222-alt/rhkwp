import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/types';

const { pipelineMock } = vi.hoisted(() => ({ pipelineMock: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineMock, env: { backends: { onnx: { wasm: {} } } },
  LogitsProcessor: class {}, LogitsProcessorList: class extends Array {}, Tensor: class {},
}));

const audio = () => new Float32Array(16000 * 30).fill(.01);
const loop = () => ({ chunks: [{ text: '야'.repeat(400), timestamp: [0, 30] }] });
const normal = () => ({ chunks: [{ text: '수요와 공급이 시장의 균형을 결정합니다.', timestamp: [0, 10] }] });
const model = (infer: ReturnType<typeof vi.fn>) => Object.assign(infer, { dispose: vi.fn().mockResolvedValue(undefined) });
let post: ReturnType<typeof vi.fn>;
let worker: { onmessage?: (event: { data: unknown }) => Promise<void> };
beforeEach(() => {
  vi.resetModules(); pipelineMock.mockReset(); post = vi.fn(); worker = {};
  vi.stubGlobal('self', Object.assign(worker, { postMessage: post }));
  vi.stubGlobal('navigator', {});
});
afterEach(() => { vi.unstubAllGlobals(); });

it('retries a Korean character loop in short windows and returns recovered text', async () => {
  const infer = model(vi.fn().mockResolvedValueOnce(loop()).mockImplementation(async () => normal()));
  pipelineMock.mockResolvedValue(infer);
  await import('../src/workers/transcriber');
  await worker.onmessage!({ data: { type: 'transcribe', audio: audio(), settings: { ...DEFAULT_SETTINGS, device: 'wasm' } } });
  expect(infer.mock.calls.map(call => call[0].length / 16000)).toEqual([30, 10, 10, 10]);
  expect(infer.mock.calls[1][1]).toMatchObject({ language: 'korean', task: 'transcribe', repetition_penalty: 1.1 });
  const result = post.mock.calls.map(call => call[0]).find(message => message.type === 'result');
  expect(result.chunks.map((chunk: { timestamp: number[] }) => chunk.timestamp)).toEqual([[0, 10], [10, 20], [20, 30]]);
  expect(JSON.stringify(result)).not.toContain('야야야');
  expect(post.mock.calls.some(call => call[0].type === 'error')).toBe(false);
});

it('reports a persistent character loop without returning invalid text', async () => {
  const infer = model(vi.fn().mockResolvedValue(loop())); pipelineMock.mockResolvedValue(infer);
  await import('../src/workers/transcriber');
  await worker.onmessage!({ data: { type: 'transcribe', audio: audio(), settings: { ...DEFAULT_SETTINGS, device: 'wasm' } } });
  expect(infer).toHaveBeenCalledTimes(2);
  expect(post.mock.calls.some(call => call[0].type === 'result')).toBe(false);
  expect(post.mock.calls.at(-1)![0]).toMatchObject({ type: 'error', message: expect.stringContaining('원음은 삭제하지 않고 보관합니다.') });
});

it('falls back from repeated GPU output to CPU and disposes the GPU model', async () => {
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ features: { has: () => true } }) } });
  const gpu = model(vi.fn().mockResolvedValue(loop())), cpu = model(vi.fn().mockImplementation(async () => normal()));
  pipelineMock.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
  await import('../src/workers/transcriber');
  await worker.onmessage!({ data: { type: 'transcribe', audio: audio(), settings: DEFAULT_SETTINGS } });
  expect(gpu).toHaveBeenCalledTimes(2); expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(pipelineMock.mock.calls.map(call => call[2].device)).toEqual(['webgpu', 'wasm']);
  expect(cpu).toHaveBeenCalledTimes(3);
  expect(post.mock.calls.at(-1)![0]).toMatchObject({ type: 'result', device: 'wasm' });
});

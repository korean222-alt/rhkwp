import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { hasSpeech } from '../lib/vad';
import type { Settings } from '../types';
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
// Keep the JS factory embedded by the bundler; only the binary needs a URL.
// A public .mjs import is rejected by Vite's development import middleware.
env.backends.onnx.wasm!.wasmPaths = { wasm: '/vendor/onnx/ort-wasm-simd-threaded.jsep.wasm' };
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let identity = '';
let device = 'wasm';
async function load(settings: Settings) {
  const nextIdentity = `${settings.model}:${settings.device}`;
  if (transcriber && identity === nextIdentity) return;
  if (transcriber) { await transcriber.dispose(); transcriber = undefined; }
  device = settings.device === 'auto' && 'gpu' in navigator && await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter() ? 'webgpu' : 'wasm';
  const progress_callback = (p: { status: string; progress?: number; file?: string }) => self.postMessage({ type: 'progress', message: p.file || 'Whisper 모델 준비', progress: p.progress });
  const model = `onnx-community/whisper-${settings.model}`;
  try {
    transcriber = await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', model, {
      device: device as 'wasm' | 'webgpu', dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8', progress_callback,
    });
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    self.postMessage({ type: 'progress', message: 'GPU 초기화에 실패해 CPU 모드로 전환합니다.' });
    transcriber = await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback });
  }
  identity = nextIdentity;
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await load(data.settings); self.postMessage({ type: 'ready', device });
    } else if (data.type === 'transcribe') {
      const audio = data.audio as Float32Array;
      if (!hasSpeech(audio)) { self.postMessage({ type: 'result', chunks: [], device }); return; }
      await load(data.settings);
      const result = await transcriber!(audio, {
        ...(data.settings.language === 'auto' ? {} : { language: data.settings.language }),
        task: 'transcribe', return_timestamps: true,
        chunk_length_s: 30, stride_length_s: 2,
      });
      const out = Array.isArray(result) ? result[0] : result;
      self.postMessage({ type: 'result', chunks: out.chunks?.length ? out.chunks : (out.text?.trim() ? [{ text: out.text, timestamp: [0, audio.length / 16000] }] : []), device });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: `음성 모델 처리에 실패했습니다. ${error instanceof Error ? error.message : String(error)}. 네트워크와 저장 공간을 확인하거나 설정에서 tiny / CPU 모드를 선택하세요.` });
  }
};

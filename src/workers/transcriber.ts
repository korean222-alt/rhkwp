import { pipeline, env, LogitsProcessor, LogitsProcessorList, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { hasSpeech } from '../lib/vad';
import { audioWindows, chooseLanguage, transcriptionIssue, type SpeechChunk } from '../lib/speech';
import type { Settings } from '../types';
env.allowLocalModels = false;
env.backends.onnx.wasm!.numThreads = 1;
// Keep the JS factory embedded by the bundler; only the binary needs a URL.
// A public .mjs import is rejected by Vite's development import middleware.
env.backends.onnx.wasm!.wasmPaths = { wasm: '/vendor/onnx/ort-wasm-simd-threaded.jsep.wasm' };
let transcriber: AutomaticSpeechRecognitionPipeline | undefined;
let identity = '';
let device = 'wasm';
let avoidGpu = false;
async function load(settings: Settings) {
  const nextIdentity = `${settings.model}:${settings.device}`;
  if (transcriber && identity === nextIdentity) return;
  if (transcriber) { await transcriber.dispose(); transcriber = undefined; }
  const adapter = !avoidGpu && settings.device === 'auto' && 'gpu' in navigator ? await (navigator as Navigator & { gpu: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> } }).gpu.requestAdapter() : null;
  device = !avoidGpu && adapter ? 'webgpu' : 'wasm';
  const progress_callback = (p: { status: string; progress?: number; file?: string }) => self.postMessage({ type: 'progress', message: p.file || 'Whisper 모델 준비', progress: p.progress });
  const model = `onnx-community/whisper-${settings.model}`;
  try {
    transcriber = await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', model, {
      device: device as 'wasm' | 'webgpu', dtype: device === 'wasm' ? 'q8' : settings.model === 'large-v3-turbo' ? (adapter?.features.has('shader-f16') ? 'q4f16' : 'q4') : { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback,
    });
  } catch (error) {
    if (device !== 'webgpu') throw error;
    device = 'wasm';
    self.postMessage({ type: 'progress', message: 'GPU 초기화에 실패해 CPU 모드로 전환합니다.' });
    transcriber = await pipeline<'automatic-speech-recognition'>('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8', progress_callback });
  }
  identity = nextIdentity;
}

class LanguageOnly extends LogitsProcessor {
  constructor(private koreanId: number, private englishId: number) { super(); }
  _call(_ids: bigint[][], logits: Tensor) {
    const scores = logits.data as Float32Array;
    const winner = chooseLanguage(scores, this.koreanId, this.englishId);
    scores.fill(-Infinity); scores[winner] = 0;
    return logits;
  }
}
async function detectLanguage(audio: Float32Array): Promise<'korean' | 'english'> {
  // Transformers.js 3.8.1 does not detect languages when language is omitted:
  // _retrieve_init_tokens falls back to English. Predict the language token
  // from audio ourselves, as Whisper's detect_language does, limited to ko/en.
  const model = transcriber!.model;
  const config = model.generation_config as unknown as { decoder_start_token_id: number; lang_to_id: Record<string, number> };
  const ko = config.lang_to_id['<|ko|>'], en = config.lang_to_id['<|en|>'];
  if (!Number.isInteger(ko) || !Number.isInteger(en)) throw new Error('혼합 언어 감지를 지원하지 않는 모델입니다. 강의 언어를 직접 선택하세요.');
  const features = await transcriber!.processor(audio);
  const processors = new LogitsProcessorList(); processors.push(new LanguageOnly(ko, en));
  let tokens: Tensor | undefined;
  try {
    const options = { inputs: features.input_features, decoder_input_ids: [config.decoder_start_token_id],
      max_new_tokens: 1, return_timestamps: false, begin_suppress_tokens: [], logits_processor: processors };
    tokens = await model.generate(options) as Tensor;
    const id = Number(tokens.tolist()[0].at(-1));
    if (id !== ko && id !== en) throw new Error('음성 언어를 판별하지 못했습니다. 강의 언어를 직접 선택하세요.');
    return id === ko ? 'korean' : 'english';
  } finally { tokens?.dispose(); features.input_features.dispose(); }
}
async function transcribe(audio: Float32Array, settings: Settings, retry = false): Promise<SpeechChunk[]> {
  const output: SpeechChunk[] = [];
  // Mixed speech gets short windows and a fresh acoustic language decision.
  const windows = audioWindows(audio, settings.language === 'auto' ? 6 : retry ? 10 : 30);
  for (const part of windows) {
    if (!hasSpeech(part.audio)) continue;
    const language = settings.language === 'auto' ? await detectLanguage(part.audio) : settings.language;
    const duration = part.audio.length / 16000;
    const result = await transcriber!(part.audio, {
      language, task: 'transcribe', return_timestamps: true,
      chunk_length_s: 30, stride_length_s: 2, repetition_penalty: retry ? 1.1 : 1.03,
      max_new_tokens: Math.min(440, Math.ceil(duration * 14) + 48),
    });
    const out = Array.isArray(result) ? result[0] : result;
    const chunks: SpeechChunk[] = out.chunks?.length ? out.chunks : out.text?.trim() ? [{ text: out.text, timestamp: [0, duration] }] : [];
    const issue = transcriptionIssue(chunks, duration);
    if (issue) throw new SpeechQualityError(issue);
    output.push(...chunks.map(c => ({ text: c.text, timestamp: [part.start + Math.max(0, c.timestamp[0] ?? 0), part.start + Math.min(duration, c.timestamp[1] ?? duration)] as [number, number] })));
  }
  const issue = transcriptionIssue(output, audio.length / 16000);
  if (issue) throw new SpeechQualityError(issue);
  return output;
}
class SpeechQualityError extends Error {}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await load(data.settings); self.postMessage({ type: 'ready', device });
    } else if (data.type === 'transcribe') {
      const audio = data.audio as Float32Array;
      if (!hasSpeech(audio)) { self.postMessage({ type: 'result', chunks: [], device }); return; }
      await load(data.settings);
      let chunks: SpeechChunk[];
      try { chunks = await transcribe(audio, data.settings); }
      catch (e) {
        if (!(e instanceof SpeechQualityError)) throw e;
        self.postMessage({ type: 'progress', message: '반복 오류를 감지해 짧은 구간으로 다시 인식합니다.' });
        try { chunks = await transcribe(audio, data.settings, true); }
        catch (retryError) {
          if (!(retryError instanceof SpeechQualityError) || device !== 'webgpu') throw retryError;
          avoidGpu = true; await load({ ...data.settings, device: 'wasm' });
          self.postMessage({ type: 'progress', message: '반복 오류가 지속되어 CPU로 다시 인식합니다.' });
          chunks = await transcribe(audio, data.settings, true);
        }
      }
      self.postMessage({ type: 'result', chunks, device });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', message: error instanceof SpeechQualityError
      ? `${detail} 원음은 삭제하지 않고 보관합니다. 설정에서 강의 언어를 확인하고 base 모델로 바꾼 뒤 저장된 구간을 다시 처리하세요.`
      : `음성 모델 처리에 실패했습니다. ${detail}. 네트워크와 저장 공간을 확인하거나 CPU 모드로 다시 처리하세요.` });
  }
};

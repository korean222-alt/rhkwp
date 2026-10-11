export type ModelSize = 'tiny' | 'base' | 'small';
export type Settings = {
  schemaVersion: 2;
  model: ModelSize; device: 'auto' | 'wasm'; language: 'auto' | 'korean' | 'english';
  snapshotMode: 'scene' | 'interval' | 'manual'; ignoreBottom: number;
  sceneThreshold: number; interval: number; width: number; quality: number;
  saveImages: boolean; ocr: boolean; ocrWidth: number; keywords: string[];
};
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 2, model: 'tiny', device: 'auto', language: 'korean', sceneThreshold: 14,
  snapshotMode: 'scene', ignoreBottom: 25,
  interval: 10, width: 960, quality: 0.7, saveImages: true, ocr: true, ocrWidth: 1920,
  keywords: ['보시면', '보이시죠', '이 그래프', '이 그림', '이 표', '여기', '화면', '슬라이드', '아래에', '위에', '다음 페이지', '예시'],
};
export type Session = {
  id: string; name: string; createdAt: number; updatedAt: number;
  status: 'recording' | 'importing' | 'interrupted' | 'processing' | 'complete';
  duration: number; settings: Settings; source: 'screen' | 'file' | 'demo';
  bytes: number; warning?: string;
};
export type AudioChunk = {
  id: string; sessionId: string; start: number; duration: number;
  samples: Float32Array; status: 'pending' | 'done' | 'error'; error?: string;
};
export type Transcript = {
  id: string; sessionId: string; start: number; end: number; text: string;
};
export type Frame = {
  id: string; sessionId: string; sec: number; sceneId: string;
  type: 'scene' | 'periodic' | 'manual'; image?: Blob; ocrImage?: Blob;
  ocr: string; ocrStatus: 'pending' | 'done' | 'error' | 'off';
};
export type EngineState = {
  phase: 'idle' | 'model' | 'transcribing' | 'ocr'; message: string;
  progress?: number; pending: number; error?: string; device?: string;
};

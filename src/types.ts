export type ModelSize = 'tiny' | 'base' | 'small' | 'large-v3-turbo';
export type Settings = {
  schemaVersion: 4;
  model: ModelSize; device: 'auto' | 'wasm'; language: 'auto' | 'korean' | 'english';
  autoStopMinutes: number;
  snapshotMode: 'scene' | 'interval' | 'manual'; ignoreBottom: number;
  sceneThreshold: number; interval: number; width: number; quality: number;
  saveImages: boolean; ocr: boolean; ocrWidth: number; keywords: string[];
};
export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 4, model: 'tiny', device: 'auto', language: 'korean', sceneThreshold: 14,
  snapshotMode: 'scene', ignoreBottom: 25, autoStopMinutes: 0,
  interval: 10, width: 640, quality: 0.55, saveImages: true, ocr: false, ocrWidth: 1920,
  keywords: ['보시면', '보이시죠', '이 그래프', '이 그림', '이 표', '여기', '화면', '슬라이드', '아래에', '위에', '다음 페이지', '예시'],
};
export type Session = {
  id: string; name: string; createdAt: number; updatedAt: number;
  status: 'recording' | 'importing' | 'interrupted' | 'processing' | 'complete';
  duration: number; settings: Settings; source: 'screen' | 'file' | 'demo';
  bytes: number; warning?: string; showTimeline?: boolean; folderId?: string;
  expectedDuration?: number; asrRate?: number; imagesOptimized?: boolean;
};
export type Folder = { id: string; name: string; parentId?: string; createdAt: number };
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
  phase: 'idle' | 'model' | 'transcribing'; message: string;
  progress?: number; pending: number; error?: string; device?: string;
  sessionId?: string;
  batchDuration?: number; batchProcessed?: number;
};
export type ChunkStats = { pending: number; errors: number; done: number; pendingSeconds: number; errorSeconds: number; doneSeconds: number; audioBytes: number };
export type SnapshotSettings = Pick<Settings, 'snapshotMode' | 'ignoreBottom' | 'sceneThreshold' | 'interval' | 'width' | 'quality' | 'autoStopMinutes'>;

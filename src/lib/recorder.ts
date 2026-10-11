import { SceneDetector, gray } from './scenes';
import { saveChunk, saveFrame, patchSession } from './db';
import type { Session, Frame } from '../types';
export type CaptureState = { elapsed: number; level: number; paused: boolean; hasAudio: boolean; sourceLabel: string; background: boolean };
export class Recorder {
  private context?: AudioContext;
  private worklet?: AudioWorkletNode;
  private analyser?: AnalyserNode;
  private meter?: Float32Array<ArrayBuffer>;
  private timer?: ReturnType<typeof setInterval>;
  private origin = 0; private pausedAt = 0; private pausedTotal = 0;
  private video = document.createElement('video');
  private stream?: MediaStream; private source?: HTMLMediaElement;
  private sourceUrl?: string; private wake?: WakeLockSentinel;
  private detector: SceneDetector;
  private sceneId = crypto.randomUUID();
  private queue = Promise.resolve(); private sceneBusy = false; private stopped = false;
  private acknowledgements = new Map<string, () => void>();
  private imported = false;
  private frameWorker?: Worker; private frameTrack?: MediaStreamTrack;
  state: CaptureState = { elapsed: 0, level: 0, paused: false, hasAudio: false, sourceLabel: '', background: false };
  constructor(private session: Session, private onState: (s: CaptureState) => void, private onEnded: () => void, private onError: (e: Error) => void) {
    this.detector = new SceneDetector(session.settings.sceneThreshold, session.settings.interval);
  }
  static supported() { return isSecureContext && !!navigator.mediaDevices?.getDisplayMedia && !!window.AudioWorkletNode; }
  async screen(stream: MediaStream) {
    this.stream = stream;
    this.video.srcObject = stream; this.video.muted = true; this.video.playsInline = true;
    await this.video.play();
    const audio = stream.getAudioTracks();
    this.state.hasAudio = audio.length > 0;
    this.state.sourceLabel = stream.getVideoTracks()[0]?.label || '공유한 화면';
    if (audio.length) {
      this.context = new AudioContext();
      await this.setup(this.context.createMediaStreamSource(new MediaStream(audio)));
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.onEnded(), { once: true });
    this.begin();
    await this.backgroundVideo(stream.getVideoTracks()[0]);
  }
  async file(file: File) {
    this.imported = true;
    this.sourceUrl = URL.createObjectURL(file);
    const hasVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name);
    this.source = hasVideo ? this.video : document.createElement('audio');
    this.source.src = this.sourceUrl; this.source.preload = 'auto';
    await new Promise<void>((resolve, reject) => {
      this.source!.onloadedmetadata = () => resolve();
      this.source!.onerror = () => reject(new Error('이 파일의 코덱을 브라우저가 지원하지 않습니다. MP4(H.264/AAC), WebM 또는 WAV를 사용하세요.'));
    });
    if (!Number.isFinite(this.source.duration)) throw new Error('파일 길이를 읽을 수 없습니다. 손상되지 않은 MP4 또는 WAV 파일을 선택하세요.');
    this.state.hasAudio = true; this.state.sourceLabel = file.name;
    this.context = new AudioContext();
    await this.setup(this.context.createMediaElementSource(this.source));
    this.source.addEventListener('ended', () => this.onEnded(), { once: true });
    await this.source.play();
    this.begin();
    if (hasVideo) {
      const captured = (this.source as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
      await this.backgroundVideo(captured?.getVideoTracks()[0]);
    } else this.state.background = true; // AudioWorklet already runs independently.
  }
  private async backgroundVideo(track?: MediaStreamTrack) {
    type Processor = { new(options: { track: MediaStreamTrack; maxBufferSize: number }): { readable: ReadableStream<VideoFrame> } };
    const Processor = (window as unknown as { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor;
    if (!track || !Processor || !window.OffscreenCanvas) return;
    this.frameTrack = track.clone();
    const worker = new Worker(new URL('../workers/capture.ts', import.meta.url), { type: 'module' });
    this.frameWorker = worker;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('화면 작업을 준비하지 못했습니다.')), 5000);
        worker.onerror = () => { clearTimeout(timeout); reject(new Error('화면 작업을 시작하지 못했습니다.')); };
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timeout); this.state.background = true; resolve(); }
          if (data.type === 'frame') this.enqueue(() => saveFrame(data.frame as Frame));
          if (data.type === 'ack') { this.acknowledgements.get(data.request)?.(); this.acknowledgements.delete(data.request); }
          if (data.type === 'error') this.onError(new Error(`화면 저장 작업 오류: ${data.message}`));
        };
        const { readable } = new Processor({ track: this.frameTrack!, maxBufferSize: 1 });
        worker.postMessage({ type: 'init', readable, settings: this.session.settings, sessionId: this.session.id, sec: this.elapsed(), clockOrigin: performance.timeOrigin + performance.now() }, [readable]);
      });
      // Worker failures after initialization must be visible too.
      worker.onerror = () => this.onError(new Error('백그라운드 화면 저장이 중단되었습니다. 녹화를 종료하고 다시 시작하세요.'));
    } catch {
      worker.terminate(); this.frameWorker = undefined; this.frameTrack.stop(); this.frameTrack = undefined;
      // Older browsers keep the existing foreground capture path.
    }
    this.onState({ ...this.state });
  }
  private elapsed() { return this.imported ? this.source!.currentTime : (performance.now() - this.origin - this.pausedTotal) / 1000; }
  private frameClock(type: 'clock' | 'pause' | 'resume' = 'clock', audioSec?: number) {
    this.frameWorker?.postMessage({ type, sec: audioSec ?? (this.state.paused ? this.state.elapsed : this.elapsed()), clockOrigin: performance.timeOrigin + performance.now() });
  }
  private async setup(input: AudioNode) {
    const context = this.context!;
    await context.audioWorklet.addModule('/audio-worklet.js');
    this.worklet = new AudioWorkletNode(context, 'lens-audio');
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 1024;
    this.meter = new Float32Array(this.analyser.fftSize);
    input.connect(this.analyser); input.connect(this.worklet);
    const silent = context.createGain(); silent.gain.value = 0;
    this.worklet.connect(silent); silent.connect(context.destination);
    this.worklet.port.onmessage = ({ data }) => {
      if (data.type === 'ack') { this.acknowledgements.get(data.request)?.(); this.acknowledgements.delete(data.request); }
      if (data.type === 'chunk') {
        const samples = data.samples as Float32Array;
        this.enqueue(() => saveChunk({
          id: `${this.session.id}:${data.start.toFixed(5).padStart(16, '0')}`, sessionId: this.session.id,
          start: data.start, duration: samples.length / 16000, samples, status: 'pending',
        }));
        this.frameClock('clock', data.start + samples.length / 16000); this.tick();
      }
    };
    await context.resume();
  }
  private enqueue(task: () => Promise<void>) {
    this.queue = this.queue.then(task).catch(e => { this.onError(new Error(`기기에 저장하지 못했습니다. ${e instanceof Error ? e.message : '저장 공간을 확인하세요.'}`)); });
  }
  private begin() {
    this.origin = performance.now();
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.visibility);
    this.timer = setInterval(() => this.tick(), 250);
    this.onState({ ...this.state });
  }
  private visibility = () => { if (document.visibilityState === 'visible' && !this.stopped) void this.acquireWakeLock(); };
  private async acquireWakeLock() {
    if ('wakeLock' in navigator && !this.wake) {
      try { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = undefined; }); } catch { /* Browser may deny; capture remains usable. */ }
    }
  }
  private lastSample = -1;
  private tick() {
    if (this.stopped) return;
    if (!this.state.paused) {
      this.state.elapsed = this.elapsed();
      if (this.analyser && this.meter) {
        this.analyser.getFloatTimeDomainData(this.meter);
        this.state.level = Math.min(1, Math.sqrt(this.meter.reduce((s, v) => s + v * v, 0) / this.meter.length) * 5);
      }
      const sec = Math.floor(this.state.elapsed);
      if (!this.frameWorker && this.video.readyState >= 2 && sec !== this.lastSample && !this.sceneBusy) {
        this.lastSample = sec;
        void this.sample().catch(e => this.onError(e));
      }
    }
    this.onState({ ...this.state });
  }
  private async sample(manual = false) {
    if (this.sceneBusy || this.stopped || !this.video.videoWidth) return;
    this.sceneBusy = true;
    try {
      const sec = this.state.elapsed;
      const low = document.createElement('canvas'); low.width = 160; low.height = 90;
      const ctx = low.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(this.video, 0, 0, 160, 90);
      const kind = manual ? 'manual' : this.detector.sample(gray(ctx.getImageData(0, 0, 160, 90).data), sec);
      if (!kind) return;
      if (kind === 'scene') this.sceneId = crypto.randomUUID();
      const settings = this.session.settings;
      let image: Blob | undefined, ocrImage: Blob | undefined;
      if (settings.saveImages) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(settings.width, this.video.videoWidth);
        canvas.height = Math.round(canvas.width * this.video.videoHeight / this.video.videoWidth);
        canvas.getContext('2d')!.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('장면을 이미지로 저장하지 못했습니다.')), 'image/jpeg', settings.quality));
      }
      if (settings.ocr && kind !== 'periodic') {
        const canvas = document.createElement('canvas');
        // OCR uses an independent lossless source, never the compressed snapshot.
        canvas.width = Math.min(settings.ocrWidth || 1920, this.video.videoWidth);
        canvas.height = Math.round(canvas.width * this.video.videoHeight / this.video.videoWidth);
        canvas.getContext('2d')!.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        ocrImage = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('OCR용 화면을 준비하지 못했습니다.')), 'image/png'));
      }
      const frame: Frame = {
        id: crypto.randomUUID(), sessionId: this.session.id, sceneId: this.sceneId, sec, type: kind,
        image, ocrImage, ocr: '', ocrStatus: settings.ocr && kind !== 'periodic' ? 'pending' : 'off',
      };
      if (!settings.saveImages && frame.ocrStatus === 'off') frame.image = undefined;
      this.enqueue(() => saveFrame(frame));
    } finally { this.sceneBusy = false; }
  }
  private async frameRequest(type: 'manual' | 'stop') {
    if (!this.frameWorker) return;
    const request = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.acknowledgements.delete(request); reject(new Error('화면 저장 응답이 늦어지고 있습니다.')); }, 5000);
      this.acknowledgements.set(request, () => { clearTimeout(timeout); resolve(); });
      this.frameWorker!.postMessage({ type, request });
    });
  }
  async snapshot() { if (this.frameWorker) await this.frameRequest('manual'); else await this.sample(true); await this.queue; }
  private async flush(type: 'flush' | 'pause') {
    if (!this.worklet) return;
    const request = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.acknowledgements.delete(request); reject(new Error('오디오 저장 응답이 늦어지고 있습니다. 마지막 5초는 저장되지 않았을 수 있습니다.')); }, 5000);
      this.acknowledgements.set(request, () => { clearTimeout(timeout); resolve(); });
      this.worklet!.port.postMessage({ type, request });
    });
    await this.queue;
  }
  async pause() {
    if (this.state.paused || this.stopped) return;
    this.state.paused = true; this.pausedAt = performance.now(); this.state.level = 0;
    this.frameClock('pause');
    this.source?.pause(); await this.flush('pause');
    this.onState({ ...this.state });
  }
  async resume() {
    if (!this.state.paused || this.stopped) return;
    this.pausedTotal += performance.now() - this.pausedAt;
    this.worklet?.port.postMessage({ type: 'resume' });
    await this.source?.play(); this.state.paused = false;
    this.frameClock('resume');
  }
  async stop() {
    if (this.stopped) return;
    this.tick();
    if (this.timer) clearInterval(this.timer);
    this.stopped = true; this.source?.pause();
    try { await this.flush('flush'); await this.frameRequest('stop'); } finally {
      // A canvas encoder may still be completing the last captured frame.
      while (this.sceneBusy) await new Promise(resolve => setTimeout(resolve, 20));
      await this.queue;
      this.frameWorker?.terminate(); this.frameTrack?.stop();
      this.stream?.getTracks().forEach(t => t.stop());
      this.video.pause(); this.video.srcObject = null; this.source?.removeAttribute('src');
      if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
      await this.context?.close(); await this.wake?.release();
      document.removeEventListener('visibilitychange', this.visibility);
      await patchSession(this.session.id, { status: 'processing', duration: this.state.elapsed });
    }
  }
  async cleanup() {
    this.stopped = true; if (this.timer) clearInterval(this.timer);
    this.frameWorker?.terminate(); this.frameTrack?.stop();
    this.stream?.getTracks().forEach(t => t.stop()); this.source?.pause();
    await this.context?.close().catch(() => {}); await this.wake?.release().catch(() => {});
    if (this.sourceUrl) URL.revokeObjectURL(this.sourceUrl);
    document.removeEventListener('visibilitychange', this.visibility);
  }
}

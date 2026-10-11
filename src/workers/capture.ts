import { SceneDetector, gray } from '../lib/scenes';
import type { Frame, Settings } from '../types';

// Video frames and audio-clock messages drive capture; window timers are not
// needed when the app tab is hidden. Only one source frame is held in memory.
let latest: VideoFrame | undefined, reader: ReadableStreamDefaultReader<VideoFrame> | undefined;
let settings: Settings, sessionId: string, detector: SceneDetector;
let sceneId = crypto.randomUUID(), running = false, paused = false, busy = false;
let clockOrigin = 0, clockSec = 0, lastSample = -Infinity;
let pending: Promise<void> = Promise.resolve();
const now = () => performance.timeOrigin + performance.now();
const elapsed = () => clockSec + (paused ? 0 : (now() - clockOrigin) / 1000);

async function sample(manual = false) {
  if (!latest || busy || paused || !running) return;
  const sec = Math.max(0, elapsed());
  if (!manual && sec - lastSample < .9) return;
  busy = true; lastSample = sec;
  try {
    const low = new OffscreenCanvas(160, 90), lowContext = low.getContext('2d', { willReadFrequently: true })!;
    lowContext.drawImage(latest, 0, 0, 160, 90);
    // Detection is sampled at 1 fps. Quantize its clock so millisecond jitter
    // on 5-second audio messages cannot accidentally double snapshot periods.
    const kind = manual ? 'manual' : detector.sample(gray(lowContext.getImageData(0, 0, 160, 90).data), Math.floor(sec));
    if (!kind) return;
    if (kind === 'scene') sceneId = crypto.randomUUID();
    const width = latest.displayWidth, height = latest.displayHeight;
    let snapshot: OffscreenCanvas | undefined, source: OffscreenCanvas | undefined;
    // Draw both before awaiting encoders so they refer to the same video frame.
    if (settings.saveImages) {
      const w = Math.min(settings.width, width);
      snapshot = new OffscreenCanvas(w, Math.round(w * height / width));
      snapshot.getContext('2d')!.drawImage(latest, 0, 0, snapshot.width, snapshot.height);
    }
    if (settings.ocr && kind !== 'periodic') {
      const w = Math.min(settings.ocrWidth || 1920, width);
      source = new OffscreenCanvas(w, Math.round(w * height / width));
      source.getContext('2d')!.drawImage(latest, 0, 0, source.width, source.height);
    }
    const [image, ocrImage] = await Promise.all([
      snapshot?.convertToBlob({ type: 'image/jpeg', quality: settings.quality }),
      source?.convertToBlob({ type: 'image/png' }),
    ]);
    const frame: Frame = { id: crypto.randomUUID(), sessionId, sceneId, sec, type: kind, image, ocrImage, ocr: '', ocrStatus: source ? 'pending' : 'off' };
    self.postMessage({ type: 'frame', frame });
  } finally { busy = false; }
}
async function readFrames() {
  try {
    while (running) {
      const result = await reader!.read();
      if (result.done) break;
      latest?.close(); latest = result.value;
      if (!paused) { pending = sample(); await pending; }
    }
  } catch (e) {
    if (running) self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      settings = data.settings; sessionId = data.sessionId; clockOrigin = data.clockOrigin; clockSec = data.sec;
      detector = new SceneDetector(settings.sceneThreshold, settings.interval);
      reader = (data.readable as ReadableStream<VideoFrame>).getReader(); running = true;
      self.postMessage({ type: 'ready' }); void readFrames();
    }
    if (data.type === 'clock' || data.type === 'pause' || data.type === 'resume') {
      clockOrigin = data.clockOrigin; clockSec = data.sec;
      if (data.type !== 'clock') paused = data.type === 'pause';
      // Static slides may produce no new video frames. Audio blocks still
      // request periodic snapshots from the latest original-resolution frame.
      if (!busy) { pending = sample(); await pending; }
    }
    if (data.type === 'manual') {
      await pending; pending = sample(true); await pending;
      self.postMessage({ type: 'ack', request: data.request });
    }
    if (data.type === 'stop') {
      running = false; await reader?.cancel(); await pending;
      latest?.close(); latest = undefined;
      self.postMessage({ type: 'ack', request: data.request });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

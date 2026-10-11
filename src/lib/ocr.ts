import { createWorker, PSM, type Worker } from 'tesseract.js';

// Only language weights are cached. User images/results never enter IndexedDB,
// localStorage, the service worker, or any network request.
export class ImageReader {
  private worker?: Worker;
  private ready?: Promise<Worker>;
  private closed = false;
  async read(image: Blob, progress: (v: number) => void) {
    this.ready ??= createWorker('kor+eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/tesseract/',
      cachePath: 'lecturelens-image-text-v1',
      logger: m => { if (!this.closed && typeof m.progress === 'number') progress(m.progress * 100); },
    }).then(async worker => {
      if (this.closed) { await worker.terminate(); throw new DOMException('취소됨', 'AbortError'); }
      this.worker = worker;
      await worker.setParameters({ preserve_interword_spaces: '0', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      return worker;
    });
    const worker = await this.ready;
    const result = await worker.recognize(image);
    if (this.closed) throw new DOMException('취소됨', 'AbortError');
    return result.data.text.trim();
  }
  dispose() { this.closed = true; void this.worker?.terminate().catch(() => {}); }
}

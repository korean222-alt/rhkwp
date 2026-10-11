import { createWorker, PSM, type Worker } from 'tesseract.js';
let worker: Worker | undefined;
export async function recognize(image: Blob, progress: (v: number) => void) {
  if (!worker) worker = await createWorker('kor+eng', 1, {
    workerPath: '/vendor/tesseract/worker.min.js',
    corePath: '/vendor/tesseract/',
    // Default data endpoint uses the accuracy-oriented best_int LSTM models.
    cachePath: 'lecturelens-ocr-best-v1',
    logger: m => { if (typeof m.progress === 'number') progress(m.progress * 100); },
  });
  await worker.setParameters({ preserve_interword_spaces: '0', tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const result = await worker.recognize(image);
  return result.data.text.trim();
}
export async function stopOcr() { await worker?.terminate(); worker = undefined; }

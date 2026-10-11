import { createRequire } from 'node:module';
import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const trRequire = createRequire(require.resolve('@huggingface/transformers'));
const teRequire = createRequire(require.resolve('tesseract.js/package.json'));
const onnx = dirname(dirname(trRequire.resolve('onnxruntime-web')));
const core = dirname(teRequire.resolve('tesseract.js-core/package.json'));
await mkdir('public/vendor/onnx', { recursive: true });
await mkdir('public/vendor/tesseract', { recursive: true });
for (const file of await readdir(join(onnx, 'dist'))) {
  if (/^ort-wasm-simd-threaded(?:\.jsep)?\.(wasm|mjs)$/.test(file)) await copyFile(join(onnx, 'dist', file), join('public/vendor/onnx', file));
}
for (const file of await readdir(core)) {
  if (/\.wasm(?:\.js)?$|^tesseract-core.*\.js$/.test(file)) await copyFile(join(core, file), join('public/vendor/tesseract', file));
}
await copyFile(join(tesseract, 'dist/worker.min.js'), 'public/vendor/tesseract/worker.min.js');
console.log('Local ONNX and OCR worker assets ready.');

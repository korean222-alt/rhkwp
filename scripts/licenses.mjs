import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const list = [], originals = [];
for (const directory of await readdir('node_modules/.pnpm')) {
  const path = join('node_modules/.pnpm', directory, 'node_modules');
  let children; try { children = await readdir(path); } catch { continue; }
  for (const child of children) {
    const names = child.startsWith('@') ? (await readdir(join(path, child))).map(x => `${child}/${x}`) : [child];
    for (const name of names) {
      try {
        const pkg = JSON.parse(await readFile(join(path, name, 'package.json'), 'utf8'));
        if (list.some(p => p.name === pkg.name && p.version === pkg.version)) continue;
        const files = (await readdir(join(path, name))).filter(file => /^(?:licen[cs]e|notice)(?:[._-].*)?$/i.test(file));
        const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || 'NOT DECLARED');
        const sections = await Promise.all(files.map(async file => `--- ${file} ---\n${await readFile(join(path, name, file), 'utf8')}`));
        originals.push({ name: `${pkg.name}@${pkg.version}`, text: `${pkg.name}@${pkg.version}\nDeclared license: ${license}\n${sections.join('\n\n') || 'No separate license file in the installed package. See package metadata and upstream repository.'}` });
        list.push({ name: pkg.name, version: pkg.version, license, notice: files.length > 0 });
      } catch { /* Exclude PNPM's support directory entries. */ }
    }
  }
}
list.sort((a, b) => a.name.localeCompare(b.name));
const lines = ['# Third-party licenses', '', '생성 기준: 설치된 잠금 파일의 직접·간접 의존성(개발 도구 포함). 라이선스/NOTICE 원문은 THIRD_PARTY_NOTICES.txt에 보존합니다. 배포 사이트에서도 오픈소스 고지 링크로 확인할 수 있습니다.', '', '| Package | Version | License | Notice |', '|---|---|---|---|', ...list.map(p => `| ${p.name} | ${p.version} | ${p.license} | ${p.notice ? '[원문 모음](THIRD_PARTY_NOTICES.txt)' : '패키지 메타데이터'} |`), '', '## Downloaded models', '', '- Whisper tiny/base/small/large-v3-turbo and ONNX exports: MIT. [OpenAI Whisper license](https://github.com/openai/whisper/blob/main/LICENSE), [ONNX Community models](https://huggingface.co/onnx-community). 모델은 배포 ZIP에 포함하지 않으며 최초 사용 시 사용자 기기에 다운로드됩니다.', '- Korean / English Tesseract traineddata: Apache-2.0. [tessdata_best](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE).', '- 테스트용 한국어·혼합 음성은 이 프로젝트의 예시 문장을 Windows TTS로 생성한 테스트 자료입니다. 강의 원본이 아닙니다.', '', '앱 자체의 상업적 배포 정책은 저장소 소유자가 결정합니다. 이 파일은 제3자 저작물에 대한 고지를 보존하기 위한 것입니다. Node용 네이티브 의존성과 개발 도구도 표에 포함됩니다.', ''];
await writeFile('THIRD_PARTY_LICENSES.md', lines.join('\n'));
originals.sort((a, b) => a.name.localeCompare(b.name));
const notices = `LectureLens third-party notices\nIncludes runtime packages, development tools and Node-only dependencies.\nDownloaded model licenses: https://github.com/openai/whisper/blob/main/LICENSE and https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE\n\n${originals.map(p => p.text).join('\n\n' + '='.repeat(72) + '\n\n')}\n`;
await writeFile('THIRD_PARTY_NOTICES.txt', notices);
await writeFile('public/third-party-notices.txt', notices);
console.log(`Recorded ${list.length} package licenses.`);
const missing = list.filter(p => p.license === 'NOT DECLARED'); if (missing.length) console.log('Undeclared:', missing.map(p => p.name).join(', '));

# LectureLens

강의 탭의 화면과 소리를 내 PC에서 한국어·영어 자막, 장면 노트, OCR, ZIP으로 정리하는 웹 앱입니다. React + TypeScript + Vite로 만들었으며 GitHub 저장소를 Vercel에 연결해 사용할 수 있습니다.

**현재 범위는 웹 베타입니다.** 화면/오디오 캡처, 실제 로컬 음성 인식과 OCR, 파일 가져오기, 이어 처리, 내보내기를 구현했습니다. 사용자 요청대로 결제는 나중에 연결합니다. 로그인, 결제, 클라우드 동기화, Windows exe/MCP는 포함하지 않습니다. 실제 1시간 강의 검증과 배포 후 확인은 아래 체크리스트에 남겨 두었습니다.

## 터미널 없이 GitHub → Vercel

1. 제공된 `lecturelens-source.zip`을 풉니다.
2. GitHub에서 새 저장소를 만듭니다. `Add file → Upload files`에서 **lecturelens 폴더 안의 내용**을 올립니다. ZIP 파일 자체를 올리는 것이 아닙니다. 저장소 첫 화면에 `package.json`, `pnpm-lock.yaml`, `vercel.json`, `src`, `public`, `scripts`가 보여야 합니다. 숨김 파일 `.gitignore`와 `.github`도 포함해 주세요. 파일 개수 제한이 나타나면 폴더별로 나눠 올리거나 GitHub Desktop으로 올릴 수 있습니다.
3. Vercel에서 `Add New → Project`를 눌러 그 저장소를 가져옵니다.
4. Framework Preset은 **Vite**, Root Directory는 저장소 루트, Output Directory는 **dist**입니다. `lecturelens` 폴더째 저장소에 올렸다면 Root Directory를 `lecturelens`로 지정합니다.
5. `Deploy`를 누릅니다. 설치와 빌드 명령은 `vercel.json`에 고정한 pnpm 버전으로 실행됩니다. 별도의 API 키, 데이터베이스, 환경 변수는 필요하지 않습니다. Node.js는 `package.json`의 24.x를 사용합니다.
6. 나온 HTTPS 주소를 **PC Chrome/Edge**에서 열고 예시 강의, 짧은 실제 강의, ZIP 다운로드를 확인합니다. Preview와 Production 주소는 브라우저 저장 공간이 서로 다릅니다. 강의를 계속 보관할 때는 같은 Production 주소를 사용하세요.

Vercel 설정 근거: [설치 명령과 패키지 관리자](https://vercel.com/docs/package-managers), [Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). 실제 Vercel 계정 배포는 아직 수행하지 않았습니다.

## 다른 작업을 하면서 녹화하기

1. 별도 탭에서 강의를 엽니다.
2. LectureLens에서 `화면 녹화 시작`을 누릅니다.
3. 공유 창의 **Chrome 탭 → 강의 탭 → 탭 오디오 공유**를 선택합니다. 전체 화면을 공유하면 다른 작업의 화면도 저장되므로 강의 탭을 선택하세요.
4. 소리 레벨을 확인하고 `작은 상태 창`을 엽니다. 이 창에는 녹화 시간, 소리, 일시 정지, 장면 저장, 종료 버튼이 있습니다.
5. 다른 탭이나 다른 프로그램에서 작업합니다. 최신 PC Chrome/Edge에서는 별도 영상 작업자와 AudioWorklet이 캡처를 이어갑니다. 작은 상태 창을 닫아도 녹화는 계속됩니다.
6. `종료하고 정리하기`를 누르고 남은 자막/OCR 처리가 끝나면 ZIP을 받습니다.

앱과 강의 탭은 닫지 마세요. 컴퓨터가 절전 모드로 들어가거나 공유를 중지하면 캡처가 중단됩니다. 화면 Wake Lock은 브라우저가 허용하는 동안만 적용되므로 장시간 사용 시 OS 절전 설정을 확인하세요. F9는 앱에 포커스가 있을 때 동작합니다. 다른 프로그램에서는 작은 창의 장면 저장 버튼을 사용하세요. 해당 브라우저가 백그라운드 화면 처리를 지원하지 않으면 앱이 안내를 표시합니다.

## 언어와 글자 인식

- 강의 언어 기본값은 **한국어 + 영어 · 자동 인식**입니다. 한국어만/영어만인 강의는 언어를 고정할 수 있습니다. 한 문장에 섞인 짧은 외국어, 전문 용어, 소음은 틀릴 수 있습니다. 자막은 연필 버튼으로 수정합니다.
- tiny는 가볍고, base/small은 더 많은 자원을 사용합니다. CPU에서는 tiny로 먼저 확인하세요. WebGPU 초기화 실패 시 CPU로 전환하며, GPU 실행 중 실패한 구간은 CPU 모드로 바꿔 이어 처리할 수 있습니다.
- **보관 이미지와 OCR 이미지를 따로 만듭니다.** 보관용은 기본 960px JPEG 70%, OCR용은 원본에서 최대 1920px PNG입니다. 고화질 임시 PNG는 장면 전환/수동 저장 때만 만들고 판독이 끝나면 삭제합니다. 실패한 장면은 재시도를 위해 보존합니다. 원본 자체의 흐린 글자는 복구할 수 없습니다.
- OCR만 보관하려면 설정의 `이미지 보관`을 끕니다. OCR 대기 중에는 임시 저장 공간이 사용됩니다. OCR 결과는 장면 상세에서 고칠 수 있습니다.

## 저장과 이어 처리

오디오는 AudioWorklet에서 16kHz 모노로 만들고 5초마다 IndexedDB에 저장합니다. 약 30초씩 음성 작업자에 보내며 완료된 오디오 PCM은 지웁니다. 전체 영상 파일은 저장하지 않습니다. 파일 가져오기는 긴 파일 전체를 메모리에 풀지 않도록 **실제 재생 속도**로 진행합니다.

새로고침/종료로 중단되면 `내 강의 → 저장된 구간 다시 처리`를 누릅니다. 저장 완료된 오디오와 OCR을 처리하며 녹화 소스 자체는 다시 공유해야 합니다. 종료 직전 최대 5초는 저장되지 않았을 수 있습니다. 다른 기기, 다른 브라우저, 다른 도메인으로 자동 이동하지 않습니다. 브라우저 데이터 삭제 전에는 ZIP을 받으세요. 동시에 여러 탭에서 녹화/처리하는 것은 Web Locks로 막습니다.

## 결과물

```text
강의이름/
  transcript.txt
  transcript.srt
  scenes.json
  frames/0000.jpg ...
  combined.md
  meta.json
```

자막의 `보시면`, `이 그래프`, `이 표` 등의 단서에 해당 장면의 OCR/이미지 경로를 붙입니다. 같은 장면의 OCR은 연속해서 중복 첨부하지 않습니다. 시점 조회는 요청 시각 이전의 가장 가까운 화면을 기준으로 합니다. 설정에서 저장을 끈 경우 이미지 파일이 없습니다. Chrome의 파일 저장 API에서는 ZIP을 파일로 순차 기록합니다. 미지원 브라우저에서는 180MB 이내 결과를 메모리 ZIP으로 제공합니다.

## 선택 기능: 내 API 키로 AI 분석

기본 녹화/자막/OCR/통합 노트에는 유료 AI API가 필요 없습니다. `AI 분석`에서는 본인의 Claude API 키와 모델 ID를 입력하고, 구간/전송 자료/이미지 상한/비용 추정을 확인한 뒤 실행합니다. 모델 ID와 요금은 사용자가 현재 사용 중인 모델 기준으로 입력합니다. 키는 기본 세션 한정이며 `기억하기`를 고르면 해당 브라우저 로컬 저장소에 평문으로 보관한다는 안내가 나옵니다.

이 기능을 사용할 때만 승인한 자막, 조회한 OCR 및 허용한 이미지를 **Anthropic API**에 직접 보냅니다. 키도 API 인증을 위해 Anthropic에 전달됩니다. 개발자의 서버로 중계하지 않으며 개발자 키는 포함하지 않습니다. 실제 유료 API 계정 호출은 미검증이고, 요청/도구 루프는 모의 응답으로 확인했습니다. 예상 비용 상한은 입력한 단가와 보수적 토큰 추정에 따른 제어이며 청구액 보증은 아닙니다.

## 로컬 개발 및 검증

Node.js 24와 pnpm 11.25.0, Chrome이 필요합니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm test:browser
```

기본 주소는 `http://127.0.0.1:5173/`입니다. build/dev에서 ONNX 및 OCR 작업자 자산을 설치 패키지에서 `public/vendor`로 준비합니다. `public/vendor`, `dist`, `node_modules`를 GitHub에 올릴 필요가 없습니다. 잠금 파일은 올려야 합니다. GitHub Actions는 테스트와 빌드를 실행합니다. Linux의 실제 백그라운드 브라우저 검증은 `xvfb-run --auto-servernum pnpm test:browser`로 실행합니다.

추가 검증 스크립트는 `scripts/`에 있습니다. 실제 음성 인식/OCR 검증은 첫 실행에 모델 다운로드가 필요하며 유료 API 키는 사용하지 않습니다.

```sh
# 별도 터미널: 배포와 같은 CSP 헤더를 적용한 dist 서버
node scripts/serve-production.mjs
# 혼합 음성 파일 가져오기부터 실제 자막/OCR 임시 이미지 삭제까지
node scripts/integration-check.mjs
# 개발 서버에서 합성 1시간 분량의 저장/새로고침/이어 처리
node scripts/storage-check.mjs
```

## 공개 전 확인

[QA.md](QA.md)에 실제 측정값과 검증 범위를 기록했습니다. 설계서의 **실제 1시간 강의** 통과 조건을 합성 저장 시험으로 대체했다고 표시하지 않습니다.

- [ ] Production HTTPS 주소에서 실제 강의 탭과 오디오를 공유해 끝까지 자막 생성
- [ ] 한국어/혼합 강의 1시간, 시각 정합 ±2초, 실제 저장 용량 측정
- [ ] 다른 프로그램 사용/백그라운드 장시간 사용 후 자막과 장면 누락 확인
- [ ] 중간 새로고침 후 저장된 구간 이어 처리 및 ZIP 확인
- [ ] 일반 노트북에서 tiny/base/small 및 WebGPU 속도/메모리 비교
- [ ] 본인 BYOK 계정으로 작은 비용 상한을 설정해 실제 AI 요청 확인

결제 연결 시에는 서버에서 로그인, 결제 웹훅, 구독 권한을 확인하는 구조가 추가로 필요합니다. 현재 웹 앱에는 유료 이용 권한 제어가 없습니다.

## 코드 위치

`src/lib/recorder.ts`와 `public/audio-worklet.js`: 스트리밍 캡처 · `src/workers/capture.ts`: 백그라운드 장면 감지/원본 OCR 이미지 · `src/workers/transcriber.ts`: 로컬 Whisper · `src/lib/db.ts`: 저장/복구 · `src/lib/engine.ts`: 처리 순서 · `src/lib/ocr.ts`: 한국어/영어 OCR · `src/lib/cues.ts`: 통합 노트 · `src/lib/exporter.ts`: 스트리밍 ZIP · `src/lib/analysis.ts`: 선택 BYOK 분석 · `src/ui`: 사용자 화면.

제3자 패키지/모델 고지는 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)에 있습니다. URL 영상 다운로드와 보호 영상 우회 기능은 포함하지 않습니다.

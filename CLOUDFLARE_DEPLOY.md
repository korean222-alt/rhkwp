# GitHub → Cloudflare Pages 배포

이 소스는 Vite 정적 앱이며 public/_headers에 Vercel과 같은 보안 헤더를 넣었다. 실제 Cloudflare 계정 연결이나 배포는 아직 하지 않았다.

1. 소스 ZIP을 풀어 lecturelens 폴더 안의 파일을 GitHub 저장소에 올린다. package.json, pnpm-lock.yaml, public, src, scripts, .github, .node-version을 포함한다.
2. Cloudflare 대시보드의 Workers & Pages에서 **Pages** 프로젝트를 만들고 GitHub 저장소를 연결한다. Workers 실행 앱이 아니라 정적 Pages 프로젝트를 선택한다.
3. 빌드 환경 변수 `SKIP_DEPENDENCY_INSTALL=1`을 지정해 자동 설치를 끈다. 사용할 설치 버전을 아래 명령으로 고정한다. 빌드 명령: `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 run build`
4. 출력 디렉터리: `dist`. 저장소 루트에 package.json이 없고 lecturelens 하위 폴더에 있다면 Root directory를 lecturelens로 설정한다.
5. Node 버전은 .node-version의 24.19.0을 사용한다. 빌드 환경에서 필요하면 NODE_VERSION=24.19.0을 지정한다. 이 앱의 기능을 위해 서버 API 키나 DB 환경 변수를 넣을 필요는 없다.
6. 배포 HTTPS 주소에서 예시 강의, ZIP 백업/복원, 한글 녹음, 사진, OCR 모델 다운로드를 확인한다. 브라우저 Network 또는 응답 헤더로 CSP/Permissions-Policy 등이 적용됐는지도 확인한다.

도메인이 바뀌면 기존 브라우저 자료가 자동 이동하지 않는다. **기존 같은 주소를 v1.3 소스로 먼저 업데이트해 전체 백업 ZIP을 받은 뒤**, 새 Pages 주소에서 가져오기한다. TXT/SRT/Markdown 등의 읽기용 개별 강의 ZIP은 앱 복원 ZIP이 아니다.

빌드 산출물 중 가장 큰 WASM은 약 20.6MiB로 현재 Pages 개별 파일 25MiB 제한 아래이다. 모델 가중치는 사용자의 브라우저가 Hugging Face에서 받는다. 무료 플랜도 서비스 약관·제한을 적용받으며 방문자 수 무제한의 가용성을 보장하지 않는다. 광고 수익이 있는 사이트는 Vercel Hobby의 비상업 조건과 맞지 않으므로 Pages 사용 또는 적합한 유료 플랜을 선택한다.

공식 근거: [빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Node 버전 지정](https://developers.cloudflare.com/pages/configuration/build-image/), [헤더 설정](https://developers.cloudflare.com/pages/configuration/headers/), [Pages 제한](https://developers.cloudflare.com/pages/platform/limits/), [Vercel 상업 사용 기준](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage).

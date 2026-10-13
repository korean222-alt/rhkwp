# 공개 전 보안과 개인정보 (v1.3)

## 반영한 내용

- 공용 PC의 API 키 평문 보관 경고를 큰 경고 상자로 표시하고 키 지우기 버튼 추가. 키가 빈 값이면 양쪽 저장소에서 제거한다. Claude 콘솔 Settings → Billing의 월 사용 한도 안내와 공식 문서 링크 추가. 앱의 추정 비용 상한은 청구 한도의 대체 수단이 아니다.
- 설정에 전체 백업·복원·확인 입력이 필요한 전체 삭제 추가. 키를 복원하거나 ZIP에 직렬화하는 기능은 없다.
- 처음 녹화를 시작할 때 학교/회사 규정, 개인 학습, 공유 권한, 실시간 수업의 얼굴·목소리 안내. 하단에서 이용·개인정보 안내 접근 가능.
- 실제 저장 구조에 맞게 임시 음성/사진/자막/비저장 OCR/선택적 Anthropic 전송/호스팅 접속 로그/광고 클릭을 구분. 기본 처리의 기기 내 동작만 안내하고 전송 없는 서비스라고 포괄적으로 주장하지 않는다.
- Vercel 설정의 CSP·COOP·nosniff·Referrer-Policy·Permissions-Policy 유지, X-Frame-Options: DENY 추가. Cloudflare Pages에도 같은 설정이 적용되도록 public/_headers 포함.
- Dependabot 주간 npm/GitHub Actions 업데이트 설정 추가. CI 권한 contents: read로 제한.
- 베타 표기 유지. 실제 모든 강의, 기기, 플랫폼의 무오류나 정확도를 보증하지 않는다.

## 확인 결과와 운영자가 해야 할 일

2026-10-12 공개 URL https://lecturelens-blush.vercel.app/ 를 읽기 요청해 CSP, COOP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy 헤더를 실제 응답에서 확인했다. X-Frame-Options 추가와 v1.3 변경은 이 소스에 반영된 것으로 실제 재배포는 수행하지 않았다. 원격 GitHub 기본 브랜치 조회는 확인되지 않아 현재 작업 폴더의 전체 코드를 기준으로 변경했다.

cdn.jsdelivr.net은 현재 Tesseract 6.0.1이 한국어/영어 언어 가중치 4.0.0_best_int를 받는 주소이다. 실행되는 OCR worker·WASM은 이미 자체 호스팅한다. CDN을 CSP에서 무작정 제거하면 첫 OCR 다운로드가 실패하므로 connect-src에 유지한다. 외부 모델 다운로드는 서버 업로드와 다르며 입력 이미지는 보내지 않는다. 자체 언어 가중치 호스팅은 후속 선택 사항이다.

광고 문의 이메일은 사용자가 공개하도록 지정한 주소라 그대로 유지한다. 전용 주소로 바꾸려면 AdBanner.tsx 및 Privacy.tsx와 광고·개인정보 문서를 함께 바꾼다. 이메일 주소는 API 비밀키가 아니다. 새 이메일 계정은 생성하지 않았다.

GitHub에서 업로드한 뒤 Repository Settings에서 Secret scanning/Push protection 지원 여부를 확인해 활성화한다. 계정이나 저장소 권한을 사용해 원격 설정을 바꾸지는 않았다. Dependabot 설정 파일은 저장소에 반영돼야 동작한다.

공개 이용·개인정보 안내는 현재 구현의 정보 흐름 설명이다. 법적 적합성 인증이나 완결된 법률 검토가 아니다. 실제 운영자의 명칭, 문의 처리 보관 기간, 호스팅 사업자와 계약, 별도 분석·결제 도입 시 정보 흐름을 운영자가 확인해 갱신해야 한다. 결제·로그인·클라우드 동기화는 현재 없다.

## 대학생용으로 추가한 기능

학기/과목 하위 폴더, 강의 폴더 이동, 전체 자막 검색과 원문 시점 이동, 핵심 개념/학습 문제 10개/강조 부분 AI 질문 프리셋. 프리셋을 누르면 질문만 채우며 전송 확인 전에는 유료 API를 호출하지 않는다. 통합 Markdown 내보내기는 기존 기능을 유지한다.

전공 용어 자동 교정, 북마크, PDF/Anki, 슬라이드 연결, 번역 병기, 파일 배속 가져오기는 이 릴리스에서 구현하지 않았다. 특히 음성 인식 전 배속 재생은 음질·시각 정합성 검증이 필요하다. 장기 기억 온톨로지 목표는 LONG_TERM_MEMORY.md에만 보관하며 별도 그래프 저장 시스템을 추가하지 않았다.

참고: [Claude 사용 한도](https://platform.claude.com/docs/en/api/rate-limits), [Cloudflare Pages 헤더](https://developers.cloudflare.com/pages/configuration/headers/).

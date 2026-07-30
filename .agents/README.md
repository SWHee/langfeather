# LangFeather AI 작업 안내

이 디렉터리는 AI와 함께 LangFeather를 수정하는 기여자를 위한 작업 문맥입니다.
사용자용 설치·사용 안내는 repository root의 `README.md`와 `docs/`를 보세요.

작업을 시작하기 전에 다음 순서로 읽습니다.

1. `product-context.md`: 왜 이 제품을 만들며 현재 무엇을 지원하는가
2. `codebase-map.md`: 수정하려는 기능의 소유 package와 canonical spec
3. `engineering.md`: package별로 반드시 지킬 기술 계약
4. `workflow.md`: 작은 변경과 PR의 기본 순서, 완료 기준
5. `testing.md`: 변경 범위별 검증과 실제 smoke test 조건
6. UI 변경이면 `design.md`

현재 지원 계약은 `specs/`가 source of truth입니다. 과거 구현 과정이나 이전
phase 기록을 근거로 기능을 추가하지 마세요.

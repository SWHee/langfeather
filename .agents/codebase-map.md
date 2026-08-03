# 코드와 계약 지도

| 변경 대상 | 소유 위치 | 먼저 읽을 문서 | 기본 검증 |
| --- | --- | --- | --- |
| Python SDK | `sdk/python/` | `specs/data-contract.md`, `sdk/python/docs/` | `make test-sdk` |
| HTTP API와 SQLite | `server/` | `specs/data-contract.md`, `specs/architecture.md` | `make test-server` |
| React UI | `web/` | `specs/web-functional.md`, `specs/web-interaction-contract.md`, `specs/web-api-map.md`, `.agents/design.md` | `npm test --prefix web` |
| SDK→API→DB 경로 | `tests/integration/` | `specs/data-contract.md` | `make test-integration` |
| 사용자 문서 | `README.md`, `docs/`, `sdk/python/docs/` | `specs/product.md` | link와 명령 재확인 |

공유 JSON contract, migration, shared frontend type는 한 작업에서 한 명만 수정합니다.
새 기능이 SDK/API/UI를 모두 바꾸면 lead가 contract를 먼저 정하고 integration test를
함께 추가합니다.

현재 `web/`의 기존 presentation layer는 전면 redesign을 위해 제거된 상태입니다.
`web/src/App.tsx`의 scaffold와 root `DESIGN.md`를 완성된 UI 또는 시각 기준으로
사용하지 마세요. 보존할 기능과 상태 전이는 `specs/web-*.md`가 소유합니다.

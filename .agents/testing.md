# 검증 안내

repository root에서 실행합니다.

```bash
make lint
make typecheck
make test
make contract-check
make build
make smoke
```

Docker Desktop을 사용할 수 있으면 release 전에는 다음도 실행합니다.

```bash
bash scripts/container_smoke.sh
```

## 변경 범위별 검증

- SDK 동작: 관련 `sdk/python/tests` focused test, `make test-sdk`, Python lint/typecheck
- API 또는 SQLite: 관련 `server/tests` focused test, `make test-server`, Python
  lint/typecheck
- Web 동작: 관련 Vitest, `npm run lint --prefix web`,
  `npm run typecheck --prefix web`, `npm run build --prefix web`
- SDK와 API 사이 JSON contract: `make contract-check`, `make test-integration`
- 여러 package를 함께 바꾼 경우: 각 package 검증과 `make test-integration`

## 실제 smoke test가 필요한 경우

Dockerfile, Compose, server startup, static web serving, port, volume, health check를
바꿨다면 build 성공만으로 끝내지 않고 실제 container smoke를 실행합니다.

```bash
bash scripts/container_smoke.sh
```

UI의 layout, navigation, dialog, 주요 action을 바꿨다면 실제 browser에서 변경 화면을
열어 다음을 확인합니다.

- desktop과 390px 안팎 mobile viewport에서 주요 조회와 action이 가능한가
- 긴 trace name, JSON, 빈 목록에서 가로 overflow나 겹침이 없는가
- loading, empty, error, disabled 상태가 이해 가능한가
- keyboard focus, scroll, browser console에 새 오류가 없는가
- visual layout을 바꿨다면 desktop/mobile screenshot으로 결과를 남겼는가

환경 제약으로 Docker나 browser smoke를 실행하지 못했다면 통과했다고 쓰지 않습니다.
PR에 미실행 항목과 이유를 남기고, 필요한 검증이 남아 있으면 완료 조건이 충족되지 않은
것으로 봅니다.

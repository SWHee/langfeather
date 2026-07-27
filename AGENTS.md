# LangFeather Agent Guide

이 파일은 저장소에서 작업하는 모든 coding agent의 최상위 작업 규칙이다.
제품 요구사항은 `docs/PRODUCT_REQUIREMENTS.md`, 확정 결정은
`docs/DECISIONS.md`, 기술 계약은 `docs/ARCHITECTURE.md`와
`docs/DATA_CONTRACT.md`를 따른다.

## 1. Mission

LangFeather는 개인 개발자와 LangGraph application 사용자를 위한 local-first LLM tracing
도구다. LangSmith의 제한과 self-hosted Langfuse의 무거움을 피하면서,
LangChain/LangGraph application의 실제 실행 흐름을 최소한의 코드로
관찰하게 하는 것이 목적이다.

모든 구현 판단에서 다음 우선순위를 적용한다.

1. 설치와 사용의 단순성
2. 디버깅에 필요한 원본 정보와 실행 관계의 정확성
3. 사용자 application으로부터의 장애 격리
4. 낮은 idle resource usage와 작은 운영 표면
5. 확장성, enterprise 기능, 무손실 전달

## 2. Authority Order

문서가 충돌하면 다음 순서로 판단한다.

1. 사용자가 현재 task에서 명시한 지시
2. `docs/DECISIONS.md`의 `Locked` 결정
3. `docs/PRODUCT_REQUIREMENTS.md`
4. `docs/DATA_CONTRACT.md`
5. `docs/ARCHITECTURE.md`
6. `docs/IMPLEMENTATION_PLAN.md`

확정 결정과 충돌하는 변경은 임의로 구현하지 않는다. 필요성을 발견하면
코드를 우회해서 작성하지 말고 decision proposal을 먼저 남긴다.

## 3. Non-negotiable Boundaries

- v1은 single project, single user, local installation만 지원한다.
- Python SDK만 구현한다.
- core SDK는 FastAPI, LangChain, LangGraph에 직접 의존하지 않는다.
- LangChain integration은 optional dependency이자 별도 module이다.
- 전송은 custom JSON API를 사용한다. v1에 OpenTelemetry를 추가하지 않는다.
- client disk spool을 추가하지 않는다.
- trace payload를 truncate, summarize, sample, redact하지 않는다.
- 비용 계산과 provider 가격표를 추가하지 않는다.
- prompt management, dataset experiment, evaluator runner, RBAC, billing을
  추가하지 않는다.
- UI에 확인되지 않은 graph edge를 추론해서 표시하지 않는다.
- trace 전송 실패로 관측 대상 application의 정상 흐름을 막지 않는다.
- production server는 Uvicorn worker 하나만 사용한다.

## 4. Repository Shape

초기 scaffold는 다음 구조를 목표로 한다.

```text
langfeather/
├── AGENTS.md
├── README.md
├── compose.yaml
├── pyproject.toml
├── docs/
├── server/
│   ├── src/langfeather_server/
│   ├── migrations/
│   └── tests/
├── sdk/python/
│   ├── src/langfeather/
│   └── tests/
├── web/
│   ├── src/
│   └── tests/
└── tests/integration/
```

경계를 지킨다.

- `sdk/python`: trace 수집, context propagation, serialization, transport,
  ASGI 및 LangChain integration
- `server`: HTTP API, validation, transaction, SQLite persistence, backup,
  offline restore CLI
- `web`: trace 조회와 삭제, feedback, graph/JSON inspection UI
- `tests/integration`: 실제 SDK -> API -> SQLite -> 조회 경로

SDK가 server package를 import하거나 server가 SDK runtime에 의존하게 만들지
않는다. 두 구성요소는 versioned JSON contract로만 연결한다.

## 5. Work Method

각 변경은 다음 순서로 진행한다.

1. 관련 문서와 기존 tests를 읽는다.
2. 변경할 contract와 영향을 받는 package를 명시한다.
3. 실패하는 focused test를 먼저 추가하거나 재현한다.
4. 가장 작은 구현으로 test를 통과시킨다.
5. package-level test, type check, lint를 실행한다.
6. cross-package contract를 바꿨다면 integration test를 실행한다.
7. 사용자 동작 또는 locked decision이 달라졌다면 같은 change에서 문서를
   갱신한다.

새 abstraction은 현재 단계에서 두 군데 이상 실제로 필요할 때만 도입한다.
미래의 OTel, PostgreSQL, multi-project 요구를 예상한 framework를 만들지
않는다. 다만 stable IDs, versioned API, generic observation kinds처럼 이미
확정된 migration seam은 보존한다.

## 6. Engineering Standards

### Python

- Python 3.10 이상에서 동작해야 한다.
- public API와 domain model에는 type hint를 작성한다.
- `ruff`, `mypy`, `pytest`를 기본 quality gate로 사용한다.
- sync와 async 실행을 모두 test한다.
- `contextvars`로 concurrent trace context를 격리한다.
- background sender thread/task는 bounded queue와 deterministic shutdown을
  가져야 한다.
- serializer는 cycle과 serialization error를 견디고 application exception을
  가리지 않아야 한다.

### Server

- SQLAlchemy 2.0 style을 사용한다.
- schema 변경은 반드시 Alembic migration으로 작성한다.
- SQLite는 WAL과 `synchronous=FULL`로 구성한다.
- write endpoint는 commit이 완료된 뒤에만 2xx를 반환한다.
- batch request 안의 trace envelope를 각각 독립 transaction으로 처리하고
  retry된 ID는 first-write-wins로 idempotent해야 한다.
- trace 삭제와 전체 초기화는 관련 observation과 feedback을 함께 처리한다.

### Web

- TypeScript strict mode를 유지한다.
- design은 trace list와 trace detail debugging flow를 우선한다.
- graph node와 inspector가 같은 selection state를 공유해야 한다.
- 큰 JSON payload는 접을 수 있어야 하며 browser main thread를 불필요하게
  막지 않아야 한다.
- trace detail은 observation summary를 먼저 받고 선택 payload만 lazy-load한다.
- 확인되지 않은 edge를 시각적 사실처럼 표시하지 않는다.
- desktop과 mobile에서 기본 조회와 삭제가 가능해야 한다.

### Tests

- unit test만으로 완료 처리하지 않는다.
- 최소 integration path는 completed, failed, cancelled trace를 포함한다.
- parallel sibling, nested Runnable, repeated node name, loop를 fixture로 둔다.
- serialization fixture에는 Pydantic, TypedDict-compatible dict, dataclass,
  LangChain Document/Message, datetime, UUID, Decimal, Enum, Path, bytes,
  Exception, cycle, unsupported object, non-string dict key, reserved marker
  collision, non-finite float, JavaScript unsafe integer를 포함한다.
- 관측 서버 unavailable, queue full, shutdown flush timeout이 application
  결과를 바꾸지 않는지 검증한다.

## 7. Agent Scope Rules

- 한 agent는 한 package 또는 명확한 vertical slice를 소유한다.
- 같은 migration, API schema, shared type file을 여러 agent가 동시에
  수정하지 않는다.
- specialist agent는 자신의 scope 밖 문제를 발견하면 handoff note를 남기고
  임의로 넓혀 고치지 않는다.
- lead agent만 cross-package contract와 release branch를 통합한다.
- unrelated refactor, dependency upgrade, formatting churn을 섞지 않는다.
- 사용자가 만든 변경을 되돌리지 않는다.

## 8. Required Handoff

각 agent는 작업 종료 시 다음을 보고한다.

```text
Scope:
Changed contracts:
Files changed:
Commands run:
Tests passed:
Known limitations:
Follow-up dependencies:
```

`Tests passed`에는 실제 실행한 명령과 결과를 적는다. 실행하지 않은 검증을
통과했다고 표현하지 않는다.

## 9. Definition of Done

변경은 다음 조건을 모두 만족해야 완료다.

- 해당 implementation-plan 단계의 acceptance criteria를 충족한다.
- public behavior가 tests로 고정되어 있다.
- lint, type check, focused tests가 통과한다.
- cross-package 변경이면 integration test가 통과한다.
- Docker 또는 browser 동작을 건드렸다면 실제 smoke test를 수행한다.
- 문서와 구현이 서로 모순되지 않는다.

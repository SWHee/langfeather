# Implementation Plan

이 계획은 contract-first vertical slice를 따른다. LangFeather의 첫 제품
가치는 범용 tracing framework를 완성하는 것이 아니라, LangGraph 입문자가
최상위 graph를 한 줄로 감싼 뒤 browser에서 이번 요청의 실제 실행 경로와
node 입출력, 반복, 병렬 실행, 실패 지점을 확인하는 것이다.

각 phase는 다음 phase가 시작되기 전에 독립적인 사용자 동작과 자동화된
acceptance gate를 가져야 한다.

## Current Status

2026-07-28 기준으로 Phase 0부터 Phase 5까지의 local technical gate가
완료됐고 Phase 7 custom score/annotation queue 구현이 진행 중이다.

- Python `uv` workspace와 SDK/server package scaffold
- Vite, React, TypeScript strict frontend scaffold
- root `make` quality command
- Python 3.10과 최신 지원 Python을 대상으로 하는 CI skeleton
- `schema_version=1` SDK/server/web contract types
- completed, failed, parallel, loop canonical fixture
- generated JSON Schema fixture
- `wrap_runnable()` sync/async capture와 bounded background HTTP sender
- FastAPI ingest/list/detail/payload API, SQLite WAL persistence, Alembic migration
- trace list, runtime observation list, lazy JSON inspector web shell
- 실제 2-node LangGraph quickstart와 SDK -> API -> SQLite -> browser 통합 test
- `invoke`, `ainvoke`, `stream`, `astream` terminal lifecycle과 cancellation
- callback parent reconciliation, Runnable/LLM/retriever/tool kind mapping
- provider가 반환한 model/usage metadata와 실제 token callback 기반 TTFT
- React Flow runtime graph와 parent evidence만 사용하는 edge
- sequential, parallel, conditional, loop, nested RunnableLambda, fallback,
  failed root, cancelled stream, streaming LLM runtime fixture
- iterative serializer와 Pydantic/dataclass/LangChain semantic adapter
- cycle, broken repr, non-string key, marker collision, non-finite number 처리
- `@observe`, `span()`, explicit context propagation, generic ASGI wrapper
- bounded queue oldest-drop, batch HTTP, transient-only retry, snapshot flush
- collector 정상/중단 상태의 return, chunks, exception parity integration gate
- local lint, type check, package/integration/web tests, build, smoke, browser smoke
- opaque cursor list/filter API와 session trace navigation API
- custom score, trace annotation/memo, fixed annotation queue API와 persistence
- root input/output header, failed-node focus, nested JSON folding/copy,
  filter reset, cursor pagination, session previous/next, annotation/delete UI
- exact `RESET` confirmation UI/API, SQLite online backup download, server-offline
  restore CLI with integrity/migration validation and atomic replace/safety copy
- FastAPI static SPA and deep-link fallback, multi-stage Docker/Compose deployment,
  configurable trusted hosts, amd64/arm64 build workflow

Phase 1 browser gate에서는 새 database에 `quickstart` trace를 만들고
`LangGraph`, `draft_answer`, `finalize_answer` observation과 선택 node의 원본
input/output을 확인했다.

Phase 2 automated gate에서는 실제 LangGraph/LangChain runtime을 single-worker
Uvicorn과 SQLite에 연결해 병렬 sibling의 interval overlap, 선택된 conditional
branch, 같은 이름의 loop observation, nested RunnableLambda parent 관계,
failed child 뒤 fallback 성공, failed root, stream chunk 보존, async cancellation,
streaming LLM TTFT를 확인했다. UI는 같은 이름의 observation을 별도 node로
표시하고 timestamp가 실제로 겹친 sibling만 같은 행에 배치하며, 확인된
`parent_observation_id` 외의 edge를 만들지 않는다.

Phase 2 browser gate에서는 새 database에 `runtime-parallel`, `runtime-loop`,
`runtime-fallback` trace를 만들었다. 병렬 sibling은 같은 행의 서로 다른
node로, 세 번 실행된 `retry_node`는 서로 다른 observation ID와 행으로
표시됐다. 성공한 fallback trace에서는 failed child가 자동 선택됐고 원본
input, output, error는 선택 뒤 lazy-load됐으며 browser warning/error는
발생하지 않았다.

Phase 3 gate에서는 2,000단계 nested payload와 serialization matrix를
검증하고 sync/async 함수, generator, async generator, thread context 전달,
concurrent task 격리를 확인했다. ASGI request는 독립 HTTP root가 되며
Runnable은 그 child로 저장된다. 8,192단계 callback parent chain을 선형
시간에 정규화하고, 실제 LangChain Runnable과 generic span이 양방향으로
번갈아 중첩되거나 async parallel sibling으로 실행돼도 가장 가까운 runtime
parent를 유지한다. 종료된 trace context를 상속한 detached task는 새 root로
분리된다. 실제 local collector를 정상 전송한 뒤 socket을 닫고 같은
application을 다시 실행해 return object identity, stream chunks, application
exception instance와 traceback 최종 frame이 동일함을 확인했다.

Phase 7 gate가 끝난 뒤 다음 release 단계는 Phase 6 hardening이다.

GitHub repository는 `SungjinWi99/langfeather`로 확정됐다. PyPI ownership,
license, GHCR publication path는 `docs/DECISIONS.md`에 따라 release 전에 결정하며
다음 implementation phase를 막지 않는다. Remote CI 자체는 저장소가 원격에
push된 뒤 별도로 확인한다.

## Phase 0: Foundation and Contract Baseline

### Goal

모든 package가 같은 `schema_version=1` contract와 공통 quality command를
기준으로 독립적으로 개발될 수 있게 한다.

### Deliverables

- repository layout와 Python workspace
- frontend package와 strict TypeScript
- root lint, format, type check, test, build, smoke command
- CI skeleton
- trace, observation, usage, error domain types
- stable opaque ID와 UTC/monotonic timing utility
- canonical completed/failed/parallel/loop envelope fixtures
- generated JSON Schema fixture
- development compose placeholder

### Required Tests

- SDK core가 optional framework dependency 없이 import됨
- SDK, server, web가 같은 canonical fixtures를 수용함
- `schema_version=1`만 수용하고 다른 version을 거부함
- root observation, unique sequence, same-trace parent 관계를 검증함
- failed, parallel, loop trace fixture를 수용함
- Python package와 frontend production build가 성공함

### Gate

- `make lint`
- `make typecheck`
- `make test`
- `make contract-check`
- `make build`
- `make smoke`

## Phase 1: First Useful LangGraph Trace

### Goal

사용자가 최소 sample LangGraph를 실행하고 trace list와 detail에서 실제 node
입출력을 보는 첫 end-to-end walking skeleton을 만든다.

### Deliverables

- minimal `contextvars` trace context와 terminal envelope builder
- minimal background HTTP sender
- FastAPI `POST /api/v1/traces/batch`
- SQLite trace/observation persistence와 first Alembic migration
- `GET /api/v1/traces`
- `GET /api/v1/traces/{trace_id}`
- `GET /api/v1/observations/{observation_id}`
- fixture 기반 trace list/detail web shell
- `examples/langgraph_quickstart` sequential sample
- SDK endpoint 기본값과 configuration contract

### Scope Boundary

이 phase에서는 full serializer registry, retry policy, annotation, backup,
advanced filter, graph layout polish를 완성하지 않는다. Canonical JSON-compatible
sample payload 하나가 SDK에서 API, SQLite, query, browser까지 이동하는 경로를
먼저 고정한다.

### Required Tests

- SDK가 만든 completed envelope를 actual HTTP API가 저장함
- write endpoint의 2xx 뒤 새 DB connection에서 trace가 조회됨
- list response가 full observation payload를 포함하지 않음
- 선택 observation payload를 별도 endpoint로 조회함
- browser가 empty, loading, one-trace 상태를 render함
- 같은 trace ID retry는 duplicate 성공이고 data를 덮어쓰지 않음

### Gate

다음 동작을 새 local database에서 재현한다.

1. server와 web을 실행한다.
2. sample sequential LangGraph를 `wrap_runnable()` 한 줄로 감싼다.
3. sample을 한 번 실행한다.
4. trace list에서 새 trace를 연다.
5. root와 child node의 input/output을 확인한다.

## Phase 2: LangGraph Runtime Fidelity

### Goal

LangGraph 입문자가 가장 자주 혼동하는 실제 실행 path, 병렬 branch, loop,
실패 지점을 callback evidence와 일치하게 보여준다.

### Deliverables

- optional LangChain callback handler
- `wrap_runnable()` invoke, ainvoke, stream, astream
- callback run ID와 parent run ID mapping
- top-level callback run과 wrapper root 중복 방지
- chain, LLM, retriever, tool, RunnableLambda kind mapping
- explicit session ID와 LangGraph `thread_id` extraction precedence
- model, provider usage, token metadata extraction
- optional TTFT capture
- React Flow runtime execution graph
- 선택 node inspector와 payload lazy loading

### Required Fixtures

- sequential graph
- parallel branches
- conditional branch
- loop/retry와 repeated node name
- nested RunnableLambda
- retriever와 tool
- streaming LLM
- failed child with successful fallback
- failed root
- cancelled stream

### Required Tests

- callback event가 발생한 모든 internal run을 수집함
- parent 관계와 timestamp가 callback evidence와 일치함
- parallel sibling interval이 겹치며 sequence는 unique함
- loop의 같은 이름 node를 별도 observation instance로 저장함
- child failure 후 fallback 성공 시 trace/root는 completed를 유지함
- 없는 data dependency edge를 생성하지 않음
- LangChain이 없는 environment에서 core SDK가 동작함

### Gate

fixture마다 expected trace status, observation count/kind, parent relation,
payload assertion이 통과하고 UI graph와 inspector selection이 일치한다.

## Phase 3: SDK Safety, Serialization, and Generic Capture

### Goal

관측 실패가 사용자 application의 결과나 exception을 바꾸지 않으며 실제 사용
project에서 만나는 Python/LangChain payload를 안전하게 보존한다.

### Deliverables

- complete serializer registry와 safe fallback
- Pydantic, dataclass, TypedDict-compatible dict adapter
- LangChain Document와 Message optional adapter
- cycle과 serialization error handling
- `@observe`, `span()`, explicit context API
- sync/async wrapper와 iterator/async iterator lifecycle
- bounded queue, batcher, short retry, warning
- deterministic flush와 shutdown
- generic ASGI wrapper

### Required Serialization Tests

- nested supported values
- Pydantic v2 `model_dump(mode="python")`
- Document와 Message subtype
- tuple, set, bytes와 type marker
- non-string dict key와 reserved marker collision
- `NaN`, infinity, JavaScript unsafe integer
- naive datetime
- Exception traceback
- cycle
- broken `repr`
- unsupported object

### Required Isolation Tests

- concurrent task의 trace context가 섞이지 않음
- existing context에서 duplicate root가 생기지 않음
- completed, failed, cancelled 상태
- queue full 시 oldest drop
- collector unavailable
- transient retry와 permanent reject 구분
- shutdown flush timeout
- ASGI normal response, exception, stream disconnect
- serializer/callback/transport 실패가 original return, chunks, exception
  instance와 traceback을 바꾸지 않음

### Gate

collector를 중단한 전후에 sample application의 return value, yielded chunks,
exception type과 traceback assertion이 동일하다.

## Phase 4: User Debugging UX

### Goal

처음 LangGraph를 다루는 사용자가 별도 tracing 지식 없이 실패 node와 잘못된
state 변화를 찾을 수 있게 한다.

### Deliverables

- trace list와 cursor pagination
- name/input/output text search
- status, time, tag, session filter
- trace header와 root input/output
- internal node collapse/expand
- failed node automatic focus
- nested JSON folding와 copy
- unknown observation kind fallback
- session previous/next
- individual trace delete
- beginner-oriented empty/error states와 terminology

### UX Language

- graph를 “전체 LangGraph 구조”가 아니라 “이번 요청의 실제 실행 경로”로
  설명한다.
- callback으로 관찰되지 않은 node나 가능한 path를 표시하지 않는다.
- raw payload를 자동 redaction하지 않으며 secret이 포함될 수 있다는 local-only
  warning을 quickstart와 UI에 표시한다.

### Required Tests

- list loading, error, empty state
- cursor reset after filter change
- repeated name과 parallel sibling rendering
- large nested JSON folding
- initial detail request가 observation summary만 가져옴
- graph selection과 inspector payload가 일치함
- error node automatic focus
- delete confirmation
- keyboard와 basic accessibility
- desktop/mobile smoke

### Gate

새 사용자가 failed fixture를 열고 실패 node, 해당 input, structured error,
traceback frame을 찾을 수 있다.

## Phase 5: Administration and Single-container Distribution

### Goal

별도 infrastructure 없이 local Docker container 하나와 named volume 하나로
설치, 유지, 삭제, backup, restore가 가능하게 한다.

### Deliverables

- full server validation과 per-envelope transaction result
- query filter와 stable cursor ordering
- reset UI/API
- SQLite online backup download
- server-offline restore CLI와 integrity/migration check
- Vite static build serving
- multi-stage Dockerfile
- production compose와 loopback port binding
- configurable trusted local Host contract
- amd64/arm64 build workflow

### Required Tests

- invalid envelope과 같은 batch의 valid envelope은 정상 저장됨
- cascade observation 및 trace 소유 product data cleanup
- default 50, maximum 200 limit
- container restart와 `docker compose down` 뒤 data 유지
- backup, reset, restore round trip
- running server에서 restore를 지원하지 않음
- invalid/incompatible backup에서 기존 DB 유지
- SPA deep-link fallback
- final image에 Node runtime이 없음
- host machine과 같은 Docker network의 documented endpoint가 모두 동작함

### Gate

clean machine-equivalent environment에서 `http://127.0.0.1:4319`의 UI/API와
documented quickstart가 동작한다.

## Phase 6: Release Hardening

### Deliverables

- PyPI metadata와 `langchain` optional extra
- GHCR image publication
- `CHANGELOG.md`, `v0.1.0` Git tag, GitHub Release와 release checklist
- Python/LangChain/LangGraph compatibility matrix
- 실제 LangGraph `Send` fan-out 프로젝트에서 명시적 dispatch edge 호환성 확인
- sequential, parallel, loop, failure sample projects
- installation, troubleshooting, limitation documentation
- idle/sample resource benchmark
- license와 package ownership decision

### Gate

- 신규 사용자 관점 installation test
- Python 3.10 이상 supported matrix
- amd64/arm64 image smoke
- `docs/PRODUCT_REQUIREMENTS.md`의 v1 acceptance criteria 전체 확인

## Phase 7: Custom Scores and Manual Annotation Queues

### Deliverables

- boolean, finite number, categorical single/multiple score config CRUD
- trace-level structured annotation과 trace당 shared memo
- fixed/manual annotation queue 생성과 score/trace 목록 편집
- 명시적 queue item 완료, 읽기 전용 완료 상태, `수정` 시 pending 전환
- legacy feedback contract/table/API 제거 migration
- future observation target을 위한 annotation target identity seam
- `Scores`, `Annotation Queues`, trace annotation UI

### Required Tests

- score type별 validation과 categorical multiple `[]`/미기록 구분
- 사용된 score의 structure 불변성과 archive
- score 값 없이도 명시적으로 queue item 완료 가능
- 완료 item 수정 시 pending 전환 및 기존 값 보존
- queue 삭제가 trace annotation/memo를 삭제하지 않음
- trace 삭제가 annotation/memo/queue item을 cascade 삭제
- queue 생성 후 score와 trace membership 수동 편집

### Gate

- server package tests, web component tests, lint/type check 통과
- SDK -> API -> SQLite -> browser smoke에서 기존 tracing flow 회귀 없음
- product, decision, architecture, data contract 문서와 구현 일치

## Phase 8: Local Dataset and Experiment Evaluation

### Deliverables

- mutable dataset/example CRUD와 trace input을 example으로 수동 추가하는 flow
- experiment create 시 dataset revision snapshot과 immutable case history
- SDK `evaluate()`/`aevaluate()` sequential runner와 normal trace linkage
- `@evaluator` custom callable, exact match/contains/json field built-ins
- boolean 또는 finite number evaluator result persistence
- dataset/experiment inspection UI와 trace header의 `Add to Dataset`

### Required Tests

- dataset update 후에도 existing experiment case snapshot이 변하지 않음
- invalid evaluator value를 거부하고 target/evaluator failure를 case result로 보존
- sync와 async target이 동일한 control contract를 사용
- trace soft reference deletion이 dataset/experiment history를 지우지 않음

### Gate

- SDK -> API -> SQLite -> evaluation result 조회와 browser smoke가 동작
- server는 evaluator callable을 실행하지 않음
- managed LLM judge, categorical automatic evaluator, scheduler/worker를 추가하지 않음

## Sequencing Rules

- canonical contract 변경은 SDK, server, web types, fixture, integration test를
  같은 change에서 갱신한다.
- Phase 1 walking skeleton은 cross-package contract를 고정하므로 lead agent가
  통합한다.
- Phase 1 API fixture가 고정된 뒤 server persistence와 web shell을 병렬화할
  수 있다.
- Phase 2 callback lifecycle이 안정된 뒤 Phase 3의 broader generic wrapper와
  transport hardening을 확장한다.
- Docker와 release 작업은 actual SDK to API to SQLite to browser path가 연결된
  뒤 시작한다.
- 각 phase 끝에 문서와 implementation drift를 검사한다.

## Scope-cut Order

일정이 부족하면 다음 순서로 줄인다.

1. visual polish와 animation
2. advanced search 조합
3. queue 생성 후 score/trace 목록 편집 편의 기능
4. session previous/next convenience
5. offline restore CLI의 UX 개선

다음은 줄이지 않는다.

- 한 줄 `wrap_runnable()`과 callback-visible internal capture
- complete payload inspection
- failed trace
- runtime parent relation
- individual delete와 reset
- local single-container installation
- tracing failure isolation

# Agent and Harness Strategy

## 1. Recommendation

LangFeather는 처음부터 많은 agent를 동시에 투입하기보다 **lead agent 1명과
최대 2~3명의 specialist agent**로 운영하는 것이 적합하다. 저장소가 작고
SDK/API/UI contract가 강하게 연결되어 있어 과도한 병렬화는 merge conflict와
contract drift를 늘린다.

권장 구조:

```text
Human product owner
└── Lead/integration agent
    ├── SDK specialist
    ├── Server/storage specialist
    └── Web UI specialist

Later gate:
└── QA/release specialist
```

Lead agent는 architecture와 contract를 소유한다. specialist는 독립
worktree에서 제한된 path만 변경한다.

## 2. Agent Roles

### Lead and Integration Agent

책임:

- `docs/DECISIONS.md`와 contract 보호
- repository scaffold와 shared tooling
- task decomposition과 dependency ordering
- OpenAPI/canonical fixture version 승인
- specialist branch review와 integration
- end-to-end test와 release gate

Lead는 큰 feature 구현을 독점하지 않는다. contract ambiguity와
cross-package integration에 집중한다.

### SDK Specialist

소유 path:

```text
sdk/python/**
```

책임:

- serializer
- context propagation
- observation lifecycle
- background transport
- ASGI integration
- optional LangChain/LangGraph integration

금지:

- server schema를 독단적으로 변경
- global provider monkey patch 추가
- disk spool 추가

### Server and Storage Specialist

소유 path:

```text
server/**
```

책임:

- FastAPI routes
- SQLAlchemy repository
- Alembic migration
- SQLite transaction/durability
- backup, offline restore CLI, reset
- static SPA serving integration

금지:

- multi-worker deployment
- PostgreSQL abstraction 선행 구현
- SDK runtime import

### Web UI Specialist

소유 path:

```text
web/**
```

책임:

- trace list/detail
- React Flow layout
- inspector와 JSON viewer
- feedback/session/delete/settings UX
- responsive behavior

금지:

- mock contract를 실제 API와 다르게 독자 확장
- aggregate dashboard와 experiment UI 추가
- inferred graph edge 표시

### QA and Release Specialist

Phase 5의 administration/distribution 작업부터 투입한다.

책임:

- integration and browser smoke
- Docker image and compose
- amd64/arm64 workflow
- PyPI/GHCR release rehearsal
- resource benchmark와 installation test

QA agent는 feature code를 광범위하게 고치지 않고 reproducible failure
report와 focused patch를 lead에게 전달한다.

## 3. Harness Components

복잡한 autonomous agent framework는 필요하지 않다. Git worktree, task
packet, deterministic commands, CI를 harness로 사용한다.

### Worktrees

각 specialist는 별도 branch/worktree를 사용한다.

```text
codex/foundation
codex/sdk-core
codex/server-ingest
codex/web-trace-detail
codex/release
```

같은 branch에 여러 agent가 쓰지 않는다. shared contract 변경은 lead
branch에서 먼저 merge한 뒤 specialist branch가 rebase 또는 merge한다.

### Task Packet

모든 agent task는 다음 template을 사용한다.

```markdown
## Goal

## Inputs and locked decisions

## Owned paths

## Do not change

## Required behavior

## Required tests

## Verification commands

## Handoff format
```

Task packet은 “serializer 구현”처럼 넓게 쓰지 않고 “Pydantic/dataclass/cycle
fixtures를 만족하는 serializer registry”처럼 observable outcome을 적는다.

### Contract Fixtures

다음 fixture를 repository에서 version-control한다.

```text
tests/fixtures/envelopes/completed.json
tests/fixtures/envelopes/failed.json
tests/fixtures/envelopes/parallel.json
tests/fixtures/envelopes/loop.json
tests/fixtures/envelopes/feedback-before-trace.json
```

SDK는 fixture와 같은 envelope를 만들고, server는 fixture를 ingest하며,
web은 fixture 기반 mock API를 render한다. 이 fixture가 agent 사이의
가장 중요한 executable contract다.

### Commands

Root-level command interface를 단순하게 유지한다.

```text
make lint
make typecheck
make test
make test-sdk
make test-server
make test-web
make test-integration
make build
make smoke
```

실제 내부 package manager 명령은 바뀔 수 있지만 agent와 CI는 root command를
공통 harness로 사용한다.

## 4. Recommended Parallelization

### Stage A: Sequential

Lead만 작업한다.

- repository scaffold
- canonical models
- API fixture
- root commands
- first CI

이 단계가 merge되기 전에는 specialist를 시작하지 않는다.

### Stage B: Parallel, Maximum Three

- SDK specialist: serializer와 core trace lifecycle
- Server specialist: ingest/query persistence
- Web specialist: fixture 기반 list/detail shell

각 agent는 shared fixture를 수정하지 않는다. 변경이 필요하면 lead에게
proposal을 보낸다.

### Stage C: Sequential Integration

Lead가 다음 순서로 합친다.

1. server
2. SDK
3. SDK -> server integration tests
4. web
5. browser smoke

Contract mismatch를 adapter로 숨기지 말고 canonical contract를 한 번
수정한 뒤 모든 consumer를 갱신한다.

### Stage D: Focused Parallel Work

- SDK specialist: LangChain/LangGraph fixtures
- Server specialist: backup/offline restore
- Web specialist: graph layout와 admin UI

기능 간 dependency가 낮아진 뒤에만 다시 병렬화한다.

### Stage E: Release Gate

QA/release specialist가 clean install을 검증하고 lead가 failures를 triage한다.
한 agent가 build failure와 application bug를 동시에 임의 수정하지 않도록
issue를 package owner에게 되돌린다.

## 5. Review Gates

각 phase에는 다음 review가 필요하다.

### Contract Review

- field name과 optionality가 SDK/server/web에서 같은가?
- unknown kind와 unknown metadata를 보존하는가?
- terminal-only persistence 원칙을 깨지 않는가?

### Failure Isolation Review

- serializer, callback, queue, HTTP failure가 application에 새 exception을
  만들지 않는가?
- original return, stream chunk, exception traceback을 보존하는가?

### Graph Accuracy Review

- parent 관계의 evidence가 있는가?
- parallelism과 loop가 실제 runtime instance를 반영하는가?
- UI가 inferred edge를 사실처럼 표시하지 않는가?

### Lightweight Review

- 새 service나 daemon이 추가됐는가?
- dependency가 core SDK import size를 불필요하게 키우는가?
- 기능이 primary user의 local debugging job에 직접 필요한가?

## 6. Agent Evaluation Scenarios

coding agent의 완료 보고만 믿지 않고 다음 scenario로 결과를 평가한다.

1. 일반 sync/async nested functions
2. LangGraph sequential path
3. parallel retrievers
4. checker retry loop
5. RunnableLambda 내부 호출
6. LLM streaming 완료
7. node exception
8. client cancellation/disconnect
9. collector unavailable
10. feedback before delayed trace ingest
11. backup/reset/offline restore
12. container restart

각 scenario는 expected trace status, observation count/kinds, parent relation,
payload assertion을 가진다.

## 7. Human Decision Gates

다음 변경은 human product owner 확인 없이 진행하지 않는다.

- locked scope 추가 또는 삭제
- authentication 또는 external exposure
- payload redaction/truncation
- storage stack 변경
- OTel 도입
- JavaScript SDK
- pricing/cost
- multi-project
- package/product rename

그 외 구현 세부사항은 tests와 문서 경계 안에서 lead agent가 결정한다.

## 8. Practical Recommendation

첫 구현 task에서는 subagent를 바로 네 명 띄우지 않는다. lead agent가
Phase 0의 canonical fixture와 root test commands를 만든 뒤, Phase 1의
walking skeleton에서 minimal ingest/query contract를 먼저 고정한다. 그
contract가 고정된 뒤 SDK와 server 두 agent를 병렬로 시작하는 구성이 가장
안전하다. Web agent는 detail API fixture가 고정된 직후 투입한다.

이 프로젝트에는 별도 orchestration framework보다 다음 조합이면 충분하다.

- Codex task 하나를 lead로 유지
- package별 worktree task
- `AGENTS.md`와 task packet
- version-controlled contract fixtures
- root `make` commands
- GitHub Actions required checks
- phase별 human approval

복잡한 multi-agent planner, shared mutable scratchpad, long-running autonomous
loop는 제품 자체보다 harness 운영 비용을 키우므로 사용하지 않는다.

# 핵심 engineering 계약

이 문서는 coding style이 아니라 application 안전성, data 호환성, local 운영 단순성을
지키기 위한 package별 규칙이다. 상세한 현재 동작은 `specs/architecture.md`와
`specs/data-contract.md`를 따른다.

## Python SDK

- Python 3.10 이상을 지원하고 public API와 domain model에 type hint를 유지한다.
- core SDK는 FastAPI, LangChain, LangGraph에 직접 의존하지 않는다. LangChain과
  LangGraph integration은 optional module에 둔다.
- `contextvars`로 동시에 실행되는 trace context를 격리하고 sync/async 실행을 모두
  검증한다.
- background sender는 bounded queue와 제한된 retry, 예측 가능한 flush/shutdown
  timeout을 유지한다. client disk spool은 추가하지 않는다.
- serializer는 cycle, serialization error, 실패하는 `repr()`을 견뎌야 한다.
- tracing 또는 serialization 실패가 application의 반환값, stream chunk, 원래 예외를
  바꾸거나 가려서는 안 된다.

## Server와 SQLite

- SQLAlchemy 2.0 style을 사용하고 schema 변경은 반드시 Alembic migration으로 남긴다.
- SQLite WAL, `synchronous=FULL`, Uvicorn worker 하나라는 운영 경계를 유지한다.
- write endpoint는 transaction commit이 끝난 뒤에만 2xx를 반환한다.
- batch ingest는 envelope마다 독립 transaction을 사용한다. 같은 ID 재전송은
  first-write-wins로 처리한다.
- trace 삭제와 전체 초기화는 계약에 명시된 observation, annotation, memo, queue
  membership을 함께 정리한다. dataset과 experiment의 soft trace reference는 보존한다.
- server는 evaluator callable이나 사용자 application code를 import하거나 실행하지 않는다.

## Web

- TypeScript strict mode를 유지하고 server response type과 실제 API 계약을 함께
  갱신한다.
- trace detail은 observation summary를 먼저 받고 선택한 payload만 lazy-load한다.
- graph와 inspector는 같은 selection state를 사용하고, runtime evidence가 없는 edge를
  추론해서 표시하지 않는다.
- 긴 JSON은 접을 수 있어야 하며 browser main thread를 불필요하게 막지 않는다.
- loading, empty, error, disabled 상태와 desktop/mobile의 주요 조회·action을 함께
  구현한다.

## Package 사이 계약

SDK/server/web이 공유하는 field나 의미를 바꿀 때는 versioned contract, server model,
web type, canonical fixture, integration test를 같은 변경에서 갱신한다. 한 package test만
통과한 상태로 cross-package 변경을 완료 처리하지 않는다.

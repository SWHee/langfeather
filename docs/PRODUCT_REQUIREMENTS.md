# Product Requirements

## 1. Product Summary

LangFeather는 Python 기반 LLM application을 위한 lightweight,
local-first tracing 및 debugging UI다. 사용자는 local Docker container를
실행하고 Python application에 최소한의 wrapper를 추가해 실제 runtime call
tree, 각 node의 원본 input/output, error, latency, token usage를 확인한다.

LangFeather는 LangSmith 전체 제품군이나 Langfuse self-hosted stack을
복제하지 않는다. 개인 학습과 로컬 디버깅에 필요한 좁은 기능을 작은
운영 비용으로 제공한다.

## 2. Target Users

### Primary

- FastAPI와 LangGraph로 RAG를 학습하거나 포트폴리오를 만드는 사용자
- LangSmith free-tier 제한을 피하고 싶은 개인 개발자
- Langfuse self-hosting을 위해 ClickHouse, Redis, object storage 등을
  운영하고 싶지 않은 사용자

### User Environment

- 개인 laptop 또는 desktop
- Docker Desktop 또는 Docker Engine
- Python 3.10 이상
- 주로 LangChain/LangGraph, 선택적으로 일반 Python/ASGI
- 관측 대상과 LangFeather가 같은 machine 또는 같은 Docker network에 존재

## 3. Core Jobs

사용자는 다음 질문에 빠르게 답할 수 있어야 한다.

1. 이번 요청에서 실제로 어떤 node와 Runnable이 실행됐는가?
2. 각 node는 어떤 input을 받고 어떤 output을 반환했는가?
3. 병목은 어디이며 어떤 호출이 병렬 또는 반복 실행됐는가?
4. 어느 node에서 어떤 exception이 발생했는가?
5. 같은 대화 session에서 이전과 다음 요청은 무엇이었는가?
6. 정해진 score 기준으로 trace를 평가하고 반복 검토 작업을 어디까지 끝냈는가?

## 4. V1 User Experience

### Installation

목표 설치 경험은 다음 두 명령이다.

```bash
docker compose up -d
pip install "langfeather[langchain]"
```

기본 UI는 `http://127.0.0.1:4319`에서 열린다. login이나 account 생성은
없다.

### Instrumentation

LangChain/LangGraph 사용자는 최상위 runnable을 한 번 감싼다.

```python
graph = langfeather.wrap_runnable(graph)
```

내부 Runnable, LLM, retriever, tool, `RunnableLambda` 중 LangChain callback
event를 발생시키는 run은 자동 수집한다. 일반 Python 사용자는 `@observe`
또는 `span()`을 사용한다.
ASGI 사용자는 선택적으로 `wrap_asgi(app)`를 적용한다.

### Trace List

첫 화면은 dashboard가 아니라 trace list다.

- 상단 navigation에서 `Traces`, `Annotation Queues`, `Scores`, `Datasets`,
  `Local Data`를 분리
- status, name, duration, node count, input summary, timestamp 표시
- 최신순 pagination
- 한 요청당 기본 50개, 최대 200개를 반환하는 cursor pagination
- name, input/output text 검색
- 필요할 때만 펼치는 status, time range, tag, session filter
- 개별 trace 삭제

### Trace Detail

- trace list, 작은 execution graph, 넓은 선택 observation inspector의
  debugging layout
- 실제 observation 관계를 나타내는 execution graph
- status, kind, duration을 표현하는 node
- parallel sibling 배치
- 반복/재시도된 같은 이름의 node를 별도 instance로 표시
- `Node View` 기본 보기와 `Runnable View` 전체 펼치기
- error node 자동 focus
- 선택 node의 핵심 Input/Output 기본 inspector와 전체 JSON 전환
- nested JSON folding과 copy
- graph에는 observation 요약만 먼저 표시하고 node 선택 시 전체 payload 조회
- 같은 session의 이전/다음 trace 이동
- trace의 queue 추가와 삭제는 header의 overflow menu에서 제공
- `Annotation` 영역은 처음에 `Add scores`와 memo만 보이고, 사용자가 trace별로
  평가할 score를 직접 추가한 뒤 값을 기록
- custom score annotation 조회, 생성, 수정, 삭제와 trace memo

### Local Data

- 상단 `Local Data` navigation에서 SQLite backup과 전체 초기화 제공
- trace 탐색 화면에는 backup과 초기화 control을 표시하지 않음

## 5. Functional Requirements

### Trace Collection

- 최상위 wrapped execution 한 번을 trace 하나로 생성한다.
- trace는 실행 전체를 담는 container이고 실제 호출은 항상 observation이다.
- 최상위 호출은 `parent_observation_id=null`인 root observation이 된다.
- ASGI wrapper가 있으면 HTTP observation이 root이고 runnable은 그 child다.
- trace input/output은 root observation의 값을 복사해 list와 header에 사용한다.
- 기존 trace context 안의 wrapped runnable은 새 trace가 아니라 child
  observation이 된다.
- sync, async, invoke, stream 실행을 지원한다.
- 일반 invoke는 최종 output만 저장한다.
- stream chunk는 memory에서 aggregate하고 terminal 상태에서 한 번 저장한다.
- completed, failed, cancelled 상태를 구분한다.
- LangChain callback event를 발생시키는 내부 run을 누락하지 않는다.
- concurrent request context가 섞이지 않는다.

### Payload

- 질문, prompt, profile, retrieved document, model output, metadata, error를
  크기 제한 없이 저장한다.
- user data에 대한 기본 redaction이나 truncation을 하지 않는다.
- API key, cookie 같은 infrastructure secret을 의도적으로 수집하는 기능은
  만들지 않지만 arbitrary payload 안의 값을 자동 검사하거나 제거하지도
  않는다.
- 원래 Python object를 JSON-compatible diagnostic representation으로
  변환한다.
- payload에 인위적인 크기 제한은 없지만 memory-only 수집이므로 매우 크거나
  끝나지 않는 stream은 application process memory를 소진할 수 있다. v1은
  이를 해결하기 위한 spool이나 자동 truncation을 제공하지 않는다.

### Delivery

- bounded in-memory queue와 background batch HTTP sender를 사용한다.
- client disk spool은 사용하지 않는다.
- 짧은 retry와 graceful shutdown flush를 제공한다.
- collector outage, queue overflow, serialization failure처럼 SDK가 포착할 수
  있는 오류는 관측 대상 application을 실패시키지 않는다. Process OOM은
  이 보장 범위 밖이다.
- 전달 불가 trace는 버리고 warning log를 남길 수 있다.

### Persistence

- SQLite에 무기한 저장한다.
- single server process와 single writer를 사용한다.
- write API는 SQLite commit 이후 성공을 반환한다.
- batch HTTP request는 network batching일 뿐이며 trace envelope별 transaction으로
  저장한다. 잘못된 envelope 하나가 다른 envelope 저장을 막지 않는다.
- retry된 trace/observation ID는 first-write-wins로 처리하고 이미 존재하면
  성공으로 간주한다.
- trace 삭제 시 observation, annotation, memo, queue item도 함께 삭제한다.
- 삭제/reset 직후 전송 중이던 SDK retry가 도착하면 trace가 다시 나타날 수
  있다. v1은 tombstone이나 reset epoch를 두지 않는다.
- 전체 reset UI를 제공한다.
- SQLite online backup을 다운로드할 수 있다.
- 복원은 server를 중지한 뒤 전용 CLI로 integrity check와 DB 교체를 수행한다.

### Metadata

- optional `session_id`, `user_id`, `release`, `environment`, `tags`,
  arbitrary metadata를 지원한다.
- LangGraph `thread_id`를 기본 `session_id` 후보로 인식한다.
- model name, provider usage metadata, input/output token을 얻을 수 있을 때
  저장한다.
- duration은 monotonic clock으로 계산하고 streaming LLM의 첫 token callback을
  얻을 수 있을 때 `time_to_first_token_us`를 저장한다.
- 얻을 수 없는 token을 추정하지 않는다.
- model cost를 계산하지 않는다.

### Scores and Annotations

- 사용자는 boolean, finite number, categorical single/multiple score를 만든다.
- `Scores` 첫 화면은 검색 가능한 score 목록을 우선하며, 생성 form은
  `New Score`를 눌렀을 때만 별도 집중 UI로 연다.
- boolean은 true/false label, number는 optional minimum/maximum,
  categorical은 사용자 정의 option을 가진다.
- categorical multiple의 빈 배열은 유효한 기록이며 미기록과 구분한다.
- system `None` option은 자동 생성하지 않는다. 필요한 의미는 사용자가 option으로
  직접 만든다.
- string/text score 대신 trace당 자유 형식 메모 하나를 제공한다.
- 현재 annotation target은 trace 전체다. persistence model은 향후 observation
  target을 추가할 수 있도록 `target_type`, `target_id`, 소유 `trace_id`를 가진다.
- annotation에 사용된 score의 값 구조와 option 의미는 바꾸지 않는다. 이름과
  설명만 수정할 수 있고 삭제 대신 archive한다.

### Annotation Queues

- `Annotation Queues` 첫 화면은 queue 생성과 검색 가능한 목록만 제공한다.
- queue를 선택하면 목록 화면을 떠나 해당 queue의 trace, 설정, review를
  다루는 별도 상세 화면으로 이동한다.
- queue review는 Trace Detail과 같은 observation Input/Output inspector를 사용한다.
- queue 생성 시 사용할 score만 사용자가 고르며, trace가 없는 상태로 시작한다.
- trace 상세의 `Add to Queue`에서 현재 trace를 기존 queue에 추가한다.
- 생성 뒤에도 score 목록은 수정할 수 있고, trace 항목은 queue 상세에서 제거할 수
  있다.
- 새 trace나 새 score는 기존 queue에 자동으로 들어가지 않는다.
- queue item 완료는 score나 memo의 작성 여부가 아니라 사용자의 `완료` 동작으로만
  결정한다.
- 완료 item은 읽기 전용이다. `수정`을 누르면 즉시 pending으로 전환되고,
  기존 값은 유지되며 다시 `완료`를 눌러야 completed가 된다.
- queue 진행 표시는 `완료 수 / 전체 수`만 제공한다. 작성률이나 coverage를 별도
  KPI로 계산하지 않는다.

## 6. Non-functional Requirements

### Simplicity

- production install은 application container 하나와 named volume 하나다.
- Node.js runtime은 production image에 포함하지 않는다.
- login, Redis, message broker, object storage, external database가 없어야 한다.

### Isolation

- SDK 내부 오류는 기본적으로 warning으로 처리하고 원래 application
  return value와 exception을 보존한다.
- wrapper가 application exception traceback을 대체하지 않는다.

### Performance

- application request thread/event loop에서 network commit을 기다리지 않는다.
- queue는 bounded여야 한다.
- UI list API는 pagination해야 한다.
- production server는 하나의 worker로 실행한다.

정확한 resource budget은 구현 후 idle과 sample workload benchmark로
기록한다. 근거 없는 수치를 사전 목표로 고정하지 않는다.

### Security Boundary

- 기본 Docker port binding은 `127.0.0.1:4319:4319`다.
- login과 API key는 v1에 없다.
- production CORS는 비활성화하고 `localhost`, `127.0.0.1` Host만 허용한다.
- mutation API는 `application/json`만 허용하며 reset은 명시적인
  `{"confirmation": "RESET"}`을 요구한다.
- `0.0.0.0` binding은 사용자가 명시적으로 변경해야 한다.
- 외부 공개를 production-safe하다고 문서화하지 않는다.

## 7. Explicitly Out of Scope

- multi-project, multi-tenant, organization, RBAC
- cloud-hosted service와 account
- OpenTelemetry/OTLP ingest
- JavaScript/TypeScript SDK
- browser tracing
- provider SDK global monkey patch
- static LangGraph editor 또는 가능한 모든 path 시각화
- live-running trace UI
- client disk spool과 guaranteed delivery
- PostgreSQL, ClickHouse, Redis, Kafka, object storage
- prompt management/versioning UI
- managed LLM evaluator, server-side evaluator execution, scheduler/worker
- observation/node 단위 annotation과 dynamic query queue
- aggregate cost dashboard와 pricing catalog
- sampling, retention policy, payload size limit
- automatic PII/secret redaction
- high availability와 multi-worker server
- 실행 중 hot restore와 restore UI
- LangChain `batch`, `abatch`, `astream_events` 자동 추적

## 8. V1 Acceptance Criteria

v1은 다음 demo가 재현될 때 완료다.

1. 새 사용자가 compose로 server/UI를 실행한다.
2. sample LangGraph를 `wrap_runnable()` 한 줄로 감싼다.
3. sequential, parallel, loop, failed node를 포함한 trace가 저장된다.
4. UI graph와 inspector에서 모든 runtime observation과 원본 payload를 본다.
5. custom score와 trace 메모를 저장하고 categorical multiple의 빈 배열과
   미기록을 구분할 수 있다.
6. 고정 annotation queue를 만들고 각 trace를 명시적으로 완료·수정할 수 있다.
7. trace 하나를 삭제하고 전체 data를 reset할 수 있다.
8. backup을 내려받고 server를 중지한 상태에서 CLI로 깨끗한 volume에
   복원할 수 있다.
9. collector를 중단해도 sample application 결과와 exception behavior가
   달라지지 않는다.
10. amd64와 arm64 image가 build된다.
11. installation, instrumentation, limitations 문서가 신규 사용자 기준으로
    검증된다.

# Data and API Contract

이 문서는 SDK와 server 사이의 canonical contract다. 구현 중 field를
변경하면 SDK, server, UI types, fixtures, integration tests를 같은
change에서 갱신한다.

## 1. Common Rules

- 모든 ID는 client가 생성하는 opaque string이다.
- timestamp는 timezone을 포함한 ISO 8601 UTC string이다.
- payload는 JSON-compatible value이며 object만 강제하지 않는다.
- v1 envelope에는 `schema_version: 1`을 포함한다.
- v1 server는 `schema_version: 1`만 수용하고 다른 version은 envelope를
  validation error로 거부한다.
- envelope의 unknown top-level field는 무시한다. `input`, `output`,
  `metadata` 내부의 arbitrary field는 payload 일부이므로 그대로 보존한다.
- ID는 1~128자 opaque string이고 name은 1~255자 string이다.
- wall-clock timestamp는 표시와 정렬에 사용하고 duration은 client의
  monotonic clock으로 계산한 integer microseconds를 사용한다.

## 2. Trace

```json
{
  "trace_id": "tr_01...",
  "name": "policy-rag",
  "started_at": "2026-07-25T12:00:00.000000Z",
  "ended_at": "2026-07-25T12:00:01.500000Z",
  "duration_us": 1500000,
  "status": "completed",
  "input": {"question": "청년 정책을 알려줘"},
  "output": {"answer": "..."},
  "error": null,
  "session_id": "chat-123",
  "user_id": "user-7",
  "release": "2026.07.25",
  "environment": "local",
  "tags": ["rag", "manual-test"],
  "metadata": {}
}
```

Required:

- `trace_id`
- `name`
- `started_at`
- `ended_at`
- `status`
- `duration_us`

Status:

- `completed`
- `failed`
- `cancelled`

`input`, `output`, `error`는 JSON `null`일 수 있다. `failed`는 가능한 경우
structured error를 가져야 한다.

Trace는 실행 전체를 담는 container다. 실제 호출은 observation으로 표현하며
trace에는 정확히 하나의 root observation이 있어야 한다. Trace의
input/output/error는 root observation 값을 복사해 list와 header에서 빠르게
사용한다. Server는 복사값의 deep equality를 재검사하지 않는다.

## 3. Observation

```json
{
  "observation_id": "obs_01...",
  "trace_id": "tr_01...",
  "parent_observation_id": null,
  "sequence": 1,
  "name": "retrieve_documents",
  "kind": "retriever",
  "started_at": "2026-07-25T12:00:00.100000Z",
  "ended_at": "2026-07-25T12:00:00.400000Z",
  "duration_us": 300000,
  "time_to_first_token_us": null,
  "status": "completed",
  "input": {"query": "청년 정책"},
  "output": [{"__type__": "Document", "page_content": "...", "metadata": {}}],
  "error": null,
  "model": null,
  "usage": null,
  "metadata": {
    "langgraph_node": "retriever",
    "langgraph_step": 2
  }
}
```

Required:

- `observation_id`
- `trace_id`
- `sequence`
- `name`
- `kind`
- `started_at`
- `ended_at`
- `status`
- `duration_us`

Initial `kind` vocabulary:

- `chain`
- `llm`
- `retriever`
- `tool`
- `function`
- `http`
- `runnable`
- `custom`

Server와 UI는 unknown kind도 보존하고 generic node로 표시한다.

Observation은 v1에서 하나의 parent만 가진다. root observation의
`parent_observation_id`는 `null`이고 envelope에는 root가 정확히 하나 있어야
한다. ASGI wrapper가 있으면 HTTP observation이 root이고 runnable observation은
그 child다.

LangGraph `Send`는 callback parent와 다른 dynamic dispatch 관계를 만들 수
있다. SDK가 `Send` target과 Pregel push index를 실제로 대응시킨 경우에만
dispatcher observation metadata에 `langfeather_dispatches`, 대상 observation
metadata에 `langfeather_dispatch_source_observation_id`를 저장한다. 이 값은
callback parent를 대체하지 않으며 UI가 별도 dispatch edge를 그리기 위한
명시적 근거다. 대응이 유일하지 않거나 관찰되지 않으면 저장하지 않는다.

`sequence`는 0 이상의 integer이며 trace 안에서 unique하다. observation이
시작될 때 thread-safe counter로 부여하고, 같은 trace를 조회할 때 안정적인
순서를 제공한다. 실행 간 동일 순서를 보장한다는 의미는 아니다.

Parent는 같은 trace와 envelope 안에 존재해야 하며 self-parent와 parent cycle은
허용하지 않는다. `ended_at`은 `started_at`보다 빠를 수 없다. `duration_us`와
token usage는 0 이상이다. `time_to_first_token_us`는 streaming LLM에서 실제
첫 token callback을 관찰한 경우에만 저장하고 그 외에는 `null`이다.

Child observation이 실패했지만 retry나 fallback으로 root 실행이 성공할 수
있다. 이 경우 child는 `failed`, trace와 root는 `completed`다. Trace status는
root observation의 terminal status를 따른다.

## 4. Error

```json
{
  "__type__": "builtins.ValueError",
  "message": "invalid input",
  "repr": "ValueError('invalid input')",
  "traceback": [
    {
      "file": "/app/graph.py",
      "line": 42,
      "function": "run_node",
      "code": "raise ValueError('invalid input')"
    }
  ]
}
```

Error serialization 자체가 실패하면 최소한 type과 safe `repr`를 남긴다.
관측 wrapper는 원래 exception instance와 traceback을 application에 그대로
전파한다.

## 5. Usage

```json
{
  "input_tokens": 120,
  "output_tokens": 45,
  "total_tokens": 165,
  "provider": "openai",
  "raw": {}
}
```

모든 numeric field는 optional이다. provider가 제공한 값만 기록하며
tokenizer로 추정하지 않는다. cost field는 canonical model에 없다.
Token count는 0 이상의 integer여야 한다.

## 6. Completed Envelope

```json
{
  "schema_version": 1,
  "trace": {},
  "observations": []
}
```

Trace와 observations는 immutable terminal snapshot으로 취급한다. Trace
envelope 하나를 transaction 하나로 저장한다.

- 처음 보는 `trace_id`는 trace와 모든 observation을 함께 저장한다.
- 이미 존재하는 `trace_id`는 first-write-wins로 `duplicate` 성공 처리하고
  기존 내용을 덮어쓰거나 merge하지 않는다.
- 새로운 trace의 observation ID가 다른 trace에서 이미 사용 중이면 해당
  envelope를 validation error로 거부한다.
- partial started state를 지원하기 위한 update API는 만들지 않는다.

## 7. Feedback

```json
{
  "feedback_id": "fb_01...",
  "trace_id": "tr_01...",
  "name": "user_feedback",
  "value": false,
  "comment": "조건이 맞지 않는 정책을 추천함",
  "metadata": {"source": "chat-ui"},
  "created_at": "2026-07-25T12:01:00.000000Z",
  "updated_at": "2026-07-25T12:01:00.000000Z"
}
```

`value`는 boolean, finite number, string 중 하나다. `POST`에서 같은
feedback ID가 retry되면 first-write-wins duplicate 성공으로 처리하고,
`PATCH`는 기존 feedback을 명시적으로 수정한다. feedback은 trace ingest
전에 도착할 수 있다. 따라서 database-level trace foreign key로 ingest
순서를 강제하지 않고 service transaction이 trace 삭제 시 관련 feedback도
삭제한다.

## 8. Serialization Markers

권장 representation:

```json
{"__type__": "uuid.UUID", "value": "..."}
{"__type__": "datetime.datetime", "value": "2026-07-25T12:00:00+00:00"}
{"__type__": "decimal.Decimal", "value": "12.50"}
{"__type__": "pathlib.PosixPath", "value": "/tmp/file"}
{"__type__": "builtins.bytes", "encoding": "base64", "value": "..."}
{"__type__": "builtins.float", "value": "nan"}
{"__type__": "builtins.float", "value": "infinity"}
{"__type__": "builtins.int", "value": "9007199254740993"}
{"__type__": "builtins.dict", "items": [[1, "integer key"], ["1", "string key"]]}
{"__type__": "app.UserState", "fields": {"question": "..."}}
{"__type__": "package.Class", "__unsupported__": true, "repr": "..."}
{"__type__": "cycle", "path": "$.metadata.parent"}
```

일반 string-key dict는 JSON object로 저장한다. Non-string key가 있거나
serializer 예약 marker key와 충돌하는 dict는 type marker와 key/value
`items`를 사용한다. 예약 marker key는 `__type__`, `__unsupported__`,
`encoding`, `items`다.

JSON이 표현할 수 없는 `NaN`, positive/negative infinity와 JavaScript safe
integer 범위 `-(2^53-1)`~`2^53-1` 밖의 integer는 marker와 string value로
저장한다. Naive datetime은 ISO value와 `"naive": true`를 함께 저장한다.

Tuple과 set은 type marker와 items를 사용해 list와 구분한다. Set은 원래
순서가 없는 collection이므로 item 순서의 재현성을 보장하지 않는다.
Pydantic model은 qualified type과 dumped fields를, LangChain Document와
Message, dataclass는 semantic fields와 qualified type을 `fields`에 함께
저장한다. Adapter 하나가 실패하면 전체 application이나 envelope를
실패시키지 않고 해당 값만 unsupported marker로 바꾼다. Exception은 type,
message, bounded safe `repr`, 가능한 traceback frame을 저장한다.

## 9. HTTP API

Base path: `/api/v1`

### Ingest

```text
POST /traces/batch
```

Request:

```json
{
  "items": [
    {
      "schema_version": 1,
      "trace": {},
      "observations": []
    }
  ]
}
```

Batch는 HTTP 호출 수를 줄이기 위한 network batching이다. 각 envelope는
독립적으로 validate하고 transaction을 commit한다. 하나의 invalid envelope가
다른 valid envelope 저장을 막지 않는다.

Request JSON 자체가 잘못되면 `422`를 반환한다. Request 형식이 유효하면 일부
envelope가 거부되어도 `200`과 item별 결과를 반환한다.

```json
{
  "results": [
    {"trace_id": "tr_01", "status": "stored", "error": null},
    {"trace_id": "tr_02", "status": "duplicate", "error": null},
    {
      "trace_id": "tr_03",
      "status": "rejected",
      "error": {"code": "validation_error", "message": "..."}
    }
  ]
}
```

SDK는 network error, timeout, `408`, `429`, `5xx`만 짧게 retry한다. `422`와
item-level `rejected`는 retry하지 않고 warning을 남긴다.

### Trace Query

```text
GET    /traces
GET    /traces/{trace_id}
DELETE /traces/{trace_id}
```

List query parameters:

- `cursor`
- `limit`
- `status`
- `from`
- `to`
- `tag`
- `session_id`
- `query`

`limit`은 한 응답에 포함할 trace 수다. 기본값은 50이고 최대값은 200이다.
Cursor가 없는 요청은 첫 페이지다. Response의 `next_cursor`를 다음 요청의
`cursor`에 그대로 전달한다.

```json
{
  "items": [],
  "next_cursor": "eyJ2IjoxLCJzdGFydGVkX2F0IjoiLi4uIiwidHJhY2VfaWQiOiIuLi4ifQ"
}
```

Cursor는 `(started_at, trace_id)` 위치를 담은 URL-safe opaque token이다.
Client는 내부를 해석하거나 생성하지 않는다. 정렬은
`started_at DESC, trace_id DESC`이고 cursor는 exclusive boundary다. 잘못된
cursor는 `400`으로 거부한다. 다음 page가 없으면 `next_cursor`는 `null`이다.
검색어나 filter가 바뀌면 client는 기존 cursor를 버리고 cursor 없는 첫
요청부터 다시 시작한다.

List item은 scalar field, `duration_us`, `observation_count`,
`input_preview`만 포함하고 전체 input/output은 포함하지 않는다.
`input_preview`는 저장된 원본을 변경하지 않는 별도 display field다.
`query`는 trace name과 저장된 input/output JSON text에 단순 `LIKE` 검색을
수행하며 고급 검색 성능은 보장하지 않는다.

Trace detail은 trace scalar field, observation summary, feedback을 포함하고
observation input/output/error 전체는 포함하지 않는다. `session_id`가 있을 때
동일 session에서 시간상 바로 이전/다음 trace가 있으면 각각
`previous_trace_id`, `next_trace_id`를 포함한다. 이 두 field가 `null`이면 더
이동할 trace가 없다.

### Observation Payload

```text
GET /observations/{observation_id}
```

선택 observation의 전체 input, output, error, usage, metadata를 반환한다.
Trace detail 화면은 root observation payload를 먼저 조회해 header의
input/output을 표시하고 이후 선택 node payload만 lazy-load한다.

### Feedback

```text
POST   /feedback
PATCH  /feedback/{feedback_id}
DELETE /feedback/{feedback_id}
```

`POST` body는 Feedback object 전체다. 새 feedback은 `201`, 같은
`feedback_id`의 retry는 저장된 원문을 돌려주는 `200`이다. `PATCH` body는
`value`, `comment`, `metadata` 중 하나 이상이며, server가 `updated_at`을
갱신한다. `DELETE`는 `204`를 반환한다. 모든 mutation request는
`application/json`이어야 한다.

### Session

```text
GET /sessions/{session_id}/traces
```

전용 session entity를 만들 필요는 없다. trace의 `session_id`로 조회한다.

### Administration

```text
GET  /admin/backup
POST /admin/reset
GET  /health
```

Reset은 JSON body `{"confirmation": "RESET"}`을 요구한다. Production은
CORS를 활성화하지 않고 기본으로 `localhost`, `127.0.0.1` Host만 허용한다.
같은 Docker network의 service name처럼 추가 local Host가 필요할 때만
`LANGFEATHER_TRUSTED_HOSTS`에 comma-separated allowlist를 명시한다. 모든
mutation endpoint는 `application/json`만 수용한다.

`GET /health`는 server version, supported schema versions, database migration
version을 반환한다.

Restore는 실행 중 HTTP API로 제공하지 않는다. Server를 중지한 뒤 다음 CLI를
실행한다.

```text
langfeather-server restore /path/to/backup.db
```

CLI는 `PRAGMA integrity_check`, supported Alembic migration version을 확인하고
기존 DB의 안전 복사본을 만든 뒤 atomic file replace를 수행한다.

## 10. Suggested Tables

### traces

- `trace_id` primary key
- indexed scalar fields: name, status, started_at, ended_at, session_id,
  user_id, release, environment
- JSON text: input, output, error, tags, metadata
- derived: duration_us, observation_count, input_preview

### observations

- `observation_id` primary key
- `trace_id` foreign key with cascade delete
- nullable `parent_observation_id`
- unique `(trace_id, sequence)`
- indexed: trace_id, parent_observation_id, kind, status, started_at
- JSON text: input, output, error, usage, metadata

### feedback

- `feedback_id` primary key
- indexed `trace_id`
- name, typed value columns or canonical JSON value
- comment, metadata, created_at, updated_at
- trace ingest 순서를 허용하기 위해 strict foreign key는 두지 않는다.

## 11. Deletion and Restore Semantics

- trace delete는 trace, observations, feedback을 하나의 transaction에서
  hard-delete한다.
- reset은 모든 product data를 삭제하지만 schema migration state는
  유지한다.
- backup은 consistent SQLite snapshot이다.
- restore는 server가 중지된 상태에서만 실행한다.
- restore는 integrity와 migration version을 검사하고 incompatible backup을
  거부한다.
- restore가 실패하면 기존 database를 그대로 유지해야 한다.
- delete/reset 직후 in-flight SDK retry가 도착하면 trace가 다시 생성될 수
  있다. v1은 tombstone과 reset epoch를 저장하지 않는다.

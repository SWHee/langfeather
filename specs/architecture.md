# 기술 구조

```text
Python application ── SDK batch HTTP ──> FastAPI + SQLite + React UI
Browser ───────────────────────────────> same-origin UI/API
```

LangFeather는 Python SDK와 하나의 collector container로 구성된다. Redis, worker,
external database, object storage는 사용하지 않는다.

## 구성 요소

| 구성 요소 | 책임 |
| --- | --- |
| `sdk/python` | context propagation, trace builder, serialization, optional LangChain callback, background delivery |
| `server` | HTTP validation, SQLite transaction, query/aggregate, backup/restore CLI, static web serving |
| `web` | Overview, trace debugging, annotation queue, score, evaluation, local data UI |

SDK core는 FastAPI/LangChain/LangGraph에 직접 의존하지 않는다. LangChain integration은
optional module이며, server와 SDK는 versioned JSON envelope로만 연결한다.

## trace lifecycle

1. `wrap_runnable()`, `@observe`, `span()`, `wrap_asgi()`가 root 또는 child observation을 만든다.
2. runtime 관계와 diagnostic payload를 memory의 trace builder에 모은다.
3. completed, failed, cancelled terminal 상태에서 envelope 하나를 만든다.
4. bounded queue의 background sender가 `/api/v1/traces/batch`로 전송한다.
5. server는 envelope별 transaction으로 SQLite에 commit하고, UI는 summary와 lazy payload를 조회한다.

trace는 container이고 실행은 observation이다. root observation은 하나이며
`parent_observation_id`가 없다. UI는 callback/context가 확인한 parent 관계만 표시한다.
정적 LangGraph topology나 data dependency를 추론하지 않는다.

## context와 streaming

`contextvars`가 현재 trace와 observation stack을 분리한다. top-level wrapper는 trace를
만들고 nested wrapper는 child observation을 만든다. ASGI wrapper를 적용하면 HTTP request가
root가 된다.

`stream`/`astream` chunk와 원래 예외는 application에 그대로 전달한다. SDK는 terminal
payload를 만들기 위해 chunk를 memory에 모으므로, 매우 크거나 끝나지 않는 stream은 memory
사용량을 키울 수 있다.

## 전송과 저장

- sender queue는 bounded in-memory queue이며 disk spool은 없다.
- network error, `408`, `429`, `5xx`만 짧게 retry한다.
- queue overflow와 hard kill에서는 trace 유실이 가능하다.
- `flush()`는 호출 시점까지 SDK가 받은 envelope 처리만 기다리며 DB durability를 보장하지 않는다.
- server는 SQLite WAL, `synchronous=FULL`, Uvicorn worker 하나를 사용한다.
- 같은 trace ID 재전송은 first-write-wins duplicate 성공으로 처리한다.

## UI와 deployment

production에서는 FastAPI가 Vite build 결과를 제공한다. development에서는 Vite가 `/api`를
server로 proxy한다. 기본 compose는 하나의 container와 `langfeather-data` volume을 사용하며
`127.0.0.1:4319`에 bind한다.

`0.3.0`은 public remote deployment를 지원하지 않는다. GHCR image는 local collector 실행
마찰을 낮추는 배포 artifact이며, HTTPS·login·team access를 뜻하지 않는다.

## 변경 시 지킬 seam

- HTTP base path는 `/api/v1`, envelope `schema_version`은 현재 `1`
- client-generated opaque ID
- generic observation `kind`
- SQLite migration은 Alembic revision으로 관리
- product version, schema version, migration revision은 서로 독립

# Decisions

이 문서는 제품 논의에서 확정된 결정을 기록한다. `Locked` 항목은 구현
편의만으로 변경하지 않는다. 변경이 필요하면 이유, 영향, migration을 포함한
새 decision record를 작성하고 사용자 승인을 받는다.

## Locked

| Area | Decision | Rationale |
| --- | --- | --- |
| Product | 이름은 LangFeather다. | lightweight Lang ecosystem tracing을 표현한다. |
| Audience | 개인 개발자와 LangGraph application 사용자가 주 사용자다. | 모든 trade-off의 기준이다. |
| Scope | v1은 single project, single user다. | tenant와 auth 복잡성을 제거한다. |
| Deployment | 개인 local Docker installation이다. | cloud service가 아니다. |
| Port | 기본 port는 `4319`다. | 다른 local service와 충돌을 줄인다. |
| Exposure | 기본 bind는 `127.0.0.1`이고 login은 없다. | local simplicity와 accidental exposure 방지를 절충한다. |
| Packaging | UI와 API는 하나의 production container다. | Next.js server와 별도 frontend container를 제거한다. |
| Backend | FastAPI를 사용한다. | 작은 JSON API와 static SPA serving에 충분하다. |
| Frontend | Vite, React, TypeScript, React Flow를 사용한다. | static SPA와 execution graph UI에 적합하다. |
| Database | SQLite, SQLAlchemy 2.0, Alembic을 사용한다. | local single-user workload에 가장 단순하다. |
| SQLite mode | single process/writer, WAL, `synchronous=FULL`이다. | 2xx 이후 committed data durability를 명확히 한다. |
| Transport | custom versioned JSON API다. | v1에서 OTel complexity가 필요하지 않다. |
| SDK language | Python 3.10 이상만 지원한다. | 주 사용자 stack에 집중한다. |
| SDK core | framework-independent다. | FastAPI와 LangChain 강제 의존을 피한다. |
| Integration | LangChain/LangGraph는 optional integration이다. | 일반 Python과 ASGI에도 사용할 수 있다. |
| Automatic capture | `wrap_runnable()`이 내부 Runnable을 callback으로 수집한다. | 사용자 코드를 최소화한다. |
| Generic capture | `@observe`, `span()`, `wrap_asgi()`를 제공한다. | framework 밖 실행도 추적한다. |
| Monkey patch | global zero-code monkey patch는 없다. | fragility, duplicate trace, version coupling을 피한다. |
| Trace boundary | 최상위 wrapped execution 한 번이 trace 하나다. | CLI, notebook, web에서 일관된 규칙이다. |
| Trace model | trace는 container이고 실제 호출은 항상 observation이다. | root와 child 관계를 한 모델로 표현한다. |
| Root observation | 최상위 호출은 parent가 없는 root observation이며 trace input/output은 root 값을 복사한다. | list와 graph 표현을 일관되게 한다. |
| Nested wrapper | 기존 context에서는 child observation이 된다. | duplicate root trace를 방지한다. |
| ASGI root | ASGI wrapper가 있으면 HTTP request가 root observation이다. | request validation부터 disconnect까지 묶는다. |
| Persistence timing | terminal 상태에서 trace envelope를 한 번 저장한다. | started/update write amplification을 제거한다. |
| Live UI | v1에 없다. | partial state persistence 복잡성을 피한다. |
| Streaming | chunks를 aggregate하고 완료 시 저장한다. | UI는 final diagnostic payload에 집중한다. |
| Delivery | bounded memory queue, background batch HTTP, short retry다. | application latency와 collector를 분리한다. |
| Spool | client local disk spool은 없다. | local debugging 목적에서 complexity를 우선 줄인다. |
| Reliability | best-effort이며 hard kill과 queue overflow 유실을 허용한다. | guaranteed delivery가 목표가 아니다. |
| Failure isolation | tracing 문제는 application을 실패시키지 않는다. | 관측 도구의 핵심 안전 경계다. |
| Retention | 무기한 보관한다. | 사용자가 직접 관리한다. |
| Payload limits | 크기 제한, truncation, sampling이 없다. | 디버깅 원문을 보존한다. |
| Large stream limit | 매우 크거나 끝나지 않는 stream의 memory 고갈은 알려진 한계다. | spool과 자동 truncation을 도입하지 않는다. |
| Redaction | application payload를 자동 redaction하지 않는다. | local-only와 원문 보존 결정을 따른다. |
| Delete | 개별 trace 삭제와 전체 초기화 UI를 제공한다. | 무기한 보관의 사용자 제어 수단이다. |
| Backup | online SQLite backup download를 제공한다. | 실행 중에도 consistent snapshot을 만든다. |
| Restore | server를 중지하고 CLI로 integrity check 후 DB를 교체한다. | hot restore의 connection/WAL 동시성 복잡성을 피한다. |
| Serialization | JSON-compatible diagnostic representation을 저장한다. | HTTP와 SQLite에서 안전하게 조회한다. |
| Unknown object | type과 bounded-safe `repr` fallback을 사용한다. | arbitrary `__dict__` traversal을 피한다. |
| Pickle | 사용하지 않는다. | version coupling과 code execution 위험을 피한다. |
| Graph semantics | runtime observation relation만 표시한다. | 정적 graph나 미확인 data edge를 추측하지 않는다. |
| Internal nodes | callback event가 발생한 모든 내부 run을 저장한다. | 관찰 가능한 실행의 완전성을 우선한다. |
| UI noise | 내부 node는 기본 collapse할 수 있지만 삭제하지 않는다. | 완전성과 가독성을 함께 제공한다. |
| UI simplicity | 화면에는 현재 작업에 꼭 필요한 component와 설명만 둔다. | 사용자가 실행 경로와 원본 data에 바로 집중하게 한다. |
| UI navigation | top navigation은 `Traces`, `Annotation Queues`, `Scores`, `Local Data`로 나누고 backup/reset은 `Local Data`에만 둔다. | trace 확인, 반복 평가, 평가 schema 관리, local data 관리를 분리한다. |
| Score management UI | `Scores`는 검색 가능한 table을 기본 화면으로 두고 create form은 `New Score` 동작 뒤의 별도 집중 UI에 둔다. | 자주 하는 조회와 드문 schema 생성을 같은 시각적 우선순위로 두지 않는다. |
| Queue navigation UI | annotation queue 생성/목록과 선택 queue의 상세 review를 같은 화면에 동시에 표시하지 않는다. | queue 탐색과 trace 평가의 작업 맥락을 분리한다. |
| Detail layout | 작은 execution graph와 더 넓은 선택 observation Input/Output inspector를 나란히 두고 `Node View`와 `Runnable View`를 사용한다. | 실행 구조보다 실제 data 확인에 더 많은 공간을 준다. |
| Trace actions | queue 추가와 삭제는 trace header의 overflow menu 하나로 묶고, queue review도 Trace Detail과 같은 inspector를 사용한다. | 낮은 빈도의 동작을 숨기고 입출력 확인 방식을 일관되게 유지한다. |
| Session | optional `session_id`로 trace를 연결한다. | multi-turn navigation에 필요하다. |
| LangGraph session | `thread_id`를 session 후보로 자동 인식한다. | 사용자 추가 코드를 줄인다. |
| LLM metadata | 실제 model/usage/token metadata만 저장한다. | provider 응답을 보존한다. |
| Cost | 계산하지 않는다. | pricing maintenance를 제거한다. |
| Score types | custom boolean, finite number, categorical single/multiple score를 지원한다. string/text score는 만들지 않는다. | 구조화된 평가와 자유 형식 메모의 역할을 분리한다. |
| Annotation target | 현재 UI/API는 trace 전체 평가만 지원하되 annotation은 `target_type`, `target_id`, 소유 `trace_id`를 저장한다. | observation/node 평가를 나중에 추가할 migration seam을 보존한다. |
| Trace annotation UI | Trace detail은 처음에 `Add scores`와 memo만 보이고, 사용자가 해당 trace에서 평가할 score를 고른 뒤에만 입력 field를 표시한다. | 모든 active score를 일괄 노출하지 않아 trace별 평가 의도를 명확히 한다. |
| Categorical multiple | 빈 배열 `[]`을 명시적으로 기록할 수 있고 미기록과 구분한다. system `None` option은 만들지 않는다. | 선택 결과 없음과 아직 평가하지 않음을 구분하며 의미는 사용자가 정의하게 한다. |
| Trace memo | 자유 형식 메모는 score가 아니라 trace당 하나이며 모든 queue에서 공유한다. | 반복 queue마다 메모가 갈라지는 것을 피한다. |
| Annotation queue | queue 생성 시 score를 선택하고 빈 queue로 시작한다. trace는 trace 상세의 `Add to Queue`로 기존 queue에 추가하며 자동 유입은 없다. | 이름이 같은 trace가 많이 쌓여도 현재 보고 있는 실행을 명확하게 추가한다. |
| Queue completion | score 작성 여부와 무관하게 사용자가 item의 `완료`를 눌렀을 때만 완료한다. 완료 item은 읽기 전용이고 `수정`을 누르면 즉시 pending으로 돌아간다. | 작업 상태와 평가 값 존재 여부를 분리한다. |
| Score lifecycle | 사용 전 score는 구조 변경/삭제 가능하고, annotation에 사용된 뒤에는 이름/설명만 수정하며 archive한다. | 과거 annotation의 해석을 보존한다. |
| Search | SQLite scalar index와 단순 text search를 사용한다. | 별도 search infrastructure를 피한다. |
| Pagination | 기본 50, 최대 200의 opaque cursor pagination을 사용한다. | 새 trace와 삭제가 있어도 page 이동을 안정적으로 유지한다. |
| Ingest transaction | batch request 안의 trace envelope별로 transaction을 수행한다. | malformed item이 정상 trace를 막는 poison batch를 피한다. |
| Idempotency | 같은 ID는 first-write-wins이며 retry는 성공으로 처리한다. | content merge와 digest 비교를 피한다. |
| Delete race | 삭제/reset 직후 in-flight retry로 trace가 다시 나타날 수 있다. | tombstone과 ingestion epoch를 만들지 않는다. |
| Schema compatibility | v1 server는 `schema_version=1`만 수용한다. | 복잡한 forward-compatibility layer를 피한다. |
| Release versioning | 첫 공개 baseline은 `0.1.0`이며 product release는 SDK, server, web, Git tag를 같은 SemVer로 맞춘다. | 사용자가 설치한 SDK와 local server의 조합을 명확히 한다. |
| Version boundaries | product version, `schema_version`, Alembic revision은 서로 독립적이다. | release, HTTP compatibility, database migration의 목적이 다르다. |
| Runnable methods | v1 자동 추적은 invoke, ainvoke, stream, astream만 지원한다. | 일반적인 LangGraph application 실행 경로에 집중한다. |
| Runnable completeness | callback event가 발생한 내부 run을 모두 저장한다. | callback으로 관찰할 수 없는 호출까지 보장하지 않는다. |
| Detail loading | graph summary와 선택 observation payload를 분리 조회한다. | 큰 trace를 한 번에 browser로 보내지 않는다. |
| Timing | duration과 TTFT는 monotonic clock으로 계산한다. | wall-clock 변경의 영향을 피한다. |
| Local web safety | production CORS off, trusted local Host, JSON-only mutation을 사용한다. | 인증 없이 기본 browser 공격 표면을 줄인다. |

## Deliberately Deferred

- OpenTelemetry exporter 또는 OTLP ingest adapter
- PostgreSQL migration
- multi-project와 authentication
- JavaScript SDK
- live trace
- static LangGraph topology import
- cross-parent links가 필요한 true DAG extension
- cost calculation
- automatic retention
- payload attachment/object storage
- full-text search engine 또는 SQLite FTS
- dataset/experiment/evaluator
- hot restore와 restore UI
- tombstone과 reset epoch
- LangChain batch 계열 자동 추적
- observation/node 단위 annotation UI/API
- trace query로 자동 확장되는 dynamic annotation queue
- queue 완료율 외 score 작성률/coverage KPI

## Implementation Defaults Requiring Validation

아래 값은 제품 결정이 아니라 초기 구현 기본값이다. benchmark와 tests를 통해
lead agent가 조정할 수 있다.

- memory queue capacity
- batch item count와 flush interval
- HTTP timeout
- retry count와 backoff
- shutdown flush timeout
- list page size와 maximum page size
- JSON inspector virtualization threshold
- unknown-object `repr` 최대 길이

값을 바꿔도 payload 자체를 truncate하는 정책으로 확대해서는 안 된다.
`repr` fallback의 제한은 이미 원본 serialization이 불가능한 unsupported
object에서 process safety를 위한 예외다.

## Still Open

구현을 시작하기 전에 반드시 막는 항목은 아니지만 release 전에 결정해야 한다.

- GHCR image의 publication path와 access policy
- PyPI `langfeather` 이름의 최종 availability와 ownership
- license
- public logo와 visual identity
- default warning logger 형식

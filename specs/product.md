# 제품 정의

## 한 문장

LangFeather는 제한된 개발 환경에서 LangGraph 챗봇을 만드는 사람이 실제 실행 흐름과
원본 diagnostic payload를 가볍게 확인하도록 돕는 self-hosted observability 도구다.

## 문제와 사용자

부트캠프 수강생은 각자 LangGraph 챗봇 project를 만들고, 이후 제한된 EC2 resource에
배포할 가능성이 있다. LangSmith는 적용이 쉽지만 hosted service와 trace quota가
있고, 무거운 self-hosted observability stack은 main application에 부담이 될 수 있다.

LangFeather의 주 사용자는 LangGraph/LangChain 기반 챗봇을 개발하는 개인 또는 작은
project 팀이다. `0.3.0`에서는 각 사용자가 자신의 PC에서 collector를 실행하는
local-first prototype을 제공한다.

## 핵심 사용자 질문

1. 이번 요청에서 실제로 어떤 Runnable, LLM, retriever, tool이 실행됐는가?
2. 각 실행의 input, output, error는 무엇인가?
3. latency와 오류는 어느 구간에서 발생했는가?
4. 기간별 요청량, latency, error, LLM/tool 호출은 어떻게 변했는가?
5. 검토한 trace를 dataset과 experiment로 비교할 수 있는가?

## 현재 제공 가치

- compiled graph 한 번 wrapping으로 callback-visible 실행을 수집
- 원본 input/output, runtime 관계, 오류, latency, token metadata 확인
- Overview, trace debugging, score/annotation, dataset/experiment 비교
- application의 정상 흐름을 막지 않는 bounded best-effort delivery
- hosted vendor의 plan quota 없이 사용자가 자신의 resource 안에서 운영

## 현재 범위와 비범위

`0.3.0`은 single-project, single-user, local-only이며 기본 bind는 `127.0.0.1`이다.
login, team sharing, public EC2 exposure, RBAC, ingest credential은 지원하지 않는다.

LangFeather는 LangSmith/Langfuse의 기능 전체를 복제하지 않는다. 비용 계산, prompt
management, billing, multi-project, OTel, PostgreSQL, live trace, JavaScript SDK도
현재 범위 밖이다.

## 제품 원칙

1. 기존 LangGraph application 변경을 최소화한다.
2. main application의 정상 실행과 tracing 실패를 격리한다.
3. 디버깅에 필요한 원본 정보와 실제 runtime 관계를 보존한다.
4. 작은 stack과 낮은 idle resource 사용을 우선한다.
5. 수강생이 AI와 함께 작은 변경을 안전하게 기여할 수 있게 한다.

## Web 기능 계약

Web presentation을 구현하거나 교체할 때 다음 문서를 함께 따른다.

- `specs/web-functional.md`: 화면별 사용자 기능과 edge state
- `specs/web-interaction-contract.md`: URL, async state, focus와 계산 의미
- `specs/web-api-map.md`: 사용자 행동과 HTTP contract 연결
- `specs/web-acceptance.md`: 자동 검증과 browser smoke 완료 조건

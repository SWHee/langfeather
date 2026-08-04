# 제품 문맥

LangFeather는 부트캠프에서 LangGraph 챗봇을 만드는 사람이 제한된 자원에서도
실행 흐름을 확인할 수 있게 하는 경량 observability 도구다.

LangSmith는 적용이 간편하지만 hosted service와 trace quota가 있고, Langfuse나
Arize Phoenix 같은 self-hosted 대안은 학습용 project에 비해 운영·resource 부담이
클 수 있다. LangFeather는 이들을 기능적으로 복제하지 않는다. 실제 LangGraph
디버깅에 필요한 실행 관계, input/output, 오류, latency, LLM/tool 호출을 작은
local stack에서 확인하는 데 집중한다.

## 현재 `0.3.2` 범위

- local-first, single-project, single-user prototype
- Python SDK, 단일 FastAPI/SQLite collector, React UI
- LangGraph compiled graph를 한 번 감싸는 명시적 계측 경계
- trace 탐색, Overview, score/annotation, dataset/experiment 비교
- PyPI SDK와 GHCR collector image 공개, GitHub Issues 피드백 수집

## 아직 구현하지 않는 것

- public EC2 team deployment, login, OAuth, RBAC, ingest credential
- multi-project isolation, hosted collector, billing, prompt management
- OTel, PostgreSQL, JavaScript SDK, live trace, 비용 계산

`0.4.0`의 team deployment는 roadmap이지 현재 기능이 아니다. 현재 local-only
보안 경계를 임의로 넓히거나 authentication을 부분적으로 추가하지 마세요.

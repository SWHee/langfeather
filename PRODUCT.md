# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

개인 laptop 또는 desktop에서 LangChain/LangGraph 기반 RAG와 LLM application을
만들고 디버깅하는 Python 개발자가 주 사용자다. 이들은 실행 경로와 node별 원본
입출력·오류를 빠르게 확인하고, 실패 사례를 고정해 변경 전후를 반복 검토한다.

## Product Purpose

LangFeather는 개인 개발자가 local Docker container 하나와 작은 Python wrapper로
LLM application의 실제 runtime trace를 수집·검토·평가하게 하는 local-first
debugging 도구다. 성공은 사용자가 외부 observability stack 없이 실행 문제를
재현하고, 검토한 사례로 regression을 발견하는 것이다.

## Positioning

trace의 원본 payload와 실제 실행 관계를 local SQLite에 보존하면서, annotation으로
선별한 사례를 사용자 자신의 Python environment에서 재실행하는 경량 평가 루프를
제공한다. 서버가 사용자 application이나 evaluator 코드를 실행하지 않는다.

## Operating Context

사용자는 `127.0.0.1:4319`의 browser UI에서 trace와 annotation queue를 검토한다.
평가 dataset은 trace에서 snapshot을 만들거나 JSONL로 다루며, experiment는 SDK가
사용자 process에서 실행하고 결과만 local server에 기록한다.

## Capabilities and Constraints

- single project, single user, local Docker installation
- Python 3.10 이상 SDK; LangChain/LangGraph integration은 optional
- FastAPI, SQLite, SQLAlchemy, Alembic, React/Vite SPA 하나의 container
- full raw trace payload 저장; automatic redaction, truncation, sampling, retention 없음
- server-side evaluator execution, worker, scheduler, broker, cloud account, RBAC 없음
- evaluator v1은 boolean/finite-number built-ins와 사용자 Python callable만 지원
- categorical automated evaluator와 LangFeather 관리형 LLM judge는 보류

## Brand Commitments

LangFeather라는 이름과 Korean-first product copy를 유지한다. UI는 화려한 analytics
dashboard가 아니라 집중된 debugging workspace여야 한다.

## Evidence on Hand

- `docs/PRODUCT_REQUIREMENTS.md`, `docs/DECISIONS.md`, `docs/DATA_CONTRACT.md`
- SDK/server/web integration tests와 canonical trace fixtures
- 현재 React UI의 Traces, Annotation Queues, Scores, Local Data surfaces

## Product Principles

- 설치와 첫 trace 확인은 짧고 직접적이어야 한다.
- 관찰된 실행 관계와 원본 data를 정확히 보존한다.
- tracing 문제는 관측 대상 application의 정상 흐름을 바꾸지 않는다.
- 평가 결과는 재현 가능한 snapshot에 연결한다.
- 기능은 local debugging loop에 필요한 만큼만 추가한다.

## Accessibility & Inclusion

Keyboard focus를 명확히 보이고, semantic button/label 구조와 desktop·mobile의 기본
조회 및 삭제 흐름을 유지한다.

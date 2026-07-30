# LangFeather Agent Guide

LangFeather는 제한된 개발 환경에서 LangGraph 챗봇을 debugging하기 위한 경량
local-first observability 도구다. 현재 지원 범위와 비범위는 `specs/product.md`를
따른다.

## 반드시 지킬 경계

- 현재 `0.2.0`은 single-project, single-user, local-only다.
- Python SDK만 제공하며 core SDK는 FastAPI/LangChain/LangGraph에 직접 의존하지 않는다.
- tracing 실패는 관측 대상 application의 반환값, stream, 원래 예외를 바꾸면 안 된다.
- raw payload를 자동 redact, truncate, summarize, sample하지 않는다.
- OTel, PostgreSQL, multi-project, login/RBAC, 비용 계산, server-side evaluator 실행을
  임의로 추가하지 않는다.
- 실제 callback evidence가 없는 graph edge를 UI에 표시하지 않는다.

## 작업 시작 순서

1. `.agents/README.md`와 관련 `specs/`를 읽는다.
2. `.agents/engineering.md`에서 수정 package의 기술 계약을 확인한다.
3. 수정 package와 contract 영향을 정한다.
4. focused test를 추가하거나 실행한다.
5. 작은 구현 후 package test, typecheck, lint를 실행한다.
6. SDK/API contract가 바뀌면 integration test와 contract check를 실행한다.
7. Docker 또는 browser 동작을 바꿨다면 실제 smoke test를 실행한다.

상세 code map, engineering contract, 완료 기준, UI 규칙, test 명령, PR 형식은
`.agents/`에 있다. 문서 간 충돌은 현재 사용자 지시, `specs/decisions.md`,
`specs/product.md`, `specs/data-contract.md`, `specs/architecture.md` 순서로 판단한다.

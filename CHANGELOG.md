# 변경 이력

사용자와 개발자에게 영향을 주는 변경 사항을 이 문서에 기록합니다. 형식은
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며, LangFeather가
`0.x` 버전인 동안에는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.2.0] - 2026-07-30

### 추가됨

- 선택한 기간과 trace 필터를 기준으로 trace 수, 지연 시간 백분위수, 오류율,
  LLM/tool 호출, feedback score 추이를 보여주는 모니터링 Overview
- 사용자 정의 불리언, 유한 숫자, 단일/복수 선택 범주형 score 정의
- trace 단위 구조화 annotation과 trace당 공유 메모
- 명시적 완료/수정 흐름을 갖는 고정 수동 annotation queue
- Datasets 화면에서 dataset과 dataset example 삭제
- 같은 dataset revision의 experiment 두 개에서 네 개와 evaluator 네 개까지 선택해
  불리언 통과율과 유한 숫자 평균을 비교하는 evaluation workspace. evaluator 오류와
  값이 없는 case 수를 함께 표시

### 변경됨

- 배포 준비 버전을 `0.2.0`으로 올렸고 Python distribution metadata와 배포 artifact에
  Apache-2.0 license를 선언·포함
- 상단 navigation을 Traces, Annotation Queues, Scores, Evaluation, Local Data로
  분리. Evaluation은 선택한 dataset을 공유하는 Compare, Experiments, Examples tab을
  제공하며 example 생성은 Add example dialog로 이동
- queue 완료 상태는 score 작성 여부와 독립적으로 관리
- 사용된 score 구조는 삭제하지 않고 변경 불가능한 보관 상태로 전환

### 제거됨

- 기존 범용 feedback API, database table, SDK type, fixture

## [0.1.0] - 2026-07-27

초기 local-first 릴리스 기준입니다. GitHub/PyPI/GHCR publication은 별도
Phase 6 release-hardening 단계로 남아 있습니다.

### 추가됨

- `wrap_runnable()`, `@observe`, `span()`, ASGI capture를 포함한 Python SDK
- runtime에서 보이는 Runnable, LLM, retriever, tool 실행을 수집하는
  LangChain/LangGraph callback capture
- trace inspection, feedback, backup, reset, offline restore를 제공하는 FastAPI,
  SQLite, Alembic 기반 local collector
- React runtime graph와 lazy input/output inspector
- Docker Compose local installation과 실행 가능한 LangGraph example

### 수정됨

- LangGraph `Send` fan-out은 callback parent 관계를 추론하지 않고 실제로 관측한
  dispatch edge만 render

### 알려진 제약

- local single-user installation만 지원하며 authentication이나 cloud collector 없음
- trace delivery는 bounded in-memory best-effort 방식
- 원본 diagnostic payload를 자동 redaction하지 않고 local에 보관

[Unreleased]: https://github.com/SungjinWi99/langfeather/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/SungjinWi99/langfeather/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SungjinWi99/langfeather/releases/tag/v0.1.0

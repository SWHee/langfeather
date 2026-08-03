# 변경 이력

사용자와 개발자에게 영향을 주는 변경 사항을 이 문서에 기록합니다. 형식은
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며, LangFeather가
`0.x` 버전인 동안에는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

## [0.3.0] - 2026-08-03

### 추가됨

- 모든 주요 데이터 표(Traces, Annotation Queue trace 목록, Scores, Evaluation
  Examples/Experiments)에 드래그로 컬럼 순서 변경, 컬럼 폭 조절, 컬럼별
  정렬(오름차순/내림차순) 기능
- Traces, Annotation Queue trace 목록, Dataset Examples 목록에 page당 20개
  pagination
- Traces 상세 popup에서 같은 session의 다른 trace로 이동할 때 `N / M` 형식의
  위치 표시
- Traces 수집 시각 컬럼을 상대 시간 대신 정확한 `MM/DD H:MM AM/PM` 시각으로 표시
- Dataset 카드에 `⋯` 메뉴로 개별 dataset 삭제
- Dataset Examples 목록에 검색창과 "+ Add Example", 행 클릭 시 열리는 편집 popup
- Evaluation Experiments tab에 검색창과 checkbox 기반 experiment 삭제
  (`DELETE /experiments/{id}`)
- Metric 비교 카드에서 여러 metric을 동시에 그래프로 비교(metric별 그룹, 같은
  experiment는 항상 같은 색), 그래프 hover 시 정확한 값을 보여주는 tooltip,
  metric×experiment 값 행렬 표
- Overview 시각화 그래프와 metric 비교 그래프에 y축 눈금 표시
- Annotation Queue 목록에 Pending/Total 대신 진행률 bar와 "완료 / 전체 runs"
  표시
- 완료된 queue item을 다시 저장하면 "수정됨" 표시(`was_edited`)
- 실행 흐름 그래프 node를 순서·kind(header) / 이름(본문) / 상태·latency(footer)
  구조로 재구성
- 전체 UI를 25% 확대해 기본 가독성 개선

### 변경됨

- Traces 목록을 opaque cursor 기반 무한 scroll에서 server가 계산한
  `total_count`를 사용하는 번호 pagination으로 전환(`GET /traces`에 `page` 지원
  추가)
- Annotation Queue item을 다시 완료할 때 별도 "Review" 화면 대신 최초 완료와
  동일한 popup·완료 버튼을 사용하도록 통일
- Evaluation의 "Compare"를 별도 tab에서 Experiments tab 안의 카드로 통합
- 표 기반 목록(Annotation Queues, Scores)의 개별 작업을 행마다 있던 `⋯` 메뉴에서
  checkbox 선택 + toolbar action(Delete/Edit)으로 통일
- Trace 상세의 Input/Output panel 제목에서 불필요한 "Input/Output" 문구를 지우고
  대신 observation kind를 tag로 표시
- 상세 popup(drawer)의 최대 폭을 960px에서 1300px로 확장

### 수정됨

- Annotation Queue 상세의 Trace ID 컬럼에 `overflow`/`ellipsis` 처리가 없어
  컬럼을 넓혀도 옆 컬럼을 침범하던 문제

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

[Unreleased]: https://github.com/SungjinWi99/LangFeather/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/SungjinWi99/LangFeather/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SungjinWi99/LangFeather/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SungjinWi99/LangFeather/releases/tag/v0.1.0

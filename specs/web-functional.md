# Web 기능 명세

이 문서는 LangFeather `0.2.0` Web UI를 새로 구현할 때 보존해야 하는 사용자 기능을
정의한다. 시각 디자인, DOM 구조, component 이름, CSS class, 화면 분할 방식은 계약이
아니다. API와 data 의미는 `specs/data-contract.md`가 우선한다.

## 현재 상태

기존 presentation layer는 전면 redesign을 위해 제거되었다. `web/src/App.tsx`는
build 가능한 임시 scaffold이며 제품 UI가 아니다. 새 구현은 이 문서,
`web-interaction-contract.md`, `web-api-map.md`, `web-acceptance.md`를 기준으로 한다.

## 공통 제품 범위

- 제품명은 `LangFeather`다.
- 사용자는 local collector를 혼자 사용하는 Python 개발자다.
- top-level 기능은 Overview, Traces, Annotation Queues, Scores, Evaluation, Local
  Data 여섯 개다.
- 기본 진입 기능은 Overview다.
- server-side evaluator 실행, login, RBAC, multi-project 전환 UI를 추가하지 않는다.
- raw payload를 자동 redact, truncate, summarize, sample하지 않는다.
- UI는 callback/runtime evidence가 없는 graph edge를 만들어내지 않는다.
- 사용자에게 보이는 주요 문구는 Korean-first를 유지하되 기술 명칭과 API field는
  필요에 따라 영어를 쓸 수 있다.

## Overview

### 목적

선택한 기간과 trace population에서 요청량, latency, error, LLM/tool 호출,
feedback 추이를 빠르게 확인한다. Overview의 filter state는 Traces와 독립적이다.

### 조회 조건

- 기본 기간은 현재 시각까지 최근 7일이다.
- 기본 timezone은 browser의 IANA timezone이며 얻을 수 없으면 `UTC`다.
- bucket은 `auto`, `hour`, `day`, `week`, `month` 중 하나다.
- 시작과 종료 시각, timezone, bucket을 변경할 수 있다.
- query, tag, session ID, release, environment, user ID로 좁힐 수 있다.
- feedback score는 동시에 최대 4개를 선택할 수 있다.
- tool은 server가 돌려준 available tool 중 여러 개를 선택할 수 있다.
- 변경 중인 draft filter는 적용 전까지 조회 결과와 URL을 바꾸지 않는다.
- 적용은 새 query를 실행하고 URL state를 갱신한다.
- 초기화는 최근 7일, local timezone, auto bucket, 빈 filter로 복귀한다.

### 결과

- total trace count
- latency p50, p95, p99
- failed/total과 error rate
- LLM call count
- tool call total과 tool별 시계열
- completed, failed, cancelled 요청 시계열
- 선택한 feedback score의 시계열과 annotation 표본 수

boolean/categorical feedback의 비율과 number feedback의 평균은 서로 다른 scale로
표현한다. number 값에 percent formatting을 적용하지 않는다. 값이 없는 bucket은
0으로 꾸미지 않고 missing/null로 취급한다.

tool call total이 0이면 `__others__ = 0` 같은 가짜 series를 그리지 않고 해당 기간에
tool 호출이 없음을 설명한다. 선택한 feedback에 기록이 없을 때도 명시적인 empty
state를 제공한다.

### 상태

- 최초 및 filter 적용 중 loading
- 성공했지만 trace/tool/feedback이 없는 부분별 empty state
- dashboard 또는 score 목록 조회 실패
- 동일한 조건을 다시 요청하는 retry

## Traces

### 목록

- trace 목록은 detail을 미리 가져오지 않고 summary만 조회한다.
- query, status, from, to, tag, session ID filter를 지원한다.
- filter draft는 적용 또는 초기화 전까지 현재 결과를 바꾸지 않는다.
- filter가 적용되면 기존 opaque cursor를 버리고 첫 page부터 조회한다.
- 다음 page는 server가 제공한 `next_cursor`만 사용한다.
- 다음 page 응답은 현재 cursor와 일치할 때만 기존 목록 뒤에 합친다.
- loading, filtered/unfiltered empty, error, retry, loading-more 상태를 구분한다.

### 선택과 deep link

- trace 선택 시에만 trace detail을 조회한다.
- `trace` URL parameter가 있으면 새로고침 후 해당 trace를 실제 선택하고 조회한다.
- 선택한 trace ID는 URL에 반영한다.
- detail을 닫거나 삭제하면 trace selection을 비운다.
- text input, textarea, select, contenteditable에 focus가 없고 modifier key가 없을 때
  `J`는 session의 next trace, `K`는 previous trace를 연다.

### detail

- 이름, status, started/ended time, duration, trace ID, session ID, user ID, release,
  environment, tags와 observation count를 확인할 수 있다.
- observation summary와 실제 runtime graph를 제공한다.
- detail 조회 직후 failed observation 중 sequence가 가장 빠른 항목을 우선 선택한다.
- failed observation이 없으면 parent가 없는 root observation을 선택한다.
- 선택할 observation이 없으면 payload inspector는 idle 상태다.
- observation payload는 observation을 선택한 뒤 별도 API로 lazy-load한다.
- observation 선택, payload loading/error/retry는 trace detail loading/error와
  독립적이다.
- selected observation과 graph selection과 inspector selection은 하나의 state를
  공유한다.

### runtime graph

- node는 observation instance 단위이며 같은 이름도 합치지 않는다.
- callback edge는 존재하는 `parent_observation_id` evidence로만 만든다.
- `dispatch_source_observation_id`가 있으면 callback parent 대신 명시적 dispatch
  edge를 사용한다.
- parent/dispatch source가 현재 graph에 없으면 edge를 추론하지 않는다.
- 시간 구간이 실제로 겹치는 sibling만 parallel row로 취급한다.
- microsecond precision을 유지한다.
- 알려진 kind는 chain, llm, retriever, tool, function, http, runnable, custom이며
  그 외 kind는 generic으로 안전하게 표시한다.
- summary mode가 있다면 root, root의 직접 child, 명시적 dispatch가 있는 실행을
  중심으로 접을 수 있지만 원본 observation 관계를 바꾸지 않는다.

### payload inspector

- Input과 Output은 항상 확인할 수 있다.
- Error가 있으면 핵심 보기에서도 확인할 수 있다.
- 전체 보기에서는 Usage와 Metadata도 확인할 수 있다.
- nested JSON object와 array는 접고 펼칠 수 있다.
- 선택한 JSON section을 원문 JSON으로 복사할 수 있다.
- 실패 payload가 structured diagnostic이면 error type, message, 마지막 traceback
  frame을 요약하되 전체 raw error도 계속 접근 가능해야 한다.
- payload가 매우 길어도 browser main thread를 불필요하게 막지 않아야 한다.

### trace action

- 선택한 trace를 기존 Annotation Queue에 추가할 수 있다.
- 선택한 trace를 기존 Dataset에 추가할 수 있다.
- queue/dataset 목록을 검색할 수 있다.
- action surface는 Escape 및 외부 클릭으로 닫히고 trigger focus를 복원한다.
- trace 삭제 전에는 trace, observations, feedback이 함께 삭제된다는 확인을 받는다.
- 삭제 성공 후 selection과 detail/payload state를 비우고 목록을 다시 조회한다.

## Scores와 trace annotation

### score 설정

- archived score를 포함한 전체 score 목록을 관리할 수 있다.
- 이름과 설명으로 score를 찾을 수 있다.
- boolean, number, categorical score를 생성한다.
- boolean은 true/false label을 가진다.
- number는 optional minimum/maximum을 가진다.
- categorical은 single/multiple selection mode와 ordered options를 가진다.
- score 이름과 설명을 수정할 수 있다.
- 아직 사용되지 않은 score는 type별 설정도 수정할 수 있다.
- 이미 사용된 score는 과거 annotation 의미를 보호하기 위해 이름과 설명만 바꾼다.
- 사용된 score를 제거하면 archive하고, 사용되지 않은 score는 확인 후 영구 삭제한다.
- create/edit/delete/archive의 pending, error, success feedback을 제공한다.

### trace annotation

- trace detail에서 사용할 score를 추가한다.
- score type에 맞는 annotation value를 입력한다.
- 기존 annotation을 수정하거나 삭제한다.
- trace memo를 score 값과 함께 저장할 수 있다.
- 저장은 annotation과 memo 요청 결과를 모두 반영한 뒤 detail을 새로 조회한다.
- 저장 실패를 성공처럼 표시하지 않는다.

## Annotation Queues

### queue 관리

- queue 목록을 조회하고 이름/설명으로 검색한다.
- 이름, optional 설명, 연결할 score 목록으로 queue를 생성한다.
- trace가 하나도 없는 빈 queue도 생성할 수 있다.
- queue의 이름, 설명, score 구성을 수정할 수 있다.
- queue 삭제는 확인 후 수행한다.
- trace detail에서 기존 queue에 trace를 추가할 수 있다.
- queue item을 제거할 수 있다.
- loading, empty, error와 mutation pending/error 상태를 제공한다.

### review

- pending/completed item 상태와 진행 상황을 보여준다.
- review를 열면 trace detail을 조회하고 root observation payload를 lazy-load한다.
- graph에서 observation을 선택하면 해당 payload를 조회한다.
- queue에 연결된 score 값과 memo를 한 번에 제출할 수 있다.
- complete 성공 시 item을 completed로 바꾸고 다음 pending item으로 이동한다.
- 이미 completed인 item을 다시 편집할 때는 edit endpoint로 pending 상태로 되돌릴 수
  있다.
- expected score가 없거나 trace/payload 조회가 실패한 상태를 명확히 처리한다.

## Evaluation

Evaluation은 Dataset 하나를 context로 Compare, Experiments, Examples 세 작업을
제공한다. server는 evaluator를 실행하지 않으며 experiment는 사용자 Python process가
기록한 결과를 읽기만 한다.

### Dataset 선택과 URL

- dataset 목록과 experiment summary 목록을 함께 조회한다.
- dataset 이름과 설명으로 선택지를 검색한다.
- 첫 진입에 URL dataset이 유효하면 복원하고, 없으면 첫 dataset을 선택한다.
- dataset을 바꾸면 experiment/metric/case selection을 비운다.
- 선택한 dataset, tab, ordered experiment IDs, metric keys, case ID를 URL에 기록한다.
- browser back/forward 후 모든 selection을 복원한다.
- 선택한 dataset이 외부에서 삭제되어 detail이 404이면 목록에서 제거하고 최신 목록의
  첫 항목으로 회복한다.
- 느린 mutation refetch가 끝나도 사용자가 그 사이 선택한 다른 dataset을 덮어쓰지
  않는다.

### Dataset 관리

- name과 optional description으로 dataset을 생성한다.
- name은 필수이며 중복 등 API 오류를 설명한다.
- experiment history가 없는 dataset만 확인 후 영구 삭제한다.
- 409이면 experiment 기록 때문에 삭제할 수 없음을 설명한다.
- dataset revision과 example count를 확인할 수 있다.

### Examples

- input은 임의 JSON value다.
- expected output은 optional JSON value다.
- metadata는 JSON object만 허용한다.
- 각 field의 parse error를 field 이름과 함께 표시한다.
- 빈 object input `{}` 저장 전에는 사용자 확인을 받는다.
- example을 생성, 수정, 확인 후 삭제할 수 있다.
- example 변경 후 갱신된 dataset revision을 반영한다.
- 과거 experiment snapshot은 example 변경/삭제와 관계없이 유지된다고 설명한다.
- source trace에서 dataset으로 추가할 때 trace output을 expected output으로 자동
  채우지 않는다.

### JSONL

- export는 example마다 `input`, `expected_output`, `metadata`만 한 줄 JSON으로 쓴다.
- `source_trace_id`와 내부 ID/timestamp는 export하지 않는다.
- file name은 dataset name을 안전한 문자로 정규화하고 불가능하면 dataset ID를 쓴다.
- import는 빈 줄을 무시하고 각 줄을 독립적으로 parse/저장한다.
- 한 줄 실패가 나머지 줄 import를 중단하지 않는다.
- 성공 개수와 실패한 원본 line number를 모두 보고한다.

### Experiments

- experiment summary 목록에서는 detail을 eager-load하지 않는다.
- 행을 펼치거나 선택할 때만 experiment detail을 조회한다.
- status, dataset revision, completed/failed case count, duration, evaluator 요약을
  확인할 수 있다.
- detail은 target metadata, evaluator 결과, case별 input/expected/actual/error,
  duration과 linked trace를 제공한다.
- JSON evidence는 접고 펼치며 복사할 수 있다.
- experiment가 없으면 Python SDK `evaluate` 실행 예제를 복사할 수 있게 제공한다.

### Compare

- 같은 dataset revision의 experiment 2~4개만 비교한다.
- 첫 번째 selected experiment가 baseline이다.
- baseline 변경은 ordered selection의 첫 항목을 바꾸고 모든 delta를 다시 계산한다.
- 서로 다른 revision은 동시에 선택할 수 없다.
- 최대 4개 제한 이유를 사용자에게 설명한다.
- 최초에는 선택한 모든 experiment에 공통으로 존재하고 data type도 같은 evaluator를
  자동 선택한다.
- 사용자가 metric을 직접 바꾼 뒤에는 자동 선택이 덮어쓰지 않는다.
- 같은 key가 서로 다른 evaluator data type으로 선언되면 같은 metric으로 계산하지
  않는다.
- boolean metric은 valid boolean result의 pass rate다.
- number metric은 valid finite number result의 mean이다.
- evaluator error, missing value, target failed case를 denominator/상태에서 숨기지
  않는다.
- scored value가 없으면 0이 아니라 null/값 없음으로 표시한다.
- baseline 값이 없으면 delta도 null이다.
- running, cancelled, failed case, evaluator error, missing metric 경고를 제공한다.
- detail load 실패 시 chart를 성공 상태처럼 표시하지 않고 retry를 제공한다.

### Case 비교

- experiment row를 pointer 또는 Enter/Space로 열 수 있다.
- selected case는 dataset example ID로 experiment 사이에서 대응한다.
- baseline 대비 better/equal/worse, target failure, input text로 case를 찾을 수 있다.
- case 목록에서 input preview를 제공한다.
- detail은 experiment별 expected, actual output, error, evaluator results를 나란히
  비교할 수 있어야 한다.
- JSON은 label, full view, copy 기능을 가진다.
- case에 trace ID가 있으면 Traces 기능에서 해당 trace를 연다.

## Local Data

- local data 전체 초기화는 별도 top-level 기능이다.
- 사용자가 정확히 `RESET`을 입력하기 전에는 실행할 수 없다.
- 실행 직전 destructive confirmation을 다시 받는다.
- 성공하면 현재 trace/detail/payload selection을 모두 비우고 Traces로 이동해 빈
  목록을 다시 조회한다.
- 실패 시 data가 지워졌다고 표시하지 않는다.

## 비기능 요구

- TypeScript strict mode를 유지한다.
- 모든 remote read에는 loading, empty, error, retry를 설계한다.
- mutation은 pending 중 중복 실행을 막고 성공/실패를 구분한다.
- stale async response가 더 최신 selection을 덮어쓰지 않는다.
- desktop과 약 390px mobile에서 주요 조회와 action이 가능해야 한다.
- 긴 trace name, ID, JSON, option label에서 가로 overflow나 겹침이 없어야 한다.
- semantic landmark, heading, label, button을 사용한다.
- dialog, menu, tab, graph node, chart point는 keyboard로 접근 가능해야 한다.
- focus-visible 표시와 dialog/popover 종료 후 합리적인 focus 복귀를 제공한다.
- loading 변화와 mutation 결과는 필요한 곳에서 assistive technology에 전달한다.

# Web redesign acceptance

새 UI는 특정 색, layout, component library를 복원하는 것이 아니라 아래 기능 계약을
충족할 때 완료된다.

## 공통 gate

- [ ] 여섯 top-level 기능에 접근할 수 있고 기본 진입은 Overview다.
- [ ] URL-owned state가 새로고침과 back/forward 뒤 복원된다.
- [ ] 각 remote read에 loading, empty, error, retry가 있다.
- [ ] 각 mutation에 pending, success, failure가 있고 중복 실행을 막는다.
- [ ] stale response가 최신 selection을 덮어쓰지 않는다.
- [ ] desktop과 약 390px mobile에서 주요 action이 가능하다.
- [ ] keyboard focus, overlay 닫기/복귀, tab navigation을 실제 browser에서 확인한다.
- [ ] 긴 ID/name/JSON과 빈 data에서 overflow 또는 겹침이 없다.
- [ ] browser console에 새 error가 없다.

## 기능별 acceptance matrix

| 기능 | 필수 정상 흐름 | 필수 edge/error |
| --- | --- | --- |
| Overview | 기본 7일 조회, filter apply/reset, score/tool 선택, 시계열 확인 | score 최대 4개, no trace/tool/feedback, retry, number 평균과 rate 분리 |
| Traces | 목록, filter, opaque pagination, trace/detail, graph, lazy payload | deep link, list/detail/payload별 error, failed-node 우선, 삭제 후 회복 |
| Trace actions | queue/dataset 추가, trace 삭제 | 목록 실패, duplicate pending 방지, Escape/외부 클릭/focus 복귀 |
| Scores | 세 type 생성, 수정, 검색, archive/delete | used score 제한, API 실패, destructive confirm |
| Annotation | score 추가, 값/memo 저장, annotation 삭제 | type별 value, 일부 요청 실패, detail refresh |
| Queues | 빈 queue 생성, 설정 수정, item 추가/제거, review 완료 | trace/payload 실패, completed item 재편집, 다음 pending 이동 |
| Datasets | 선택/검색/생성/삭제, example CRUD | 404 회복, history 409, JSON field 오류, 빈 input 확인, stale refetch |
| JSONL | round-trip export/import | blank line, partial failure, 실패 line number, 내부 field 제외 |
| Experiments | summary, lazy detail, case evidence, evaluate quickstart | no experiment, running/cancelled/failed, detail load failure |
| Compare | 같은 revision 2~4개, baseline, metric, case filter/detail | revision/type conflict, missing/error/target failure, null delta, retry |
| Local Data | `RESET` 입력과 확인 후 초기화 | 잘못된 confirmation, API 실패 |

## 자동 검증

최소 gate:

```bash
npm run lint --prefix web
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
```

다음 pure/contract test는 presentation과 무관하므로 항상 유지한다.

- API schema v1 fixture validation
- dashboard repeated query serialization
- Overview URL state round-trip
- experiment comparison arithmetic와 revision mismatch
- runtime graph evidence/layout semantics
- locked product name

새 presentation 구현에는 화면별 focused interaction test를 다시 추가한다. test는 CSS
class, pixel value, 과도하게 구체적인 DOM nesting보다 accessible role/name, API call,
state transition, URL 결과를 우선 검증한다.

## 실제 browser smoke

layout, navigation, dialog 또는 주요 action을 구현한 변경은 build만으로 완료하지 않는다.

- desktop과 390px viewport screenshot
- Overview filter와 retry
- trace 선택 → graph node 선택 → payload 확인
- queue 또는 dataset에 trace 추가
- score/queue/dataset dialog keyboard 사용
- Evaluation tab과 Compare case 이동
- destructive confirmation
- focus-visible, Escape, scroll, console 확인

미실행 smoke는 통과로 기록하지 않는다.

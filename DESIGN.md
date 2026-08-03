# LangFeather Light Observatory — design reference

## Status

`web/src`의 구현이 승인된 visual source of truth다. 이 문서는 그 구현이 따르는
색·타이포·구조 결정을 기록한 참고 문서이며, 구현과 이 문서가 다르면 실제 동작하는
`web/src`를 기준으로 이 문서를 갱신한다.

과거 `design-explorations/v2/*-light.html` 여섯 화면(Overview, Traces, Annotation
Queues, Scores, Evaluation, Setting)을 출발점으로 만들었으나, 구현이 끝난 뒤 참고
목적을 다해 삭제했다. 새 화면을 추가하거나 크게 바꿀 때는 아래 원칙과 기존
`web/src/styles.css` token을 먼저 찾아 재사용한다.

## Visual thesis

LangFeather는 화려한 SaaS analytics가 아니라, 밝은 작업대 위에서 runtime evidence를
정밀하게 읽는 local debugging observatory다. 장식적인 dashboard card wall 대신
얇은 구분선, 밀도 높은 표, 넓게 이어지는 chart와 drawer 중심 workspace를 사용한다.

## Palette

- page: `#f7f8fa`
- surface: `#ffffff`
- surface alternate: `#f3f6f9`
- ink: `#1a2433`
- muted: `#6f7c8e`
- quiet: `#9aa5b4`
- line: `#e5e9ee`
- strong line: `#d8dee7`
- primary navy: `#163b70`
- primary soft: `#e7effa`
- success: `#10a77f`
- danger: `#e34a3c`
- warning: `#d8841c`
- comparison accent: `#7859d6`

상태 색은 의미를 전달할 때만 사용한다. 주요 작업과 선택 상태는 navy, 보조 chart
series만 제한된 accent palette를 쓴다. Queues, Scores, Datasets, Local Data
화면은 `.surface-*` class로 line/ink/navy 등을 미세하게 다르게 tint해 구획을
드러내지만 핵심 palette 관계는 동일하게 유지한다.

## Typography

- UI: Pretendard, SF Pro Text, Inter, Apple SD Gothic Neo, system sans
- ID, JSON, timestamp, measurement: SF Mono, IBM Plex Mono, ui-monospace
- page title은 24px/700, section title은 16px/700, body는 13–14px를 기본으로 한다.
- label과 table heading은 읽기 가능한 11–12px를 유지하며 과한 letter spacing을 쓰지
  않는다.
- `body`에 `zoom: 1.25`를 적용해 위 px 값보다 실제로는 25% 더 크게 보인다. 새 px
  값을 추가할 때도 이 zoom을 고려해 상대적으로 작게/크게 느껴지는지 확인한다.

## Structure

- 상단 bar는 고정 높이의 wordmark와 정확히 여섯 navigation item(Overview / Traces
  / Annotation Queues / Scores / Evaluation / Setting)을 가진다.
- desktop content는 최대폭 없이 diagnostic evidence에 필요한 가로 공간을 사용한다.
- page header 아래에 filter/action strip을 두고, data surface는 불필요한 중첩 card 없이
  border로 구획한다.
- Trace, review, experiment, dataset example detail은 오른쪽에서 슬라이드되는
  drawer를 쓴다. 기본폭은 화면마다 560–760px이고, 왼쪽 가장자리를 드래그해
  420px에서 1300px까지 사용자가 직접 조절할 수 있다. mobile에서는 viewport
  전체를 사용한다.
- 데이터 표는 checkbox 선택 + toolbar 기반 bulk action(Delete/Edit)으로
  일관되게 통일한다. 카드 형태로 나열하는 목록(dataset 카드 등)만 행마다
  `⋯` 메뉴를 쓴다.

## Components and state

- radius는 기본 8px이며 작은 control만 pill 형태를 허용한다.
- button과 field는 34–38px 높이, 명확한 border와 `:focus-visible` ring을 가진다.
- loading, empty, error, disabled, pending mutation은 각 surface 안에서 같은 공간을
  점유해 layout jump를 줄인다.
- destructive action은 danger color만으로 의존하지 않고 영향 설명, 정확한 확인 입력,
  최종 confirmation을 제공한다.
- chart point와 graph node는 pointer와 keyboard 모두 선택할 수 있고 값이 accessible
  name에 포함된다.
- overlay가 닫히면 trigger로 focus를 복원한다.
- 표 header는 드래그로 순서를 바꿀 수 있고(가로축 이동만 허용, 다른 header가
  실시간으로 자리를 비켜준다), 오른쪽 경계를 드래그해 폭을 조절할 수 있으며,
  header의 정렬 아이콘으로 오름차순/내림차순/해제를 순환한다. 이 세 동작은
  `useReorderableColumns` 한 곳에서 구현해 모든 표가 같은 방식으로 동작한다.
- 20개를 넘는 목록(Traces, annotation queue의 trace 목록, dataset example
  목록)은 페이지당 20개로 나누고 이전/다음 버튼과 `N / M` 표시를 쓴다. 새
  검색이나 필터를 적용하면 1페이지로 돌아간다.

## Motion and interaction

- `prefers-reduced-motion`에서는 transform 기반 전환을 제거한다.
- Overview chart card는 drag handle과 keyboard 대체 control로 순서를 바꿀 수 있고,
  resize control로 크기를 조절한다.
- runtime graph는 실제 callback/dispatch evidence만 그리며 pan/zoom이 node selection을
  방해하지 않게 한다. 각 node header는 실행 순번과 kind를, body는 이름을, footer는
  상태와 latency를 보여준다.

## Responsive rules

- 긴 ID, trace name, JSON은 `min-width: 0`, wrapping 또는 내부 scroll로 처리하며 page
  자체의 가로 overflow를 만들지 않는다.
- 표는 `table-layout: fixed`와 열별 `overflow: hidden` + ellipsis로 좁은 열에서도
  다른 열을 침범하지 않는다.

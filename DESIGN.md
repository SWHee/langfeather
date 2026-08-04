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

## Token 구조

`web/src/styles.css`의 token은 세 층이다. hex는 primitive 층에만 쓰고, component
규칙은 semantic 층만 참조한다. theme을 추가할 때는 semantic 층만 다시 정의한다.

```text
primitive  --c-teal-700: #1d6b74
semantic   --accent: var(--c-teal-700)
component  --radius: 10px
```

## Palette

brand는 logo의 청록에서 왔다. logo 색 `#2fabb9`는 흰 배경 대비가 2.75:1이라
mark에만 쓰고, text와 interaction에는 대비를 확보한 어두운 단계를 쓴다.

| 역할 | token | 값 | 흰 배경 대비 |
| --- | --- | --- | --- |
| page | `--page` | `#f4f7f8` | — |
| surface | `--surface` | `#ffffff` | — |
| surface alternate | `--surface-alt` | `#eef3f4` | — |
| table header | `--surface-head` | `#f9fbfb` | — |
| line | `--line` | `#dbe5e7` | — |
| strong line | `--strong` | `#c3d2d6` | — |
| ink | `--ink` | `#0f2129` | 16.54 |
| muted | `--muted` | `#4d6873` | 5.93 |
| quiet | `--quiet` | `#567480` | 4.99 |
| accent | `--accent` | `#1d6b74` | 6.16 |
| accent hover | `--accent-hover` | `#165157` | 8.94 |
| accent soft | `--accent-soft` | `#e4f2f4` | — |
| accent faint | `--accent-faint` | `#f0f7f8` | — |
| accent border | `--accent-border` | `#8fc0c7` | — |
| logo mark | `--accent-mark` | `#2fabb9` | 2.75 (mark 전용) |
| success | `--green` | `#0f7a52` | 5.35 |
| danger | `--red` | `#c0392f` | 5.43 |
| warning | `--orange` | `#9a6212` | 5.08 |
| llm tint | `--violet` | `#6b4fd8` | 5.62 |
| retriever tint | `--blue` | `#2c5c99` | 6.78 |

chart series는 `--series-1` `#258590`, `--series-2` `#5566d6`, `--series-3`
`#c07a10`, `--series-4` `#c94f7c`이며 전부 흰 배경 대비 3:1 이상이다.

text로 쓰는 색은 WCAG AA(4.5:1)를 만족한다. 새 색을 추가할 때 이 기준을 먼저
확인한다. 상태 색은 의미를 전달할 때만 쓰고, 선택과 주요 작업은 accent만 쓴다.
retriever tint를 accent와 다른 색으로 두는 이유는 선택 상태와 구분하기 위해서다.

화면마다 token을 다르게 tint하던 `.surface-*` override는 제거했다. 같은 제품이
화면에 따라 다른 색과 다른 접근성 등급을 갖게 만들었기 때문이다. 다시 넣지 않는다.

## Typography

- UI: Pretendard, SF Pro Text, Inter, Apple SD Gothic Neo, system sans
- ID, JSON, timestamp, measurement: `ui-monospace` 우선. OS 기본 mono로 해석되므로
  별도 webfont를 bundle하지 않는다.
- body는 18px/1.45, page title 30px/700, section title 20px/700을 기본으로 한다.
- label과 table heading은 11–12px를 유지하며 과한 letter spacing을 쓰지 않는다.
- font-size는 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30px만 쓰고,
  font-weight는 400과 700만 쓴다.

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

- 간격은 2px 격자 위의 정수 px만 쓴다. border는 1px, radius는 기본 10px이며 작은
  control만 pill 형태를 허용한다. 소수점 px를 새로 만들지 않는다.
- button과 field는 44px 높이로 touch target 기준을 만족하고, 명확한 border와
  `:focus-visible` ring을 가진다.
- icon은 glyph 문자가 아니라 SVG로 그린다. glyph는 font fallback에 따라 굵기와
  정렬이 기기마다 달라진다. `components.tsx`의 `Icon` 계열을 재사용한다.
- pointer hover에서만 나타나는 control을 만들지 않는다. touch 기기에는 hover가
  없어서 기능 자체가 사라진다. 평소 낮은 대비로 두고 hover/focus에서 강조한다.
- shell 최상단에 본문으로 건너뛰는 skip link를 둔다. 각 화면의 `<main>`이
  `id="lf-main"`으로 그 착지점이 된다.
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

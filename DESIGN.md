# LangFeather Light Observatory — derived implementation index

## Status

`design-explorations/v2/*-light.html`의 정확히 여섯 화면만 승인된 visual source of
truth다. 이 문서는 그 원본을 찾고 구현할 때 쓰는 파생 인덱스이며, React 구현과 이
문서 모두 visual conflict를 해석하는 권한이 없다.

원본은 Overview, Traces, Annotation Queues, Scores, Evaluation, Setting 순서의 V2
light HTML이다. 어떤 상세 규칙이 여기·React·기존 코드·과거 화면과 다르면 해당 V2
HTML을 따른다.

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
- quiet: `#98a4b3`
- line: `#e5e9ee`
- strong line: `#d8dee7`
- primary navy: `#163b70`
- primary soft: `#e7effa`
- success: `#10a77f`
- danger: `#e34a3c`
- warning: `#d8841c`
- comparison accent: `#7859d6`

상태 색은 의미를 전달할 때만 사용한다. 주요 작업과 선택 상태는 navy, 보조 chart
series만 제한된 accent palette를 쓴다.

## Typography

- UI: Pretendard, SF Pro Text, Inter, Apple SD Gothic Neo, system sans
- ID, JSON, timestamp, measurement: SF Mono, IBM Plex Mono, ui-monospace
- page title은 24px/700, section title은 16px/700, body는 13–14px를 기본으로 한다.
- label과 table heading은 읽기 가능한 11–12px를 유지하며 과한 letter spacing을 쓰지
  않는다.

## Structure

- 상단 bar의 높이·wordmark·정확히 여섯 navigation item·local environment badge의
  geometry는 각 V2 원본을 따른다.
- navigation 순서는 `Overview / Traces / Annotation Queues / Scores / Evaluation /
  Setting`이다.
- desktop content는 최대폭 없이 diagnostic evidence에 필요한 가로 공간을 사용한다.
- page header 아래에 filter/action strip을 두고, data surface는 불필요한 중첩 card 없이
  border로 구획한다.
- Trace와 review detail은 오른쪽 drawer를 사용한다. drawer는 desktop에서 최대
  760px이고 mobile에서는 viewport 전체를 사용한다.
- 표와 mobile의 정보 밀도·overflow 규칙은 각 V2 원본을 그대로 따른다.

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

## Motion and interaction

- motion의 대상, timing, easing은 각 V2 원본을 따른다.
- `prefers-reduced-motion`에서는 transform 기반 전환을 제거한다.
- Overview chart card는 drag handle과 keyboard 대체 control로 순서를 바꿀 수 있고,
  resize control로 크기를 조절한다.
- runtime graph는 실제 callback/dispatch evidence만 그리며 pan/zoom이 node selection을
  방해하지 않게 한다.

## Responsive rules

- breakpoint, navigation overflow, page padding, chart/form 접힘 규칙은 각 V2 원본의
  media query를 따른다.
- 긴 ID, trace name, JSON은 `min-width: 0`, wrapping 또는 내부 scroll로 처리하며 page
  자체의 가로 overflow를 만들지 않는다.

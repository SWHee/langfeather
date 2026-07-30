# UI 디자인 계약

UI 변경은 새 디자인을 만드는 일이 아니라 기존 `web/`의 시각 언어를 유지하는 일이다.

## 기본 원칙

- 새 색, font, shadow, gradient, spacing scale을 임의로 추가하지 않는다.
- 기존 token, 공용 component, page pattern을 먼저 찾고 재사용한다.
- 정보 확인이 우선이다. 장식용 card, icon, animation을 기능 없이 추가하지 않는다.
- 상태는 loading, empty, error, disabled를 함께 설계한다.
- desktop과 mobile 모두에서 기본 조회와 주요 action이 가능해야 한다.
- semantic HTML과 keyboard 접근성을 유지한다.

## 화면 작업 전 확인

1. 비슷한 기존 화면과 component를 찾는다.
2. 필요한 정보, action, empty/error 상태를 짧게 적는다.
3. 새 component가 기존 것을 대체할 만큼 두 곳 이상 필요한지 확인한다.

## 완료 전 확인

- 긴 trace name, JSON, 빈 목록에서도 layout이 깨지지 않는가
- 좁은 화면에서 가로 overflow가 생기지 않는가
- 버튼 label과 icon만으로 action을 오해하지 않는가
- 실제 browser의 desktop과 390px 안팎 mobile viewport에서 주요 흐름을 확인했는가
- visual layout을 바꿨다면 desktop/mobile screenshot으로 회귀를 확인했는가
- browser console, keyboard focus, scroll 동작에 새 문제가 없는가

Figma나 별도 design system을 도입하지 않는다. `web/`의 token과 공용 component가
구현 source of truth이고, root `DESIGN.md`는 색상·spacing·component visual token의
참고 기준이다. 이 문서는 AI가 그 기준을 우회하지 않게 하는 작업 규칙이다.

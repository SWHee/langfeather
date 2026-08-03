# UI 디자인 계약

현재 기존 `web/` presentation은 전면 redesign을 위해 의도적으로 제거되었다.
새 UI가 확정되기 전까지 기존 screenshot, 삭제된 JSX/CSS, git history를 시각적
출발점으로 복원하지 않는다. 제품 기능과 상태는 `specs/web-functional.md`,
`specs/web-interaction-contract.md`, `specs/web-api-map.md`를 유지하되 새 시각
언어와 information architecture는 별도로 결정한다.

## 기본 원칙

- 새 visual direction을 구현하기 전에 root `DESIGN.md`를 실제 결정으로 교체한다.
- scaffold에는 재사용할 기존 token, 공용 component, page pattern이 없다고 가정한다.
- 정보 확인이 우선이다. 장식용 card, icon, animation을 기능 없이 추가하지 않는다.
- 상태는 loading, empty, error, disabled를 함께 설계한다.
- desktop과 mobile 모두에서 기본 조회와 주요 action이 가능해야 한다.
- semantic HTML과 keyboard 접근성을 유지한다.

## 화면 작업 전 확인

1. 관련 `specs/web-*.md`에서 기능, action, state, API 계약을 확인한다.
2. 새 visual direction과 주요 정보 구조를 사용자와 확정한다.
3. 공용 primitive가 두 곳 이상에서 같은 의미를 가질 때만 component로 추출한다.

## 완료 전 확인

- 긴 trace name, JSON, 빈 목록에서도 layout이 깨지지 않는가
- 좁은 화면에서 가로 overflow가 생기지 않는가
- 버튼 label과 icon만으로 action을 오해하지 않는가
- 실제 browser의 desktop과 390px 안팎 mobile viewport에서 주요 흐름을 확인했는가
- visual layout을 바꿨다면 desktop/mobile screenshot으로 회귀를 확인했는가
- browser console, keyboard focus, scroll 동작에 새 문제가 없는가

별도 요청 없이 Figma를 도입하지 않는다. 새 UI가 완성되면 실제 구현과 root
`DESIGN.md`가 함께 visual source of truth가 된다. 그 전까지 scaffold의 browser
기본 style은 디자인 결정이 아니다.

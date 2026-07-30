# 제품 roadmap

roadmap은 계획이며 현재 지원 계약이 아니다. 구현 전에는 `specs/decisions.md`에
필요한 결정을 추가하고 acceptance criteria를 정한다.

| 버전 | 목표 | 확인할 사용자 가치 |
| --- | --- | --- |
| `0.2.0` | local-first prototype 공개 | PyPI SDK와 GHCR collector image로 설치하고, 기존 compiled graph를 한 번 감싸 trace를 확인하며 GitHub Issues로 피드백을 남길 수 있다. |
| `0.3.0` | UI와 디자인 개선 | 실제 피드백을 바탕으로 trace 탐색, 원인 확인, monitoring/evaluation 정보 구조를 개선한다. |
| `0.4.0` | single-project team deployment | EC2에서 HTTPS와 팀원별 접근 인증, SDK ingest credential을 갖춘 shared collector를 제공한다. |

## `0.2.0` 피드백 우선순위

- 설치와 collector 실행에서 막히는 지점
- 기존 LangGraph code에 적용하기 위해 바꿔야 했던 코드의 양
- trace가 실제 debugging 질문에 충분했는지
- UI에서 이해하기 어려운 정보와 필요한 기능
- idle 및 실행 중 resource 부담

피드백은 GitHub Issues로 받는다. Issue template은 bug, 설치/적용 경험, 기능 제안으로
나눈다.

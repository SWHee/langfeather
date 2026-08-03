# 피드백 운영

`0.3.0` prototype의 피드백은 GitHub Issues로 받습니다. feedback을 설문이나 chat에
흩어두지 않습니다.

## Issue 종류

- **Bug**: 재현 가능한 오류 또는 trace data가 기대와 다른 경우
- **설치·적용 경험**: collector 실행, SDK 설치, 기존 LangGraph code 적용에서 막힌 경우
- **기능 제안**: 실제 debugging 과정에서 부족했던 기능

## 요청할 정보

- 하려던 일과 기대한 결과
- 최소 재현 code 또는 적용한 code diff
- 실행 명령, version, error log
- 실제 trace payload를 공유해도 되는지 여부

secret, 개인 정보, production payload는 issue에 올리지 않습니다. 기능 제안은 해결책보다
먼저 어떤 debugging 질문을 해결하지 못했는지 설명하게 합니다.

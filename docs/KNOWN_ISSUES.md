# Confirmed Issues

현재 확인되어 열린 제품 이슈는 없다.

## Resolved: LF-001 LangGraph `Send` dispatch edge

- Resolved: 2026-07-27
- Automated coverage: SDK callback capture, server trace-detail summary, web
  runtime graph rendering

LangGraph `Send` 이후 callback parent가 dispatcher를 가리키지 않는 경우,
LangFeather는 callback parent를 추측해서 고치지 않는다. 대신 `Send(target,
index)`와 대상 Pregel push index가 유일하게 대응할 때만 dispatcher ID를
명시적 metadata evidence로 저장한다. UI는 그 evidence가 있는 대상에 점선
dispatch edge를 그리고, 기존 callback parent edge는 표시하지 않는다.

이 동작의 contract는 [DATA_CONTRACT.md](DATA_CONTRACT.md)에 있다. 실제 사용자
프로젝트의 LangGraph 버전과 callback metadata 조합에서의 호환성 확인은 Phase 6
release-hardening compatibility matrix에서 계속 확인한다. 이는 알려진 제품
결함이 아니라 release 검증 항목이다.

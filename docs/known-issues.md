# 알려진 제약

현재 별도로 추적 중인 확인된 제품 결함은 없습니다.

다음은 결함이 아니라 `0.3.2`의 의도된 범위 또는 제약입니다.

- local-first, single-project, single-user만 지원
- public EC2 exposure, login, team sharing, ingest credential 미지원
- delivery는 bounded in-memory best-effort이며 queue overflow와 hard kill에서 유실 가능
- 매우 크거나 끝나지 않는 stream은 memory를 많이 사용할 수 있음
- 자동 계측은 callback-visible `invoke`, `ainvoke`, `stream`, `astream`에 한정
- static graph edge, LangChain batch 계열, 비용 계산, OTel, PostgreSQL, JavaScript SDK 미지원

재현 가능한 동작 오류는 [GitHub Issues](https://github.com/SungjinWi99/LangFeather/issues)에
남겨주세요.

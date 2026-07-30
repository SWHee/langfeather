# AI-assisted 작업 흐름

작은 변경 하나를 한 PR로 만듭니다. 관련 없는 refactor, dependency upgrade, formatting
churn을 섞지 않습니다.

1. issue와 관련 `specs/`를 읽고 현재 지원 범위를 한 문장으로 적는다.
2. 수정할 package와 contract 영향 여부를 정한다.
3. 기존 focused test를 찾고, bug라면 재현 test를 먼저 추가한다.
4. 가장 작은 구현을 작성한다.
5. 변경 범위에 맞는 test와 lint/typecheck를 실행한다.
6. UI 변경이면 `.agents/design.md`의 visual QA 항목을 확인한다.
7. PR에는 목적, 바뀐 사용자 동작, 검증 명령/결과, 남은 제약을 적는다.

## 완료 기준

다음 조건을 충족해야 작업을 완료했다고 보고한다.

- 요청한 동작과 관련 acceptance criteria를 충족한다.
- 달라진 public behavior를 focused test로 고정한다.
- 변경한 package의 lint, typecheck, test를 통과한다.
- SDK/API/data contract가 바뀌면 contract check와 integration test를 통과한다.
- Docker 실행이나 browser 동작을 바꿨다면 `.agents/testing.md`의 실제 smoke test를
  수행한다.
- 사용자 동작이나 확정 계약이 달라졌다면 같은 변경에서 관련 문서를 갱신한다.
- 기존 사용자 변경을 되돌리거나 관련 없는 refactor, dependency 변경, formatting
  churn을 섞지 않는다.

환경 제약으로 필요한 검증을 실행하지 못했다면 완료로 숨기지 않고 실행하지 못한 명령,
이유, 남은 위험을 명시한다.

AI에게는 다음처럼 요청합니다.

```text
LangFeather의 [기능]을 수정해줘.
먼저 .agents/README.md와 관련 specs를 읽고, 현재 지원 범위를 벗어나지 않는지
확인해. 수정 파일과 contract 영향을 먼저 설명하고 focused test를 추가하거나 실행해.
관련 없는 refactor와 dependency 변경은 하지 마. 마지막에 변경 파일, 검증 결과,
남은 제약을 PR 형식으로 정리해.
```

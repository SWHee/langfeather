# 평가 기능 계약

평가 기능은 debugging 중 확인한 사례를 regression dataset으로 고정하고, 같은 사례에서
application 변경 전후를 비교하는 local loop다.

```text
reviewed trace → dataset example → local Python experiment → comparison
```

## 경계

- dataset은 수정 가능한 example 모음이다.
- experiment를 시작하면 input, expected output, metadata, evaluator 선언을 revision과
  함께 snapshot하고 이후 case 결과는 immutable history로 저장한다.
- target과 evaluator callable은 `evaluate()`/`aevaluate()`를 호출한 Python process에서
  실행한다. server는 이를 import하거나 실행하지 않는다.
- evaluator 값은 boolean 또는 finite number다. categorical 자동 평가와 managed LLM
  judge는 제공하지 않는다.
- trace 삭제는 dataset/experiment history를 삭제하지 않는다. source trace는 soft
  reference다.

## 비교 규칙

- 같은 dataset revision의 experiment만 비교한다.
- 사용자가 experiment 2~4개와 evaluator 최대 4개를 고른다.
- boolean은 통과율, finite number는 평균을 표시한다.
- 전체 case, 정상 값, evaluator 오류, 값 없음, target 실패 수를 숨기지 않는다.

사용 방법은 [평가 가이드](../../sdk/python/docs/evaluation.md)를, API 필드는
[data contract](../data-contract.md)를 따른다.

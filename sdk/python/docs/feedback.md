# Trace feedback 기록

`log_feedback()`은 application code에서 특정 trace에 feedback score를 남긴다. 저장되는
값은 UI에서 사람이 직접 매기는 annotation과 같은 record이므로, trace 상세와 Overview의
score 추이에 함께 나타난다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")


@langfeather.observe(name="answer")
def answer(question: str) -> str:
    context = langfeather.current_context()
    assert context is not None
    trace_id = context.trace_id  # 나중에 feedback을 붙일 대상
    ...
```

Trace는 server에 이미 저장돼 있어야 한다. 방금 실행한 trace라면 `flush()`로 전송을
끝낸 뒤 feedback을 남긴다.

```python
langfeather.flush()

langfeather.log_feedback(trace_id, name="helpful", value=True)
langfeather.log_feedback(trace_id, name="user_rating", value=4.5)
```

## Score 해석

`name`은 활성 score config의 이름이다. 같은 이름의 score가 없으면 값 type에 따라
자동으로 만든다.

| 값 | Score data type | 없을 때 |
| --- | --- | --- |
| `bool` | boolean | 자동 생성 |
| `int`, `float` (finite) | number | 자동 생성 |
| `str`, `Sequence[str]` | categorical | 생성하지 않고 error |

Categorical score는 option 목록과 선택 방식이 값 하나에서 나오지 않으므로 UI나
`POST /api/v1/scores`로 먼저 만들어야 한다. 값으로는 option label을 주고, 이미 option
ID를 알고 있다면 그대로 써도 된다.

```python
langfeather.log_feedback(trace_id, name="tone", value="좋음")
langfeather.log_feedback(trace_id, name="topics", value=["정책", "지원금"])
```

`description`은 score를 새로 만들 때만 쓰인다. 이미 있는 score의 설명은 바꾸지 않는다.

## 저장 규칙

- 같은 trace에 같은 score로 다시 기록하면 이전 값을 덮어쓴다.
- 반환하는 `Feedback`은 `annotation_id`, `trace_id`, `score_config_id`, `name`,
  `data_type`, 서버에 저장된 `value`를 가진다.
- number score에 min/max가 설정돼 있으면 범위를 벗어난 값은 저장되지 않는다.
- archive된 score에는 기록할 수 없다.

## 실패 처리

실패는 모두 `FeedbackError`(`EvaluationError`의 하위 type)로 올라오고, 가능하면
`status_code`에 HTTP status가 담긴다. `log_feedback()`은 trace 전송 경로와 달리 조용히
버리지 않으므로, 사용자 응답 경로에서 호출한다면 직접 감싸는 편이 안전하다.

```python
try:
    langfeather.log_feedback(trace_id, name="helpful", value=True)
except langfeather.FeedbackError as error:
    logger.warning("feedback 기록 실패: %s", error)
```

전송이 끝나기 전에 호출하면 trace를 찾지 못해 404로 실패한다. 값 type이 score와 맞지
않거나 categorical option이 없을 때는 요청을 보내기 전에 error가 난다.

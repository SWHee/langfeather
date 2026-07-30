# LangChain·LangGraph 계측

이 가이드는 optional LangChain integration을 사용하는 application을 위한 문서입니다.
일반 Python과 ASGI 계측은 [계측하기](instrumentation.md)를 참고하세요.

## 설치와 적용 위치

```bash
pip install "langfeather[langchain]"
```

`StateGraph.compile()` 결과처럼 실제로 호출하는 최상위 Runnable을 **한 번만**
`wrap_runnable()`으로 감쌉니다. node, prompt, state schema, checkpointer를 따로
감쌀 필요가 없습니다.

```python
import langfeather

compiled_graph = builder.compile(checkpointer=checkpointer)
graph = langfeather.wrap_runnable(compiled_graph, name="support-agent")

answer = graph.invoke(
    {"question": "내 신청 상태를 알려줘"},
    {
        "configurable": {"thread_id": "conversation-42"},
        "tags": ["development"],
        "metadata": {"release": "2026-07-30"},
    },
)
```

wrapper는 기존 config와 callback을 보존하면서 LangFeather callback을 더합니다. 같은
Runnable을 중첩해 반복해서 감싸지 마세요.

## 지원하는 호출 방식

| 호출 | 지원 | terminal trace 시점 |
| --- | --- | --- |
| `invoke()` | 예 | 반환 또는 예외 |
| `ainvoke()` | 예 | 반환 또는 예외 |
| `stream()` | 예 | iterator 종료, 실패, 취소 |
| `astream()` | 예 | async iterator 종료, 실패, 취소 |

stream의 chunk는 변경하지 않고 호출자에게 반환합니다. 시작한 stream을 중간에 닫으면
cancelled trace가 기록되고, 생성만 한 stream은 trace를 만들지 않습니다.

## session과 trace ID

root trace의 session ID는 다음 순서로 선택합니다.

1. `config["metadata"]["session_id"]`
2. `config["configurable"]["thread_id"]`
3. 지정하지 않음

따라서 LangGraph의 일반적인 `thread_id`만 사용해도 대화별 trace를 이동할 수 있습니다.
별도 session 이름을 쓸 때는 metadata에 `session_id`를 넣으세요.

```python
result = graph.invoke(
    {"question": "..."},
    {
        "configurable": {"thread_id": "internal-state-id"},
        "metadata": {"session_id": "customer-42"},
    },
)
```

호출 config의 `metadata.langfeather_trace_id`를 제공하면 그 root trace ID를 유지할 수
있습니다. 이 값은 재시도나 외부 correlation을 위해 안정적인 ID가 이미 있을 때만
사용하세요.

## 무엇이 자동으로 보이나

LangFeather callback이 실제 runtime에서 받는 chain, Runnable, LLM, retriever,
tool run과 그 parent 관계를 기록합니다. UI는 관측된 callback evidence만 표시하며
정적 graph edge나 보지 못한 호출을 추론하지 않습니다.

LLM model과 token 정보는 LangChain이 provider metadata로 제공한 경우에만 복사합니다.
누락된 token을 추정하지 않고, provider 가격표나 비용 계산도 하지 않습니다. 첫 token
시간 역시 실제 token callback이 있을 때만 기록합니다.

다음은 자동 계측 대상이 아닙니다.

- LangChain을 우회한 provider SDK 호출
- callback을 발생시키지 않는 일반 Python helper
- Runnable 바깥에서 실행된 외부 tool

이런 구간은 `@langfeather.observe(kind="tool")` 또는 `span(kind="tool")`으로
명시적으로 계측하세요.

## 기존 application 동작 유지

관측 실패, serializer 실패, queue overflow, collector 통신 실패가 application의
정상 반환값·stream chunk·원래 예외를 대체하지 않도록 설계되어 있습니다. 그 대신
trace가 유실될 수 있습니다. 짧게 끝나는 script는 종료 전에 `flush()`를 호출하고,
전송 보장 범위는 [전송과 제약](delivery-and-limits.md)에서 확인하세요.

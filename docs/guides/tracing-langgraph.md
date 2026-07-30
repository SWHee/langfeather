# LangGraph tracing 가이드

## 적용 원칙

`StateGraph.compile()` 결과처럼 실제로 호출하는 최상위 Runnable을 한 번만
`wrap_runnable()`으로 감쌉니다. node마다 wrapper를 추가하거나 global monkey patch를
사용하지 않습니다.

```python
compiled_graph = builder.compile(checkpointer=checkpointer)
graph = langfeather.wrap_runnable(compiled_graph, name="support-agent")
```

지원하는 호출 방식은 `invoke`, `ainvoke`, `stream`, `astream`입니다. wrapper는 기존
callback, tags, metadata, configurable 값을 보존합니다.

## session 연결

`metadata.session_id`가 있으면 그것을 사용하고, 없으면 LangGraph
`configurable.thread_id`를 session 후보로 사용합니다. 둘 다 없어도 trace는 생성되며,
그 경우에는 trace ID만 자동 생성됩니다.

## 일반 Python과 ASGI

LangChain callback에 나타나지 않는 helper나 raw provider/tool 호출은
`@langfeather.observe(kind="tool")` 또는 `span(kind="tool")`으로 감쌉니다. HTTP
application은 `wrap_asgi(app)`으로 request를 root trace로 만들 수 있습니다.

상세 API와 delivery 제약은 SDK 문서를 보세요.

- [SDK README](../../sdk/python/README.md)
- [계측하기](../../sdk/python/docs/instrumentation.md)
- [LangChain·LangGraph](../../sdk/python/docs/langchain-langgraph.md)
- [전송과 제약](../../sdk/python/docs/delivery-and-limits.md)

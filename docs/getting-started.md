# 시작하기

LangFeather `0.3.1`은 local-first prototype입니다. collector와 trace data는 자신의
PC에서 실행·보관하며 login이나 cloud account가 필요하지 않습니다.

## Collector 실행

필요한 것: Docker Desktop, Python 3.10 이상, `pip`.

```bash
docker pull ghcr.io/sungjinwi99/langfeather:0.3.1
docker run -d --name langfeather \
  -p 127.0.0.1:4319:4319 \
  -v langfeather-data:/data \
  ghcr.io/sungjinwi99/langfeather:0.3.1
```

브라우저에서 <http://127.0.0.1:4319>를 엽니다. collector를 끄려면 data를 지우지 않는
`docker stop langfeather`를 사용합니다. container를 다시 만들 때도 `langfeather-data`
volume을 유지하면 trace data는 남습니다.

## LangGraph application에 적용하기

LangChain 또는 LangGraph application에는 optional extra를 설치합니다.

```bash
pip install "langfeather[langchain]"
```

실제로 호출하는 compiled graph를 한 번만 감쌉니다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")
graph = langfeather.wrap_runnable(compiled_graph)

result = graph.invoke(
    {"question": "검색 결과를 요약해줘"},
    {"configurable": {"thread_id": "example-session"}},
)
langfeather.flush(timeout=2)
```

기존 node, state, checkpointer, config, streaming, 예외 처리는 바꾸지 않습니다.
`thread_id`가 있으면 같은 대화의 trace를 묶어 볼 수 있습니다.

다음 단계는 [LangGraph tracing 가이드](guides/tracing-langgraph.md)입니다.

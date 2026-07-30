# LangFeather Python SDK

[한국어 README](README.md)

The LangFeather Python SDK sends LangChain, LangGraph, and general Python
observations to a local LangFeather collector. Delivery is background,
bounded, and best-effort so observability does not change application results.

Start the local collector and UI first; see the [project README](../../README_EN.md).

## Install

```bash
# LangChain or LangGraph integration
pip install "langfeather[langchain]"

# General Python or ASGI capture only
pip install langfeather
```

Endpoint precedence is `configure(endpoint=...)`, then `LANGFEATHER_ENDPOINT`,
then `http://127.0.0.1:4319`.

## Quick start

Wrap the top-level Runnable you actually call, once.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")
graph = langfeather.wrap_runnable(compiled_graph, name="my-langgraph-app")

result = graph.invoke(
    {"question": "Summarize the retrieved documents."},
    {"configurable": {"thread_id": "example-session"}},
)
langfeather.flush(timeout=2)
```

Detailed Korean-first guides:

- [Instrumentation](docs/instrumentation.md)
- [LangChain and LangGraph](docs/langchain-langgraph.md)
- [Delivery and limits](docs/delivery-and-limits.md)
- [Dataset, experiment, evaluator guide](docs/evaluation.md)

`flush()` only waits for envelopes accepted by the SDK at the time it is called;
it is not an end-to-end database durability guarantee. See
[Delivery and limits](docs/delivery-and-limits.md) before relying on
it in a short-lived process.

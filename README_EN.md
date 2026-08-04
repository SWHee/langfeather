# LangFeather

[한국어 README](README.md)

> Lightweight observability for inspecting real LangGraph chatbot execution in constrained development environments.

LangFeather captures callback-visible Runnable, LLM, retriever, and tool runs,
then lets you inspect original input/output, errors, and latency in a local UI.
It keeps the debugging features needed for a LangGraph project without trying to
reproduce a full hosted observability platform.

## Current scope

`0.3.2` is a local-first, single-project, single-user prototype. The collector
runs on your own machine and binds to `127.0.0.1:4319` by default. Login, cloud
collection, team sharing, and public EC2 deployment are not supported yet.

Trace payloads are stored in local SQLite without automatic redaction,
truncation, or sampling. Do not send secrets or production data.

## Quick start

Run the collector:

```bash
docker run -d --name langfeather \
  -p 127.0.0.1:4319:4319 \
  -v langfeather-data:/data \
  ghcr.io/sungjinwi99/langfeather:0.3.2
```

Open <http://127.0.0.1:4319>, install the SDK, then wrap the compiled graph you
actually call:

```bash
pip install "langfeather[langchain]"
```

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")
graph = langfeather.wrap_runnable(compiled_graph, name="my-langgraph-app")
result = graph.invoke(
    {"question": "Summarize the retrieved documents."},
    {"configurable": {"thread_id": "example-session"}},
)
```

`compiled_graph` is the existing result of `StateGraph.compile()`.

The detailed docs are Korean-first:

- [Getting started](docs/getting-started.md)
- [Python SDK](sdk/python/README_EN.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

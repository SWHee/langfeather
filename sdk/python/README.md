# LangFeather Python SDK

The SDK core has no runtime dependencies. Install the optional LangChain
integration for LangChain or LangGraph applications:

```bash
pip install "langfeather[langchain]"
```

Wrap the top-level Runnable once:

```python
import langfeather

langfeather.configure()  # optional
graph = langfeather.wrap_runnable(graph)
result = graph.invoke(
    {"question": "hello"},
    {"configurable": {"thread_id": "example-session"}},
)
langfeather.flush(timeout=2)
```

Configuration precedence is:

1. `configure(endpoint="http://...")`
2. the `LANGFEATHER_ENDPOINT` environment variable when `endpoint` is omitted
3. `http://127.0.0.1:4319`

The endpoint is the server base URL; the SDK posts terminal envelopes to
`/api/v1/traces/batch`. Configuration is lazy: importing or configuring the SDK
does not start a sender thread or perform network I/O. The first completed trace
starts a bounded background sender.

For sessions, `config["metadata"]["session_id"]` takes precedence over
LangGraph's `config["configurable"]["thread_id"]`.

`invoke`, `ainvoke`, `stream`, and `astream` are trace-aware. Stream chunks are
returned unchanged while LangFeather keeps an in-memory diagnostic aggregate
and sends one terminal envelope after exhaustion, failure, cancellation,
`close()`, or `aclose()`. Closing a started stream records `cancelled`; merely
creating a stream without starting iteration does not execute or record it.

The optional LangChain callback captures callback-visible chain, Runnable,
LLM, retriever, and tool runs with their runtime parent relation. LLM model and
token fields are copied only when LangChain exposes provider metadata; missing
tokens are not estimated and cost is not calculated. Time to first token is
recorded only after an actual `on_llm_new_token` callback.

General Python code does not need LangChain:

```python
import langfeather

@langfeather.observe(name="retrieve_documents")
def retrieve_documents(query: str) -> list[str]:
    with langfeather.span("local_lookup", input=query) as current_span:
        documents = ["document"]
        current_span.set_output(documents)
    return documents
```

`@observe` supports synchronous functions, coroutines, generators, and async
generators. Iterator chunks and application exceptions are returned unchanged.
Closing a started generator records `cancelled`; creating one without iterating
does not create a trace.

`current_context()` returns an explicit context snapshot. Use
`use_context(snapshot)` only when manually propagating the current trace into a
new thread or an execution context that did not inherit Python `contextvars`.
The snapshot is valid only while its owning trace is active. Work intentionally
detached beyond the parent call starts a new root trace instead of appending to
an envelope that has already been sent.

Generic spans and callback-visible LangChain runs can alternate without
flattening the call tree. For example, a `span()` inside a LangGraph node is a
child of that node, and a Runnable invoked inside the span is a child of the
span.

Any HTTP ASGI application can be wrapped without importing FastAPI:

```python
app = langfeather.wrap_asgi(app)
```

Each HTTP request becomes a new root observation. A wrapped Runnable invoked
inside the request becomes its child. The wrapper records request routing fields
and response status/body, but intentionally omits request and response headers,
including cookies and authorization values. Status and body chunks observed
before an exception or disconnect remain in the terminal payload. A received
`http.disconnect` records the request as `cancelled`.

The serializer preserves Pydantic models, dataclasses, LangChain documents and
messages, diagnostic standard-library types, non-string mapping keys, cycles,
and unsupported values through explicit JSON markers. The SDK never walks an
arbitrary object's `__dict__`.

Delivery remains best-effort. The bounded in-memory queue discards the oldest
waiting trace on overflow, retries only network errors, `408`, `429`, and `5xx`,
and reports failures through warnings. Serialization, callback, queue, and
collector failures do not replace application return values, chunks, exception
instances, or their originating traceback frames. `shutdown()` stops accepting
new envelopes after its bounded flush; call `configure()` explicitly before
tracing again in the same process.

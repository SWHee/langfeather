# LangFeather Python SDK

[English README](README_EN.md)

LangFeather Python SDK는 LangChain·LangGraph 실행과 일반 Python 코드를 local
LangFeather collector로 보냅니다. SDK는 application의 실행 결과를 바꾸지 않도록
백그라운드에서 best-effort로 전송합니다.

> 시작하기 전에 local collector와 UI를 실행하세요. 전체 설치 방법은
> [프로젝트 README](../../README.md)를 참고하세요.

## 설치

LangChain 또는 LangGraph application에는 optional extra를 설치합니다.

```bash
pip install "langfeather[langchain]"
```

일반 Python 함수나 ASGI application만 관측한다면 core package만 설치하면 됩니다.

```bash
pip install langfeather
```

SDK endpoint는 다음 우선순위로 결정됩니다.

1. `langfeather.configure(endpoint="http://...")`
2. endpoint를 생략했을 때 `LANGFEATHER_ENDPOINT`
3. 기본값 `http://127.0.0.1:4319`

Host에서 application을 실행하면 기본 endpoint를 그대로 사용할 수 있습니다.
같은 Docker Compose network 안의 application container에서는
`http://langfeather:4319`처럼 collector service 주소를 지정하세요.

## 사용법

`StateGraph.compile()`의 결과처럼 실제로 호출하는 최상위 Runnable을 감쌉니다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")
graph = langfeather.wrap_runnable(compiled_graph, name="my-langgraph-app")

result = graph.invoke(
    {"question": "검색 결과를 요약해줘"},
    {"configurable": {"thread_id": "example-session"}},
)

# 짧게 끝나는 CLI/script에서는 종료 전에 호출합니다.
langfeather.flush(timeout=2)
```

UI에서 새 trace를 열어 root graph와 내부 Runnable·LLM·retriever·tool 실행을
확인하세요. 기존 입력, 출력, streaming chunk, 예외는 wrapper를 씌우기 전과 같은
형태로 application에 전달됩니다.

## 다음 문서

- [계측하기](docs/instrumentation.md): `@observe`, `span()`, ASGI,
  명시적 context propagation
- [LangChain·LangGraph](docs/langchain-langgraph.md): 지원 호출 방식,
  session 연결, callback 관측 범위
- [전송과 제약](docs/delivery-and-limits.md): queue, retry, `flush()`,
  shutdown, streaming의 제약
- [Dataset, Experiment, Evaluator guide](../../docs/DATASET_EXPERIMENT_EVALUATION.md):
  local Python process에서 실행하는 평가 기능

## 최소 API

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")

@langfeather.observe(name="retrieve_documents", kind="retriever")
def retrieve_documents(query: str) -> list[str]:
    with langfeather.span("local_lookup", input={"query": query}) as operation:
        documents = ["document"]
        operation.set_output(documents)
    return documents
```

`@observe`는 동기 함수, coroutine, generator, async generator를 지원합니다.
직접 provider SDK를 호출하거나 LangChain callback에 나타나지 않는 도구는
`@observe(kind="tool")` 또는 `span(kind="tool")`으로 감싸세요.

## 데이터와 전달의 경계

LangFeather는 debugging을 위해 trace payload를 자동으로 redact, truncate,
summarize, sample하지 않습니다. 실제 secret이나 production data를 공유 database에
넣지 마세요.

전송은 bounded in-memory queue와 짧은 retry를 사용하는 best-effort 방식입니다.
collector가 없거나 queue가 가득 차도 application의 반환값이나 예외를 바꾸지 않지만,
그 trace는 유실될 수 있습니다. `flush()`가 `True`를 반환해도 SDK가 collector에
전달 처리를 마쳤다는 뜻일 뿐, 서버 database에 저장됐다는 end-to-end 보장은
아닙니다. 자세한 운영 의미는 [전송과 제약](docs/delivery-and-limits.md)을
확인하세요.

# Python SDK 계측하기

이 문서는 LangFeather Python SDK로 일반 Python 코드, LangChain/LangGraph runnable,
ASGI request를 trace로 남기는 방법을 설명합니다. 설치와 첫 실행은
[SDK README](../README.md)에서 시작하세요.

## 어떤 방식을 쓸까

| 대상 | 권장 API | 생성되는 root |
| --- | --- | --- |
| LangChain/LangGraph application | `wrap_runnable()` | 최상위 Runnable 호출 |
| 일반 함수 또는 provider SDK 호출 | `@observe` | 함수 호출 |
| 코드의 한 구간 | `span()` | 활성 trace의 child, 없으면 새 trace |
| HTTP ASGI application | `wrap_asgi()` | HTTP request |

활성 trace 안에서 새 계측을 시작하면 부모-자식 관계가 유지됩니다. 예를 들어
`span()` 안에서 호출한 `@observe` 함수는 span의 child가 됩니다.

## 함수에 `@observe` 붙이기

```python
import langfeather

@langfeather.observe(
    name="search_documents",
    kind="retriever",
    metadata={"index": "policy-v2"},
)
def search_documents(query: str) -> list[str]:
    return ["matching document"]
```

기본 이름은 함수명이고 기본 kind는 `function`입니다. `name`, `kind`, `metadata`,
`session_id`를 지정할 수 있습니다. 동기 함수, coroutine, generator, async generator를
지원하며 원래 반환값·yield chunk·예외를 application에 그대로 전달합니다.

LangChain callback이 직접 볼 수 없는 raw provider SDK 호출이나 임의의 Python tool은
`kind="tool"` 등으로 명시적으로 감싸면 관측할 수 있습니다.

```python
@langfeather.observe(name="weather_api", kind="tool")
def fetch_weather(city: str) -> dict[str, object]:
    return weather_client.current(city)
```

## 구간에 `span()` 사용하기

반환값이 아닌 중간 작업을 남기려면 `span()`의 handle에 output을 넣습니다.

```python
with langfeather.span(
    "rerank",
    input={"candidate_count": len(documents)},
    kind="retriever",
) as operation:
    reranked = rerank(documents)
    operation.set_output(reranked)
```

block에서 예외가 발생하면 span은 error로 끝나고 예외는 다시 발생합니다. output을
설정하지 않으면 정상 종료 output은 `null`입니다.

## ASGI request 관측

FastAPI 의존성 없이 모든 HTTP ASGI application을 감쌀 수 있습니다. application을
실행하기 전에 wrapper를 적용하세요.

```python
import langfeather
from fastapi import FastAPI

app = FastAPI()
app = langfeather.wrap_asgi(app, name="policy-api")
```

HTTP request 하나가 root observation 하나가 됩니다. request 안에서 호출된 wrapped
Runnable 또는 `@observe` 함수는 그 request의 child가 됩니다. HTTP가 아닌 ASGI scope는
그대로 통과합니다.

ASGI wrapper는 route 진단 필드, response status, response body를 기록합니다. request와
response header는 기록하지 않으므로 cookie와 authorization header도 기록하지 않습니다.
client disconnect는 request를 cancelled로 기록합니다.

## 다른 thread로 context 전달하기

`contextvars`를 자연스럽게 상속하지 않는 별도 thread에는 현재 context를 명시적으로
전달할 수 있습니다.

```python
from concurrent.futures import ThreadPoolExecutor
import langfeather

@langfeather.observe
def parent() -> str:
    context = langfeather.current_context()
    assert context is not None

    def child() -> str:
        with langfeather.use_context(context):
            with langfeather.span("background_lookup") as operation:
                operation.set_output("done")
        return "done"

    with ThreadPoolExecutor() as executor:
        return executor.submit(child).result()
```

snapshot은 owning trace가 살아 있는 동안에만 부모 연결에 사용하세요. 의도적으로
나중에 실행되는 background work는 새 root trace로 남기는 편이 안전합니다.

## streaming과 예외

`@observe`와 Runnable wrapper는 stream을 생성한 시점이 아니라 처음 소비한 시점부터
관측합니다. 끝까지 소비하면 완료, 실행 중 예외가 나면 error, 시작한 stream을
`close()` 또는 `aclose()`하면 cancelled로 마감합니다. 생성만 하고 소비하지 않은
stream은 실행·기록되지 않습니다.

stream chunk는 원래대로 전달되며 SDK는 terminal payload를 만들기 위해 chunk를 memory에
모읍니다. 오래 끝나지 않거나 매우 큰 stream은 memory 사용량을 키울 수 있으므로
[전송과 제약](delivery-and-limits.md)의 제한을 확인하세요.

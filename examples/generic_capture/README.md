# Generic Python Capture

LangChain이나 LangGraph 밖의 일반 Python 함수도 같은 local trace에 기록할 수
있다. 먼저 LangFeather server를 실행한 뒤 repository root에서 다음 명령을
실행한다.

```bash
uv run python examples/generic_capture/app.py
```

`generic-python` trace 안에 함수 root와 `normalize_question` child가 생성된다.
`@observe`는 원래 반환값과 exception을 그대로 유지하며, `span()`의 결과는
`set_output()`으로 명시할 수 있다.

다른 thread에 현재 trace를 명시적으로 전달해야 할 때만
`current_context()`와 `use_context()`를 사용한다.

```python
context = langfeather.current_context()

def worker():
    if context is not None:
        with langfeather.use_context(context):
            with langfeather.span("worker_step"):
                ...
```

FastAPI를 포함한 ASGI application은 framework dependency 없이 감쌀 수 있다.

```python
app = langfeather.wrap_asgi(app)
```

HTTP wrapper는 method, path, query string과 response status/body를 기록하지만
cookie, authorization, response header는 의도적으로 수집하지 않는다.

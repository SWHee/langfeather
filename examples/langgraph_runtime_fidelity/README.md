# LangGraph runtime fidelity fixtures

이 예제들은 LangGraph의 가능한 정적 경로가 아니라, 한 번의 요청에서 실제로
실행된 callback 경로를 LangFeather로 확인하기 위한 작은 fixture다.

저장소 root에서 개발 환경과 single-worker API를 실행한다.

```bash
make setup
LANGFEATHER_DATABASE_URL=sqlite:///./langfeather-runtime.db \
  uv run uvicorn langfeather_server.app:app \
  --host 127.0.0.1 --port 8000 --workers 1
```

다른 terminal에서 web을 실행한다.

```bash
npm run dev --prefix web
```

세 번째 terminal에서 원하는 scenario를 실행한다.

```bash
LANGFEATHER_ENDPOINT=http://127.0.0.1:8000 \
  uv run python -m examples.langgraph_runtime_fidelity.app sequential
```

`sequential` 대신 `parallel`, `conditional`, `loop`, `nested`, `fallback`,
`stream`, `streaming-llm`을 지정할 수 있다. 실행 후
`http://127.0.0.1:5173`에서 해당 `runtime-*` trace를 연다.

각 scenario에서 확인할 핵심은 다음과 같다.

| Scenario | Trace detail에서 확인할 것 |
| --- | --- |
| sequential | 두 node의 실제 입력, 출력, 실행 순서 |
| parallel | sibling interval이 실제로 겹치는지 |
| conditional | 선택된 branch만 나타나고 선택되지 않은 branch는 없는지 |
| loop | 같은 `retry_node`가 서로 다른 observation으로 세 번 나타나는지 |
| nested | `RunnableLambda` 내부 parent-child 관계 |
| fallback | 실패한 child와 성공한 fallback, completed root |
| stream | application chunk를 그대로 받으면서 terminal trace가 남는지 |
| streaming-llm | fake chat model의 token callback, TTFT, chunk 보존 |

`fixtures.py`에는 integration test용 failed-root와 cancelled-async-stream
fixture도 포함한다. 이 두 fixture는 의도적으로 exception 또는 cancellation을
발생시키므로 기본 CLI 목록에서는 실행하지 않는다.

# LangGraph Quickstart

이 예제는 두 개의 순차 node를 실행하고 LangFeather에 실제 runtime
observation을 보낸다.

저장소 root에서 개발환경과 API를 실행한다.

```bash
make setup
LANGFEATHER_DATABASE_URL=sqlite:///./langfeather-dev.db \
  uv run uvicorn langfeather_server.app:app --host 127.0.0.1 --port 8000
```

다른 terminal에서 web을 실행한다. Vite는 `/api` 요청을 기본적으로
`http://127.0.0.1:8000`에 전달한다.

```bash
npm run dev --prefix web
```

세 번째 terminal에서 example을 실행한다.

```bash
LANGFEATHER_ENDPOINT=http://127.0.0.1:8000 \
  uv run python examples/langgraph_quickstart/app.py
```

`http://127.0.0.1:5173`을 열고 `quickstart` trace를 선택한다.
`draft_answer`, `finalize_answer` node를 각각 눌러 원본 input/output을
확인한다.

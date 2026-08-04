# LangFeather Server

LangFeather collector는 FastAPI와 SQLite persistence를 제공하는 단일 process package다.
일반 사용자는 `ghcr.io/sungjinwi99/langfeather:0.3.2` image로 실행합니다. repository
root의 `docker compose`는 source build를 위한 개발 환경입니다.

test나 embedding에서는 명시적인 database URL로 application factory를 만들 수 있습니다.

```python
from langfeather_server.app import create_app

app = create_app(database_url="sqlite:////tmp/langfeather.db")
```

기본 database URL이 맞지 않으면 `LANGFEATHER_DATABASE_URL`을 지정하고 Uvicorn worker
하나로 실행합니다.

```bash
uvicorn langfeather_server.app:app --host 127.0.0.1 --port 4319 --workers 1
```

SQLite persistence 계약상 production server는 worker를 하나만 사용해야 합니다. 현재
release에는 login이 없으므로 loopback bind를 유지하고 public network에 직접 노출하지
마세요.

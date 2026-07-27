# LangFeather Server

Local FastAPI and SQLite persistence package for LangFeather.

The application factory accepts an explicit SQLAlchemy database URL for tests
and embedding:

```python
from langfeather_server.app import create_app

app = create_app(database_url="sqlite:////tmp/langfeather.db")
```

For Uvicorn, set `LANGFEATHER_DATABASE_URL` when the default
`sqlite:////data/langfeather.db` is not appropriate, then run:

```text
uvicorn langfeather_server.app:app --host 127.0.0.1 --port 4319 --workers 1
```

LangFeather production servers **must use exactly one Uvicorn worker**. The
SQLite WAL configuration supports concurrent readers, but v1 deliberately has
one application process/writer. Starting multiple workers violates the v1
persistence contract. LangFeather has no login in v1, so keep the default
loopback binding unless local-network exposure has been explicitly secured.

from __future__ import annotations

import fcntl
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

SQLITE_BUSY_TIMEOUT_MS = 5_000


class DatabasePathError(ValueError):
    pass


class DatabaseInUseError(RuntimeError):
    pass


@dataclass(frozen=True)
class Database:
    engine: Engine
    session_factory: sessionmaker[Session]


def sqlite_database_path(database_url: str) -> Path:
    url = make_url(database_url)
    if url.get_backend_name() != "sqlite":
        raise DatabasePathError("LangFeather v1 requires a SQLite database URL")
    if url.database is None or url.database == ":memory:":
        raise DatabasePathError("a file-backed SQLite database is required")
    return Path(url.database).resolve()


def _lock_path(database_path: Path) -> Path:
    return database_path.with_name(f"{database_path.name}.lock")


@contextmanager
def exclusive_sqlite_lock(
    database_path: Path,
    *,
    blocking: bool,
) -> Iterator[None]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_path(database_path).open("a+") as lock_file:
        flags = fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB
        try:
            fcntl.flock(lock_file.fileno(), flags)
        except BlockingIOError as error:
            raise DatabaseInUseError("LangFeather server appears to be running") from error
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def backup_sqlite_database(source_path: Path, destination_path: Path) -> None:
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    source_uri = f"{source_path.resolve().as_uri()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as source:
        with sqlite3.connect(destination_path) as destination:
            source.backup(destination)


def backup_live_database(engine: Engine, destination_path: Path) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    source = engine.raw_connection()
    try:
        with sqlite3.connect(destination_path) as destination:
            source.backup(destination)
    finally:
        source.close()


def create_database(database_url: str) -> Database:
    url = make_url(database_url)
    connect_args: dict[str, Any] = {}
    if url.get_backend_name() == "sqlite":
        connect_args["check_same_thread"] = False

    engine = create_engine(
        url,
        connect_args=connect_args,
        future=True,
    )

    if url.get_backend_name() == "sqlite":

        @event.listens_for(engine, "connect")
        def configure_sqlite(
            dbapi_connection: Any,
            _connection_record: Any,
        ) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA synchronous=FULL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
            finally:
                cursor.close()

    return Database(
        engine=engine,
        session_factory=sessionmaker(
            bind=engine,
            class_=Session,
            expire_on_commit=False,
        ),
    )

from __future__ import annotations

import os
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile

from langfeather_server.database import (
    DatabaseInUseError,
    DatabasePathError,
    backup_sqlite_database,
    exclusive_sqlite_lock,
    sqlite_database_path,
)
from langfeather_server.migrations import head_revision

DEFAULT_DATABASE_URL = "sqlite:////data/langfeather.db"
DATABASE_URL_ENV = "LANGFEATHER_DATABASE_URL"


class RestoreError(RuntimeError):
    """Raised when an offline SQLite restore cannot be completed safely."""


@dataclass(frozen=True)
class RestoreResult:
    database_path: Path
    safety_copy: Path | None


def _validate_backup(backup_path: Path) -> None:
    if not backup_path.is_file():
        raise RestoreError(f"backup does not exist: {backup_path}")

    source_uri = f"{backup_path.resolve().as_uri()}?mode=ro"
    try:
        with sqlite3.connect(source_uri, uri=True) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()
            if integrity != ("ok",):
                raise RestoreError("backup failed SQLite integrity_check")
            revision = connection.execute(
                "SELECT version_num FROM alembic_version"
            ).fetchone()
    except sqlite3.Error as error:
        raise RestoreError("backup is not a readable LangFeather SQLite database") from error

    if revision is None or revision[0] != head_revision():
        raise RestoreError("backup database migration is not supported by this server")


def _safety_copy_path(database_path: Path) -> Path:
    return database_path.with_name(f"{database_path.name}.before-restore.db")


def _atomic_copy(source_path: Path, destination_path: Path) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="wb",
            dir=destination_path.parent,
            prefix=f".{destination_path.name}.",
            suffix=".restore",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            with source_path.open("rb") as source:
                shutil.copyfileobj(source, temporary_file)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, destination_path)
    except OSError as error:
        raise RestoreError("could not copy the backup into the database location") from error
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def restore_database(
    backup_path: Path,
    *,
    database_url: str | None = None,
) -> RestoreResult:
    """Restore a stopped LangFeather server from a validated SQLite backup.

    The server and this command share an advisory lock file.  Acquiring the
    lock non-blockingly makes a running server an explicit error instead of a
    race with its SQLite connection pool.
    """

    resolved_url = database_url or os.environ.get(DATABASE_URL_ENV) or DEFAULT_DATABASE_URL
    try:
        database_path = sqlite_database_path(resolved_url)
    except DatabasePathError as error:
        raise RestoreError(str(error)) from error

    backup_path = backup_path.resolve()
    if backup_path == database_path:
        raise RestoreError("backup and destination database must be different files")
    _validate_backup(backup_path)

    try:
        with exclusive_sqlite_lock(database_path, blocking=False):
            safety_copy: Path | None = None
            if database_path.exists():
                safety_copy = _safety_copy_path(database_path)
                try:
                    backup_sqlite_database(database_path, safety_copy)
                except (OSError, sqlite3.Error) as error:
                    raise RestoreError("could not create a safety copy of the database") from error
            _atomic_copy(backup_path, database_path)
    except DatabaseInUseError as error:
        raise RestoreError("cannot restore while the LangFeather server is running") from error

    return RestoreResult(database_path=database_path, safety_copy=safety_copy)

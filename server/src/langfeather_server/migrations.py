from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, text


def _migration_script_location() -> Path:
    packaged_location = Path(__file__).with_name("_alembic")
    if packaged_location.is_dir():
        return packaged_location

    source_location = Path(__file__).resolve().parents[2] / "migrations"
    if source_location.is_dir():
        return source_location

    raise RuntimeError("Alembic migration assets are missing from the server package")


def _alembic_config() -> Config:
    config = Config()
    config.set_main_option(
        "script_location",
        str(_migration_script_location()),
    )
    return config


def upgrade_database(engine: Engine) -> None:
    config = _alembic_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def head_revision() -> str:
    revision = ScriptDirectory.from_config(_alembic_config()).get_current_head()
    if revision is None:
        raise RuntimeError("Alembic migration head is missing")
    return revision


def current_revision(engine: Engine) -> str | None:
    with engine.connect() as connection:
        result = connection.execute(
            text("SELECT version_num FROM alembic_version")
        ).scalar_one_or_none()
    return result

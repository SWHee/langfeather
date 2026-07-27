from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from langfeather_server.app import create_app
from langfeather_server.cli import main
from langfeather_server.restore import RestoreError, restore_database


def make_envelope() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "trace": {
            "trace_id": "tr_admin_01",
            "name": "admin-graph",
            "started_at": "2026-07-26T12:00:00.000000Z",
            "ended_at": "2026-07-26T12:00:01.000000Z",
            "duration_us": 1_000_000,
            "status": "completed",
            "input": {"question": "backup works?"},
            "output": {"answer": "yes"},
            "error": None,
            "session_id": "admin-session",
            "tags": [],
            "metadata": {},
        },
        "observations": [
            {
                "observation_id": "obs_admin_01",
                "trace_id": "tr_admin_01",
                "parent_observation_id": None,
                "sequence": 0,
                "name": "admin-graph",
                "kind": "runnable",
                "started_at": "2026-07-26T12:00:00.000000Z",
                "ended_at": "2026-07-26T12:00:01.000000Z",
                "duration_us": 1_000_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"question": "backup works?"},
                "output": {"answer": "yes"},
                "error": None,
                "model": None,
                "usage": None,
                "metadata": {},
            }
        ],
    }


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "langfeather.db"


@pytest.fixture
def api(database_path: Path) -> Iterator[TestClient]:
    application = create_app(database_url=f"sqlite:///{database_path}")
    with TestClient(application, base_url="http://localhost") as client:
        yield client


def store_trace_and_feedback(client: TestClient) -> None:
    feedback = {
        "feedback_id": "fb_admin_01",
        "trace_id": "tr_admin_01",
        "name": "user_feedback",
        "value": True,
        "comment": "backup me",
        "metadata": {},
        "created_at": "2026-07-26T12:00:00.000000Z",
        "updated_at": "2026-07-26T12:00:00.000000Z",
    }
    assert client.post("/api/v1/feedback", json=feedback).status_code == 201
    assert (
        client.post("/api/v1/traces/batch", json={"items": [make_envelope()]})
        .json()["results"][0]["status"]
        == "stored"
    )


def test_backup_reset_and_offline_restore_round_trip(
    api: TestClient,
    database_path: Path,
    tmp_path: Path,
) -> None:
    store_trace_and_feedback(api)

    backup = api.get("/api/v1/admin/backup")
    backup_path = tmp_path / "backup.db"
    backup_path.write_bytes(backup.content)
    assert backup.status_code == 200
    assert backup.headers["content-type"].startswith("application/x-sqlite3")
    assert "attachment" in backup.headers["content-disposition"]
    with sqlite3.connect(backup_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM traces").fetchone() == (1,)

    invalid_confirmation = api.post("/api/v1/admin/reset", json={"confirmation": "no"})
    reset = api.post("/api/v1/admin/reset", json={"confirmation": "RESET"})
    assert invalid_confirmation.status_code == 422
    assert reset.status_code == 204
    assert api.get("/api/v1/traces").json()["items"] == []

    # The TestClient fixture owns the server lock until this test ends. The
    # direct restore check is covered separately with a closed server.
    with pytest.raises(RestoreError, match="running"):
        restore_database(backup_path, database_url=f"sqlite:///{database_path}")


def test_restore_replaces_a_stopped_database_and_preserves_a_safety_copy(
    database_path: Path,
    tmp_path: Path,
) -> None:
    application = create_app(database_url=f"sqlite:///{database_path}")
    with TestClient(application, base_url="http://localhost") as client:
        store_trace_and_feedback(client)
        backup = client.get("/api/v1/admin/backup")
    backup_path = tmp_path / "backup.db"
    backup_path.write_bytes(backup.content)

    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        assert client.post(
            "/api/v1/admin/reset",
            json={"confirmation": "RESET"},
        ).status_code == 204

    result = restore_database(backup_path, database_url=f"sqlite:///{database_path}")

    assert result.safety_copy is not None
    assert result.safety_copy.exists()
    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        assert client.get("/api/v1/traces/tr_admin_01").status_code == 200
        assert client.get("/api/v1/traces/tr_admin_01").json()["feedback"][0][
            "comment"
        ] == "backup me"


def test_invalid_or_incompatible_restore_keeps_the_existing_database(
    database_path: Path,
    tmp_path: Path,
) -> None:
    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        store_trace_and_feedback(client)

    invalid_backup = tmp_path / "invalid.db"
    invalid_backup.write_text("not a sqlite database", encoding="utf-8")
    with pytest.raises(RestoreError):
        restore_database(invalid_backup, database_url=f"sqlite:///{database_path}")
    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        assert client.get("/api/v1/traces/tr_admin_01").status_code == 200

    incompatible_backup = tmp_path / "incompatible.db"
    with sqlite3.connect(incompatible_backup) as connection:
        connection.execute("CREATE TABLE alembic_version (version_num VARCHAR(32))")
        connection.execute("INSERT INTO alembic_version VALUES ('9999_unknown')")
    with pytest.raises(RestoreError, match="migration"):
        restore_database(incompatible_backup, database_url=f"sqlite:///{database_path}")
    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        assert client.get("/api/v1/traces/tr_admin_01").status_code == 200


def test_restore_cli_reports_the_restored_database(
    database_path: Path,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with TestClient(
        create_app(database_url=f"sqlite:///{database_path}"),
        base_url="http://localhost",
    ) as client:
        store_trace_and_feedback(client)
        backup = client.get("/api/v1/admin/backup")
    backup_path = tmp_path / "backup.db"
    backup_path.write_bytes(backup.content)

    assert (
        main(
            [
                "restore",
                str(backup_path),
                "--database-url",
                f"sqlite:///{database_path}",
            ]
        )
        == 0
    )
    assert "restored" in capsys.readouterr().out


def test_default_trusted_hosts_are_local_only(tmp_path: Path) -> None:
    application = create_app(database_url=f"sqlite:///{tmp_path / 'host.db'}")
    with TestClient(application, base_url="http://localhost") as client:
        assert client.get("/api/v1/health").status_code == 200
        assert (
            client.get("/api/v1/health", headers={"host": "testserver"}).status_code
            == 400
        )


def test_static_spa_fallback_and_configurable_trusted_hosts(tmp_path: Path) -> None:
    static_dir = tmp_path / "static"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<main>LangFeather SPA</main>")
    (assets_dir / "app.js").write_text("console.log('asset');")
    application = create_app(
        database_url=f"sqlite:///{tmp_path / 'static.db'}",
        static_dir=static_dir,
        trusted_hosts=["testserver", "student.local"],
    )
    with TestClient(application) as client:
        deep_link = client.get("/traces/tr_admin_01")
        asset = client.get("/assets/app.js")
        unknown_api = client.get("/api/v1/nope")
        trusted_host = client.get("/api/v1/health", headers={"host": "student.local"})
        rejected_host = client.get("/api/v1/health", headers={"host": "other.local"})

    assert deep_link.status_code == 200
    assert deep_link.text == "<main>LangFeather SPA</main>"
    assert asset.status_code == 200
    assert "console.log" in asset.text
    assert unknown_api.status_code == 404
    assert trusted_host.status_code == 200
    assert rejected_host.status_code == 400

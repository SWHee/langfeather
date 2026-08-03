from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
import uvicorn

import langfeather
from langfeather_server.app import create_app


def _get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return cast(dict[str, object], json.loads(response.read()))


def _post_json(url: str, payload: object) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        return cast(dict[str, object], json.loads(response.read()))


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[str]:
    database_path = tmp_path / "langfeather-feedback-integration.db"
    application = create_app(database_url=f"sqlite:///{database_path}")
    config = uvicorn.Config(
        application,
        host="127.0.0.1",
        port=0,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        pytest.fail("Uvicorn did not start for the integration test")

    port = int(server.servers[0].sockets[0].getsockname()[1])
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        langfeather.shutdown(timeout=2)
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            pytest.fail("Uvicorn did not stop after the integration test")


def _traced_call(endpoint: str) -> str:
    captured: dict[str, str] = {}

    @langfeather.observe(name="feedback-target")
    def answer(question: str) -> str:
        context = langfeather.current_context()
        assert context is not None
        captured["trace_id"] = context.trace_id
        return f"답변: {question}"

    langfeather.configure(endpoint=endpoint, request_timeout=2, retry_count=0)
    answer("지원 대상은?")
    assert langfeather.flush(timeout=5)
    return captured["trace_id"]


def test_feedback_scores_reach_the_trace_detail(live_server: str) -> None:
    trace_id = _traced_call(live_server)
    tone = _post_json(
        f"{live_server}/api/v1/scores",
        {
            "name": "tone",
            "data_type": "categorical",
            "categorical_selection_mode": "single",
            "options": [{"label": "좋음"}, {"label": "나쁨"}],
        },
    )

    helpful = langfeather.log_feedback(
        trace_id,
        name="helpful",
        value=True,
        description="사용자가 유용하다고 표시했는지",
        endpoint=live_server,
    )
    rating = langfeather.log_feedback(
        trace_id, name="rating", value=4.5, endpoint=live_server
    )
    picked = langfeather.log_feedback(
        trace_id, name="tone", value="좋음", endpoint=live_server
    )

    assert (helpful.data_type, helpful.value) == ("boolean", True)
    assert (rating.data_type, rating.value) == ("number", 4.5)
    assert picked.score_config_id == tone["score_config_id"]

    detail = _get_json(f"{live_server}/api/v1/traces/{trace_id}")
    annotations = cast(list[dict[str, object]], detail["annotations"])
    configs = {
        cast(str, config["score_config_id"]): cast(str, config["name"])
        for config in cast(list[dict[str, object]], detail["score_configs"])
    }
    assert {
        configs[cast(str, annotation["score_config_id"])]: annotation["value"]
        for annotation in annotations
    } == {
        "helpful": True,
        "rating": 4.5,
        "tone": [cast(list[dict[str, object]], tone["options"])[0]["score_option_id"]],
    }


def test_repeated_feedback_replaces_the_stored_value(live_server: str) -> None:
    trace_id = _traced_call(live_server)

    first = langfeather.log_feedback(
        trace_id, name="helpful", value=True, endpoint=live_server
    )
    second = langfeather.log_feedback(
        trace_id, name="helpful", value=False, endpoint=live_server
    )

    assert first.score_config_id == second.score_config_id
    detail = _get_json(f"{live_server}/api/v1/traces/{trace_id}")
    annotations = cast(list[dict[str, object]], detail["annotations"])
    assert [annotation["value"] for annotation in annotations] == [False]


def test_feedback_for_an_undelivered_trace_explains_flush(live_server: str) -> None:
    with pytest.raises(langfeather.FeedbackError) as error:
        langfeather.log_feedback(
            "tr_missing", name="helpful", value=True, endpoint=live_server
        )

    assert error.value.status_code == 404
    assert "langfeather.flush()" in str(error.value)

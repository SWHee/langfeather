from __future__ import annotations

from collections.abc import Mapping

import pytest

from langfeather import FeedbackError, log_feedback
from langfeather import feedback as feedback_module
from langfeather.evaluation import _ControlRequestError


class _Control:
    instances: list[_Control] = []
    scores: list[dict[str, object]] = []
    create_conflicts: bool = False
    put_error_status: int | None = None

    def __init__(self, endpoint: str | None) -> None:
        self.endpoint = endpoint
        self.gets: list[str] = []
        self.posts: list[tuple[str, object]] = []
        self.puts: list[tuple[str, object]] = []
        self.__class__.instances.append(self)

    def get(self, path: str) -> Mapping[str, object]:
        self.gets.append(path)
        assert path == "/api/v1/scores"
        return {"items": list(self.__class__.scores)}

    def post(self, path: str, payload: object) -> Mapping[str, object]:
        self.posts.append((path, payload))
        assert path == "/api/v1/scores"
        assert isinstance(payload, dict)
        created: dict[str, object] = {
            "score_config_id": f"sc_{len(self.__class__.scores) + 1}",
            "name": payload["name"],
            "description": payload.get("description"),
            "data_type": payload["data_type"],
            "options": [],
        }
        if self.__class__.create_conflicts:
            self.__class__.scores.append(created)
            raise _ControlRequestError("conflict", status_code=409)
        self.__class__.scores.append(created)
        return created

    def put(self, path: str, payload: object) -> Mapping[str, object]:
        self.puts.append((path, payload))
        status = self.__class__.put_error_status
        if status is not None:
            raise _ControlRequestError("failed", status_code=status)
        assert isinstance(payload, dict)
        return {
            "annotation_id": "an_1",
            "trace_id": path.split("/")[4],
            "value": payload["value"],
        }


@pytest.fixture(autouse=True)
def control(monkeypatch: pytest.MonkeyPatch) -> type[_Control]:
    _Control.instances = []
    _Control.scores = []
    _Control.create_conflicts = False
    _Control.put_error_status = None
    monkeypatch.setattr(feedback_module, "_ControlClient", _Control)
    return _Control


def test_boolean_feedback_creates_the_missing_score_once() -> None:
    result = log_feedback("tr_1", name="helpful", value=True, endpoint="http://x")

    assert result.score_config_id == "sc_1"
    assert result.data_type == "boolean"
    assert result.value is True
    client = _Control.instances[0]
    assert client.endpoint == "http://x"
    assert client.posts == [
        (
            "/api/v1/scores",
            {"name": "helpful", "description": None, "data_type": "boolean"},
        )
    ]
    assert client.puts == [("/api/v1/traces/tr_1/annotations/sc_1", {"value": True})]

    log_feedback("tr_2", name="helpful", value=False)

    assert len(_Control.instances[1].posts) == 0


def test_number_feedback_reuses_an_existing_score() -> None:
    _Control.scores = [
        {
            "score_config_id": "sc_latency",
            "name": "latency",
            "data_type": "number",
            "options": [],
        }
    ]

    result = log_feedback("tr_1", name="latency", value=3)

    assert result.value == 3.0
    assert _Control.instances[0].posts == []
    assert _Control.instances[0].puts == [
        ("/api/v1/traces/tr_1/annotations/sc_latency", {"value": 3.0})
    ]


def test_categorical_feedback_maps_labels_to_option_ids() -> None:
    _Control.scores = [
        {
            "score_config_id": "sc_tone",
            "name": "tone",
            "data_type": "categorical",
            "options": [
                {"score_option_id": "so_1", "label": "좋음"},
                {"score_option_id": "so_2", "label": "나쁨"},
            ],
        }
    ]

    result = log_feedback("tr 1", name="tone", value=["좋음", "so_2"])

    assert result.value == ("so_1", "so_2")
    assert _Control.instances[0].puts == [
        ("/api/v1/traces/tr%201/annotations/sc_tone", {"value": ["so_1", "so_2"]})
    ]


def test_a_string_value_is_one_categorical_option() -> None:
    _Control.scores = [
        {
            "score_config_id": "sc_tone",
            "name": "tone",
            "data_type": "categorical",
            "options": [{"score_option_id": "so_1", "label": "좋음"}],
        }
    ]

    assert log_feedback("tr_1", name="tone", value="좋음").value == ("so_1",)


def test_a_create_conflict_falls_back_to_the_winning_score() -> None:
    _Control.create_conflicts = True

    result = log_feedback("tr_1", name="helpful", value=True)

    assert result.score_config_id == "sc_1"


def test_a_missing_trace_explains_that_delivery_comes_first() -> None:
    _Control.put_error_status = 404

    with pytest.raises(FeedbackError) as error:
        log_feedback("tr_1", name="helpful", value=True)

    assert "langfeather.flush()" in str(error.value)
    assert error.value.status_code == 404


def test_an_archived_score_is_reported_as_such() -> None:
    _Control.put_error_status = 409

    with pytest.raises(FeedbackError, match="archived"):
        log_feedback("tr_1", name="helpful", value=True)


def test_a_value_that_does_not_match_the_score_type_is_rejected() -> None:
    _Control.scores = [
        {
            "score_config_id": "sc_helpful",
            "name": "helpful",
            "data_type": "boolean",
            "options": [],
        },
        {
            "score_config_id": "sc_latency",
            "name": "latency",
            "data_type": "number",
            "options": [],
        },
        {
            "score_config_id": "sc_tone",
            "name": "tone",
            "data_type": "categorical",
            "options": [{"score_option_id": "so_1", "label": "좋음"}],
        },
    ]

    with pytest.raises(FeedbackError, match="requires True/False"):
        log_feedback("tr_1", name="helpful", value=1)
    with pytest.raises(FeedbackError, match="requires a number"):
        log_feedback("tr_1", name="latency", value=True)
    with pytest.raises(FeedbackError, match="finite"):
        log_feedback("tr_1", name="latency", value=float("inf"))
    with pytest.raises(FeedbackError, match="no option '없음'"):
        log_feedback("tr_1", name="tone", value="없음")
    assert _Control.instances[0].puts == []


def test_a_missing_categorical_score_is_not_created() -> None:
    with pytest.raises(FeedbackError, match="create the categorical score"):
        log_feedback("tr_1", name="tone", value="좋음")

    assert _Control.instances[0].posts == []


def test_empty_identifiers_are_rejected_before_any_request() -> None:
    with pytest.raises(FeedbackError, match="trace_id"):
        log_feedback("", name="helpful", value=True)
    with pytest.raises(FeedbackError, match="name"):
        log_feedback("tr_1", name="", value=True)

    assert _Control.instances == []

"""Trace feedback scores recorded from application code.

A feedback score is stored as a trace annotation on a named score config, which
is the same record the UI writes during manual review. The trace must already
exist on the server, so call :func:`langfeather.flush` before logging feedback
for a trace the current process just produced.
"""

from __future__ import annotations

import math
import urllib.parse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from .evaluation import (
    EvaluationError,
    _ControlClient,
    _ControlRequestError,
    _required_list,
    _required_string,
)

FeedbackValue = bool | int | float | str | Sequence[str]
FeedbackDataType = Literal["boolean", "number", "categorical"]

# Categorical configs carry option IDs and a selection mode that a single value
# cannot imply, so only these two types are created on demand.
_AUTO_CREATED_TYPES: dict[FeedbackDataType, str] = {
    "boolean": "boolean",
    "number": "number",
}


class FeedbackError(EvaluationError):
    """Raised when a trace feedback score cannot be recorded."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class Feedback:
    """One stored feedback score for a trace."""

    annotation_id: str
    trace_id: str
    score_config_id: str
    name: str
    data_type: FeedbackDataType
    value: bool | float | tuple[str, ...]


def log_feedback(
    trace_id: str,
    *,
    name: str,
    value: FeedbackValue,
    description: str | None = None,
    endpoint: str | None = None,
) -> Feedback:
    """Record one feedback score for an already delivered trace.

    ``name`` selects the active score config with that name. A missing config is
    created for ``bool`` (boolean) and ``int``/``float`` (number) values;
    categorical scores must already exist because their options define the
    accepted values. Logging the same ``name`` for the same trace again replaces
    the previous value.

    ``value`` is a ``bool`` for boolean scores, a finite number for number
    scores, and one option label (or a sequence of labels) for categorical
    scores. Option IDs are accepted in place of labels.
    """

    if not trace_id:
        raise FeedbackError("trace_id must not be empty")
    if not name:
        raise FeedbackError("name must not be empty")
    try:
        return _log_feedback(
            _ControlClient(endpoint),
            trace_id=trace_id,
            name=name,
            value=value,
            description=description,
        )
    except FeedbackError:
        raise
    except _ControlRequestError as error:
        raise FeedbackError(str(error), status_code=error.status_code) from error
    except EvaluationError as error:
        raise FeedbackError(str(error)) from error


def _log_feedback(
    control: _ControlClient,
    *,
    trace_id: str,
    name: str,
    value: FeedbackValue,
    description: str | None,
) -> Feedback:
    config = _resolve_score_config(
        control,
        name=name,
        value=value,
        description=description,
    )
    score_config_id = _required_string(config, "score_config_id")
    data_type = _feedback_data_type(config)
    annotation_value = _annotation_value(config, data_type, value)
    try:
        raw = control.put(
            f"/api/v1/traces/{_quote(trace_id)}/annotations/{_quote(score_config_id)}",
            {"value": annotation_value},
        )
    except _ControlRequestError as error:
        raise FeedbackError(
            _put_failure_message(error, trace_id=trace_id, name=name),
            status_code=error.status_code,
        ) from error
    return Feedback(
        annotation_id=_required_string(raw, "annotation_id"),
        trace_id=_required_string(raw, "trace_id"),
        score_config_id=score_config_id,
        name=_required_string(config, "name"),
        data_type=data_type,
        value=(
            tuple(annotation_value)
            if isinstance(annotation_value, list)
            else annotation_value
        ),
    )


def _put_failure_message(
    error: _ControlRequestError,
    *,
    trace_id: str,
    name: str,
) -> str:
    if error.status_code == 404:
        return (
            f"trace {trace_id} was not found; feedback can only be added to a "
            "delivered trace, so call langfeather.flush() first"
        )
    if error.status_code == 409:
        return f"score '{name}' is archived and cannot be annotated"
    return str(error)


def _resolve_score_config(
    control: _ControlClient,
    *,
    name: str,
    value: FeedbackValue,
    description: str | None,
) -> Mapping[str, object]:
    existing = _find_score_config(control, name)
    if existing is not None:
        return existing
    data_type = _auto_created_data_type(name, value)
    try:
        return control.post(
            "/api/v1/scores",
            {"name": name, "description": description, "data_type": data_type},
        )
    except _ControlRequestError as error:
        if error.status_code != 409:
            raise
    # A concurrent logger won the name; the config it created is the right one.
    created = _find_score_config(control, name)
    if created is None:
        raise FeedbackError(f"score '{name}' create conflicted but was not found")
    return created


def _find_score_config(
    control: _ControlClient, name: str
) -> Mapping[str, object] | None:
    # The list endpoint has no name filter and hides archived configs by default.
    raw = control.get("/api/v1/scores")
    for item in _required_list(raw, "items"):
        if item.get("name") == name:
            return item
    return None


def _auto_created_data_type(name: str, value: FeedbackValue) -> str:
    if isinstance(value, bool):
        return _AUTO_CREATED_TYPES["boolean"]
    if isinstance(value, (int, float)):
        return _AUTO_CREATED_TYPES["number"]
    raise FeedbackError(
        f"score '{name}' does not exist; create the categorical score with its "
        "options before logging feedback for it"
    )


def _feedback_data_type(config: Mapping[str, object]) -> FeedbackDataType:
    data_type = _required_string(config, "data_type")
    if data_type not in ("boolean", "number", "categorical"):
        raise FeedbackError(f"score has unsupported data type {data_type!r}")
    return cast(FeedbackDataType, data_type)


def _annotation_value(
    config: Mapping[str, object],
    data_type: FeedbackDataType,
    value: FeedbackValue,
) -> bool | float | list[str]:
    name = _required_string(config, "name")
    if data_type == "boolean":
        if not isinstance(value, bool):
            raise FeedbackError(f"score '{name}' is boolean and requires True/False")
        return value
    if data_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise FeedbackError(f"score '{name}' is number and requires a number")
        number = float(value)
        if not math.isfinite(number):
            raise FeedbackError(f"score '{name}' requires a finite number")
        return number
    labels: list[str]
    if isinstance(value, str):
        labels = [value]
    elif isinstance(value, (bool, int, float)):
        raise FeedbackError(f"score '{name}' is categorical and requires option labels")
    else:
        labels = list(value)
    if not labels or not all(isinstance(label, str) for label in labels):
        raise FeedbackError(f"score '{name}' is categorical and requires option labels")
    return [_option_id(config, name, label) for label in labels]


def _option_id(config: Mapping[str, object], name: str, label: str) -> str:
    options = _required_list(config, "options")
    for option in options:
        if option.get("label") == label or option.get("score_option_id") == label:
            return _required_string(option, "score_option_id")
    available = ", ".join(
        repr(option.get("label")) for option in options if "label" in option
    )
    raise FeedbackError(
        f"score '{name}' has no option {label!r}"
        + (f"; available options are {available}" if available else "")
    )


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="")

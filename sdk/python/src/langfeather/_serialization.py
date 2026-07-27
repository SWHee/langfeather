from __future__ import annotations

import base64
import math
import traceback as traceback_module
from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from pathlib import PurePath
from typing import Protocol, TypeAlias, cast
from uuid import UUID

from ._contracts import JsonValue

_JS_SAFE_INTEGER = (1 << 53) - 1
_RESERVED_MARKERS = frozenset({"__type__", "__unsupported__", "encoding", "items"})
_MAX_REPR_LENGTH = 2_000


def _safe_class_attribute(
    value_type: type[object],
    attribute: str,
    fallback: str,
) -> str:
    try:
        candidate = getattr(value_type, attribute)
    except BaseException:
        return fallback
    return candidate if isinstance(candidate, str) and candidate else fallback


def _qualified_type(value: object) -> str:
    value_type = type(value)
    module = _safe_class_attribute(value_type, "__module__", "unknown")
    qualname = _safe_class_attribute(value_type, "__qualname__", "object")
    return f"{module}.{qualname}"


def _safe_repr(value: object) -> str:
    fallback = f"<unrepresentable {_qualified_type(value)}>"
    try:
        rendered = repr(value)
        if len(rendered) <= _MAX_REPR_LENGTH:
            return rendered
        return f"{rendered[: _MAX_REPR_LENGTH - 3]}..."
    except BaseException:
        return fallback


def _safe_message(error: BaseException) -> str | None:
    try:
        return str(error)
    except BaseException:
        return None


def _unsupported(value: object) -> dict[str, JsonValue]:
    return {
        "__type__": _qualified_type(value),
        "__unsupported__": True,
        "repr": _safe_repr(value),
    }


@dataclass(slots=True)
class _Destination:
    container: list[JsonValue] | dict[str, JsonValue]
    key: int | str


@dataclass(slots=True)
class _Child:
    value: object
    path: str
    destination: _Destination


@dataclass(slots=True)
class _Expansion:
    output: JsonValue
    identity: int
    children: list[_Child]


@dataclass(slots=True)
class _ValueTask:
    value: object
    path: str
    destination: _Destination


@dataclass(slots=True)
class _ExitTask:
    identity: int


_Task: TypeAlias = _ValueTask | _ExitTask


class _PydanticModel(Protocol):
    def model_dump(self, *, mode: str) -> object: ...


def _assign(destination: _Destination, value: JsonValue) -> None:
    if isinstance(destination.container, list):
        destination.container[cast(int, destination.key)] = value
    else:
        destination.container[cast(str, destination.key)] = value


def _sequence_expansion(
    *,
    value: object,
    items: list[object],
    path: str,
    output: list[JsonValue],
) -> _Expansion:
    children = [
        _Child(
            value=item,
            path=f"{path}[{index}]",
            destination=_Destination(output, index),
        )
        for index, item in enumerate(items)
    ]
    return _Expansion(output=output, identity=id(value), children=children)


def _marked_sequence_expansion(
    *,
    value: object,
    items: list[object],
    path: str,
    type_name: str,
) -> _Expansion:
    serialized_items: list[JsonValue] = [None] * len(items)
    output: dict[str, JsonValue] = {
        "__type__": type_name,
        "items": serialized_items,
    }
    expansion = _sequence_expansion(
        value=value,
        items=items,
        path=path,
        output=serialized_items,
    )
    expansion.output = output
    return expansion


def _mapping_expansion(
    value: Mapping[object, object],
    *,
    path: str,
) -> _Expansion:
    items = list(value.items())
    string_keys = all(isinstance(key, str) for key, _ in items)
    marker_collision = any(
        isinstance(key, str) and key in _RESERVED_MARKERS for key, _ in items
    )

    if string_keys and not marker_collision:
        output: dict[str, JsonValue] = {}
        children: list[_Child] = []
        for key, item in items:
            string_key = cast(str, key)
            output[string_key] = None
            children.append(
                _Child(
                    value=item,
                    path=f"{path}.{string_key}",
                    destination=_Destination(output, string_key),
                )
            )
        return _Expansion(output=output, identity=id(value), children=children)

    serialized_items: list[JsonValue] = []
    children = []
    for index, (key, item) in enumerate(items):
        pair: list[JsonValue] = [None, None]
        serialized_items.append(pair)
        children.extend(
            (
                _Child(
                    value=key,
                    path=f"{path}.keys[{index}]",
                    destination=_Destination(pair, 0),
                ),
                _Child(
                    value=item,
                    path=(
                        f"{path}.{key}"
                        if isinstance(key, str)
                        else f"{path}.values[{index}]"
                    ),
                    destination=_Destination(pair, 1),
                ),
            )
        )
    output = {
        "__type__": "builtins.dict",
        "items": serialized_items,
    }
    return _Expansion(output=output, identity=id(value), children=children)


def _mro_contains(
    value: object,
    *,
    module_prefix: str,
    class_name: str,
) -> bool:
    try:
        value_mro = type(value).__mro__
    except BaseException:
        return False
    for candidate in value_mro:
        module = _safe_class_attribute(candidate, "__module__", "")
        name = _safe_class_attribute(candidate, "__name__", "")
        if module.startswith(module_prefix) and name == class_name:
            return True
    return False


def _is_pydantic_model(value: object) -> bool:
    return _mro_contains(
        value,
        module_prefix="pydantic.",
        class_name="BaseModel",
    )


def _is_langchain_document_or_message(value: object) -> bool:
    return _mro_contains(
        value,
        module_prefix="langchain_core.documents.",
        class_name="Document",
    ) or _mro_contains(
        value,
        module_prefix="langchain_core.messages.",
        class_name="BaseMessage",
    )


def _model_expansion(value: object, *, path: str) -> _Expansion:
    dumped = cast(_PydanticModel, value).model_dump(mode="python")
    if not isinstance(dumped, Mapping):
        raise TypeError("model_dump did not return a mapping")

    output: dict[str, JsonValue] = {
        "__type__": _qualified_type(value),
        "fields": None,
    }
    return _Expansion(
        output=output,
        identity=id(value),
        children=[
            _Child(
                value=dumped,
                path=path,
                destination=_Destination(output, "fields"),
            )
        ],
    )


def _dataclass_expansion(value: object, *, path: str) -> _Expansion:
    dumped: dict[str, object] = {}
    for field_definition in fields(value):  # type: ignore[arg-type]
        dumped[field_definition.name] = getattr(value, field_definition.name)

    output: dict[str, JsonValue] = {
        "__type__": _qualified_type(value),
        "fields": None,
    }
    return _Expansion(
        output=output,
        identity=id(value),
        children=[
            _Child(
                value=dumped,
                path=path,
                destination=_Destination(output, "fields"),
            )
        ],
    )


def _enum_expansion(value: Enum, *, path: str) -> _Expansion:
    output: dict[str, JsonValue] = {
        "__type__": _qualified_type(value),
        "value": None,
    }
    return _Expansion(
        output=output,
        identity=id(value),
        children=[
            _Child(
                value=value.value,
                path=f"{path}.value",
                destination=_Destination(output, "value"),
            )
        ],
    )


def _convert(
    value: object,
    *,
    path: str,
    active: set[int],
) -> JsonValue | _Expansion:
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, Enum):
        identity = id(value)
        if identity in active:
            return {"__type__": "cycle", "path": path}
        return _enum_expansion(value, path=path)
    if isinstance(value, int):
        if abs(value) > _JS_SAFE_INTEGER:
            return {
                "__type__": "builtins.int",
                "value": str(value),
            }
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        marker = "nan"
        if math.isinf(value):
            marker = "infinity" if value > 0 else "-infinity"
        return {"__type__": "builtins.float", "value": marker}
    if isinstance(value, UUID):
        return {"__type__": "uuid.UUID", "value": str(value)}
    if isinstance(value, datetime):
        result: dict[str, JsonValue] = {
            "__type__": "datetime.datetime",
            "value": value.isoformat(),
        }
        if value.tzinfo is None:
            result["naive"] = True
        return result
    if isinstance(value, date):
        return {"__type__": "datetime.date", "value": value.isoformat()}
    if isinstance(value, Decimal):
        return {"__type__": "decimal.Decimal", "value": str(value)}
    if isinstance(value, PurePath):
        return {"__type__": _qualified_type(value), "value": str(value)}
    if isinstance(value, bytes):
        return {
            "__type__": "builtins.bytes",
            "encoding": "base64",
            "value": base64.b64encode(value).decode("ascii"),
        }
    if isinstance(value, bytearray):
        return {
            "__type__": "builtins.bytearray",
            "encoding": "base64",
            "value": base64.b64encode(value).decode("ascii"),
        }
    if isinstance(value, BaseException):
        return serialize_error(value)

    identity = id(value)
    if identity in active:
        return {"__type__": "cycle", "path": path}

    if isinstance(value, Mapping):
        return _mapping_expansion(cast(Mapping[object, object], value), path=path)
    if isinstance(value, list):
        items = list(value)
        output: list[JsonValue] = [None] * len(items)
        return _sequence_expansion(
            value=value,
            items=items,
            path=path,
            output=output,
        )
    if isinstance(value, tuple):
        return _marked_sequence_expansion(
            value=value,
            items=list(value),
            path=path,
            type_name="builtins.tuple",
        )
    if isinstance(value, (set, frozenset)):
        return _marked_sequence_expansion(
            value=value,
            items=list(value),
            path=path,
            type_name=_qualified_type(value),
        )
    if _is_langchain_document_or_message(value) or _is_pydantic_model(value):
        return _model_expansion(value, path=path)
    if not isinstance(value, type) and is_dataclass(value):
        return _dataclass_expansion(value, path=path)
    return _unsupported(value)


def to_json_value(
    value: object,
    *,
    path: str = "$",
    _ancestors: frozenset[int] = frozenset(),
) -> JsonValue:
    """Convert a Python value to a diagnostic, JSON-compatible representation.

    Conversion is iterative so deeply nested supported payloads do not depend on
    Python's recursion limit. Any adapter failure is contained at the failing value
    and represented with a bounded safe repr.
    """
    root: dict[str, JsonValue] = {"value": None}
    active = set(_ancestors)
    tasks: list[_Task] = [
        _ValueTask(
            value=value,
            path=path,
            destination=_Destination(root, "value"),
        )
    ]

    while tasks:
        task = tasks.pop()
        if isinstance(task, _ExitTask):
            active.discard(task.identity)
            continue

        try:
            converted = _convert(task.value, path=task.path, active=active)
        except BaseException:
            converted = _unsupported(task.value)

        if not isinstance(converted, _Expansion):
            _assign(task.destination, converted)
            continue

        _assign(task.destination, converted.output)
        active.add(converted.identity)
        tasks.append(_ExitTask(converted.identity))
        tasks.extend(
            _ValueTask(
                value=child.value,
                path=child.path,
                destination=child.destination,
            )
            for child in reversed(converted.children)
        )

    return root["value"]


def serialize_error(error: BaseException) -> dict[str, JsonValue]:
    """Serialize an exception without mutating or replacing it."""
    frames: list[JsonValue] = []
    try:
        extracted = traceback_module.extract_tb(error.__traceback__)
        for frame in extracted:
            try:
                frames.append(
                    {
                        "file": frame.filename,
                        "line": frame.lineno,
                        "function": frame.name,
                        "code": frame.line,
                    }
                )
            except BaseException:
                continue
    except BaseException:
        frames = []
    return {
        "__type__": _qualified_type(error),
        "message": _safe_message(error),
        "repr": _safe_repr(error),
        "traceback": frames,
    }

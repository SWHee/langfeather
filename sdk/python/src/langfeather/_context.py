from __future__ import annotations

import contextvars
import importlib
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ._builder import TraceBuilder

if TYPE_CHECKING:
    from .integrations.langchain import LangFeatherCallbackHandler


@dataclass(frozen=True, slots=True)
class _ActiveTrace:
    builder: TraceBuilder
    handler: LangFeatherCallbackHandler


@dataclass(frozen=True, slots=True)
class _GenericRunScope:
    run_id: str
    langchain_anchor_run_id: str | None


_active_trace: contextvars.ContextVar[_ActiveTrace | None] = contextvars.ContextVar(
    "langfeather_active_trace",
    default=None,
)
_active_generic_run: contextvars.ContextVar[_GenericRunScope | None] = (
    contextvars.ContextVar(
        "langfeather_active_generic_run",
        default=None,
    )
)


def get_live_active_trace() -> _ActiveTrace | None:
    """Return the inherited trace only while its builder still accepts runs."""
    active = _active_trace.get()
    if active is None or active.builder.finished:
        return None
    return active


def _current_langchain_parent_run_id() -> str | None:
    """Read LangChain's current Runnable parent without a required dependency."""
    try:
        config_module = importlib.import_module("langchain_core.runnables.config")
        child_config = config_module.var_child_runnable_config.get()
        if not isinstance(child_config, Mapping):
            return None
        callbacks = child_config.get("callbacks")
        parent_run_id = getattr(callbacks, "parent_run_id", None)
        return None if parent_run_id is None else str(parent_run_id)
    except BaseException:
        return None


def _resolve_generic_parent_run_id(
    current_langchain_parent_run_id: str | None,
) -> str | None:
    scope = _active_generic_run.get()
    if scope is None:
        return current_langchain_parent_run_id
    if (
        current_langchain_parent_run_id is None
        or current_langchain_parent_run_id == scope.langchain_anchor_run_id
    ):
        return scope.run_id
    return current_langchain_parent_run_id


def _resolve_callback_parent_run_id(
    explicit_parent_run_id: object | None,
) -> object | None:
    scope = _active_generic_run.get()
    if scope is None:
        return explicit_parent_run_id
    normalized_parent = (
        None if explicit_parent_run_id is None else str(explicit_parent_run_id)
    )
    if normalized_parent is None or normalized_parent == scope.langchain_anchor_run_id:
        return scope.run_id
    return explicit_parent_run_id

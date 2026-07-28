from __future__ import annotations

import asyncio
import concurrent.futures
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Any

from ._contracts import JsonValue
from ._ids import new_observation_id, new_trace_id
from ._serialization import serialize_error, to_json_value
from ._timing import MonotonicTimer, utc_now

Envelope = dict[str, Any]


def _status_for_error(error: BaseException | None) -> str:
    if isinstance(
        error,
        (
            asyncio.CancelledError,
            concurrent.futures.CancelledError,
            GeneratorExit,
        ),
    ):
        return "cancelled"
    return "failed" if error is not None else "completed"


def _format_timestamp(value: datetime) -> str:
    utc_value = value.astimezone(timezone.utc)
    return utc_value.isoformat(timespec="microseconds").replace("+00:00", "Z")


@dataclass(slots=True)
class _ObservationDraft:
    observation_id: str
    run_id: str
    parent_run_id: str | None
    parent_observation_id: str | None
    sequence: int
    name: str
    kind: str
    started_at: datetime
    timer: MonotonicTimer
    input: JsonValue
    metadata: dict[str, JsonValue]
    ended_at: datetime | None = None
    duration_us: int | None = None
    time_to_first_token_us: int | None = None
    status: str | None = None
    output: JsonValue = None
    error: JsonValue = None
    model: str | None = None
    usage: dict[str, JsonValue] | None = None

    def finish(
        self,
        *,
        status: str,
        output: object = None,
        error: BaseException | None = None,
        model: str | None = None,
        usage: object = None,
    ) -> None:
        if self.status is not None:
            return
        self.ended_at = utc_now()
        self.duration_us = self.timer.elapsed_us()
        self.status = status
        self.output = to_json_value(
            output, path=f"$.observations[{self.sequence}].output"
        )
        self.error = None if error is None else serialize_error(error)
        if model is not None:
            self.model = model
        serialized_usage = to_json_value(
            usage,
            path=f"$.observations[{self.sequence}].usage",
        )
        if isinstance(serialized_usage, dict):
            self.usage = serialized_usage

    def as_mapping(self, trace_id: str) -> dict[str, Any]:
        ended_at = self.ended_at or utc_now()
        duration_us = (
            self.duration_us
            if self.duration_us is not None
            else self.timer.elapsed_us()
        )
        return {
            "observation_id": self.observation_id,
            "trace_id": trace_id,
            "parent_observation_id": self.parent_observation_id,
            "sequence": self.sequence,
            "name": self.name,
            "kind": self.kind,
            "started_at": _format_timestamp(self.started_at),
            "ended_at": _format_timestamp(ended_at),
            "duration_us": duration_us,
            "time_to_first_token_us": self.time_to_first_token_us,
            "status": self.status or "cancelled",
            "input": self.input,
            "output": self.output,
            "error": self.error,
            "model": self.model,
            "usage": self.usage,
            "metadata": self.metadata,
        }


@dataclass(slots=True)
class TraceBuilder:
    """Thread-safe lifecycle builder for one terminal trace envelope."""

    invocation_input: object
    configured_name: str | None
    session_id: str | None
    trace_id: str = field(default_factory=new_trace_id)
    trace_metadata: object = field(default_factory=dict)
    _started_at: datetime = field(default_factory=utc_now)
    _timer: MonotonicTimer = field(default_factory=MonotonicTimer.start)
    _lock: RLock = field(default_factory=RLock)
    _by_run_id: dict[str, _ObservationDraft] = field(default_factory=dict)
    _observations: list[_ObservationDraft] = field(default_factory=list)
    _root_observation_id: str | None = None
    _finished: bool = False

    @property
    def finished(self) -> bool:
        """Return whether this builder has emitted its terminal envelope."""
        with self._lock:
            return self._finished

    def start_run(
        self,
        *,
        run_id: object,
        parent_run_id: object | None,
        name: str,
        kind: str,
        inputs: object,
        metadata: object,
    ) -> bool:
        run_key = str(run_id)
        parent_key = None if parent_run_id is None else str(parent_run_id)
        with self._lock:
            if self._finished or run_key in self._by_run_id:
                return False

            parent_observation_id = None
            if parent_key is not None:
                parent = self._by_run_id.get(parent_key)
                if parent is not None:
                    parent_observation_id = parent.observation_id
            if self._root_observation_id is None:
                self._root_observation_id = new_observation_id()
                observation_id = self._root_observation_id
            else:
                observation_id = new_observation_id()
                if parent_observation_id is None:
                    parent_observation_id = self._root_observation_id

            serialized_metadata = to_json_value(
                metadata,
                path=f"$.observations[{len(self._observations)}].metadata",
            )
            metadata_mapping = (
                serialized_metadata if isinstance(serialized_metadata, dict) else {}
            )
            observation = _ObservationDraft(
                observation_id=observation_id,
                run_id=run_key,
                parent_run_id=parent_key,
                parent_observation_id=parent_observation_id,
                sequence=len(self._observations),
                name=name[:255] or "runnable",
                kind=kind,
                started_at=utc_now(),
                timer=MonotonicTimer.start(),
                input=to_json_value(
                    inputs,
                    path=f"$.observations[{len(self._observations)}].input",
                ),
                metadata=metadata_mapping,
            )
            self._by_run_id[run_key] = observation
            self._observations.append(observation)
            return True

    def end_run(
        self,
        *,
        run_id: object,
        output: object,
        model: str | None = None,
        usage: object = None,
        metadata: object = None,
    ) -> None:
        with self._lock:
            observation = self._by_run_id.get(str(run_id))
            if observation is not None:
                if model is None:
                    metadata_model = observation.metadata.get("ls_model_name")
                    if isinstance(metadata_model, str):
                        model = metadata_model
                if isinstance(usage, dict) and usage.get("provider") is None:
                    metadata_provider = observation.metadata.get("ls_provider")
                    if isinstance(metadata_provider, str):
                        usage = {**usage, "provider": metadata_provider}
                if metadata is not None:
                    serialized_metadata = to_json_value(
                        metadata,
                        path=f"$.observations[{observation.sequence}].metadata",
                    )
                    if isinstance(serialized_metadata, dict):
                        observation.metadata.update(serialized_metadata)
                observation.finish(
                    status="completed",
                    output=output,
                    model=model,
                    usage=usage,
                )

    def observation_id_for_run(self, run_id: object) -> str | None:
        with self._lock:
            observation = self._by_run_id.get(str(run_id))
            return None if observation is None else observation.observation_id

    def error_run(
        self,
        *,
        run_id: object,
        error: BaseException,
        output: object = None,
    ) -> None:
        with self._lock:
            observation = self._by_run_id.get(str(run_id))
            if observation is not None:
                observation.finish(
                    status=_status_for_error(error),
                    output=output,
                    error=error,
                )

    def mark_first_token(self, *, run_id: object) -> None:
        with self._lock:
            observation = self._by_run_id.get(str(run_id))
            if (
                observation is not None
                and observation.kind == "llm"
                and observation.time_to_first_token_us is None
            ):
                observation.time_to_first_token_us = observation.timer.elapsed_us()

    def _select_root_observation(self) -> _ObservationDraft:
        parentless = next(
            (
                observation
                for observation in self._observations
                if observation.parent_run_id is None
            ),
            None,
        )
        if parentless is not None:
            root = parentless
        else:
            missing_parent = next(
                (
                    observation
                    for observation in self._observations
                    if observation.parent_run_id not in self._by_run_id
                ),
                None,
            )
            root = missing_parent or self._observations[0]
        self._root_observation_id = root.observation_id
        return root

    def _resolve_parent_links(self, root: _ObservationDraft) -> None:
        root_id = root.observation_id
        proposed: dict[str, str | None] = {}
        sequence_by_id = {
            observation.observation_id: observation.sequence
            for observation in self._observations
        }

        for observation in self._observations:
            if observation is root:
                proposed[observation.observation_id] = None
                continue
            parent = (
                None
                if observation.parent_run_id is None
                else self._by_run_id.get(observation.parent_run_id)
            )
            proposed[observation.observation_id] = (
                parent.observation_id
                if parent is not None and parent is not observation
                else root_id
            )

        unresolved, visiting, resolved = range(3)
        states: dict[str, int] = {root_id: resolved}
        for observation in self._observations:
            current_id = observation.observation_id
            if states.get(current_id, unresolved) == resolved:
                continue

            path: list[str] = []
            path_indexes: dict[str, int] = {}
            while states.get(current_id, unresolved) == unresolved:
                states[current_id] = visiting
                path_indexes[current_id] = len(path)
                path.append(current_id)
                parent_id = proposed[current_id]
                if parent_id is None:
                    proposed[current_id] = root_id
                    current_id = root_id
                else:
                    current_id = parent_id

            if states.get(current_id) == visiting:
                cycle = path[path_indexes[current_id] :]
                breaker = min(cycle, key=sequence_by_id.__getitem__)
                proposed[breaker] = root_id

            for observation_id in path:
                states[observation_id] = resolved

        for observation in self._observations:
            observation.parent_observation_id = proposed[observation.observation_id]

    def finish(
        self,
        *,
        output: object = None,
        error: BaseException | None = None,
        fallback_name: str,
    ) -> Envelope:
        with self._lock:
            if self._finished:
                raise RuntimeError("trace builder has already been finalized")
            self._finished = True
            terminal_status = _status_for_error(error)

            if not self._observations:
                root = _ObservationDraft(
                    observation_id=new_observation_id(),
                    run_id="__langfeather_fallback_root__",
                    parent_run_id=None,
                    parent_observation_id=None,
                    sequence=0,
                    name=(self.configured_name or fallback_name)[:255] or "runnable",
                    kind="runnable",
                    started_at=self._started_at,
                    timer=self._timer,
                    input=to_json_value(self.invocation_input, path="$.trace.input"),
                    metadata={},
                )
                root.finish(status=terminal_status, output=output, error=error)
                self._root_observation_id = root.observation_id
                self._observations.append(root)

            root = self._select_root_observation()
            self._resolve_parent_links(root)
            if root.status is None:
                root.finish(status=terminal_status, output=output, error=error)
            elif error is not None and root.status != terminal_status:
                root.status = terminal_status
                root.output = None
                root.error = serialize_error(error)
                root.ended_at = utc_now()
                root.duration_us = root.timer.elapsed_us()

            for observation in self._observations:
                if observation.status is None:
                    observation.finish(status="cancelled")

            trace_name = self.configured_name or root.name
            serialized_trace_metadata = to_json_value(
                self.trace_metadata,
                path="$.trace.metadata",
            )
            trace = {
                "trace_id": self.trace_id,
                "name": trace_name[:255] or "runnable",
                "started_at": _format_timestamp(root.started_at),
                "ended_at": _format_timestamp(root.ended_at or utc_now()),
                "duration_us": root.duration_us or 0,
                "status": root.status,
                "input": root.input,
                "output": root.output,
                "error": root.error,
                "session_id": self.session_id,
                "user_id": None,
                "release": None,
                "environment": None,
                "tags": [],
                "metadata": (
                    serialized_trace_metadata
                    if isinstance(serialized_trace_metadata, dict)
                    else {}
                ),
            }
            return {
                "schema_version": 1,
                "trace": trace,
                "observations": [
                    observation.as_mapping(self.trace_id)
                    for observation in self._observations
                ],
            }

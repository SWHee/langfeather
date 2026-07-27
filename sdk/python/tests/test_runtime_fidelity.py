from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from langfeather import wrap_runnable
from langfeather._builder import TraceBuilder
from langfeather._contracts import CompletedEnvelope


@pytest.fixture
def captured_envelopes(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    from langfeather import _runnable

    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(_runnable, "enqueue_envelope", captured.append)
    return captured


def _callbacks(config: dict[str, Any]) -> list[Any]:
    callbacks = config["callbacks"]
    assert isinstance(callbacks, list)
    return callbacks


class _SyncStreamRunnable:
    def stream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> Iterator[str]:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "sync_stream"},
                value,
                run_id=run_id,
                name="sync_stream",
            )
        try:
            yield "first"
            yield "second"
        except GeneratorExit:
            raise
        except BaseException as error:
            for callback in _callbacks(config):
                callback.on_chain_error(error, run_id=run_id)
            raise
        else:
            for callback in _callbacks(config):
                callback.on_chain_end("firstsecond", run_id=run_id)


class _AsyncStreamRunnable:
    async def astream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> AsyncIterator[str]:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "async_stream"},
                value,
                run_id=run_id,
                name="async_stream",
            )
        try:
            yield "first"
            await asyncio.sleep(0)
            yield "second"
        except GeneratorExit:
            raise
        except BaseException as error:
            for callback in _callbacks(config):
                callback.on_chain_error(error, run_id=run_id)
            raise
        else:
            for callback in _callbacks(config):
                callback.on_chain_end("firstsecond", run_id=run_id)


class _FailingStreamRunnable:
    def __init__(self, error: RuntimeError) -> None:
        self.error = error

    def stream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> Iterator[str]:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "failing_stream"},
                value,
                run_id=run_id,
                name="failing_stream",
            )
        yield "partial"
        for callback in _callbacks(config):
            callback.on_chain_error(self.error, run_id=run_id)
        raise self.error


class _FailingAsyncStreamRunnable:
    def __init__(self, error: RuntimeError) -> None:
        self.error = error
        self.chunk = _IdentityChunk()

    async def astream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> AsyncIterator[_IdentityChunk]:
        assert config is not None
        run_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "failing_async_stream"},
                value,
                run_id=run_id,
                name="failing_async_stream",
            )
        yield self.chunk
        for callback in _callbacks(config):
            callback.on_chain_error(self.error, run_id=run_id)
        raise self.error


class _CallbackFreeStreamRunnable:
    def stream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> Iterator[dict[str, str]]:
        yield {"step": "one"}
        yield {"step": "two"}


class _IdentityChunk:
    pass


class _IdentityStreamRunnable:
    def __init__(self) -> None:
        self.chunks = (_IdentityChunk(), _IdentityChunk())

    def stream(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> Iterator[_IdentityChunk]:
        yield from self.chunks


def test_sync_stream_preserves_chunks_and_aggregates_terminal_output(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    stream = wrap_runnable(_SyncStreamRunnable()).stream("question")

    assert list(stream) == ["first", "second"]

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "completed"
    assert envelope.trace.output == "firstsecond"
    assert envelope.observations[0].output == "firstsecond"


def test_stream_without_callbacks_aggregates_every_chunk_in_memory(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    chunks = list(wrap_runnable(_CallbackFreeStreamRunnable()).stream("question"))

    assert chunks == [{"step": "one"}, {"step": "two"}]
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.output == chunks


def test_stream_returns_the_exact_original_chunk_instances(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnable = _IdentityStreamRunnable()

    received = list(wrap_runnable(runnable).stream("question"))

    assert received[0] is runnable.chunks[0]
    assert received[1] is runnable.chunks[1]
    assert len(captured_envelopes) == 1


def test_sync_stream_preserves_original_exception(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    original = RuntimeError("stream failed")
    stream = wrap_runnable(_FailingStreamRunnable(original)).stream("question")

    assert next(stream) == "partial"
    with pytest.raises(RuntimeError) as caught:
        next(stream)

    assert caught.value is original
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "failed"
    assert isinstance(envelope.trace.error, dict)
    assert envelope.trace.error["message"] == "stream failed"


def test_closing_sync_stream_records_cancelled_terminal_envelope(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    stream: Any = wrap_runnable(_SyncStreamRunnable()).stream("question")

    assert next(stream) == "first"
    stream.close()

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "cancelled"
    assert envelope.observations[0].status.value == "cancelled"


def test_stream_does_not_leak_active_trace_while_consumer_handles_chunk(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    from langfeather._context import _active_trace

    stream: Any = wrap_runnable(_SyncStreamRunnable()).stream("question")

    assert next(stream) == "first"
    assert _active_trace.get() is None
    stream.close()
    assert len(captured_envelopes) == 1


def test_async_stream_preserves_chunks_and_aggregates_terminal_output(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    async def consume() -> list[str]:
        return [
            chunk
            async for chunk in wrap_runnable(_AsyncStreamRunnable()).astream("question")
        ]

    assert asyncio.run(consume()) == ["first", "second"]
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "completed"
    assert envelope.trace.output == "firstsecond"


def test_closing_async_stream_records_cancelled_terminal_envelope(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    async def consume_one() -> None:
        stream: Any = wrap_runnable(_AsyncStreamRunnable()).astream("question")
        assert await anext(stream) == "first"
        await stream.aclose()

    asyncio.run(consume_one())

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "cancelled"
    assert envelope.observations[0].status.value == "cancelled"


def test_async_stream_preserves_chunk_and_exception_identity(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    original = RuntimeError("async stream failed")
    runnable = _FailingAsyncStreamRunnable(original)

    async def consume() -> None:
        stream = wrap_runnable(runnable).astream("question")
        assert await anext(stream) is runnable.chunk
        with pytest.raises(RuntimeError) as caught:
            await anext(stream)
        assert caught.value is original

    asyncio.run(consume())

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "failed"
    assert isinstance(envelope.trace.error, dict)
    assert envelope.trace.error["message"] == "async stream failed"


@dataclass
class _Message:
    response_metadata: dict[str, object]
    usage_metadata: dict[str, int]


@dataclass
class _Generation:
    message: _Message


@dataclass
class _LLMResult:
    generations: list[list[_Generation]]
    llm_output: dict[str, object]


class _AllCallbackKindsRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        assert config is not None
        root_id = uuid4()
        function_id = uuid4()
        retriever_id = uuid4()
        tool_id = uuid4()
        llm_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "runtime_root"},
                value,
                run_id=root_id,
                name="runtime_root",
            )
            callback.on_chain_start(
                {"id": ["langchain", "runnables", "RunnableLambda"]},
                value,
                run_id=function_id,
                parent_run_id=root_id,
                name="student_function",
            )
            callback.on_chain_end(
                "function output",
                run_id=function_id,
                parent_run_id=root_id,
            )
            callback.on_retriever_start(
                {"name": "student_retriever"},
                "search query",
                run_id=retriever_id,
                parent_run_id=root_id,
                name="student_retriever",
            )
            callback.on_retriever_end(
                ["document"],
                run_id=retriever_id,
                parent_run_id=root_id,
            )
            callback.on_tool_start(
                {"name": "student_tool"},
                "tool input",
                run_id=tool_id,
                parent_run_id=root_id,
                name="student_tool",
            )
            callback.on_tool_end(
                "tool output",
                run_id=tool_id,
                parent_run_id=root_id,
            )
            callback.on_llm_start(
                {"name": "student_llm"},
                ["prompt"],
                run_id=llm_id,
                parent_run_id=root_id,
                name="student_llm",
                metadata={
                    "ls_provider": "openai",
                    "ls_model_name": "configured-model",
                },
            )
            callback.on_llm_new_token("first", run_id=llm_id)
            callback.on_llm_end(
                _LLMResult(
                    generations=[
                        [
                            _Generation(
                                _Message(
                                    response_metadata={
                                        "model_name": "returned-model",
                                    },
                                    usage_metadata={
                                        "input_tokens": 7,
                                        "output_tokens": 3,
                                        "total_tokens": 10,
                                    },
                                )
                            )
                        ]
                    ],
                    llm_output={
                        "model_name": "returned-model",
                        "token_usage": {
                            "prompt_tokens": 7,
                            "completion_tokens": 3,
                            "total_tokens": 10,
                        },
                    },
                ),
                run_id=llm_id,
                parent_run_id=root_id,
            )
            callback.on_chain_end("done", run_id=root_id)
        return "done"


def test_callback_kind_parent_model_usage_and_ttft_mapping(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    result = wrap_runnable(_AllCallbackKindsRunnable()).invoke("question")

    assert result == "done"
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    by_name = {observation.name: observation for observation in envelope.observations}
    root = by_name["runtime_root"]
    assert root.kind == "chain"
    assert by_name["student_function"].kind == "runnable"
    assert by_name["student_retriever"].kind == "retriever"
    assert by_name["student_tool"].kind == "tool"
    llm = by_name["student_llm"]
    assert llm.kind == "llm"
    assert all(
        observation.parent_observation_id == root.observation_id
        for observation in envelope.observations[1:]
    )
    assert llm.model == "returned-model"
    assert llm.usage is not None
    assert llm.usage.input_tokens == 7
    assert llm.usage.output_tokens == 3
    assert llm.usage.total_tokens == 10
    assert llm.usage.provider == "openai"
    assert llm.usage.raw == {
        "input_tokens": 7,
        "output_tokens": 3,
        "total_tokens": 10,
    }
    assert llm.time_to_first_token_us is not None
    assert llm.time_to_first_token_us >= 0


def test_usage_extraction_does_not_estimate_a_missing_total() -> None:
    from langfeather.integrations.langchain import _llm_result_details

    model, usage = _llm_result_details(
        {
            "generations": [
                [
                    {
                        "message": {
                            "response_metadata": {
                                "model": "provider-returned-model",
                                "provider": "provider-name",
                            },
                            "usage_metadata": {
                                "input_tokens": 4,
                                "output_tokens": 2,
                            },
                        }
                    }
                ]
            ],
            "llm_output": {},
        }
    )

    assert model == "provider-returned-model"
    assert usage is not None
    assert usage["input_tokens"] == 4
    assert usage["output_tokens"] == 2
    assert usage["total_tokens"] is None
    assert "cost" not in usage


class _FallbackRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        assert config is not None
        root_id = uuid4()
        failed_id = uuid4()
        fallback_id = uuid4()
        error = ValueError("primary failed")
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "fallback_root"},
                value,
                run_id=root_id,
                name="fallback_root",
            )
            callback.on_chain_start(
                {"name": "answer"},
                value,
                run_id=failed_id,
                parent_run_id=root_id,
                name="answer",
            )
            callback.on_chain_error(
                error,
                run_id=failed_id,
                parent_run_id=root_id,
            )
            callback.on_chain_start(
                {"name": "answer"},
                value,
                run_id=fallback_id,
                parent_run_id=root_id,
                name="answer",
            )
            callback.on_chain_end(
                "fallback",
                run_id=fallback_id,
                parent_run_id=root_id,
            )
            callback.on_chain_end("fallback", run_id=root_id)
        return "fallback"


def test_failed_child_with_successful_fallback_keeps_root_completed(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    assert wrap_runnable(_FallbackRunnable()).invoke("question") == "fallback"

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "completed"
    assert envelope.observations[0].status.value == "completed"
    repeated = [
        observation
        for observation in envelope.observations
        if observation.name == "answer"
    ]
    assert len(repeated) == 2
    assert [observation.status.value for observation in repeated] == [
        "failed",
        "completed",
    ]
    assert repeated[0].observation_id != repeated[1].observation_id


class _OutOfOrderParentRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        assert config is not None
        root_id = uuid4()
        child_id = uuid4()
        grandchild_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "root"},
                value,
                run_id=root_id,
                name="root",
            )
            callback.on_chain_start(
                {"name": "grandchild"},
                value,
                run_id=grandchild_id,
                parent_run_id=child_id,
                name="grandchild",
            )
            callback.on_chain_start(
                {"name": "child"},
                value,
                run_id=child_id,
                parent_run_id=root_id,
                name="child",
            )
            callback.on_chain_end("grandchild", run_id=grandchild_id)
            callback.on_chain_end("child", run_id=child_id)
            callback.on_chain_end("done", run_id=root_id)
        return "done"


def test_parent_run_mapping_is_reconciled_when_parent_callback_arrives_late(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    wrap_runnable(_OutOfOrderParentRunnable()).invoke("question")

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    by_name = {observation.name: observation for observation in envelope.observations}
    assert (
        by_name["grandchild"].parent_observation_id == by_name["child"].observation_id
    )


class _RootCallbackArrivesLateRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> dict[str, str]:
        assert config is not None
        root_id = uuid4()
        child_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "early_child"},
                {"child_input": value},
                run_id=child_id,
                parent_run_id=root_id,
                name="early_child",
            )
            callback.on_chain_error(
                ValueError("child recovered"),
                run_id=child_id,
            )
            callback.on_chain_start(
                {"name": "actual_root"},
                {"root_input": value},
                run_id=root_id,
                name="actual_root",
            )
            callback.on_chain_end(
                {"root_output": "done"},
                run_id=root_id,
            )
        return {"wrapper_output": "ignored when callback root completed"}


def test_actual_root_is_reselected_when_its_callback_arrives_after_child(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    wrap_runnable(_RootCallbackArrivesLateRunnable()).invoke("question")

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    by_name = {observation.name: observation for observation in envelope.observations}
    actual_root = by_name["actual_root"]
    early_child = by_name["early_child"]

    assert [
        observation.name
        for observation in envelope.observations
        if observation.parent_observation_id is None
    ] == ["actual_root"]
    assert early_child.parent_observation_id == actual_root.observation_id
    assert early_child.status.value == "failed"
    assert envelope.trace.name == "actual_root"
    assert envelope.trace.input == {"root_input": "question"}
    assert envelope.trace.output == {"root_output": "done"}
    assert envelope.trace.status.value == "completed"
    assert envelope.trace.error is None


class _CyclicAmbiguousParentRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        assert config is not None
        cycle_a_id = uuid4()
        cycle_b_id = uuid4()
        chosen_root_id = uuid4()
        second_root_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "cycle_a"},
                value,
                run_id=cycle_a_id,
                parent_run_id=cycle_b_id,
                name="cycle_a",
            )
            callback.on_chain_start(
                {"name": "cycle_b"},
                value,
                run_id=cycle_b_id,
                parent_run_id=cycle_a_id,
                name="cycle_b",
            )
            callback.on_chain_start(
                {"name": "chosen_root"},
                value,
                run_id=chosen_root_id,
                name="chosen_root",
            )
            callback.on_chain_start(
                {"name": "second_root"},
                value,
                run_id=second_root_id,
                name="second_root",
            )
            callback.on_chain_end("cycle-a", run_id=cycle_a_id)
            callback.on_chain_end("cycle-b", run_id=cycle_b_id)
            callback.on_chain_end("root-output", run_id=chosen_root_id)
            callback.on_chain_end("second-root", run_id=second_root_id)
        return "wrapper-output"


def test_cyclic_and_ambiguous_parent_evidence_uses_deterministic_root_fallback(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    wrap_runnable(_CyclicAmbiguousParentRunnable()).invoke("question")

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    by_name = {observation.name: observation for observation in envelope.observations}
    chosen_root = by_name["chosen_root"]

    assert [
        observation.name
        for observation in envelope.observations
        if observation.parent_observation_id is None
    ] == ["chosen_root"]
    assert by_name["cycle_a"].parent_observation_id == chosen_root.observation_id
    assert by_name["cycle_b"].parent_observation_id == by_name["cycle_a"].observation_id
    assert by_name["second_root"].parent_observation_id == chosen_root.observation_id
    assert envelope.trace.name == "chosen_root"
    assert envelope.trace.output == "root-output"


def test_deep_parent_chain_reconciliation_preserves_every_direct_link() -> None:
    builder = TraceBuilder(
        invocation_input="question",
        configured_name=None,
        session_id=None,
    )
    depth = 8_192
    builder.start_run(
        run_id="run-0",
        parent_run_id=None,
        name="root",
        kind="chain",
        inputs=None,
        metadata={},
    )
    for index in range(1, depth):
        builder.start_run(
            run_id=f"run-{index}",
            parent_run_id=f"run-{index - 1}",
            name=f"node-{index}",
            kind="chain",
            inputs=None,
            metadata={},
        )

    envelope = builder.finish(output="done", fallback_name="fallback")
    observations = envelope["observations"]

    assert len(observations) == depth
    assert [
        observation["name"]
        for observation in observations
        if observation["parent_observation_id"] is None
    ] == ["root"]
    for index in (1, depth // 2, depth - 1):
        assert (
            observations[index]["parent_observation_id"]
            == observations[index - 1]["observation_id"]
        )


class _BrokenResponse:
    @property
    def llm_output(self) -> object:
        raise RuntimeError("provider metadata failed")


class _BrokenMetadataRunnable:
    def invoke(
        self,
        value: str,
        config: dict[str, Any] | None = None,
        **kwargs: object,
    ) -> str:
        assert config is not None
        root_id = uuid4()
        llm_id = uuid4()
        for callback in _callbacks(config):
            callback.on_chain_start(
                {"name": "root"},
                value,
                run_id=root_id,
                name="root",
            )
            callback.on_llm_start(
                {"name": "llm"},
                ["prompt"],
                run_id=llm_id,
                parent_run_id=root_id,
                name="llm",
            )
            callback.on_llm_end(_BrokenResponse(), run_id=llm_id)
            callback.on_chain_end("unchanged", run_id=root_id)
        return "unchanged"


def test_provider_metadata_extraction_failure_does_not_change_result(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    result = wrap_runnable(_BrokenMetadataRunnable()).invoke("question")

    assert result == "unchanged"
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "completed"
    llm = next(item for item in envelope.observations if item.kind == "llm")
    assert llm.status.value == "completed"
    assert llm.model is None
    assert llm.usage is None


def test_callback_builder_failure_does_not_change_result_or_exception(
    monkeypatch: pytest.MonkeyPatch,
    captured_envelopes: list[dict[str, Any]],
) -> None:
    from langfeather._builder import TraceBuilder

    original_start = TraceBuilder.start_run
    calls = 0

    def fail_once(self: TraceBuilder, **kwargs: object) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("callback capture failed")
        cast(Any, original_start)(self, **kwargs)

    monkeypatch.setattr(TraceBuilder, "start_run", fail_once)

    assert wrap_runnable(_FallbackRunnable()).invoke("question") == "fallback"
    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    assert envelope.trace.status.value == "completed"


def test_top_level_callback_is_not_duplicated_when_config_already_contains_handler(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    from langfeather._builder import TraceBuilder
    from langfeather.integrations.langchain import (
        LangFeatherCallbackHandler,
        add_callback,
    )

    builder = TraceBuilder(
        invocation_input="question",
        configured_name=None,
        session_id=None,
    )
    handler = LangFeatherCallbackHandler(builder)
    first = add_callback(None, handler)
    second = add_callback(first, handler)

    callbacks = second["callbacks"]
    assert sum(item is handler for item in callbacks) == 1


def test_callback_manager_with_existing_handler_is_not_duplicated() -> None:
    from langfeather._builder import TraceBuilder
    from langfeather.integrations.langchain import (
        LangFeatherCallbackHandler,
        add_callback,
    )

    class _Manager:
        def __init__(self, handler: object) -> None:
            self.handlers = [handler]

    builder = TraceBuilder(
        invocation_input="question",
        configured_name=None,
        session_id=None,
    )
    handler = LangFeatherCallbackHandler(builder)
    manager = _Manager(handler)
    config = {"callbacks": manager}

    assert add_callback(config, handler) is config


def test_uuid_run_ids_with_same_name_remain_distinct(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    assert wrap_runnable(_FallbackRunnable()).invoke("question") == "fallback"

    envelope = CompletedEnvelope.from_mapping(captured_envelopes[0])
    ids: list[str] = [
        observation.observation_id
        for observation in envelope.observations
        if observation.name == "answer"
    ]
    assert len(ids) == 2
    assert all(isinstance(UUID(run_id.removeprefix("obs_")), UUID) for run_id in ids)

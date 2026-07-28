from __future__ import annotations

import asyncio
import inspect
import threading
from collections.abc import AsyncGenerator, Generator, Iterator
from typing import Any, cast

import pytest

import langfeather._context as context_module
import langfeather._observe as observe_module
import langfeather._runnable as runnable_module
from langfeather._builder import TraceBuilder
from langfeather._observe import (
    current_context,
    observe,
    span,
    use_context,
)
from langfeather._runnable import wrap_runnable


@pytest.fixture
def captured_envelopes(
    monkeypatch: pytest.MonkeyPatch,
) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(observe_module, "enqueue_envelope", captured.append)
    monkeypatch.setattr(runnable_module, "enqueue_envelope", captured.append)
    return captured


def test_bare_observe_preserves_signature_result_and_completed_payload(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    def add(left: int, right: int = 1) -> int:
        return left + right

    observed = observe(add)

    assert inspect.signature(observed) == inspect.signature(add)
    assert observed(2, right=3) == 5
    assert current_context() is None

    envelope = captured_envelopes[0]
    assert envelope["trace"]["name"] == "add"
    assert envelope["trace"]["status"] == "completed"
    assert envelope["trace"]["output"] == 5
    root = envelope["observations"][0]
    assert root["kind"] == "function"
    assert root["input"] == {"args": [2], "kwargs": {"right": 3}}
    assert root["output"] == 5


def test_configured_observe_preserves_original_exception(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    original = RuntimeError("student function failed")

    @observe(name="load_policy", metadata={"lesson": 3})
    def fail() -> None:
        raise original

    with pytest.raises(RuntimeError) as caught:
        fail()

    assert caught.value is original
    assert current_context() is None
    envelope = captured_envelopes[0]
    assert envelope["trace"]["name"] == "load_policy"
    assert envelope["trace"]["status"] == "failed"
    root = envelope["observations"][0]
    assert root["metadata"] == {"lesson": 3}
    assert root["error"]["message"] == "student function failed"


def test_nested_observe_and_span_share_one_trace_with_parent_relations(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    @observe
    def normalize(value: str) -> str:
        return value.strip()

    @observe(name="answer_question")
    def answer(value: str) -> str:
        normalized = normalize(value)
        with span("draft", input={"value": normalized}) as current_span:
            result = normalized.upper()
            current_span.set_output(result)
        return result

    assert answer(" hello ") == "HELLO"

    assert len(captured_envelopes) == 1
    observations = captured_envelopes[0]["observations"]
    assert [item["name"] for item in observations] == [
        "answer_question",
        "normalize",
        "draft",
    ]
    root, child, grandchild = observations
    assert root["parent_observation_id"] is None
    assert child["parent_observation_id"] == root["observation_id"]
    assert grandchild["parent_observation_id"] == root["observation_id"]
    assert grandchild["kind"] == "custom"
    assert grandchild["output"] == "HELLO"


@pytest.mark.parametrize("generic_parent_kind", ["observe", "span"])
def test_runnable_callback_root_uses_current_generic_run_as_default_parent(
    captured_envelopes: list[dict[str, Any]],
    generic_parent_kind: str,
) -> None:
    class CallbackRunnable:
        def invoke(
            self,
            value: str,
            config: dict[str, Any] | None = None,
            **kwargs: object,
        ) -> str:
            del kwargs
            assert config is not None
            callbacks = config["callbacks"]
            for callback in callbacks:
                callback.on_chain_start(
                    {"name": "callback_root"},
                    value,
                    run_id="callback-root",
                    name="callback_root",
                )
                callback.on_chain_start(
                    {"name": "callback_child"},
                    value,
                    run_id="callback-child",
                    parent_run_id="callback-root",
                    name="callback_child",
                )
                callback.on_chain_end(value, run_id="callback-child")
                callback.on_chain_end(value, run_id="callback-root")
            return value

    runnable = wrap_runnable(CallbackRunnable())

    @observe(name="generic_child")
    def observed_child() -> str:
        return cast(str, runnable.invoke("from-observe"))

    @observe(name="generic_root")
    def root() -> str:
        if generic_parent_kind == "observe":
            return observed_child()
        with span("generic_span"):
            return cast(str, runnable.invoke("from-span"))

    assert root() == f"from-{generic_parent_kind}"

    observations = captured_envelopes[0]["observations"]
    by_name = {observation["name"]: observation for observation in observations}
    generic_parent = by_name[
        "generic_child" if generic_parent_kind == "observe" else "generic_span"
    ]
    callback_root = by_name["callback_root"]
    callback_child = by_name["callback_child"]
    assert callback_root["parent_observation_id"] == generic_parent["observation_id"]
    assert callback_child["parent_observation_id"] == callback_root["observation_id"]
    assert "langchain_parent_run_id" not in callback_root["metadata"]
    assert callback_child["metadata"]["langchain_parent_run_id"] == "callback-root"


def test_broken_callback_parent_id_cannot_escape_generic_capture(
    captured_envelopes: list[dict[str, Any]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    class BrokenParentId:
        def __str__(self) -> str:
            raise RuntimeError("broken parent str")

    class CallbackRunnable:
        def invoke(
            self,
            value: str,
            config: dict[str, Any] | None = None,
            **kwargs: object,
        ) -> str:
            del kwargs
            assert config is not None
            for callback in config["callbacks"]:
                callback.on_chain_start(
                    {"name": "broken_parent_child"},
                    value,
                    run_id="broken-parent-child",
                    parent_run_id=BrokenParentId(),
                    name="broken_parent_child",
                )
                callback.on_chain_end(value.upper(), run_id="broken-parent-child")
            return value.upper()

    runnable = wrap_runnable(CallbackRunnable())

    @observe(name="generic_parent")
    def run() -> str:
        return cast(str, runnable.invoke("student"))

    assert run() == "STUDENT"
    assert "LangFeather callback capture failed" in caplog.text
    assert len(captured_envelopes) == 1
    assert [item["name"] for item in captured_envelopes[0]["observations"]] == [
        "generic_parent"
    ]


def test_top_level_span_creates_one_custom_root(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    with span("manual_step", input={"question": "hello"}) as current_span:
        current_span.set_output({"answer": "world"})

    envelope = captured_envelopes[0]
    assert envelope["trace"]["name"] == "manual_step"
    assert envelope["trace"]["status"] == "completed"
    root = envelope["observations"][0]
    assert root["parent_observation_id"] is None
    assert root["kind"] == "custom"
    assert root["input"] == {"question": "hello"}
    assert root["output"] == {"answer": "world"}


def test_explicit_context_can_be_attached_in_a_worker_thread(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    worker_context_ids: list[str] = []

    @observe
    def outer() -> None:
        context = current_context()
        assert context is not None

        def worker() -> None:
            with use_context(context):
                attached = current_context()
                assert attached is not None
                worker_context_ids.append(attached.trace_id)
                with span("thread_child"):
                    pass

        thread = threading.Thread(target=worker)
        thread.start()
        thread.join(timeout=2)
        assert not thread.is_alive()

    outer()

    envelope = captured_envelopes[0]
    assert worker_context_ids == [envelope["trace"]["trace_id"]]
    root, child = envelope["observations"]
    assert child["name"] == "thread_child"
    assert child["parent_observation_id"] == root["observation_id"]
    assert current_context() is None


def test_finalized_context_snapshot_cannot_be_reattached(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    snapshots = []

    @observe(name="snapshot_source")
    def source() -> None:
        context = current_context()
        assert context is not None
        snapshots.append(context)

    source()
    stale_context = snapshots[0]

    with use_context(stale_context):
        assert current_context() is None
        with span("fresh_after_stale"):
            attached = current_context()
            assert attached is not None
            assert attached.trace_id != stale_context.trace_id
        assert current_context() is None

    assert [item["trace"]["name"] for item in captured_envelopes] == [
        "snapshot_source",
        "fresh_after_stale",
    ]
    assert captured_envelopes[1]["observations"][0]["parent_observation_id"] is None


def test_finalized_context_is_not_reused_by_any_runnable_mode(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    snapshots = []

    @observe(name="runnable_snapshot_source")
    def source() -> None:
        context = current_context()
        assert context is not None
        snapshots.append(context)

    class PlainRunnable:
        def invoke(
            self,
            value: str,
            config: object = None,
            **kwargs: object,
        ) -> str:
            del config, kwargs
            return f"invoke:{value}"

        async def ainvoke(
            self,
            value: str,
            config: object = None,
            **kwargs: object,
        ) -> str:
            del config, kwargs
            return f"ainvoke:{value}"

        def stream(
            self,
            value: str,
            config: object = None,
            **kwargs: object,
        ) -> Iterator[str]:
            del config, kwargs
            yield f"stream:{value}"

        async def astream(
            self,
            value: str,
            config: object = None,
            **kwargs: object,
        ) -> AsyncGenerator[str, None]:
            del config, kwargs
            yield f"astream:{value}"

    source()
    stale_context = snapshots[0]
    runnable = PlainRunnable()

    async def run_async_modes() -> tuple[str, list[str]]:
        invoke_result = await wrap_runnable(
            runnable,
            name="fresh_ainvoke",
        ).ainvoke("student")
        stream_result = [
            chunk
            async for chunk in wrap_runnable(
                runnable,
                name="fresh_astream",
            ).astream("student")
        ]
        return invoke_result, stream_result

    with use_context(stale_context):
        assert wrap_runnable(runnable, name="fresh_invoke").invoke("student") == (
            "invoke:student"
        )
        assert list(wrap_runnable(runnable, name="fresh_stream").stream("student")) == [
            "stream:student"
        ]
        assert asyncio.run(run_async_modes()) == (
            "ainvoke:student",
            ["astream:student"],
        )

    assert [item["trace"]["name"] for item in captured_envelopes] == [
        "runnable_snapshot_source",
        "fresh_invoke",
        "fresh_stream",
        "fresh_ainvoke",
        "fresh_astream",
    ]
    assert len({item["trace"]["trace_id"] for item in captured_envelopes}) == len(
        captured_envelopes
    )


def test_detached_task_inheriting_finalized_context_starts_a_new_root(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    stale_context_seen = []

    @observe(name="detached_child")
    async def child() -> str:
        return "child-result"

    async def scenario() -> str:
        release = asyncio.Event()

        @observe(name="detached_parent")
        async def parent() -> asyncio.Task[str]:
            async def detached_runner() -> str:
                await release.wait()
                stale_context_seen.append(current_context())
                return await child()

            return asyncio.create_task(detached_runner())

        task = await parent()
        release.set()
        return await task

    assert asyncio.run(scenario()) == "child-result"
    assert stale_context_seen == [None]
    assert [item["trace"]["name"] for item in captured_envelopes] == [
        "detached_parent",
        "detached_child",
    ]
    parent_trace, child_trace = captured_envelopes
    assert parent_trace["trace"]["trace_id"] != child_trace["trace"]["trace_id"]
    assert child_trace["observations"][0]["parent_observation_id"] is None


def test_detached_task_wrapped_runnable_clears_stale_generic_scope(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")
    traced = wrap_runnable(
        runnables.RunnableLambda(lambda value: value.upper()),
        name="detached-runnable",
    )
    stale_context_seen = []

    async def scenario() -> str:
        release = asyncio.Event()

        @observe(name="detached-runnable-parent")
        async def parent() -> asyncio.Task[str]:
            async def detached_runner() -> str:
                await release.wait()
                stale_context_seen.append(current_context())
                return cast(str, traced.invoke("student"))

            return asyncio.create_task(detached_runner())

        task = await parent()
        release.set()
        return await task

    assert asyncio.run(scenario()) == "STUDENT"
    assert stale_context_seen == [None]
    assert [item["trace"]["name"] for item in captured_envelopes] == [
        "detached-runnable-parent",
        "detached-runnable",
    ]
    runnable_trace = captured_envelopes[1]
    assert runnable_trace["observations"][0]["parent_observation_id"] is None


def test_concurrent_async_calls_keep_trace_context_isolated(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    ready = asyncio.Event()
    release = asyncio.Event()
    started = 0

    @observe
    async def run(label: str) -> str:
        nonlocal started
        started += 1
        if started == 2:
            ready.set()
        await ready.wait()
        context = current_context()
        assert context is not None
        with span(f"child-{label}", input=label):
            await release.wait()
        return context.trace_id

    async def scenario() -> tuple[str, str]:
        first = asyncio.create_task(run("one"))
        second = asyncio.create_task(run("two"))
        await ready.wait()
        release.set()
        return await first, await second

    first_trace_id, second_trace_id = asyncio.run(scenario())

    assert first_trace_id != second_trace_id
    assert len(captured_envelopes) == 2
    observations_by_trace = {
        item["trace"]["trace_id"]: [
            observation["name"] for observation in item["observations"]
        ]
        for item in captured_envelopes
    }
    assert observations_by_trace[first_trace_id] == ["run", "child-one"]
    assert observations_by_trace[second_trace_id] == ["run", "child-two"]
    assert current_context() is None


def test_async_cancellation_is_preserved_and_recorded(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    original = asyncio.CancelledError("student cancelled")

    @observe
    async def cancelled() -> None:
        raise original

    async def scenario() -> None:
        with pytest.raises(asyncio.CancelledError) as caught:
            await cancelled()
        assert caught.value is original

    asyncio.run(scenario())
    assert captured_envelopes[0]["trace"]["status"] == "cancelled"
    assert captured_envelopes[0]["observations"][0]["status"] == "cancelled"


def test_generator_context_exists_only_while_iterator_runs(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    seen_inside: list[bool] = []

    @observe(name="word_stream")
    def words() -> Iterator[str]:
        seen_inside.append(current_context() is not None)
        yield "hello"
        seen_inside.append(current_context() is not None)
        yield " world"

    iterator = words()
    assert inspect.isgeneratorfunction(words)
    assert captured_envelopes == []
    assert next(iterator) == "hello"
    assert current_context() is None
    assert list(iterator) == [" world"]
    assert seen_inside == [True, True]
    assert current_context() is None
    assert captured_envelopes[0]["trace"]["status"] == "completed"
    assert captured_envelopes[0]["trace"]["output"] == "hello world"


def test_closing_generator_runs_finally_in_context_and_records_cancelled(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    finalizer_context: list[bool] = []

    @observe
    def numbers() -> Generator[int, None, None]:
        try:
            yield 1
            yield 2
        finally:
            finalizer_context.append(current_context() is not None)

    iterator = numbers()
    assert next(iterator) == 1
    iterator.close()

    assert finalizer_context == [True]
    assert current_context() is None
    assert captured_envelopes[0]["trace"]["status"] == "cancelled"


def test_async_generator_context_and_aclose_lifecycle(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    seen_inside: list[bool] = []
    finalizer_context: list[bool] = []

    @observe(name="async_stream")
    async def stream() -> AsyncGenerator[str, None]:
        try:
            seen_inside.append(current_context() is not None)
            yield "first"
            seen_inside.append(current_context() is not None)
            yield "second"
        finally:
            finalizer_context.append(current_context() is not None)

    async def scenario() -> None:
        iterator = stream()
        assert await anext(iterator) == "first"
        assert current_context() is None
        await iterator.aclose()

    asyncio.run(scenario())

    assert inspect.isasyncgenfunction(stream)
    assert seen_inside == [True]
    assert finalizer_context == [True]
    assert current_context() is None
    assert captured_envelopes[0]["trace"]["status"] == "cancelled"


def test_async_generator_completion_preserves_chunks_and_output(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    @observe
    async def letters() -> AsyncGenerator[str, None]:
        yield "a"
        yield "b"

    async def scenario() -> list[str]:
        return [item async for item in letters()]

    assert asyncio.run(scenario()) == ["a", "b"]
    assert current_context() is None
    assert captured_envelopes[0]["trace"]["status"] == "completed"
    assert captured_envelopes[0]["trace"]["output"] == "ab"


def test_generator_send_and_async_generator_asend_are_forwarded(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    @observe
    def sync_echo() -> Generator[str, str, None]:
        received = yield "ready"
        yield received

    sync_iterator = sync_echo()
    assert next(sync_iterator) == "ready"
    assert sync_iterator.send("sync-value") == "sync-value"
    with pytest.raises(StopIteration):
        next(sync_iterator)

    @observe
    async def async_echo() -> AsyncGenerator[str, str]:
        received = yield "ready"
        yield received

    async def scenario() -> None:
        async_iterator = async_echo()
        assert await anext(async_iterator) == "ready"
        assert await async_iterator.asend("async-value") == "async-value"
        with pytest.raises(StopAsyncIteration):
            await anext(async_iterator)

    asyncio.run(scenario())

    assert inspect.isgeneratorfunction(sync_echo)
    assert inspect.isasyncgenfunction(async_echo)
    assert [item["trace"]["output"] for item in captured_envelopes] == [
        "readysync-value",
        "readyasync-value",
    ]


def test_capture_setup_failure_does_not_change_function_result(
    monkeypatch: pytest.MonkeyPatch,
    captured_envelopes: list[dict[str, Any]],
) -> None:
    def broken_start(self: TraceBuilder, **kwargs: object) -> None:
        raise RuntimeError("capture setup failed")

    monkeypatch.setattr(TraceBuilder, "start_run", broken_start)

    @observe
    def student_function(value: str) -> str:
        return value.upper()

    assert student_function("unchanged") == "UNCHANGED"
    assert captured_envelopes == []
    assert current_context() is None


def test_actual_langchain_node_span_uses_callback_run_as_parent(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")

    def target_node(value: str) -> str:
        with span("inside_node"):
            return value.upper()

    sequence = (
        runnables.RunnableLambda(lambda value: value).with_config(
            {"run_name": "source_node"}
        )
        | runnables.RunnableLambda(target_node).with_config({"run_name": "target_node"})
    ).with_config({"run_name": "sequence_root"})

    assert wrap_runnable(sequence).invoke("student") == "STUDENT"

    by_name = {
        observation["name"]: observation
        for observation in captured_envelopes[0]["observations"]
    }
    assert (
        by_name["inside_node"]["parent_observation_id"]
        == by_name["target_node"]["observation_id"]
    )
    assert context_module._current_langchain_parent_run_id() is None


def test_actual_langchain_explicit_parent_precedes_generic_default(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")
    sequence = (
        runnables.RunnableLambda(lambda value: value).with_config(
            {"run_name": "explicit_source"}
        )
        | runnables.RunnableLambda(
            lambda value: _generic_inside_explicit_target(value)
        ).with_config({"run_name": "explicit_target"})
    ).with_config({"run_name": "explicit_sequence"})
    traced = wrap_runnable(sequence)

    def _generic_inside_explicit_target(value: str) -> str:
        with span("generic_inside_explicit_target"):
            return value.upper()

    @observe(name="explicit_outer")
    def run() -> str:
        with span("generic_parent"):
            return cast(str, traced.invoke("student"))

    assert run() == "STUDENT"

    by_name = {
        observation["name"]: observation
        for observation in captured_envelopes[0]["observations"]
    }
    assert (
        by_name["explicit_sequence"]["parent_observation_id"]
        == by_name["generic_parent"]["observation_id"]
    )
    assert (
        by_name["explicit_source"]["parent_observation_id"]
        == by_name["explicit_sequence"]["observation_id"]
    )
    assert (
        by_name["explicit_target"]["parent_observation_id"]
        == by_name["explicit_sequence"]["observation_id"]
    )
    assert (
        by_name["generic_inside_explicit_target"]["parent_observation_id"]
        == by_name["explicit_target"]["observation_id"]
    )
    assert context_module._current_langchain_parent_run_id() is None


def test_actual_langchain_generic_scope_becomes_parent_of_nested_runnable(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")
    inner = runnables.RunnableLambda(lambda value: value.upper()).with_config(
        {"run_name": "inner_langchain"}
    )

    def outer_node(value: str) -> str:
        with span("middle_generic"):
            return cast(str, inner.invoke(value))

    outer = runnables.RunnableLambda(outer_node).with_config(
        {"run_name": "outer_langchain"}
    )

    assert wrap_runnable(outer).invoke("student") == "STUDENT"

    by_name = {
        observation["name"]: observation
        for observation in captured_envelopes[0]["observations"]
    }
    assert (
        by_name["middle_generic"]["parent_observation_id"]
        == by_name["outer_langchain"]["observation_id"]
    )
    assert (
        by_name["inner_langchain"]["parent_observation_id"]
        == by_name["middle_generic"]["observation_id"]
    )
    assert "langchain_parent_run_id" in by_name["inner_langchain"]["metadata"]
    assert context_module._current_langchain_parent_run_id() is None


def test_actual_langchain_async_concurrent_sibling_contexts_do_not_mix(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")
    ready = asyncio.Event()
    started = 0

    async def branch(label: str, value: str) -> str:
        nonlocal started
        started += 1
        if started == 2:
            ready.set()
        await ready.wait()
        with span(f"inside_{label}"):
            await asyncio.sleep(0)
            return f"{label}:{value}"

    async def left(value: str) -> str:
        return await branch("left", value)

    async def right(value: str) -> str:
        return await branch("right", value)

    parallel = runnables.RunnableParallel(
        left=runnables.RunnableLambda(left).with_config({"run_name": "left_node"}),
        right=runnables.RunnableLambda(right).with_config({"run_name": "right_node"}),
    ).with_config({"run_name": "parallel_root"})

    async def scenario() -> dict[str, str]:
        return cast(
            dict[str, str],
            await wrap_runnable(parallel).ainvoke("student"),
        )

    assert asyncio.run(scenario()) == {
        "left": "left:student",
        "right": "right:student",
    }

    by_name = {
        observation["name"]: observation
        for observation in captured_envelopes[0]["observations"]
    }
    assert (
        by_name["inside_left"]["parent_observation_id"]
        == by_name["left_node"]["observation_id"]
    )
    assert (
        by_name["inside_right"]["parent_observation_id"]
        == by_name["right_node"]["observation_id"]
    )
    assert context_module._current_langchain_parent_run_id() is None


def test_actual_langchain_callback_error_does_not_leak_run_context(
    captured_envelopes: list[dict[str, Any]],
) -> None:
    runnables = pytest.importorskip("langchain_core.runnables")
    original = RuntimeError("node failed")

    def fail(value: str) -> str:
        raise original

    runnable = runnables.RunnableLambda(fail).with_config({"run_name": "failing_node"})

    with pytest.raises(RuntimeError) as caught:
        wrap_runnable(runnable).invoke("student")

    assert caught.value is original
    assert captured_envelopes[0]["trace"]["status"] == "failed"
    assert context_module._current_langchain_parent_run_id() is None

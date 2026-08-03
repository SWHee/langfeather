from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from langfeather import wrap_runnable
from langfeather._builder import TraceBuilder
from langfeather._contracts import CompletedEnvelope
from langfeather.integrations.langchain import LangFeatherCallbackHandler

langchain_runnables = pytest.importorskip("langchain_core.runnables")


class Send:
    def __init__(self, node: str) -> None:
        self.node = node


def test_real_langchain_sequence_uses_callback_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from langfeather import _runnable

    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(_runnable, "enqueue_envelope", captured.append)
    runnable_lambda = langchain_runnables.RunnableLambda
    graph = runnable_lambda(lambda value: value + 1).with_config(
        run_name="increment"
    ) | runnable_lambda(lambda value: value * 2).with_config(run_name="double")

    result = wrap_runnable(graph).invoke(3)

    assert result == 8
    assert len(captured) == 1
    envelope = CompletedEnvelope.from_mapping(captured[0])
    assert len(envelope.observations) == 3
    root = envelope.observations[0]
    assert root.parent_observation_id is None
    assert {item.name for item in envelope.observations[1:]} == {
        "increment",
        "double",
    }
    assert all(
        item.parent_observation_id == root.observation_id
        for item in envelope.observations[1:]
    )


def test_real_runnable_lambda_is_mapped_to_runnable_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from langfeather import _runnable

    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(_runnable, "enqueue_envelope", captured.append)

    assert (
        wrap_runnable(
            langchain_runnables.RunnableLambda(lambda value: value + 1)
        ).invoke(1)
        == 2
    )

    envelope = CompletedEnvelope.from_mapping(captured[0])
    assert len(envelope.observations) == 1
    assert envelope.observations[0].name == "RunnableLambda"
    assert envelope.observations[0].kind == "runnable"


def test_real_prompt_and_parser_steps_are_mapped_to_runnable_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    from langfeather import _runnable

    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(_runnable, "enqueue_envelope", captured.append)

    prompt = ChatPromptTemplate.from_template("say {word}")
    chain = prompt | (lambda value: value.to_string()) | StrOutputParser()

    assert wrap_runnable(chain).invoke({"word": "hi"}) == "Human: say hi"

    envelope = CompletedEnvelope.from_mapping(captured[0])
    kind_by_name = {item.name: item.kind for item in envelope.observations}
    assert kind_by_name["ChatPromptTemplate"] == "runnable"
    assert kind_by_name["StrOutputParser"] == "runnable"


def test_real_langchain_llm_result_metadata_is_copied_without_estimation() -> None:
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, LLMResult

    builder = TraceBuilder(
        invocation_input=["prompt"],
        configured_name="metadata-test",
        session_id=None,
    )
    handler = LangFeatherCallbackHandler(builder)
    run_id = uuid4()
    handler.on_chat_model_start(
        None,
        [["prompt"]],
        run_id=run_id,
        name="provider-model",
        metadata={"ls_provider": "provider-name"},
    )
    handler.on_llm_new_token("first", run_id=run_id)
    response = LLMResult(
        generations=[
            [
                ChatGeneration(
                    message=AIMessage(
                        content="answer",
                        response_metadata={"model_name": "returned-model"},
                        usage_metadata={
                            "input_tokens": 5,
                            "output_tokens": 2,
                            "total_tokens": 7,
                        },
                    )
                )
            ]
        ],
    )
    handler.on_llm_end(response, run_id=run_id)

    envelope = CompletedEnvelope.from_mapping(
        builder.finish(output=response, fallback_name="metadata-test")
    )
    observation = envelope.observations[0]
    assert observation.model == "returned-model"
    assert observation.usage is not None
    assert observation.usage.input_tokens == 5
    assert observation.usage.output_tokens == 2
    assert observation.usage.total_tokens == 7
    assert observation.usage.provider == "provider-name"
    assert observation.usage.raw == {
        "input_tokens": 5,
        "output_tokens": 2,
        "total_tokens": 7,
    }
    assert observation.time_to_first_token_us is not None


def test_send_dispatch_evidence_links_only_the_matching_pregel_push() -> None:
    builder = TraceBuilder(
        invocation_input={"question": "교통비"},
        configured_name="dispatch-test",
        session_id=None,
    )
    handler = LangFeatherCallbackHandler(builder)
    root_run = uuid4()
    dispatch_run = uuid4()
    checker_run = uuid4()
    handler.on_chain_start(None, {}, run_id=root_run, name="graph")
    handler.on_chain_start(
        None,
        {},
        run_id=dispatch_run,
        parent_run_id=root_run,
        name="dispatch",
        metadata={"langgraph_node": "retriever"},
    )
    handler.on_chain_end(
        [Send("policy_checker"), Send("policy_checker")],
        run_id=dispatch_run,
    )
    handler.on_chain_start(
        None,
        {},
        run_id=checker_run,
        parent_run_id=root_run,
        name="policy_checker",
        metadata={
            "langgraph_node": "policy_checker",
            "langgraph_path": ("__pregel_push", 1, False),
        },
    )
    handler.on_chain_end({}, run_id=checker_run)
    handler.on_chain_end({}, run_id=root_run)

    envelope = CompletedEnvelope.from_mapping(
        builder.finish(output={}, fallback_name="dispatch-test")
    )
    by_name = {item.name: item for item in envelope.observations}
    dispatch = by_name["dispatch"]
    checker = by_name["policy_checker"]
    assert checker.parent_observation_id != dispatch.observation_id
    assert dispatch.metadata["langfeather_dispatches"] == [
        {"target": "policy_checker", "index": 0},
        {"target": "policy_checker", "index": 1},
    ]
    assert checker.metadata["langfeather_dispatch_source_observation_id"] == (
        dispatch.observation_id
    )

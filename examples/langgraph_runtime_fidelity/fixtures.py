from __future__ import annotations

import asyncio
import time
from typing import Any, Literal, TypedDict

from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import BaseMessageChunk
from langchain_core.runnables import Runnable, RunnableLambda
from langchain_core.runnables.config import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph


class AnswerState(TypedDict, total=False):
    question: str
    draft: str
    answer: str


class ParallelState(TypedDict, total=False):
    question: str
    left_context: str
    right_context: str
    answer: str


class ConditionalState(TypedDict, total=False):
    question: str
    route: Literal["short", "long"]
    answer: str


class LoopState(TypedDict, total=False):
    question: str
    attempts: int
    answer: str


class NestedState(TypedDict, total=False):
    question: str
    working: str
    answer: str


class RecoveryState(TypedDict, total=False):
    question: str
    answer: str
    recovered: bool


class CancelState(TypedDict, total=False):
    question: str
    first: str
    answer: str


def _draft_answer(state: AnswerState) -> AnswerState:
    return {"draft": f"초안: {state['question']}"}


def _finalize_answer(state: AnswerState) -> AnswerState:
    return {"answer": f"완성: {state['draft']}"}


def build_sequential_graph() -> Runnable[Any, Any]:
    builder = StateGraph(AnswerState)
    builder.add_node("draft_answer", _draft_answer)
    builder.add_node("finalize_answer", _finalize_answer)
    builder.add_edge(START, "draft_answer")
    builder.add_edge("draft_answer", "finalize_answer")
    builder.add_edge("finalize_answer", END)
    return builder.compile()


def _parallel_left(state: ParallelState) -> ParallelState:
    time.sleep(0.08)
    return {"left_context": f"왼쪽 자료: {state['question']}"}


def _parallel_right(state: ParallelState) -> ParallelState:
    time.sleep(0.08)
    return {"right_context": f"오른쪽 자료: {state['question']}"}


def _merge_parallel(state: ParallelState) -> ParallelState:
    return {
        "answer": f"{state['left_context']} | {state['right_context']}",
    }


def build_parallel_graph() -> Runnable[Any, Any]:
    builder = StateGraph(ParallelState)
    builder.add_node("parallel_left", _parallel_left)
    builder.add_node("parallel_right", _parallel_right)
    builder.add_node("merge_parallel", _merge_parallel)
    builder.add_edge(START, "parallel_left")
    builder.add_edge(START, "parallel_right")
    builder.add_edge("parallel_left", "merge_parallel")
    builder.add_edge("parallel_right", "merge_parallel")
    builder.add_edge("merge_parallel", END)
    return builder.compile()


def _choose_route(state: ConditionalState) -> ConditionalState:
    return {"route": state.get("route", "short")}


def _route_after_choice(state: ConditionalState) -> Literal["short", "long"]:
    return state["route"]


def _short_answer(state: ConditionalState) -> ConditionalState:
    return {"answer": f"짧은 답: {state['question']}"}


def _long_answer(state: ConditionalState) -> ConditionalState:
    return {"answer": f"긴 답: {state['question']} / 근거 포함"}


def build_conditional_graph() -> Runnable[Any, Any]:
    builder = StateGraph(ConditionalState)
    builder.add_node("choose_route", _choose_route)
    builder.add_node("short_answer", _short_answer)
    builder.add_node("long_answer", _long_answer)
    builder.add_edge(START, "choose_route")
    builder.add_conditional_edges(
        "choose_route",
        _route_after_choice,
        {"short": "short_answer", "long": "long_answer"},
    )
    builder.add_edge("short_answer", END)
    builder.add_edge("long_answer", END)
    return builder.compile()


def _retry_node(state: LoopState) -> LoopState:
    attempts = state.get("attempts", 0) + 1
    update: LoopState = {"attempts": attempts}
    if attempts == 3:
        update["answer"] = f"세 번째 시도에 성공: {state['question']}"
    return update


def _continue_retry(state: LoopState) -> Literal["again", "done"]:
    return "done" if state["attempts"] >= 3 else "again"


def build_loop_graph() -> Runnable[Any, Any]:
    builder = StateGraph(LoopState)
    builder.add_node("retry_node", _retry_node)
    builder.add_edge(START, "retry_node")
    builder.add_conditional_edges(
        "retry_node",
        _continue_retry,
        {"again": "retry_node", "done": END},
    )
    return builder.compile()


def _nested_prepare(state: NestedState) -> NestedState:
    return {"working": f"정리: {state['question']}"}


def _nested_finalize(state: NestedState) -> NestedState:
    return {"answer": f"중첩 결과: {state['working']}"}


def build_nested_runnable_graph() -> Runnable[Any, Any]:
    nested_pipeline = (
        RunnableLambda(_nested_prepare).with_config(run_name="RunnableLambda")
        | RunnableLambda(_nested_finalize).with_config(run_name="RunnableLambda")
    )
    builder = StateGraph(NestedState)
    builder.add_node("nested_pipeline", nested_pipeline)
    builder.add_edge(START, "nested_pipeline")
    builder.add_edge("nested_pipeline", END)
    return builder.compile()


def _raise_root_error(state: AnswerState) -> AnswerState:
    raise RuntimeError(f"root failure: {state['question']}")


def build_failed_root_graph() -> Runnable[Any, Any]:
    builder = StateGraph(AnswerState)
    builder.add_node("explode", _raise_root_error)
    builder.add_edge(START, "explode")
    builder.add_edge("explode", END)
    return builder.compile()


def _raise_child_error(state: RecoveryState) -> RecoveryState:
    raise ValueError(f"primary failed: {state['question']}")


def _recover_child(state: RecoveryState) -> RecoveryState:
    return {
        "answer": f"fallback answer: {state['question']}",
        "recovered": True,
    }


def build_fallback_graph() -> Runnable[Any, Any]:
    primary = RunnableLambda(_raise_child_error).with_config(
        run_name="fragile_child"
    )
    fallback = RunnableLambda(_recover_child).with_config(
        run_name="fallback_child"
    )
    resilient = primary.with_fallbacks([fallback])
    builder = StateGraph(RecoveryState)
    builder.add_node("resilient_node", resilient)
    builder.add_edge(START, "resilient_node")
    builder.add_edge("resilient_node", END)
    return builder.compile()


def build_stream_graph() -> Runnable[Any, Any]:
    return build_sequential_graph()


def build_streaming_llm_graph() -> Runnable[Any, Any]:
    model = FakeListChatModel(responses=["깃털"], sleep=0.002)

    def stream_model(
        state: MessagesState,
        config: RunnableConfig,
    ) -> dict[str, list[BaseMessageChunk]]:
        chunks = list(model.stream(state["messages"], config))
        if not chunks:
            raise RuntimeError("fake streaming model returned no chunks")
        combined = chunks[0]
        for chunk in chunks[1:]:
            combined += chunk
        return {"messages": [combined]}

    builder = StateGraph(MessagesState)
    builder.add_node("streaming_llm", stream_model)
    builder.add_edge(START, "streaming_llm")
    builder.add_edge("streaming_llm", END)
    return builder.compile()


async def _first_async_step(state: CancelState) -> CancelState:
    await asyncio.sleep(0)
    return {"first": f"첫 chunk: {state['question']}"}


async def _slow_async_step(state: CancelState) -> CancelState:
    await asyncio.sleep(30)
    return {"answer": f"완료: {state['first']}"}


def build_cancelled_stream_graph() -> Runnable[Any, Any]:
    builder = StateGraph(CancelState)
    builder.add_node("first_async_step", _first_async_step)
    builder.add_node("slow_async_step", _slow_async_step)
    builder.add_edge(START, "first_async_step")
    builder.add_edge("first_async_step", "slow_async_step")
    builder.add_edge("slow_async_step", END)
    return builder.compile()

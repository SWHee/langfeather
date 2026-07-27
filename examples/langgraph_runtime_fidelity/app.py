from __future__ import annotations

import argparse
from collections.abc import Callable
from typing import Any

from examples.langgraph_runtime_fidelity.fixtures import (
    build_conditional_graph,
    build_fallback_graph,
    build_loop_graph,
    build_nested_runnable_graph,
    build_parallel_graph,
    build_sequential_graph,
    build_stream_graph,
    build_streaming_llm_graph,
)
from langchain_core.messages import HumanMessage

import langfeather

GraphFactory = Callable[[], Any]

GRAPH_FACTORIES: dict[str, GraphFactory] = {
    "sequential": build_sequential_graph,
    "parallel": build_parallel_graph,
    "conditional": build_conditional_graph,
    "loop": build_loop_graph,
    "nested": build_nested_runnable_graph,
    "fallback": build_fallback_graph,
    "stream": build_stream_graph,
    "streaming-llm": build_streaming_llm_graph,
}

INPUTS: dict[str, dict[str, object]] = {
    "sequential": {"question": "순차 실행 경로를 보여줘"},
    "parallel": {"question": "두 자료를 동시에 찾아줘"},
    "conditional": {"question": "자세히 설명해줘", "route": "long"},
    "loop": {"question": "세 번 시도해줘", "attempts": 0},
    "nested": {"question": "RunnableLambda 내부도 보여줘"},
    "fallback": {"question": "실패하면 복구해줘"},
    "stream": {"question": "chunk를 보여줘"},
    "streaming-llm": {
        "messages": [HumanMessage(content="두 글자로 답해줘")],
    },
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=sorted(GRAPH_FACTORIES))
    arguments = parser.parse_args()
    scenario = arguments.scenario
    graph = langfeather.wrap_runnable(
        GRAPH_FACTORIES[scenario](),
        name=f"runtime-{scenario}",
    )

    if scenario in {"stream", "streaming-llm"}:
        for chunk in graph.stream(INPUTS[scenario], stream_mode="updates"):
            print(chunk)
    else:
        print(graph.invoke(INPUTS[scenario]))

    if not langfeather.flush(timeout=5):
        print("LangFeather 전송이 제한 시간 안에 끝나지 않았습니다.")


if __name__ == "__main__":
    main()

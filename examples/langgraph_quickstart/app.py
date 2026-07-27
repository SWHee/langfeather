from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

import langfeather


class TutorialState(TypedDict, total=False):
    question: str
    draft: str
    answer: str


def draft_answer(state: TutorialState) -> TutorialState:
    return {"draft": f"초안: {state['question']}"}


def finalize_answer(state: TutorialState) -> TutorialState:
    return {"answer": f"완성: {state['draft']}"}


def build_graph() -> object:
    builder = StateGraph(TutorialState)
    builder.add_node("draft_answer", draft_answer)
    builder.add_node("finalize_answer", finalize_answer)
    builder.add_edge(START, "draft_answer")
    builder.add_edge("draft_answer", "finalize_answer")
    builder.add_edge("finalize_answer", END)
    return builder.compile()


def main() -> None:
    graph = langfeather.wrap_runnable(
        build_graph(),
        name="quickstart",
    )
    result = graph.invoke(
        {"question": "LangGraph 실행 경로를 보여줘"},
        {"configurable": {"thread_id": "quickstart-session"}},
    )
    print(result["answer"])
    if not langfeather.flush(timeout=5):
        print("LangFeather 전송이 제한 시간 안에 끝나지 않았습니다.")


if __name__ == "__main__":
    main()

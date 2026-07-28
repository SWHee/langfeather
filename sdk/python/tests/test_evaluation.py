from __future__ import annotations

import asyncio

import pytest

from langfeather import (
    DatasetExample,
    add_dataset_examples,
    aevaluate,
    create_dataset,
    evaluate,
    evaluator,
    exact_match,
    find_dataset,
    get_dataset,
    get_or_create_dataset,
)
from langfeather import evaluation as evaluation_module


class _Control:
    instances: list[_Control] = []
    datasets: dict[str, dict[str, object]] = {}
    case_count: int = 1

    def __init__(self, endpoint: str | None) -> None:
        self.endpoint = endpoint
        self.puts: list[tuple[str, dict[str, object]]] = []
        self.posts: list[tuple[str, dict[str, object]]] = []
        self.__class__.instances.append(self)

    def get(self, path: str) -> dict[str, object]:
        if path.startswith("/api/v1/datasets?name="):
            name = path.removeprefix("/api/v1/datasets?name=")
            return {
                "items": [
                    dataset
                    for dataset in self.__class__.datasets.values()
                    if dataset["name"] == name
                ]
            }
        dataset_id = path.rsplit("/", maxsplit=1)[-1]
        return self.__class__.datasets[dataset_id]

    def post(self, path: str, payload: object) -> dict[str, object]:
        self.posts.append((path, {"payload": payload}))
        if path == "/api/v1/datasets":
            request = payload
            assert isinstance(request, dict)
            dataset_id = f"ds_{len(self.__class__.datasets) + 1}"
            examples = request.get("examples", [])
            assert isinstance(examples, list)
            dataset = {
                "dataset_id": dataset_id,
                "name": request["name"],
                "description": request.get("description"),
                "revision": 1,
                "examples": [
                    {
                        **example,
                        "dataset_example_id": f"dse_{index}",
                        "position": index,
                    }
                    for index, example in enumerate(examples)
                ],
            }
            self.__class__.datasets[dataset_id] = dataset
            return dataset
        if path.endswith("/examples"):
            dataset_id = path.split("/")[-2]
            dataset = self.__class__.datasets[dataset_id]
            examples = payload
            assert isinstance(examples, list)
            existing = dataset["examples"]
            assert isinstance(existing, list)
            existing.extend(
                {
                    **example,
                    "dataset_example_id": f"dse_{len(existing) + index}",
                    "position": len(existing) + index,
                }
                for index, example in enumerate(examples)
            )
            revision = dataset["revision"]
            assert isinstance(revision, int)
            dataset["revision"] = revision + 1
            return dataset
        request = payload
        assert isinstance(request, dict)
        if path == "/api/v1/experiments":
            return {
                "experiment_id": "exp_1",
                "dataset_id": "ds_1",
                "cases": [
                    {
                        "experiment_case_id": f"ec_{index + 1}",
                        "dataset_example_id": f"dse_{index + 1}",
                        "input": {"question": "hello"},
                        "expected_output": {"answer": "hello"},
                        "metadata": {"kind": "smoke"},
                    }
                    for index in range(self.__class__.case_count)
                ],
            }
        return {
            "experiment_id": "exp_1",
            "status": request["status"],
            "case_count": 1,
            "completed_case_count": 1,
            "failed_case_count": 0,
        }

    def put(self, path: str, payload: object) -> dict[str, object]:
        assert isinstance(payload, dict)
        self.puts.append((path, payload))
        return {}


@pytest.fixture(autouse=True)
def fake_control(monkeypatch: pytest.MonkeyPatch) -> None:
    _Control.instances = []
    _Control.datasets = {}
    _Control.case_count = 1
    monkeypatch.setattr(evaluation_module, "_ControlClient", _Control)
    monkeypatch.setattr(evaluation_module, "flush_transport", lambda timeout: True)
    monkeypatch.setattr("langfeather._observe.enqueue_envelope", lambda envelope: None)


def test_evaluate_records_target_and_evaluator_results() -> None:
    @evaluator(key="length", name="Answer length", data_type="number")
    def answer_length(**kwargs: object) -> float:
        return 1.0

    run = evaluate(
        dataset="ds_1",
        name="sync baseline",
        target=lambda _: {"answer": "hello"},
        evaluators=[exact_match(), answer_length],
        endpoint="http://collector.test",
    )

    assert run.experiment_id == "exp_1"
    assert run.status == "completed"
    control = _Control.instances[0]
    _, payload = control.puts[0]
    assert payload["status"] == "completed"
    assert payload["trace_id"] is not None
    assert payload["evaluator_results"] == [
        {"evaluator_key": "exact_match", "value": True},
        {"evaluator_key": "length", "value": 1.0},
    ]


def test_aevaluate_accepts_async_target() -> None:
    async def target(_: object) -> dict[str, str]:
        return {"answer": "hello"}

    run = asyncio.run(
        aevaluate(
            dataset="ds_1",
            name="async baseline",
            target=target,
            evaluators=[exact_match()],
        )
    )

    assert run.status == "completed"
    assert _Control.instances[0].puts[0][1]["status"] == "completed"


def test_dataset_helpers_create_find_reuse_and_append_examples() -> None:
    created = create_dataset(
        name="rag-regression",
        description="reviewed cases",
        examples=[DatasetExample(input={"question": "hello"})],
    )
    assert created.name == "rag-regression"
    assert created.examples[0].dataset_example_id == "dse_0"

    assert find_dataset("rag-regression") == created
    assert get_dataset(created.dataset_id) == created

    reused = get_or_create_dataset(
        name="rag-regression",
        examples=[DatasetExample(input={"question": "not added"})],
    )
    assert reused == created

    updated = add_dataset_examples(
        created.dataset_id,
        [DatasetExample(input={"question": "second"})],
    )
    assert updated.revision == 2
    assert [item.input for item in updated.examples] == [
        {"question": "hello"},
        {"question": "second"},
    ]


def test_interrupt_in_target_stops_the_run_instead_of_failing_one_case() -> None:
    _Control.case_count = 3
    attempts: list[str] = []

    def target(_: object) -> dict[str, str]:
        attempts.append("call")
        if len(attempts) == 2:
            raise KeyboardInterrupt
        return {"answer": "hello"}

    with pytest.raises(KeyboardInterrupt):
        evaluate(
            dataset="ds_1",
            name="interrupted",
            target=target,
            evaluators=[exact_match()],
        )

    control = _Control.instances[0]
    # The third case must never run, and the interrupted case is not recorded.
    assert len(attempts) == 2
    assert [path for path, _ in control.puts] == [
        "/api/v1/experiments/exp_1/cases/ec_1"
    ]
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_interrupt_in_evaluator_stops_the_run() -> None:
    _Control.case_count = 2

    @evaluator(key="interrupting", name="Interrupting")
    def interrupting(**kwargs: object) -> bool:
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        evaluate(
            dataset="ds_1",
            name="interrupted evaluator",
            target=lambda _: {"answer": "hello"},
            evaluators=[interrupting],
        )

    control = _Control.instances[0]
    assert control.puts == []
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_async_cancellation_stops_the_run() -> None:
    _Control.case_count = 3
    attempts: list[str] = []

    async def target(_: object) -> dict[str, str]:
        attempts.append("call")
        if len(attempts) == 2:
            raise asyncio.CancelledError
        return {"answer": "hello"}

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            aevaluate(
                dataset="ds_1",
                name="cancelled",
                target=target,
                evaluators=[exact_match()],
            )
        )

    control = _Control.instances[0]
    assert len(attempts) == 2
    assert len(control.puts) == 1
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )

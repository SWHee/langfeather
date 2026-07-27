from __future__ import annotations

import asyncio
import traceback
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest

from langfeather import _builder, _runnable
from langfeather._runnable import wrap_runnable


class _PlainRunnable:
    def invoke(
        self,
        value: object,
        config: object = None,
        **kwargs: object,
    ) -> object:
        del config, kwargs
        return value

    async def ainvoke(
        self,
        value: object,
        config: object = None,
        **kwargs: object,
    ) -> object:
        del config, kwargs
        await asyncio.sleep(0)
        return value


class _FailingRunnable:
    def __init__(self, error: RuntimeError) -> None:
        self.error = error

    def invoke(
        self,
        value: object,
        config: object = None,
        **kwargs: object,
    ) -> None:
        del value, config, kwargs
        raise self.error


class _StreamingRunnable:
    def __init__(self, error: RuntimeError | None = None) -> None:
        self.error = error

    def stream(
        self,
        value: object,
        config: object = None,
        **kwargs: object,
    ) -> Iterator[str]:
        del value, config, kwargs
        yield "첫"
        yield " 번째"
        if self.error is not None:
            raise self.error

    async def astream(
        self,
        value: object,
        config: object = None,
        **kwargs: object,
    ) -> AsyncIterator[str]:
        del value, config, kwargs
        yield "첫"
        await asyncio.sleep(0)
        yield " 번째"
        if self.error is not None:
            raise self.error


def _raise_capture_failure(*args: object, **kwargs: object) -> Any:
    del args, kwargs
    raise RuntimeError("LangFeather capture failed")


@pytest.mark.parametrize("failure_site", ["serialize", "enqueue"])
def test_capture_failure_does_not_change_sync_return(
    monkeypatch: pytest.MonkeyPatch,
    failure_site: str,
) -> None:
    value = object()
    if failure_site == "serialize":
        monkeypatch.setattr(_builder, "to_json_value", _raise_capture_failure)
    else:
        monkeypatch.setattr(_runnable, "enqueue_envelope", _raise_capture_failure)

    result = wrap_runnable(_PlainRunnable()).invoke(value)

    assert result is value


@pytest.mark.parametrize("failure_site", ["serialize", "enqueue"])
def test_capture_failure_does_not_replace_application_exception(
    monkeypatch: pytest.MonkeyPatch,
    failure_site: str,
) -> None:
    original = RuntimeError("application failed")
    if failure_site == "serialize":
        monkeypatch.setattr(_builder, "to_json_value", _raise_capture_failure)
    else:
        monkeypatch.setattr(_runnable, "enqueue_envelope", _raise_capture_failure)

    with pytest.raises(RuntimeError) as caught:
        wrap_runnable(_FailingRunnable(original)).invoke("input")

    assert caught.value is original
    extracted = traceback.extract_tb(caught.value.__traceback__)
    assert extracted[-1].name == "invoke"
    assert extracted[-1].line == "raise self.error"


@pytest.mark.parametrize("failure_site", ["serialize", "enqueue"])
def test_capture_failure_does_not_change_stream_chunks(
    monkeypatch: pytest.MonkeyPatch,
    failure_site: str,
) -> None:
    if failure_site == "serialize":
        monkeypatch.setattr(_builder, "to_json_value", _raise_capture_failure)
    else:
        monkeypatch.setattr(_runnable, "enqueue_envelope", _raise_capture_failure)

    chunks = list(wrap_runnable(_StreamingRunnable()).stream("input"))

    assert chunks == ["첫", " 번째"]


def test_capture_failure_does_not_replace_stream_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = RuntimeError("stream failed")
    monkeypatch.setattr(_runnable, "enqueue_envelope", _raise_capture_failure)
    stream = wrap_runnable(_StreamingRunnable(original)).stream("input")

    assert next(stream) == "첫"
    assert next(stream) == " 번째"
    with pytest.raises(RuntimeError) as caught:
        next(stream)

    assert caught.value is original
    extracted = traceback.extract_tb(caught.value.__traceback__)
    assert extracted[-1].name == "stream"
    assert extracted[-1].line == "raise self.error"


def test_capture_failure_does_not_change_async_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(_builder, "to_json_value", _raise_capture_failure)

    async def collect() -> list[str]:
        return [
            chunk
            async for chunk in wrap_runnable(_StreamingRunnable()).astream("input")
        ]

    assert asyncio.run(collect()) == ["첫", " 번째"]

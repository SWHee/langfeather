from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import contextmanager
from typing import Any, Generic, TypeVar, cast

from ._builder import TraceBuilder
from ._context import (
    _active_generic_run,
    _active_trace,
    _ActiveTrace,
    _GenericRunScope,
    get_live_active_trace,
)
from ._ids import new_trace_id
from ._transport import enqueue_envelope
from .integrations.langchain import LangFeatherCallbackHandler, add_callback

logger = logging.getLogger("langfeather")

InputT = TypeVar("InputT")
OutputT = TypeVar("OutputT")


def _session_id_from_config(config: object) -> str | None:
    try:
        if not isinstance(config, Mapping):
            return None
        metadata = config.get("metadata")
        if isinstance(metadata, Mapping):
            explicit_session_id = metadata.get("session_id")
            if explicit_session_id is not None:
                return str(explicit_session_id)
        configurable = config.get("configurable")
        if isinstance(configurable, Mapping):
            thread_id = configurable.get("thread_id")
            if thread_id is not None:
                return str(thread_id)
    except BaseException:
        logger.warning(
            "LangFeather could not extract a session ID; continuing without one",
            exc_info=True,
        )
    return None


def _trace_id_from_config(config: object) -> str | None:
    """Read an optional caller-owned trace ID without changing the public API."""
    try:
        if not isinstance(config, Mapping):
            return None
        metadata = config.get("metadata")
        if not isinstance(metadata, Mapping):
            return None
        trace_id = metadata.get("langfeather_trace_id")
        if isinstance(trace_id, str) and trace_id:
            return trace_id
    except BaseException:
        logger.warning(
            "LangFeather could not extract an explicit trace ID; generating one",
            exc_info=True,
        )
    return None


def _runnable_name(runnable: object) -> str:
    try:
        get_name = getattr(runnable, "get_name", None)
        if callable(get_name):
            name = get_name()
            if isinstance(name, str) and name:
                return name
    except BaseException:
        logger.warning(
            "LangFeather could not determine the Runnable name; using its type",
            exc_info=True,
        )
    return type(runnable).__name__


@contextmanager
def _activate_trace_context(
    active: _ActiveTrace,
    generic_scope: _GenericRunScope | None,
) -> Iterator[None]:
    trace_token = _active_trace.set(active)
    generic_token = _active_generic_run.set(generic_scope)
    try:
        yield
    finally:
        _active_generic_run.reset(generic_token)
        _active_trace.reset(trace_token)


class RunnableWrapper(Generic[InputT, OutputT]):
    """A transparent Runnable wrapper that installs one LangFeather callback."""

    def __init__(self, runnable: Any, *, name: str | None = None) -> None:
        self.__wrapped__ = runnable
        self._runnable = runnable
        self._name = name

    def invoke(
        self,
        input: InputT,
        config: Any = None,
        **kwargs: Any,
    ) -> OutputT:
        active = get_live_active_trace()
        if active is not None:
            return self._invoke_nested(
                active,
                input=input,
                config=config,
                kwargs=kwargs,
            )

        fallback_name = _runnable_name(self._runnable)
        builder = TraceBuilder(
            invocation_input=input,
            configured_name=self._name,
            session_id=_session_id_from_config(config),
            trace_id=_trace_id_from_config(config) or new_trace_id(),
        )
        handler = LangFeatherCallbackHandler(builder)
        try:
            traced_config = add_callback(config, handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback; invoking without tracing",
                exc_info=True,
            )
            return cast(OutputT, self._runnable.invoke(input, config, **kwargs))

        trace = _ActiveTrace(builder=builder, handler=handler)
        with _activate_trace_context(trace, None):
            try:
                result: OutputT = self._runnable.invoke(
                    input,
                    traced_config,
                    **kwargs,
                )
            except BaseException as error:
                self._finalize(
                    builder,
                    fallback_name=fallback_name,
                    error=error,
                )
                raise
            else:
                self._finalize(
                    builder,
                    fallback_name=fallback_name,
                    output=result,
                )
                return result

    async def ainvoke(
        self,
        input: InputT,
        config: Any = None,
        **kwargs: Any,
    ) -> OutputT:
        active = get_live_active_trace()
        if active is not None:
            return await self._ainvoke_nested(
                active,
                input=input,
                config=config,
                kwargs=kwargs,
            )

        fallback_name = _runnable_name(self._runnable)
        builder = TraceBuilder(
            invocation_input=input,
            configured_name=self._name,
            session_id=_session_id_from_config(config),
            trace_id=_trace_id_from_config(config) or new_trace_id(),
        )
        handler = LangFeatherCallbackHandler(builder)
        try:
            traced_config = add_callback(config, handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback; invoking without tracing",
                exc_info=True,
            )
            return cast(
                OutputT,
                await self._runnable.ainvoke(input, config, **kwargs),
            )

        trace = _ActiveTrace(builder=builder, handler=handler)
        with _activate_trace_context(trace, None):
            try:
                result: OutputT = await self._runnable.ainvoke(
                    input,
                    traced_config,
                    **kwargs,
                )
            except BaseException as error:
                self._finalize(
                    builder,
                    fallback_name=fallback_name,
                    error=error,
                )
                raise
            else:
                self._finalize(
                    builder,
                    fallback_name=fallback_name,
                    output=result,
                )
                return result

    def stream(
        self,
        input: InputT,
        config: Any = None,
        **kwargs: Any,
    ) -> Iterator[OutputT]:
        """Yield original chunks and emit one terminal envelope."""
        active = get_live_active_trace()
        if active is not None:
            yield from self._stream_nested(
                active,
                input=input,
                config=config,
                kwargs=kwargs,
            )
            return

        fallback_name = _runnable_name(self._runnable)
        builder = TraceBuilder(
            invocation_input=input,
            configured_name=self._name,
            session_id=_session_id_from_config(config),
            trace_id=_trace_id_from_config(config) or new_trace_id(),
        )
        handler = LangFeatherCallbackHandler(builder)
        try:
            traced_config = add_callback(config, handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback; streaming without tracing",
                exc_info=True,
            )
            yield from self._runnable.stream(input, config, **kwargs)
            return

        trace = _ActiveTrace(builder=builder, handler=handler)
        chunks: list[object] = []
        iterator: Iterator[OutputT] | None = None
        try:
            iterator = self._start_sync_stream(
                trace,
                generic_scope=None,
                input=input,
                config=traced_config,
                kwargs=kwargs,
            )
            while True:
                try:
                    chunk = self._next_sync_chunk(trace, None, iterator)
                except StopIteration:
                    break
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            terminal_error = error
            if isinstance(error, GeneratorExit) and iterator is not None:
                try:
                    self._close_sync_stream(trace, None, iterator)
                except BaseException as close_error:
                    terminal_error = close_error
            self._finalize(
                builder,
                fallback_name=fallback_name,
                error=terminal_error,
            )
            if terminal_error is not error:
                raise terminal_error from error
            raise
        else:
            self._finalize(
                builder,
                fallback_name=fallback_name,
                output=_aggregate_chunks(chunks),
            )

    async def astream(
        self,
        input: InputT,
        config: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[OutputT]:
        """Yield original async chunks and emit one terminal envelope."""
        active = get_live_active_trace()
        if active is not None:
            async for chunk in self._astream_nested(
                active,
                input=input,
                config=config,
                kwargs=kwargs,
            ):
                yield chunk
            return

        fallback_name = _runnable_name(self._runnable)
        builder = TraceBuilder(
            invocation_input=input,
            configured_name=self._name,
            session_id=_session_id_from_config(config),
            trace_id=_trace_id_from_config(config) or new_trace_id(),
        )
        handler = LangFeatherCallbackHandler(builder)
        try:
            traced_config = add_callback(config, handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback; streaming without tracing",
                exc_info=True,
            )
            async for chunk in self._runnable.astream(input, config, **kwargs):
                yield chunk
            return

        trace = _ActiveTrace(builder=builder, handler=handler)
        chunks: list[object] = []
        iterator: AsyncIterator[OutputT] | None = None
        try:
            iterator = self._start_async_stream(
                trace,
                generic_scope=None,
                input=input,
                config=traced_config,
                kwargs=kwargs,
            )
            while True:
                try:
                    chunk = await self._next_async_chunk(trace, None, iterator)
                except StopAsyncIteration:
                    break
                chunks.append(chunk)
                yield chunk
        except BaseException as error:
            terminal_error = error
            if isinstance(error, GeneratorExit) and iterator is not None:
                try:
                    await self._close_async_stream(trace, None, iterator)
                except BaseException as close_error:
                    terminal_error = close_error
            self._finalize(
                builder,
                fallback_name=fallback_name,
                error=terminal_error,
            )
            if terminal_error is not error:
                raise terminal_error from error
            raise
        else:
            self._finalize(
                builder,
                fallback_name=fallback_name,
                output=_aggregate_chunks(chunks),
            )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._runnable, name)

    def _invoke_nested(
        self,
        active: _ActiveTrace,
        *,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> OutputT:
        try:
            traced_config = add_callback(config, active.handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback to a nested Runnable",
                exc_info=True,
            )
            traced_config = config
        return cast(
            OutputT,
            self._runnable.invoke(input, traced_config, **kwargs),
        )

    async def _ainvoke_nested(
        self,
        active: _ActiveTrace,
        *,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> OutputT:
        try:
            traced_config = add_callback(config, active.handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback to a nested Runnable",
                exc_info=True,
            )
            traced_config = config
        return cast(
            OutputT,
            await self._runnable.ainvoke(input, traced_config, **kwargs),
        )

    def _stream_nested(
        self,
        active: _ActiveTrace,
        *,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> Iterator[OutputT]:
        try:
            traced_config = add_callback(config, active.handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback to a nested Runnable",
                exc_info=True,
            )
            traced_config = config
        generic_scope = _active_generic_run.get()
        iterator = self._start_sync_stream(
            active,
            generic_scope=generic_scope,
            input=input,
            config=traced_config,
            kwargs=kwargs,
        )
        try:
            while True:
                try:
                    yield self._next_sync_chunk(active, generic_scope, iterator)
                except StopIteration:
                    return
        except GeneratorExit:
            self._close_sync_stream(active, generic_scope, iterator)
            raise

    async def _astream_nested(
        self,
        active: _ActiveTrace,
        *,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> AsyncIterator[OutputT]:
        try:
            traced_config = add_callback(config, active.handler)
        except BaseException:
            logger.warning(
                "LangFeather could not attach its callback to a nested Runnable",
                exc_info=True,
            )
            traced_config = config
        generic_scope = _active_generic_run.get()
        iterator = self._start_async_stream(
            active,
            generic_scope=generic_scope,
            input=input,
            config=traced_config,
            kwargs=kwargs,
        )
        try:
            while True:
                try:
                    yield await self._next_async_chunk(
                        active,
                        generic_scope,
                        iterator,
                    )
                except StopAsyncIteration:
                    return
        except GeneratorExit:
            await self._close_async_stream(active, generic_scope, iterator)
            raise

    def _start_sync_stream(
        self,
        active: _ActiveTrace,
        *,
        generic_scope: _GenericRunScope | None,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> Iterator[OutputT]:
        with _activate_trace_context(active, generic_scope):
            return iter(self._runnable.stream(input, config, **kwargs))

    @staticmethod
    def _next_sync_chunk(
        active: _ActiveTrace,
        generic_scope: _GenericRunScope | None,
        iterator: Iterator[OutputT],
    ) -> OutputT:
        with _activate_trace_context(active, generic_scope):
            return next(iterator)

    @staticmethod
    def _close_sync_stream(
        active: _ActiveTrace,
        generic_scope: _GenericRunScope | None,
        iterator: Iterator[OutputT],
    ) -> None:
        close = getattr(iterator, "close", None)
        if not callable(close):
            return
        with _activate_trace_context(active, generic_scope):
            close()

    def _start_async_stream(
        self,
        active: _ActiveTrace,
        *,
        generic_scope: _GenericRunScope | None,
        input: InputT,
        config: Any,
        kwargs: dict[str, Any],
    ) -> AsyncIterator[OutputT]:
        with _activate_trace_context(active, generic_scope):
            return cast(
                AsyncIterator[OutputT],
                self._runnable.astream(input, config, **kwargs),
            )

    @staticmethod
    async def _next_async_chunk(
        active: _ActiveTrace,
        generic_scope: _GenericRunScope | None,
        iterator: AsyncIterator[OutputT],
    ) -> OutputT:
        with _activate_trace_context(active, generic_scope):
            return await anext(iterator)

    @staticmethod
    async def _close_async_stream(
        active: _ActiveTrace,
        generic_scope: _GenericRunScope | None,
        iterator: AsyncIterator[OutputT],
    ) -> None:
        close = getattr(iterator, "aclose", None)
        if not callable(close):
            return
        with _activate_trace_context(active, generic_scope):
            await close()

    @staticmethod
    def _finalize(
        builder: TraceBuilder,
        *,
        fallback_name: str,
        output: object = None,
        error: BaseException | None = None,
    ) -> None:
        try:
            envelope = builder.finish(
                output=output,
                error=error,
                fallback_name=fallback_name,
            )
            enqueue_envelope(envelope)
        except BaseException:
            logger.warning(
                "LangFeather could not finalize a trace",
                exc_info=True,
            )


def wrap_runnable(
    runnable: Any,
    *,
    name: str | None = None,
) -> RunnableWrapper[Any, Any]:
    """Wrap a LangChain/LangGraph Runnable without executing it."""
    return RunnableWrapper(runnable, name=name)


def _aggregate_chunks(chunks: list[object]) -> object:
    """Create a diagnostic aggregate without invoking arbitrary user methods."""
    if not chunks:
        return None
    if all(isinstance(chunk, str) for chunk in chunks):
        return "".join(cast(list[str], chunks))
    if all(isinstance(chunk, bytes) for chunk in chunks):
        return b"".join(cast(list[bytes], chunks))
    if len(chunks) == 1:
        return chunks[0]
    return chunks

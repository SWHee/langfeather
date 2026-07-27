from __future__ import annotations

import inspect
import logging
from collections.abc import (
    AsyncGenerator,
    Callable,
    Generator,
    Iterator,
    Mapping,
)
from contextlib import contextmanager
from dataclasses import dataclass, field
from functools import wraps
from types import TracebackType
from typing import Any, ParamSpec, TypeVar, cast, overload
from uuid import uuid4

from ._builder import TraceBuilder
from ._context import (
    _active_generic_run,
    _active_trace,
    _ActiveTrace,
    _current_langchain_parent_run_id,
    _GenericRunScope,
    _resolve_generic_parent_run_id,
    get_live_active_trace,
)
from ._runnable import _aggregate_chunks
from ._transport import enqueue_envelope
from .integrations.langchain import LangFeatherCallbackHandler

logger = logging.getLogger("langfeather")

P = ParamSpec("P")
R = TypeVar("R")
YieldT = TypeVar("YieldT")
SendT = TypeVar("SendT")
ReturnT = TypeVar("ReturnT")

_UNSET = object()


@dataclass(frozen=True, slots=True)
class TraceContext:
    """An explicit snapshot that can be attached in another task or thread."""

    trace_id: str
    parent_run_id: str | None
    _active: _ActiveTrace = field(repr=False, compare=False)


def current_context() -> TraceContext | None:
    """Return the current LangFeather context without mutating it."""
    active = get_live_active_trace()
    if active is None:
        return None
    current_langchain_parent = _current_langchain_parent_run_id()
    return TraceContext(
        trace_id=active.builder.trace_id,
        parent_run_id=_resolve_generic_parent_run_id(current_langchain_parent),
        _active=active,
    )


@contextmanager
def use_context(context: TraceContext) -> Iterator[TraceContext]:
    """Attach an explicit trace context for the duration of the block."""
    if context._active.builder.finished:
        yield context
        return

    active = context._active
    destination_langchain_parent = _current_langchain_parent_run_id()
    scope = (
        None
        if context.parent_run_id is None
        else _GenericRunScope(
            run_id=context.parent_run_id,
            langchain_anchor_run_id=destination_langchain_parent,
        )
    )
    trace_token = _active_trace.set(active)
    run_token = _active_generic_run.set(scope)
    try:
        yield context
    finally:
        _active_generic_run.reset(run_token)
        _active_trace.reset(trace_token)


@dataclass(slots=True)
class _Operation:
    active: _ActiveTrace
    run_id: str
    fallback_name: str
    owns_trace: bool
    langchain_anchor_run_id: str | None
    _finished: bool = False

    @contextmanager
    def activate(self) -> Iterator[None]:
        trace_token = _active_trace.set(self.active)
        run_token = _active_generic_run.set(
            _GenericRunScope(
                run_id=self.run_id,
                langchain_anchor_run_id=self.langchain_anchor_run_id,
            )
        )
        try:
            yield
        finally:
            _active_generic_run.reset(run_token)
            _active_trace.reset(trace_token)

    def finish(
        self,
        *,
        output: object = None,
        error: BaseException | None = None,
    ) -> None:
        if self._finished:
            return
        self._finished = True
        try:
            if error is None:
                self.active.builder.end_run(run_id=self.run_id, output=output)
            else:
                self.active.builder.error_run(
                    run_id=self.run_id,
                    output=output,
                    error=error,
                )
        except BaseException:
            logger.warning(
                "LangFeather could not finish a generic observation",
                exc_info=True,
            )

        if not self.owns_trace:
            return
        try:
            envelope = self.active.builder.finish(
                output=output,
                error=error,
                fallback_name=self.fallback_name,
            )
            enqueue_envelope(envelope)
        except BaseException:
            logger.warning(
                "LangFeather could not finalize a generic trace",
                exc_info=True,
            )


def _begin_operation(
    *,
    name: str,
    kind: str,
    inputs: object,
    metadata: object,
    session_id: str | None,
    force_new_trace: bool = False,
) -> _Operation | None:
    try:
        active = None if force_new_trace else get_live_active_trace()
        owns_trace = active is None
        if active is None:
            builder = TraceBuilder(
                invocation_input=inputs,
                configured_name=name,
                session_id=session_id,
            )
            active = _ActiveTrace(
                builder=builder,
                handler=LangFeatherCallbackHandler(builder),
            )

        run_id = f"generic_{uuid4()}"
        current_langchain_parent = _current_langchain_parent_run_id()
        parent_run_id = (
            None
            if owns_trace
            else _resolve_generic_parent_run_id(current_langchain_parent)
        )
        accepted = active.builder.start_run(
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name or "function",
            kind=kind or "custom",
            inputs=inputs,
            metadata=metadata,
        )
        if not accepted and not owns_trace:
            builder = TraceBuilder(
                invocation_input=inputs,
                configured_name=name,
                session_id=session_id,
            )
            active = _ActiveTrace(
                builder=builder,
                handler=LangFeatherCallbackHandler(builder),
            )
            owns_trace = True
            accepted = active.builder.start_run(
                run_id=run_id,
                parent_run_id=None,
                name=name or "function",
                kind=kind or "custom",
                inputs=inputs,
                metadata=metadata,
            )
        if not accepted:
            return None
        return _Operation(
            active=active,
            run_id=run_id,
            fallback_name=name or "function",
            owns_trace=owns_trace,
            langchain_anchor_run_id=current_langchain_parent,
        )
    except BaseException:
        logger.warning(
            "LangFeather could not start a generic observation",
            exc_info=True,
        )
        return None


def _call_input(args: tuple[object, ...], kwargs: Mapping[str, object]) -> object:
    return {"args": list(args), "kwargs": dict(kwargs)}


class Span:
    """Mutable result handle yielded by :func:`span`."""

    __slots__ = ("_output",)

    def __init__(self) -> None:
        self._output: object = _UNSET

    def set_output(self, output: object) -> None:
        self._output = output

    def _resolved_output(self) -> object:
        return None if self._output is _UNSET else self._output


@contextmanager
def span(
    name: str,
    *,
    input: object = None,
    kind: str = "custom",
    metadata: object = None,
    session_id: str | None = None,
) -> Iterator[Span]:
    """Observe an explicit block as a root trace or nested child observation."""
    operation = _begin_operation(
        name=name,
        kind=kind,
        inputs=input,
        metadata={} if metadata is None else metadata,
        session_id=session_id,
    )
    handle = Span()
    if operation is None:
        yield handle
        return

    try:
        with operation.activate():
            yield handle
    except BaseException as error:
        operation.finish(error=error)
        raise
    else:
        operation.finish(output=handle._resolved_output())


def _operation_for_call(
    function: Callable[..., object],
    *,
    args: tuple[object, ...],
    kwargs: Mapping[str, object],
    name: str | None,
    kind: str,
    metadata: object,
    session_id: str | None,
) -> _Operation | None:
    return _begin_operation(
        name=name or function.__name__,
        kind=kind,
        inputs=_call_input(args, kwargs),
        metadata=metadata,
        session_id=session_id,
    )


class _ObservedGenerator(Generator[YieldT, SendT, ReturnT]):
    def __init__(
        self,
        iterator: Generator[YieldT, SendT, ReturnT],
        operation_factory: Callable[[], _Operation | None],
    ) -> None:
        self._iterator = iterator
        self._operation_factory = operation_factory
        self._operation: _Operation | None = None
        self._started = False
        self._finished = False
        self._chunks: list[object] = []

    def __iter__(self) -> _ObservedGenerator[YieldT, SendT, ReturnT]:
        return self

    def __next__(self) -> YieldT:
        return self.send(cast(SendT, None))

    def send(self, value: SendT) -> YieldT:
        return self._advance(lambda: self._iterator.send(value))

    @overload
    def throw(
        self,
        typ: type[BaseException],
        val: object = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT: ...

    @overload
    def throw(
        self,
        typ: BaseException,
        val: None = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT: ...

    def throw(
        self,
        typ: type[BaseException] | BaseException,
        val: object = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT:
        if isinstance(typ, BaseException):
            if tb is None:
                return self._advance(lambda: self._iterator.throw(typ))
            return self._advance(lambda: self._iterator.throw(type(typ), typ, tb))
        if tb is None:
            return self._advance(lambda: self._iterator.throw(typ, val))
        return self._advance(lambda: self._iterator.throw(typ, val, tb))

    def close(self) -> None:
        if self._finished:
            return
        if not self._started:
            self._iterator.close()
            self._finished = True
            return
        operation = self._operation
        try:
            if operation is None:
                self._iterator.close()
            else:
                with operation.activate():
                    self._iterator.close()
        except BaseException as error:
            self._finish(error=error)
            raise
        else:
            self._finish(error=GeneratorExit())

    def _ensure_started(self) -> _Operation | None:
        if not self._started:
            self._started = True
            self._operation = self._operation_factory()
        return self._operation

    def _advance(self, advance: Callable[[], YieldT]) -> YieldT:
        operation = self._ensure_started()
        try:
            if operation is None:
                chunk = advance()
            else:
                with operation.activate():
                    chunk = advance()
        except StopIteration as stop:
            self._finish(output=_aggregate_chunks(self._chunks))
            raise stop
        except BaseException as error:
            self._finish(error=error)
            raise
        self._chunks.append(chunk)
        return chunk

    def _finish(
        self,
        *,
        output: object = None,
        error: BaseException | None = None,
    ) -> None:
        if self._finished:
            return
        self._finished = True
        if self._operation is not None:
            self._operation.finish(output=output, error=error)


class _ObservedAsyncGenerator(AsyncGenerator[YieldT, SendT]):
    def __init__(
        self,
        iterator: AsyncGenerator[YieldT, SendT],
        operation_factory: Callable[[], _Operation | None],
    ) -> None:
        self._iterator = iterator
        self._operation_factory = operation_factory
        self._operation: _Operation | None = None
        self._started = False
        self._finished = False
        self._chunks: list[object] = []

    def __aiter__(self) -> _ObservedAsyncGenerator[YieldT, SendT]:
        return self

    async def __anext__(self) -> YieldT:
        return await self.asend(cast(SendT, None))

    async def asend(self, value: SendT) -> YieldT:
        return await self._advance(lambda: self._iterator.asend(value))

    @overload
    async def athrow(
        self,
        typ: type[BaseException],
        val: object = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT: ...

    @overload
    async def athrow(
        self,
        typ: BaseException,
        val: None = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT: ...

    async def athrow(
        self,
        typ: type[BaseException] | BaseException,
        val: object = None,
        tb: TracebackType | None = None,
        /,
    ) -> YieldT:
        if isinstance(typ, BaseException):
            if tb is None:
                return await self._advance(lambda: self._iterator.athrow(typ))
            return await self._advance(
                lambda: self._iterator.athrow(type(typ), typ, tb)
            )
        if tb is None:
            return await self._advance(lambda: self._iterator.athrow(typ, val))
        return await self._advance(lambda: self._iterator.athrow(typ, val, tb))

    async def aclose(self) -> None:
        if self._finished:
            return
        if not self._started:
            await self._iterator.aclose()
            self._finished = True
            return
        operation = self._operation
        try:
            if operation is None:
                await self._iterator.aclose()
            else:
                with operation.activate():
                    await self._iterator.aclose()
        except BaseException as error:
            self._finish(error=error)
            raise
        else:
            self._finish(error=GeneratorExit())

    def _ensure_started(self) -> _Operation | None:
        if not self._started:
            self._started = True
            self._operation = self._operation_factory()
        return self._operation

    async def _advance(
        self,
        advance: Callable[[], Any],
    ) -> YieldT:
        operation = self._ensure_started()
        try:
            if operation is None:
                chunk = await advance()
            else:
                with operation.activate():
                    chunk = await advance()
        except StopAsyncIteration:
            self._finish(output=_aggregate_chunks(self._chunks))
            raise
        except BaseException as error:
            self._finish(error=error)
            raise
        self._chunks.append(chunk)
        return cast(YieldT, chunk)

    def _finish(
        self,
        *,
        output: object = None,
        error: BaseException | None = None,
    ) -> None:
        if self._finished:
            return
        self._finished = True
        if self._operation is not None:
            self._operation.finish(output=output, error=error)


def _decorate(
    function: Callable[P, R],
    *,
    name: str | None,
    kind: str,
    metadata: object,
    session_id: str | None,
) -> Callable[P, R]:
    if inspect.isasyncgenfunction(function):

        @wraps(function)
        async def async_generator_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
            iterator = cast(
                AsyncGenerator[Any, Any],
                function(*args, **kwargs),
            )
            observed = _ObservedAsyncGenerator(
                iterator,
                lambda: _operation_for_call(
                    function,
                    args=cast(tuple[object, ...], args),
                    kwargs=cast(Mapping[str, object], kwargs),
                    name=name,
                    kind=kind,
                    metadata=metadata,
                    session_id=session_id,
                ),
            )
            send_value: object = None
            thrown: BaseException | None = None
            try:
                while True:
                    try:
                        if thrown is None:
                            chunk = await observed.asend(send_value)
                        else:
                            chunk = await observed.athrow(thrown)
                            thrown = None
                    except StopAsyncIteration:
                        return
                    try:
                        send_value = yield chunk
                    except GeneratorExit:
                        await observed.aclose()
                        raise
                    except BaseException as error:
                        thrown = error
            finally:
                await observed.aclose()

        return cast(Callable[P, R], async_generator_wrapper)

    if inspect.isgeneratorfunction(function):

        @wraps(function)
        def generator_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
            iterator = cast(
                Generator[Any, Any, Any],
                function(*args, **kwargs),
            )
            observed = _ObservedGenerator(
                iterator,
                lambda: _operation_for_call(
                    function,
                    args=cast(tuple[object, ...], args),
                    kwargs=cast(Mapping[str, object], kwargs),
                    name=name,
                    kind=kind,
                    metadata=metadata,
                    session_id=session_id,
                ),
            )
            return (yield from observed)

        return cast(Callable[P, R], generator_wrapper)

    if inspect.iscoroutinefunction(function):

        @wraps(function)
        async def async_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
            operation = _operation_for_call(
                function,
                args=cast(tuple[object, ...], args),
                kwargs=cast(Mapping[str, object], kwargs),
                name=name,
                kind=kind,
                metadata=metadata,
                session_id=session_id,
            )
            if operation is None:
                return await function(*args, **kwargs)
            try:
                with operation.activate():
                    result = await function(*args, **kwargs)
            except BaseException as error:
                operation.finish(error=error)
                raise
            operation.finish(output=result)
            return result

        return cast(Callable[P, R], async_wrapper)

    @wraps(function)
    def sync_wrapper(*args: P.args, **kwargs: P.kwargs) -> Any:
        operation = _operation_for_call(
            function,
            args=cast(tuple[object, ...], args),
            kwargs=cast(Mapping[str, object], kwargs),
            name=name,
            kind=kind,
            metadata=metadata,
            session_id=session_id,
        )
        if operation is None:
            return function(*args, **kwargs)
        try:
            with operation.activate():
                result = function(*args, **kwargs)
        except BaseException as error:
            operation.finish(error=error)
            raise
        operation.finish(output=result)
        return result

    return cast(Callable[P, R], sync_wrapper)


@overload
def observe(function: Callable[P, R], /) -> Callable[P, R]: ...


@overload
def observe(
    function: None = None,
    /,
    *,
    name: str | None = None,
    kind: str = "function",
    metadata: object = None,
    session_id: str | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def observe(
    function: Callable[P, R] | None = None,
    /,
    *,
    name: str | None = None,
    kind: str = "function",
    metadata: object = None,
    session_id: str | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]:
    """Observe a sync, async, generator, or async-generator function."""

    def decorator(target: Callable[P, R]) -> Callable[P, R]:
        return _decorate(
            target,
            name=name,
            kind=kind,
            metadata={} if metadata is None else metadata,
            session_id=session_id,
        )

    if function is None:
        return decorator
    return decorator(function)

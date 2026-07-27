from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Coroutine
from functools import wraps
from typing import Any

from ._observe import _begin_operation

logger = logging.getLogger("langfeather")

ASGIScope = dict[str, Any]
ASGIMessage = dict[str, Any]
ASGIReceive = Callable[[], Awaitable[ASGIMessage]]
ASGISend = Callable[[ASGIMessage], Awaitable[None]]
ASGIApp = Callable[
    [ASGIScope, ASGIReceive, ASGISend],
    Coroutine[Any, Any, None],
]

_HTTP_SCOPE_KEYS = (
    "type",
    "asgi",
    "http_version",
    "scheme",
    "method",
    "root_path",
    "path",
    "raw_path",
    "query_string",
    "client",
    "server",
)


def _request_input(scope: ASGIScope) -> dict[str, object]:
    return {key: scope[key] for key in _HTTP_SCOPE_KEYS if key in scope}


def wrap_asgi(app: ASGIApp, *, name: str | None = None) -> ASGIApp:
    """Wrap HTTP ASGI requests while passing non-HTTP scopes through unchanged."""

    @wraps(app)
    async def wrapped(
        scope: ASGIScope,
        receive: ASGIReceive,
        send: ASGISend,
    ) -> None:
        try:
            scope_type = scope.get("type")
        except BaseException:
            logger.warning(
                "LangFeather could not inspect an ASGI scope",
                exc_info=True,
            )
            await app(scope, receive, send)
            return
        if scope_type != "http":
            await app(scope, receive, send)
            return

        try:
            method = scope.get("method")
            path = scope.get("path")
            request_input = _request_input(scope)
        except BaseException:
            logger.warning(
                "LangFeather could not capture ASGI request diagnostics",
                exc_info=True,
            )
            method = None
            path = None
            request_input = {}
        operation_name = name or (
            f"{method if isinstance(method, str) else 'HTTP'} "
            f"{path if isinstance(path, str) else '/'}"
        )
        operation = _begin_operation(
            name=operation_name,
            kind="http",
            inputs=request_input,
            metadata={},
            session_id=None,
            force_new_trace=True,
        )
        if operation is None:
            await app(scope, receive, send)
            return

        disconnected = False
        status_code: int | None = None
        body_chunks: list[bytes] = []

        async def observed_receive() -> ASGIMessage:
            nonlocal disconnected
            message = await receive()
            try:
                if message.get("type") == "http.disconnect":
                    disconnected = True
            except BaseException:
                logger.warning(
                    "LangFeather could not inspect an ASGI receive message",
                    exc_info=True,
                )
            return message

        async def observed_send(message: ASGIMessage) -> None:
            nonlocal status_code
            try:
                message_type = message.get("type")
                if message_type == "http.response.start":
                    status = message.get("status")
                    if isinstance(status, int) and not isinstance(status, bool):
                        status_code = status
                elif message_type == "http.response.body":
                    body = message.get("body", b"")
                    if isinstance(body, bytes):
                        body_chunks.append(body)
                    elif isinstance(body, bytearray):
                        body_chunks.append(bytes(body))
            except BaseException:
                logger.warning(
                    "LangFeather could not inspect an ASGI send message",
                    exc_info=True,
                )
            await send(message)

        def response_output() -> dict[str, object]:
            return {
                "status_code": status_code,
                "body": b"".join(body_chunks),
            }

        try:
            with operation.activate():
                await app(scope, observed_receive, observed_send)
        except BaseException as error:
            terminal_error: BaseException = error
            if disconnected:
                terminal_error = asyncio.CancelledError("ASGI client disconnected")
            operation.finish(output=response_output(), error=terminal_error)
            raise
        if disconnected:
            operation.finish(
                output=response_output(),
                error=asyncio.CancelledError("ASGI client disconnected"),
            )
        else:
            operation.finish(output=response_output())

    return wrapped

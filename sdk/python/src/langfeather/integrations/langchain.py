from __future__ import annotations

import importlib
import logging
from collections.abc import Callable, Mapping
from typing import Any

from .._builder import TraceBuilder
from .._context import _resolve_callback_parent_run_id

logger = logging.getLogger("langfeather")
_JS_SAFE_INTEGER = (1 << 53) - 1


def _mapping(value: object) -> Mapping[object, object] | None:
    return value if isinstance(value, Mapping) else None


def _attribute(value: object, name: str) -> object:
    if isinstance(value, Mapping):
        return value.get(name)
    return getattr(value, name, None)


def _first_mapping(*values: object) -> Mapping[object, object] | None:
    for value in values:
        mapping = _mapping(value)
        if mapping is not None:
            return mapping
    return None


def _string_from(
    mappings: tuple[Mapping[object, object] | None, ...],
    *keys: str,
) -> str | None:
    for mapping in mappings:
        if mapping is None:
            continue
        for key in keys:
            value = mapping.get(key)
            if isinstance(value, str) and value:
                return value
    return None


def _token_from(
    raw: Mapping[object, object],
    *keys: str,
) -> int | None:
    for key in keys:
        value = raw.get(key)
        if (
            isinstance(value, int)
            and not isinstance(value, bool)
            and 0 <= value <= _JS_SAFE_INTEGER
        ):
            return value
    return None


def _first_generation_metadata(
    response: object,
) -> tuple[Mapping[object, object] | None, Mapping[object, object] | None]:
    generations = _attribute(response, "generations")
    if not isinstance(generations, (list, tuple)) or not generations:
        return None, None
    first_group = generations[0]
    if not isinstance(first_group, (list, tuple)) or not first_group:
        return None, None
    generation = first_group[0]
    message = _attribute(generation, "message")
    source = message if message is not None else generation
    return (
        _mapping(_attribute(source, "response_metadata")),
        _mapping(_attribute(source, "usage_metadata")),
    )


def _llm_result_details(
    response: object,
) -> tuple[str | None, dict[str, object] | None]:
    """Extract only provider-returned model and token metadata.

    LangChain integrations expose this data through a few response shapes. This
    adapter intentionally copies observed counts and never derives missing ones.
    """
    try:
        llm_output = _mapping(_attribute(response, "llm_output"))
        response_metadata, usage_metadata = _first_generation_metadata(response)
        model = _string_from(
            (response_metadata, llm_output),
            "model_name",
            "model",
            "model_id",
        )
        raw_usage = _first_mapping(
            usage_metadata,
            None if response_metadata is None else response_metadata.get("usage"),
            (
                None
                if response_metadata is None
                else response_metadata.get("token_usage")
            ),
            None if llm_output is None else llm_output.get("usage"),
            None if llm_output is None else llm_output.get("token_usage"),
            None if llm_output is None else llm_output.get("usage_metadata"),
        )
        if raw_usage is None:
            return model, None
        usage: dict[str, object] = {
            "input_tokens": _token_from(
                raw_usage,
                "input_tokens",
                "prompt_tokens",
                "prompt_token_count",
            ),
            "output_tokens": _token_from(
                raw_usage,
                "output_tokens",
                "completion_tokens",
                "candidates_token_count",
            ),
            "total_tokens": _token_from(
                raw_usage,
                "total_tokens",
                "total_token_count",
            ),
            "provider": _string_from(
                (response_metadata, llm_output, raw_usage),
                "provider",
                "model_provider",
                "provider_name",
            ),
            "raw": dict(raw_usage),
        }
        return model, usage
    except BaseException:
        logger.warning(
            "LangFeather could not extract provider LLM metadata",
            exc_info=True,
        )
        return None, None


def _chain_kind(
    serialized: object,
    explicit_name: object,
    run_type: object,
) -> str:
    evidence: list[str] = []
    if isinstance(explicit_name, str):
        evidence.append(explicit_name)
    if isinstance(run_type, str):
        evidence.append(run_type)
    if isinstance(serialized, Mapping):
        serialized_name = serialized.get("name")
        if isinstance(serialized_name, str):
            evidence.append(serialized_name)
        identifier = serialized.get("id")
        if isinstance(identifier, (list, tuple)):
            evidence.extend(item for item in identifier if isinstance(item, str))
    return "runnable" if "RunnableLambda" in evidence else "chain"


def _run_name(serialized: object, explicit_name: object, fallback: str) -> str:
    if isinstance(explicit_name, str) and explicit_name:
        return explicit_name
    if isinstance(serialized, Mapping):
        serialized_name = serialized.get("name")
        if isinstance(serialized_name, str) and serialized_name:
            return serialized_name
        identifier = serialized.get("id")
        if isinstance(identifier, list) and identifier:
            candidate = identifier[-1]
            if isinstance(candidate, str) and candidate:
                return candidate
    return fallback


def _metadata(
    metadata: object,
    tags: object,
    *,
    parent_run_id: object | None,
) -> dict[str, object]:
    result: dict[str, object] = dict(metadata) if isinstance(metadata, Mapping) else {}
    if isinstance(tags, (list, tuple)) and tags:
        result["langchain_tags"] = list(tags)
    if parent_run_id is not None:
        result.setdefault("langchain_parent_run_id", str(parent_run_id))
    return result


def _dispatch_evidence(outputs: object) -> list[dict[str, str | int]]:
    values = outputs if isinstance(outputs, (list, tuple)) else [outputs]
    evidence: list[dict[str, str | int]] = []
    for index, value in enumerate(values):
        target = _attribute(value, "node")
        if value.__class__.__name__ == "Send" and isinstance(target, str) and target:
            item: dict[str, str | int] = {"target": target, "index": index}
            evidence.append(item)
    return evidence


def _dispatch_key(metadata: Mapping[str, object]) -> tuple[str, int] | None:
    target = metadata.get("langgraph_node")
    path = metadata.get("langgraph_path")
    if not isinstance(target, str) or not isinstance(path, (list, tuple)):
        return None
    if len(path) < 2 or path[0] != "__pregel_push":
        return None
    index = path[1]
    return (target, index) if isinstance(index, int) and not isinstance(index, bool) else None


class LangFeatherCallbackHandler:
    """Duck-typed LangChain callback handler backed by one trace builder.

    The class deliberately does not import ``langchain_core``. LangChain accepts
    callback handler objects by protocol, which keeps ``import langfeather``
    dependency-free while the ``langchain`` package extra supplies Runnable APIs.
    """

    raise_error = False
    run_inline = False
    ignore_agent = False
    ignore_chain = False
    ignore_chat_model = False
    ignore_custom_event = False
    ignore_llm = False
    ignore_retriever = False
    ignore_retry = False

    def __init__(self, builder: TraceBuilder) -> None:
        self._builder = builder
        self._dispatch_sources: dict[tuple[str, int], str | None] = {}

    def _link_dispatch(self, metadata: dict[str, object]) -> None:
        key = _dispatch_key(metadata)
        if key is None:
            return
        source = self._dispatch_sources.get(key)
        if source is not None:
            metadata["langfeather_dispatch_source_observation_id"] = source

    def _safe(self, operation: Callable[[], None]) -> None:
        try:
            operation()
        except BaseException:
            logger.warning(
                "LangFeather callback capture failed",
                exc_info=True,
            )

    def _start(
        self,
        *,
        serialized: object,
        inputs: object,
        run_id: object,
        parent_run_id: object | None,
        name: object,
        kind: str,
        metadata: object,
        tags: object,
        fallback_name: str,
    ) -> None:
        def capture() -> None:
            effective_parent_run_id = _resolve_callback_parent_run_id(parent_run_id)
            captured_metadata = _metadata(
                metadata,
                tags,
                parent_run_id=parent_run_id,
            )
            self._link_dispatch(captured_metadata)
            self._builder.start_run(
                run_id=run_id,
                parent_run_id=effective_parent_run_id,
                name=_run_name(serialized, name, fallback_name),
                kind=kind,
                inputs=inputs,
                metadata=captured_metadata,
            )

        self._safe(capture)

    def on_chain_start(
        self,
        serialized: object,
        inputs: object,
        *,
        run_id: object,
        parent_run_id: object | None = None,
        tags: object = None,
        metadata: object = None,
        name: object = None,
        **kwargs: object,
    ) -> None:
        self._start(
            serialized=serialized,
            inputs=inputs,
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name,
            kind=_chain_kind(serialized, name, kwargs.get("run_type")),
            metadata=metadata,
            tags=tags,
            fallback_name="chain",
        )

    def on_chain_end(
        self,
        outputs: object,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        def capture() -> None:
            evidence = _dispatch_evidence(outputs)
            metadata = (
                {"langfeather_dispatches": evidence} if evidence else None
            )
            self._builder.end_run(run_id=run_id, output=outputs, metadata=metadata)
            source_id = self._builder.observation_id_for_run(run_id)
            if source_id is None:
                return
            for item in evidence:
                target = item["target"]
                index = item["index"]
                if not isinstance(target, str) or not isinstance(index, int):
                    continue
                key = (target, index)
                self._dispatch_sources[key] = (
                    source_id if key not in self._dispatch_sources else None
                )

        self._safe(capture)

    def on_chain_error(
        self,
        error: BaseException,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.error_run(run_id=run_id, error=error))

    def on_llm_start(
        self,
        serialized: object,
        prompts: object,
        *,
        run_id: object,
        parent_run_id: object | None = None,
        tags: object = None,
        metadata: object = None,
        name: object = None,
        **kwargs: object,
    ) -> None:
        self._start(
            serialized=serialized,
            inputs=prompts,
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name,
            kind="llm",
            metadata=metadata,
            tags=tags,
            fallback_name="llm",
        )

    def on_chat_model_start(
        self,
        serialized: object,
        messages: object,
        *,
        run_id: object,
        parent_run_id: object | None = None,
        tags: object = None,
        metadata: object = None,
        name: object = None,
        **kwargs: object,
    ) -> None:
        self.on_llm_start(
            serialized,
            messages,
            run_id=run_id,
            parent_run_id=parent_run_id,
            tags=tags,
            metadata=metadata,
            name=name,
            **kwargs,
        )

    def on_llm_new_token(
        self,
        token: str,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.mark_first_token(run_id=run_id))

    def on_llm_end(
        self,
        response: object,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        def capture() -> None:
            model, usage = _llm_result_details(response)
            self._builder.end_run(
                run_id=run_id,
                output=response,
                model=model,
                usage=usage,
            )

        self._safe(capture)

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.error_run(run_id=run_id, error=error))

    def on_retriever_start(
        self,
        serialized: object,
        query: object,
        *,
        run_id: object,
        parent_run_id: object | None = None,
        tags: object = None,
        metadata: object = None,
        name: object = None,
        **kwargs: object,
    ) -> None:
        self._start(
            serialized=serialized,
            inputs=query,
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name,
            kind="retriever",
            metadata=metadata,
            tags=tags,
            fallback_name="retriever",
        )

    def on_retriever_end(
        self,
        documents: object,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.end_run(run_id=run_id, output=documents))

    def on_retriever_error(
        self,
        error: BaseException,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.error_run(run_id=run_id, error=error))

    def on_tool_start(
        self,
        serialized: object,
        input_str: object,
        *,
        run_id: object,
        parent_run_id: object | None = None,
        tags: object = None,
        metadata: object = None,
        name: object = None,
        inputs: object = None,
        **kwargs: object,
    ) -> None:
        self._start(
            serialized=serialized,
            inputs=inputs if inputs is not None else input_str,
            run_id=run_id,
            parent_run_id=parent_run_id,
            name=name,
            kind="tool",
            metadata=metadata,
            tags=tags,
            fallback_name="tool",
        )

    def on_tool_end(
        self,
        output: object,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.end_run(run_id=run_id, output=output))

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: object,
        **kwargs: object,
    ) -> None:
        self._safe(lambda: self._builder.error_run(run_id=run_id, error=error))


def add_callback(config: Any, callback: LangFeatherCallbackHandler) -> Any:
    """Return Runnable config with LangFeather appended to existing callbacks."""
    if isinstance(config, Mapping):
        callbacks = config.get("callbacks")
        if _contains_callback(callbacks, callback):
            return config
    try:
        config_module = importlib.import_module("langchain_core.runnables.config")
    except ImportError:
        return _add_callback_without_langchain(config, callback)
    merge_configs = config_module.merge_configs
    return merge_configs(config, {"callbacks": [callback]})


def _contains_callback(callbacks: object, callback: object) -> bool:
    if callbacks is callback:
        return True
    if isinstance(callbacks, (list, tuple)):
        return any(existing is callback for existing in callbacks)
    try:
        handlers = getattr(callbacks, "handlers", None)
    except BaseException:
        return False
    return isinstance(handlers, (list, tuple)) and any(
        existing is callback for existing in handlers
    )


def _add_callback_without_langchain(
    config: Any,
    callback: LangFeatherCallbackHandler,
) -> dict[str, Any]:
    if config is None:
        return {"callbacks": [callback]}
    if not isinstance(config, Mapping):
        raise TypeError("Runnable config must be a mapping or None")
    merged = dict(config)
    callbacks = merged.get("callbacks")
    if callbacks is None:
        merged["callbacks"] = [callback]
    elif isinstance(callbacks, (list, tuple)):
        merged["callbacks"] = [*callbacks, callback]
    else:
        raise TypeError(
            "Non-list callback managers require the 'langchain' package extra"
        )
    return merged

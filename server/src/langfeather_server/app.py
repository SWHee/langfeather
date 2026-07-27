from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated, cast

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.background import BackgroundTask

from langfeather_server import __version__
from langfeather_server.api_models import (
    BatchIngestRequest,
    BatchIngestResponse,
    BatchItemError,
    BatchItemResult,
    FeedbackPatchRequest,
    HealthResponse,
    ObservationDetail,
    ResetRequest,
    TraceDetail,
    TraceListResponse,
)
from langfeather_server.contracts import (
    CompletedEnvelopeContract,
    FeedbackContract,
    TraceStatus,
)
from langfeather_server.database import (
    Database,
    backup_live_database,
    create_database,
    exclusive_sqlite_lock,
    sqlite_database_path,
)
from langfeather_server.migrations import current_revision, upgrade_database
from langfeather_server.repository import (
    InvalidCursorError,
    ObservationIdConflictError,
    TraceRepository,
)

DEFAULT_DATABASE_URL = "sqlite:////data/langfeather.db"
DATABASE_URL_ENV = "LANGFEATHER_DATABASE_URL"
STATIC_DIR_ENV = "LANGFEATHER_STATIC_DIR"
TRUSTED_HOSTS_ENV = "LANGFEATHER_TRUSTED_HOSTS"
DEFAULT_TRUSTED_HOSTS = ("localhost", "127.0.0.1")


def _require_json_content_type(request: Request) -> None:
    content_type = request.headers.get("content-type", "").partition(";")[0].lower()
    if content_type != "application/json":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Content-Type must be application/json",
        )


def _repository(request: Request) -> TraceRepository:
    return cast(TraceRepository, request.app.state.trace_repository)


def _database(request: Request) -> Database:
    return cast(Database, request.app.state.database)


RepositoryDependency = Annotated[TraceRepository, Depends(_repository)]
DatabaseDependency = Annotated[Database, Depends(_database)]
TraceLimit = Annotated[int, Query(ge=1, le=200)]
TraceStatusFilter = Annotated[TraceStatus | None, Query(alias="status")]
TraceFrom = Annotated[datetime | None, Query(alias="from")]
TraceTo = Annotated[datetime | None, Query(alias="to")]


def _resolve_trusted_hosts(value: Sequence[str] | None) -> list[str]:
    if value is not None:
        return list(value)
    configured = os.environ.get(TRUSTED_HOSTS_ENV)
    if configured is None:
        return list(DEFAULT_TRUSTED_HOSTS)
    hosts = [host.strip() for host in configured.split(",") if host.strip()]
    return hosts or list(DEFAULT_TRUSTED_HOSTS)


def _resolve_static_dir(value: Path | None) -> Path | None:
    candidate = value or (
        Path(configured) if (configured := os.environ.get(STATIC_DIR_ENV)) else None
    )
    if candidate is None:
        return None
    resolved = candidate.resolve()
    return resolved if (resolved / "index.html").is_file() else None


def _remove_file(path: Path) -> None:
    path.unlink(missing_ok=True)


def _candidate_trace_id(raw_item: object) -> str | None:
    if not isinstance(raw_item, dict):
        return None
    raw_trace = raw_item.get("trace")
    if not isinstance(raw_trace, dict):
        return None
    trace_id = raw_trace.get("trace_id")
    return trace_id if isinstance(trace_id, str) else None


def create_app(
    *,
    database_url: str | None = None,
    static_dir: Path | None = None,
    trusted_hosts: Sequence[str] | None = None,
) -> FastAPI:
    resolved_database_url = (
        database_url or os.environ.get(DATABASE_URL_ENV) or DEFAULT_DATABASE_URL
    )
    database = create_database(resolved_database_url)
    repository = TraceRepository(database.session_factory)
    database_path = sqlite_database_path(resolved_database_url)

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        with exclusive_sqlite_lock(database_path, blocking=False):
            upgrade_database(database.engine)
            try:
                yield
            finally:
                database.engine.dispose()

    application = FastAPI(
        title="LangFeather Server",
        version=__version__,
        lifespan=lifespan,
    )
    application.state.database = database
    application.state.trace_repository = repository
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_resolve_trusted_hosts(trusted_hosts),
    )

    @application.post(
        "/api/v1/traces/batch",
        response_model=BatchIngestResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def ingest_batch(
        request_body: BatchIngestRequest,
        store: RepositoryDependency,
    ) -> BatchIngestResponse:
        results: list[BatchItemResult] = []
        for raw_item in request_body.items:
            trace_id = _candidate_trace_id(raw_item)
            try:
                envelope = CompletedEnvelopeContract.model_validate(raw_item)
                trace_id = envelope.trace.trace_id
                item_status = store.ingest(envelope)
            except (ValidationError, ObservationIdConflictError) as error:
                results.append(
                    BatchItemResult(
                        trace_id=trace_id,
                        status="rejected",
                        error=BatchItemError(
                            code="validation_error",
                            message=str(error),
                        ),
                    )
                )
                continue
            results.append(
                BatchItemResult(
                    trace_id=trace_id,
                    status=item_status,
                )
            )
        return BatchIngestResponse(results=results)

    @application.get(
        "/api/v1/traces",
        response_model=TraceListResponse,
    )
    def list_traces(
        store: RepositoryDependency,
        limit: TraceLimit = 50,
        cursor: str | None = None,
        status_filter: TraceStatusFilter = None,
        from_time: TraceFrom = None,
        to_time: TraceTo = None,
        tag: str | None = None,
        session_id: str | None = None,
        query: str | None = None,
    ) -> TraceListResponse:
        try:
            page = store.list_traces(
                limit=limit,
                cursor=cursor,
                status=status_filter,
                from_time=from_time,
                to_time=to_time,
                tag=tag,
                session_id=session_id,
                query=query,
            )
        except InvalidCursorError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cursor is invalid",
            ) from error
        return TraceListResponse(items=page.items, next_cursor=page.next_cursor)

    @application.get(
        "/api/v1/sessions/{session_id}/traces",
        response_model=TraceListResponse,
    )
    def list_session_traces(
        session_id: str,
        store: RepositoryDependency,
        limit: TraceLimit = 50,
        cursor: str | None = None,
    ) -> TraceListResponse:
        try:
            page = store.list_traces(
                limit=limit,
                cursor=cursor,
                session_id=session_id,
            )
        except InvalidCursorError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cursor is invalid",
            ) from error
        return TraceListResponse(items=page.items, next_cursor=page.next_cursor)

    @application.get(
        "/api/v1/traces/{trace_id}",
        response_model=TraceDetail,
    )
    def get_trace(
        trace_id: str,
        store: RepositoryDependency,
    ) -> TraceDetail:
        trace = store.get_trace(trace_id)
        if trace is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trace not found",
            )
        return trace

    @application.delete(
        "/api/v1/traces/{trace_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_trace(
        trace_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_trace(trace_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trace not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/feedback",
        response_model=FeedbackContract,
        dependencies=[Depends(_require_json_content_type)],
    )
    def create_feedback(
        feedback: FeedbackContract,
        response: Response,
        store: RepositoryDependency,
    ) -> FeedbackContract:
        stored_feedback, result = store.create_feedback(feedback)
        if result == "stored":
            response.status_code = status.HTTP_201_CREATED
        return stored_feedback

    @application.patch(
        "/api/v1/feedback/{feedback_id}",
        response_model=FeedbackContract,
        dependencies=[Depends(_require_json_content_type)],
    )
    def update_feedback(
        feedback_id: str,
        patch: FeedbackPatchRequest,
        store: RepositoryDependency,
    ) -> FeedbackContract:
        feedback = store.update_feedback(feedback_id, patch)
        if feedback is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Feedback not found",
            )
        return feedback

    @application.delete(
        "/api/v1/feedback/{feedback_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_feedback(
        feedback_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_feedback(feedback_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Feedback not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/api/v1/admin/backup")
    def download_backup(
        database_state: DatabaseDependency,
    ) -> FileResponse:
        with NamedTemporaryFile(suffix=".db", delete=False) as backup_file:
            backup_path = Path(backup_file.name)
        try:
            backup_live_database(database_state.engine, backup_path)
        except Exception:
            _remove_file(backup_path)
            raise
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return FileResponse(
            backup_path,
            media_type="application/x-sqlite3",
            filename=f"langfeather-backup-{timestamp}.db",
            background=BackgroundTask(_remove_file, backup_path),
        )

    @application.post(
        "/api/v1/admin/reset",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def reset_data(
        _request: ResetRequest,
        store: RepositoryDependency,
    ) -> Response:
        store.reset()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get(
        "/api/v1/observations/{observation_id}",
        response_model=ObservationDetail,
    )
    def get_observation(
        observation_id: str,
        store: RepositoryDependency,
    ) -> ObservationDetail:
        observation = store.get_observation(observation_id)
        if observation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Observation not found",
            )
        return observation

    @application.get(
        "/api/v1/health",
        response_model=HealthResponse,
    )
    def health(
        database_state: DatabaseDependency,
    ) -> HealthResponse:
        return HealthResponse(
            status="ok",
            server_version=__version__,
            supported_schema_versions=[1],
            database_migration_version=current_revision(database_state.engine),
        )

    resolved_static_dir = _resolve_static_dir(static_dir)
    if resolved_static_dir is not None:
        assets_dir = resolved_static_dir / "assets"
        if assets_dir.is_dir():
            application.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="assets",
            )

        @application.get("/{path:path}", include_in_schema=False)
        def serve_spa(path: str) -> FileResponse:
            if path == "api" or path.startswith("api/"):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            requested = (resolved_static_dir / path).resolve()
            if requested.is_relative_to(resolved_static_dir) and requested.is_file():
                return FileResponse(requested)
            return FileResponse(resolved_static_dir / "index.html")

    return application


app = create_app()

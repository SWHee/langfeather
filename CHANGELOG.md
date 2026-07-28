# Changelog

All notable user-visible changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release numbers
follow Semantic Versioning while LangFeather remains in the `0.x` series.

## [Unreleased]

### Added

- Custom boolean, finite number, categorical single/multiple score definitions.
- Trace-level structured annotations and one shared memo per trace.
- Fixed manual annotation queues with explicit complete/edit workflow.
- Dataset and dataset example deletion from the Datasets view.

### Changed

- The top navigation now separates Traces, Annotation Queues, Scores, Datasets,
  and Local Data. Datasets opens as a searchable list; a dataset detail holds its
  examples and experiments, and example creation moved into an Add example
  dialog.
- Queue completion is explicit and independent of score coverage.
- Used score structures are immutable and archived instead of deleted.

### Removed

- The legacy generic feedback API, database table, SDK type, and fixture.

## [0.1.0] - 2026-07-27

Initial local-first release baseline. GitHub/PyPI/GHCR publication remains a
separate Phase 6 release-hardening step.

### Added

- Python SDK with `wrap_runnable()`, `@observe`, `span()`, and ASGI capture.
- LangChain/LangGraph callback capture for runtime-visible Runnable, LLM,
  retriever, and tool executions.
- FastAPI, SQLite, Alembic local collector with trace inspection, feedback,
  backup, reset, and offline restore.
- React runtime graph and lazy input/output inspector.
- Docker Compose local installation and runnable LangGraph examples.

### Fixed

- LangGraph `Send` fan-out now renders only explicitly evidenced dispatch
  edges, without inferring callback parent relationships.

### Known limitations

- Local, single-user installation only; no authentication or cloud collector.
- Trace delivery is bounded in-memory best effort.
- Raw diagnostic payloads are retained locally without automatic redaction.

[Unreleased]: https://github.com/SungjinWi99/langfeather/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SungjinWi99/langfeather/releases/tag/v0.1.0

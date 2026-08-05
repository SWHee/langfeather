UV_CACHE_DIR := $(CURDIR)/.uv-cache
UV_PYTHON_INSTALL_DIR := $(CURDIR)/.python
export UV_CACHE_DIR
export UV_PYTHON_INSTALL_DIR

.PHONY: setup lint format typecheck test test-sdk test-server test-web \
	test-integration contract contract-check build smoke check-contrast

setup:
	uv python install 3.12
	uv sync --python 3.12 --all-packages --all-groups
	npm install --prefix web

lint:
	uv run ruff check examples scripts sdk/python server tests
	npm run lint --prefix web

format:
	uv run ruff format .
	npm run format --prefix web

typecheck:
	uv run mypy -p langfeather -p langfeather_server
	uv run mypy examples sdk/python/tests server/tests tests/integration scripts
	npm run typecheck --prefix web

test: test-sdk test-server test-integration test-web

test-sdk:
	uv run pytest sdk/python/tests

test-server:
	uv run pytest server/tests

test-web:
	npm test --prefix web

test-integration:
	uv run pytest tests/integration

contract:
	uv run python server/scripts/export_contract_schema.py

contract-check: contract
	git diff --exit-code -- tests/fixtures/schema/v1.json

build:
	uv build --package langfeather
	uv build --package langfeather-server
	npm run build --prefix web

smoke:
	uv run python scripts/smoke_imports.py
	npm run build --prefix web

check-contrast:
	uv run python scripts/check_contrast.py

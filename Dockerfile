FROM node:24-bookworm-slim AS web-build

WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim AS server-build

WORKDIR /build
COPY server/ ./server/
RUN python -m pip wheel --no-cache-dir --wheel-dir /wheels ./server

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANGFEATHER_DATABASE_URL=sqlite:////data/langfeather.db \
    LANGFEATHER_STATIC_DIR=/app/static

WORKDIR /app
COPY --from=server-build /wheels /wheels
RUN python -m pip install --no-cache-dir /wheels/*.whl \
    && rm -rf /wheels
COPY --from=web-build /build/web/dist /app/static

EXPOSE 4319

CMD ["uvicorn", "langfeather_server.app:app", "--host", "0.0.0.0", "--port", "4319", "--workers", "1"]

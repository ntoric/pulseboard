# ---- Frontend ----
FROM node:24-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Backend ----
FROM golang:1.25-bookworm AS backend
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
  && rm -rf /var/lib/apt/lists/*

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
COPY --from=frontend /src/dist ./frontend/dist

ENV CGO_ENABLED=1
RUN go build -ldflags="-s -w" -o /out/server ./cmd/server

# ---- Runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin appuser

WORKDIR /app
COPY --from=backend /out/server /app/server
COPY --from=backend /src/frontend/dist /app/static

RUN mkdir -p /app/data && chown -R appuser:appuser /app

USER appuser
ENV PORT=8080 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/static

EXPOSE 8080
VOLUME ["/app/data"]

CMD ["/app/server"]

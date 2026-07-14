#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

case "${1:-}" in
  backend)
    cd "$ROOT/backend"
    exec go run ./cmd/server
    ;;
  frontend)
    cd "$ROOT/frontend"
    exec npm run dev
    ;;
  build)
    cd "$ROOT/frontend" && npm run build
    cd "$ROOT/backend" && CGO_ENABLED=1 go build -o bin/server ./cmd/server
    echo "Built frontend/dist and backend/bin/server"
    ;;
  start)
    cd "$ROOT/frontend" && npm run build
    cd "$ROOT/backend"
    STATIC_DIR=../frontend/dist exec ./bin/server 2>/dev/null || STATIC_DIR=../frontend/dist exec go run ./cmd/server
    ;;
  *)
    echo "Usage: $0 {backend|frontend|build|start}"
    exit 1
    ;;
esac

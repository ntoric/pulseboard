#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"

# Bind mounts are often root-owned; fix ownership when started as root.
if [ "$(id -u)" = "0" ]; then
  chown -R appuser:appuser "$DATA_DIR"
  exec gosu appuser /app/server "$@"
fi

exec /app/server "$@"

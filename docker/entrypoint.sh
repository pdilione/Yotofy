#!/bin/sh
set -eu

mkdir -p /data /music

# Start FastAPI backend (backend/sync.py) on port 8000
uvicorn backend.sync:app \
  --host 0.0.0.0 \
  --port "${API_PORT:-8000}" \
  --workers 1 \
  --proxy-headers &
API_PID=$!

# Start Nginx serving Vite/React UI on port 3000
nginx -g "daemon off;" &
UI_PID=$!

cleanup() {
  echo "Shutting down Yotofy stack..."
  kill -TERM "$API_PID" "$UI_PID" 2>/dev/null || true
  wait "$API_PID" "$UI_PID" 2>/dev/null || true
}

trap cleanup INT TERM

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$UI_PID" 2>/dev/null; do
  sleep 1
done

cleanup
exit 1

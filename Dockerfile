# =============================================================================
# Stage 1: Build the Vite / React Frontend
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=optional && \
    ([ -d node_modules/@rollup/rollup-linux-x64-musl ] || npm install --no-save @rollup/rollup-linux-x64-musl)


COPY . .

RUN npm run build


# =============================================================================
# Stage 2: Production Full-Stack FastAPI Server (serves /api/* and dist/ at /)
# =============================================================================
FROM python:3.12-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-builder /app/dist ./dist

RUN mkdir -p /data /music && ln -sfn /data /app/data

VOLUME ["/data", "/music"]

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    API_PORT=8000 \
    AUDIO_DIR=/music \
    DATA_DIR=/data \
    STATE_FILE_PATH=/data/state.json \
    SPOTIFY_TOKEN_PATH=/data/spotify_token.json \
    YOTO_TOKEN_PATH=/data/yoto_token.json \
    ZOTIFY_CREDENTIALS_PATH=/data/credentials.json \
    FRONTEND_DIST_DIR=/app/dist

EXPOSE 8000

CMD ["uvicorn", "backend.sync:app", "--host", "0.0.0.0", "--port", "8000"]

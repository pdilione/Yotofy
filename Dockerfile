# =============================================================================
# Stage 1: Build the Vite / React Frontend
# =============================================================================
FROM node:22-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY index.html index.tsx App.tsx types.ts tsconfig.json vite.config.ts metadata.json ./
COPY components ./components
COPY services ./services

RUN npm run build

# =============================================================================
# Stage 2: Production FastAPI Backend (8000) + Nginx React UI (3000)
# =============================================================================
FROM python:3.11-slim AS runtime

# Install system dependencies:
# - ffmpeg: required by Zotify for 320kbps MP3 conversion
# - git: required for pip installing librespot-python / zotify from git
# - nginx: serves compiled Vite/React SPA on port 3000 & proxies /api/ to :8000
# - curl: used for container healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    nginx \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy Python backend, built Vite/React assets, and container configs
COPY backend ./backend
COPY --from=frontend-builder /app/dist ./dist
COPY docker/nginx.conf /etc/nginx/conf.d/yotofy.conf
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Persistent directories for SQLite sync cache/credentials (/data) and MP3s (/music)
RUN mkdir -p /data /music

VOLUME ["/data", "/music"]

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UI_PORT=3000 \
    API_PORT=8000 \
    AUDIO_DIR=/music \
    DATA_DIR=/data \
    CACHE_DB_PATH=/data/sync_cache.db \
    CACHE_JSON_PATH=/data/sync_cache.json \
    ZOTIFY_CREDENTIALS_PATH=/data/credentials.json \
    FRONTEND_DIST_DIR=/app/dist

# Expose 3000 for React UI and 8000 for FastAPI backend API
EXPOSE 3000 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -sf http://127.0.0.1:8000/api/health && curl -sf http://127.0.0.1:3000/ > /dev/null || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]

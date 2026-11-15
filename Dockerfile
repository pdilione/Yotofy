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
    git \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

RUN mkdir -p /app/data /music && \
    pip install --no-cache-dir music-tag pkce pwinput tabulate ffmpy tqdm pillow requests "git+https://github.com/kokarare1212/librespot-python" && \
    pip install --no-cache-dir --no-deps "https://github.com/zotify-dev/zotify/archive/refs/heads/v1.0-dev.zip" && \
    python -c 'p="/usr/local/lib/python3.12/site-packages/zotify/playable.py"; s=open(p).read(); open(p,"w").write("from librespot.audio import LoadedStream\n" + s.replace("PlayableContentFeeder.LoadedStream", "LoadedStream"))' && \
    ln -sfn /app/data /data

COPY backend ./backend
COPY --from=frontend-builder /app/dist ./dist

VOLUME ["/app/data", "/music"]

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    API_PORT=8000 \
    AUDIO_DIR=/music \
    DATA_DIR=/app/data \
    STATE_FILE_PATH=/app/data/state.json \
    SPOTIFY_TOKEN_PATH=/app/data/spotify_token.json \
    YOTO_TOKEN_PATH=/app/data/yoto_token.json \
    ZOTIFY_CREDENTIALS_PATH=/app/data/credentials.json \
    FRONTEND_DIST_DIR=/app/dist

EXPOSE 8000

CMD ["uvicorn", "backend.sync:app", "--host", "0.0.0.0", "--port", "8000"]


# ClipForge Studio — free-tier (Render) Docker image
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p data/auth data/studio/uploads data/studio/outputs data/studio/work \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV TRUST_PROXY=1
ENV COOKIE_SECURE=1
ENV AUTH_REQUIRED=true
ENV EMAIL_DEV_LINKS=false

# Prefer system ffmpeg (linux) over windows binary from npm if present
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

USER node
EXPOSE 10000

# Simple health: process must listen (Render also hits /api/health)
CMD ["node", "server.js"]

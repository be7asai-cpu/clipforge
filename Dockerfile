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
# Whole scripts dir (pc-agent.js required for /api/studio/pc-agent-bundle.zip)
COPY scripts ./scripts
# Real-ESRGAN Windows binaries — only packed into PC-agent ZIP (not run in Linux container)
COPY tools/realesrgan/realesrgan-ncnn-vulkan.exe tools/realesrgan/
COPY tools/realesrgan/vcomp140.dll tools/realesrgan/
COPY tools/realesrgan/vcomp140d.dll tools/realesrgan/
COPY tools/realesrgan/models/realesr-animevideov3-x2.bin tools/realesrgan/models/
COPY tools/realesrgan/models/realesr-animevideov3-x2.param tools/realesrgan/models/
COPY tools/realesrgan/models/realesr-animevideov3-x3.bin tools/realesrgan/models/
COPY tools/realesrgan/models/realesr-animevideov3-x3.param tools/realesrgan/models/
COPY tools/realesrgan/models/realesr-animevideov3-x4.bin tools/realesrgan/models/
COPY tools/realesrgan/models/realesr-animevideov3-x4.param tools/realesrgan/models/
COPY tools/realesrgan/models/realesrgan-x4plus.bin tools/realesrgan/models/
COPY tools/realesrgan/models/realesrgan-x4plus.param tools/realesrgan/models/
COPY tools/realesrgan/models/realesrgan-x4plus-anime.bin tools/realesrgan/models/
COPY tools/realesrgan/models/realesrgan-x4plus-anime.param tools/realesrgan/models/

RUN mkdir -p data/auth data/studio/uploads data/studio/outputs data/studio/work \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000
ENV TRUST_PROXY=1
ENV COOKIE_SECURE=1
ENV AUTH_REQUIRED=true
# Show activation link in UI when SMTP is missing/fails (safe for private apps)
ENV EMAIL_DEV_LINKS=true

# Prefer system ffmpeg (linux) over windows binary from npm if present
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

USER node
EXPOSE 10000

# Simple health: process must listen (Render also hits /api/health)
CMD ["node", "server.js"]

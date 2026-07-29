# ClipForge Studio — free-tier friendly image (Render / Fly / Railway)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

# speech_recognition for Google free STT (optional; pipeline degrades gracefully)
RUN pip3 install --break-system-packages --no-cache-dir SpeechRecognition 2>/dev/null \
  || pip3 install --no-cache-dir SpeechRecognition 2>/dev/null \
  || true

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
# Empty runtime dirs (uploads/outputs created at boot)
RUN mkdir -p data/auth data/studio/uploads data/studio/outputs data/studio/work

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3847
ENV TRUST_PROXY=1
ENV COOKIE_SECURE=1
ENV AUTH_REQUIRED=true
ENV EMAIL_DEV_LINKS=false

# ffmpeg-static may not match linux arch in all cases — prefer system ffmpeg
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3847)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

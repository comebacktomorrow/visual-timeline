# The Visual Timeline backend, self-hosted: the reference worker
# (worker/src/index.js, unchanged) on workerd, Cloudflare's open-source
# Workers runtime, through wrangler's local mode. Frames are stored on the
# /data volume; tokens and settings come from the env file mounted at
# /config/vt.env. Build from the repository root (selfhost/docker-compose.yml
# does this).
FROM node:24-slim

WORKDIR /app/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --no-audit --no-fund

# Only what the worker serves: its code and config, and the web pages it
# serves as static assets (wrangler.jsonc points at ../web). The worker's
# .dev.vars (throwaway local-dev tokens) is deliberately not copied.
COPY worker/src ./src
COPY worker/wrangler.jsonc ./
COPY web /app/web

ENV WRANGLER_SEND_METRICS=false
EXPOSE 8787
CMD ["npx", "wrangler", "dev", \
     "--ip", "0.0.0.0", "--port", "8787", \
     "--persist-to", "/data", \
     "--env-file", "/config/vt.env", \
     "--show-interactive-dev-session=false"]

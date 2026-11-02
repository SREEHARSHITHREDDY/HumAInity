# ─── Build ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app

# Dependencies first, so a source change does not reinstall node_modules.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm -w @humainity/web run build

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Python for the CP-SAT solver. Without it the API still runs, using the
# built-in TypeScript engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv python3-pip curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY package.json ./
COPY apps/api ./apps/api
COPY scripts ./scripts
COPY services ./services

RUN python3 -m venv services/scheduler/.venv \
 && services/scheduler/.venv/bin/pip install --no-cache-dir -r services/scheduler/requirements.txt

# Writable location for the two databases.
RUN mkdir -p /data && chown -R node:node /data /app
ENV HR_DATABASE_URL=/data/hr.db
ENV HEALTH_DATABASE_URL=/data/health.db

USER node
EXPOSE 4000 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/ready || exit 1

COPY --chown=node:node docker-entrypoint.sh /app/
ENTRYPOINT ["/app/docker-entrypoint.sh"]

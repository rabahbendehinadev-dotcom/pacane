# ============================================================
# Stage 1 — Build
# ============================================================
FROM node:24-slim AS builder

RUN npm install -g pnpm@10

WORKDIR /app

# ── Copy workspace manifests for layer caching ──
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY lib/db/package.json                     lib/db/
COPY lib/api-spec/package.json               lib/api-spec/
COPY lib/api-client-react/package.json       lib/api-client-react/
COPY lib/api-zod/package.json                lib/api-zod/
COPY lib/object-storage-web/package.json     lib/object-storage-web/
COPY artifacts/api-server/package.json       artifacts/api-server/
COPY artifacts/erp/package.json              artifacts/erp/

RUN printf 'shamefully-hoist=true\nauto-install-peers=false\nstrict-peer-dependencies=false\n' > .npmrc
RUN pnpm install --no-frozen-lockfile

# ── Copy all source ──
COPY . .

# Rebuild lib declarations
RUN npx tsc --build lib/db/tsconfig.json     2>/dev/null || true
RUN pnpm --filter @workspace/api-zod run build 2>/dev/null || true

# ── Build ERP frontend ──
ENV BASE_PATH=/
ENV NODE_ENV=production
RUN pnpm --filter @workspace/erp run build

# ── Build API server bundle ──
RUN pnpm --filter @workspace/api-server run build

# ── Collect output ──
RUN mkdir -p /out/frontend && cp -r artifacts/erp/dist/public/. /out/frontend/
RUN mkdir -p /out/server   && cp -r artifacts/api-server/dist/. /out/server/

# ============================================================
# Stage 2 — Production image
# ============================================================
FROM node:24-slim AS production

RUN npm install -g pnpm@10

WORKDIR /app

# Re-install only production runtime deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY lib/db/package.json                     lib/db/
COPY lib/api-spec/package.json               lib/api-spec/
COPY lib/api-client-react/package.json       lib/api-client-react/
COPY lib/api-zod/package.json                lib/api-zod/
COPY lib/object-storage-web/package.json     lib/object-storage-web/
COPY artifacts/api-server/package.json       artifacts/api-server/

RUN printf 'shamefully-hoist=true\nauto-install-peers=false\nstrict-peer-dependencies=false\n' > .npmrc
RUN pnpm install --no-frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /out/server     ./dist/
COPY --from=builder /out/frontend   ./frontend-dist/

# Copy startup scripts
COPY scripts/docker-start.sh ./start.sh
COPY scripts/prod-seed.mjs   ./scripts/prod-seed.mjs
RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=8080
ENV FRONTEND_DIST=/app/frontend-dist

EXPOSE 8080

CMD ["/app/start.sh"]

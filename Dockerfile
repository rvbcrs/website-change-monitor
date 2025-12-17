# Build stage
FROM node:20-bookworm AS builder
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Copy root configurations
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package configs keeping directory structure
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/client/package.json ./apps/web/client/
COPY apps/web/server/package.json ./apps/web/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/web/client ./apps/web/client
COPY apps/web/server ./apps/web/server

# Build shared package first
RUN pnpm --filter @deltawatch/shared build

# Build client
RUN pnpm --filter @deltawatch/web-client build

# Build server
RUN pnpm --filter @deltawatch/web-server build

# Production dependencies stage
# This stage installs dependencies that might require native build tools (python/make/g++)
# We discard this stage after copying node_modules, saving space
FROM node:20-bookworm-slim AS prod-deps
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# Install build tools needed for sqlite3/bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/client/package.json ./apps/web/client/
COPY apps/web/server/package.json ./apps/web/server/

# Install production dependencies
RUN pnpm install --prod --frozen-lockfile


# Final Runner Stage
FROM node:20-bookworm-slim AS runner
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# Install ONLY runtime dependencies for Playwright (Chromium)
# We do NOT install python/make/g++ here to save space
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && npx playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy production node_modules from prod-deps stage
COPY --from=prod-deps /app/node_modules ./node_modules
# Also copy nested node_modules from server package (where playwright likely resides)
COPY --from=prod-deps /app/apps/web/server/node_modules ./apps/web/server/node_modules

# Copy built artifacts from builder
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
# Copy server dist (includes openapi.json)
COPY --from=builder /app/apps/web/server/dist ./apps/web/server/dist
# Copy client build
COPY --from=builder /app/apps/web/client/dist ./apps/web/server/client/dist
# Copy server public assets
COPY apps/web/server/public ./apps/web/server/public

# Copy package.jsons (sometimes needed for runtime resolution)
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/client/package.json ./apps/web/client/
COPY apps/web/server/package.json ./apps/web/server/

# Install Chrome browser binary
# We use pnpm exec which knows how to find the binary in the workspace
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd apps/web/server && pnpm exec playwright install chromium

# Define data directory
ENV DATA_DIR=/app/apps/web/server/data
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "apps/web/server/dist/index.js"]

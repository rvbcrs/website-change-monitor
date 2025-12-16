# Build stage
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install
RUN cd server && npm install
RUN cd client && npm install
COPY . .
RUN cd client && npm run build
# Build TypeScript server
RUN cd server && npm run build
# Remove dev dependencies from server
RUN cd server && npm prune --production

# Production stage
FROM node:20-bookworm-slim
WORKDIR /app

# Install system dependencies for Playwright (Chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && npx playwright install-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Copy production artifacts (compiled JS and dependencies)
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/server/node_modules /app/server/node_modules
COPY --from=builder /app/server/package.json /app/server/package.json
COPY --from=builder /app/server/public /app/server/public
COPY --from=builder /app/client/dist /app/server/client/dist
COPY --from=builder /app/package.json /app/package.json

# Install Chrome browser binary
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

ENV DATA_DIR=/app/server/data
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/dist/index.js"]

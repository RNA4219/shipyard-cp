# shipyard-cp Dockerfile
FROM node:24-alpine AS builder

# Native build dependencies are required only while compiling better-sqlite3.
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy package files for root and workspaces
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./
COPY packages/memx-resolver-js/package.json ./packages/memx-resolver-js/
COPY packages/tracker-bridge-js/package.json ./packages/tracker-bridge-js/
COPY packages/agent-taskstate-js/package.json ./packages/agent-taskstate-js/
COPY packages/shared-redis-utils/package.json ./packages/shared-redis-utils/
COPY web/package.json ./web/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code for workspaces and main app
COPY packages/memx-resolver-js/ ./packages/memx-resolver-js/
COPY packages/tracker-bridge-js/ ./packages/tracker-bridge-js/
COPY packages/agent-taskstate-js/ ./packages/agent-taskstate-js/
COPY packages/shared-redis-utils/ ./packages/shared-redis-utils/
COPY src/ ./src/
COPY docs/ ./docs/

# Build
RUN pnpm run build:backend && pnpm prune --prod

# Production image
FROM node:24-alpine

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy built files, dependencies, and docs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/docs ./docs

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/healthz || exit 1

RUN chmod +x /app/dist/cli.js \
  && ln -s /app/dist/cli.js /usr/local/bin/shipyard \
  && chown -R node:node /app
USER node

# Start server
CMD ["node", "dist/server.js"]
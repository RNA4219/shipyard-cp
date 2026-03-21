# shipyard-cp Dockerfile
FROM node:22-alpine AS builder

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
RUN pnpm run build

# Production image
FROM node:22-alpine

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy built files, dependencies, and docs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/docs ./docs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start server
CMD ["node", "dist/server.js"]
# shipyard-cp Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for root and workspaces
COPY package*.json ./
COPY tsconfig.json ./
COPY packages/memx-resolver-js/package*.json ./packages/memx-resolver-js/
COPY packages/tracker-bridge-js/package*.json ./packages/tracker-bridge-js/
COPY packages/agent-taskstate-js/package*.json ./packages/agent-taskstate-js/

# Install dependencies
RUN npm ci

# Copy source code for workspaces and main app
COPY packages/memx-resolver-js/ ./packages/memx-resolver-js/
COPY packages/tracker-bridge-js/ ./packages/tracker-bridge-js/
COPY packages/agent-taskstate-js/ ./packages/agent-taskstate-js/
COPY src/ ./src/
COPY docs/ ./docs/

# Build
RUN npm run build

# Production image
FROM node:20-alpine

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
# Backend Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and workspace packages
COPY package*.json ./
COPY packages ./packages

# Install dependencies (npm install supports workspaces)
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY --from=builder /app/package*.json ./

# Copy node_modules with workspace symlinks
COPY --from=builder /app/node_modules ./node_modules

# Copy workspace packages (built)
COPY --from=builder /app/packages ./packages

# Copy built files
COPY --from=builder /app/dist ./dist

# Copy docs for OpenAPI spec
COPY --from=builder /app/docs ./docs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start the server
CMD ["node", "dist/server.js"]
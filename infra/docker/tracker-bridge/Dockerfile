# tracker-bridge Mock Server Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy mock server files
COPY docker/tracker-bridge/package*.json ./
COPY docker/tracker-bridge/server.js ./

# Install dependencies
RUN npm ci --only=production

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8081

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8081/health || exit 1

# Start server
CMD ["node", "server.js"]
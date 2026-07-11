# Frontend Dockerfile
FROM node:24-alpine AS builder

# Native build dependencies are required only while compiling better-sqlite3.
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install from the root workspace lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/memx-resolver-js/package.json ./packages/memx-resolver-js/
COPY packages/tracker-bridge-js/package.json ./packages/tracker-bridge-js/
COPY packages/agent-taskstate-js/package.json ./packages/agent-taskstate-js/
COPY packages/shared-redis-utils/package.json ./packages/shared-redis-utils/
COPY web/package.json ./web/package.json
RUN pnpm install --frozen-lockfile

COPY web/ ./web/
RUN pnpm --dir web run build

FROM nginx:alpine
COPY --from=builder /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
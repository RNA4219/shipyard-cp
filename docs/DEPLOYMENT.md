# Shipyard Control Plane - Deployment Guide

## Overview

This guide covers deployment options for Shipyard Control Plane, from development to production environments.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for containerized deployment)
- Redis 7+ (for persistence)
- API keys for external services (GitHub, OpenAI, Anthropic, etc.)

## Quick Start (Docker)

```bash
# Clone and configure
git clone https://github.com/RNA4219/shipyard-cp.git
cd shipyard-cp

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
# - GITHUB_TOKEN
# - OPENAI_API_KEY
# - ANTHROPIC_API_KEY
# - GOOGLE_API_KEY

# Start all services
cd docker
docker-compose up -d

# Check health
curl http://localhost:3000/health
```

## Production Deployment

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required for production
NODE_ENV=production
REDIS_URL=redis://your-redis-host:6379
REDIS_KEY_PREFIX=shipyard-cp-prod:

# External services (use production URLs)
MEMX_RESOLVER_URL=https://resolver.your-domain.com
TRACKER_BRIDGE_URL=https://tracker.your-domain.com

# Authentication (implement before production)
API_KEY=your-secure-api-key
ADMIN_API_KEY=your-admin-api-key

# Worker API keys
GITHUB_TOKEN=ghp_xxx
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
GOOGLE_API_KEY=xxx
```

### 2. Redis Setup

#### Option A: Managed Redis (Recommended)

Use a managed Redis service:
- AWS ElastiCache
- Google Cloud Memorystore
- Azure Cache for Redis
- Upstash

```bash
REDIS_URL=redis://:password@your-redis-host:6379
```

#### Option B: Self-hosted Redis

```bash
# Using Docker
docker run -d \
  --name redis \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine \
  redis-server --appendonly yes --maxmemory 512mb
```

### 3. Control Plane Deployment

#### Option A: Docker Compose

```bash
cd docker
docker-compose -f docker-compose.yml up -d
```

#### Option B: Kubernetes

```yaml
# kubernetes/deployment.yaml (example)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipyard-cp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shipyard-cp
  template:
    metadata:
      labels:
        app: shipyard-cp
    spec:
      containers:
      - name: shipyard-cp
        image: shipyard-cp:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: shipyard-cp-config
        - secretRef:
            name: shipyard-cp-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

#### Option C: Cloud Run / Fargate

```bash
# Build and push image
docker build -t shipyard-cp:latest -f docker/shipyard-cp/Dockerfile .
docker tag shipyard-cp:latest gcr.io/your-project/shipyard-cp:latest
docker push gcr.io/your-project/shipyard-cp:latest

# Deploy to Cloud Run
gcloud run deploy shipyard-cp \
  --image gcr.io/your-project/shipyard-cp:latest \
  --set-env-vars NODE_ENV=production \
  --set-secrets REDIS_URL=redis-url:latest
```

### 4. External Services Setup

#### memx-resolver

Production deployment for document resolution:

```bash
# Deploy memx-resolver (example)
cd memx-resolver
docker-compose -f docker-compose.prod.yml up -d
```

#### tracker-bridge

Production deployment for tracker integration:

```bash
# Deploy tracker-bridge (example)
cd tracker-bridge
docker-compose -f docker-compose.prod.yml up -d
```

### 5. Health Checks

```bash
# Control Plane health
curl http://localhost:3000/health

# Redis health
redis-cli ping

# Full health check
curl http://localhost:3000/health/ready
```

### 6. Monitoring

#### Logs

```bash
# Docker logs
docker-compose logs -f shipyard-cp

# Kubernetes logs
kubectl logs -f deployment/shipyard-cp
```

#### Metrics (TODO)

Prometheus metrics endpoint: `/metrics`

## Scaling Considerations

### Horizontal Scaling

With Redis persistence, you can run multiple Control Plane instances:

```yaml
# docker-compose.scale.yml
services:
  shipyard-cp:
    deploy:
      replicas: 3
```

### Load Balancer

Use a load balancer (nginx, HAProxy, cloud LB) in front:

```nginx
upstream shipyard-cp {
    server shipyard-cp-1:3000;
    server shipyard-cp-2:3000;
    server shipyard-cp-3:3000;
}

server {
    listen 80;
    location / {
        proxy_pass http://shipyard-cp;
    }
}
```

## Security Checklist

- [ ] Enable authentication (API_KEY)
- [ ] Configure TLS/HTTPS
- [ ] Use secrets management (not .env files in production)
- [ ] Restrict Redis access (network/VPC)
- [ ] Enable Redis AUTH
- [ ] Configure CORS appropriately
- [ ] Review and rotate API keys regularly
- [ ] Enable audit logging

## Troubleshooting

### Common Issues

1. **Redis connection refused**
   ```bash
   # Check Redis is running
   redis-cli ping

   # Check network connectivity
   telnet redis-host 6379
   ```

2. **Out of memory**
   ```bash
   # Increase Redis maxmemory
   redis-cli config set maxmemory 512mb
   ```

3. **Slow responses**
   ```bash
   # Check Redis latency
   redis-cli --latency

   # Check memory usage
   redis-cli info memory
   ```

### Logs

Set log level for debugging:

```bash
LOG_LEVEL=debug
DEBUG_SHIPYARD=*
```

## Backup & Recovery

### Redis Backup

```bash
# Trigger RDB snapshot
redis-cli BGSAVE

# Copy dump file
cp /var/lib/redis/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
```

### Disaster Recovery

1. Restore Redis from backup
2. Restart Control Plane services
3. Verify data integrity with health checks

## Maintenance

### Rolling Updates

```bash
# Kubernetes rolling update
kubectl set image deployment/shipyard-cp shipyard-cp=shipyard-cp:v2

# Docker Compose
docker-compose pull shipyard-cp
docker-compose up -d shipyard-cp
```

### Database Migrations

Currently using Redis - no schema migrations needed.

## Cost Estimation

| Component | Cloud Provider | Estimated Cost |
|-----------|---------------|----------------|
| Control Plane (3 instances) | AWS/GCP | $50-100/month |
| Redis (1GB) | ElastiCache/Memorystore | $20-50/month |
| Load Balancer | AWS ALB/GCP LB | $20-30/month |
| **Total** | | **$90-180/month** |

## Next Steps

1. Implement authentication (P1)
2. Add CI/CD pipeline
3. Set up monitoring and alerting
4. Configure backup automation
5. Security hardening